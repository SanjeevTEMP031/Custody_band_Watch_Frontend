export const VERIFIED_GPS_SOURCES = ['watch_tcp', 'gps_ingest_api'] as const
export const GPS_FRESHNESS_MS = 5 * 60_000

export interface VerifiedGpsFix {
  latitude: number
  longitude: number
  timestamp: number
  recordedAt: string
  accuracy: number | null
  source: (typeof VERIFIED_GPS_SOURCES)[number]
  status: string | null
  key: string
}

const VALID_STATUS_VALUES = new Set([
  'A',
  'ACTIVE',
  'FIX',
  'FIXED',
  'GPS FIX',
  'GPS LOCKED',
  'GPS VALID',
  'OK',
  'VALID',
])
const VALID_FLAG_VALUES = new Set(['1', 'A', 'ACTIVE', 'TRUE', 'YES'])
const INVALID_FLAG_VALUES = new Set(['0', 'FALSE', 'INVALID', 'NO', 'V'])

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function parseTimestamp(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: unknown; toDate?: () => Date }
    if (typeof timestamp.toDate === 'function') {
      const milliseconds = timestamp.toDate().getTime()
      return Number.isFinite(milliseconds) ? milliseconds : null
    }
    if (typeof timestamp.seconds === 'number') return timestamp.seconds * 1000
  }
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  }
  const text = String(value).trim()
  const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`
  const parsed = Date.parse(withTimezone)
  return Number.isFinite(parsed) ? parsed : null
}

function isValidFlag(value: unknown): boolean {
  return VALID_FLAG_VALUES.has(String(value).trim().toUpperCase())
}

function isInvalidFlag(value: unknown): boolean {
  return INVALID_FLAG_VALUES.has(String(value).trim().toUpperCase())
}

function extractRawPacketStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.replace(/^\[+|\]+$/g, '').split(',')[3]?.trim().toUpperCase() ?? null
}

export function normalizeVerifiedGpsFix(value: unknown, now = Date.now()): VerifiedGpsFix | null {
  const record = asRecord(value)
  if (!record) return null
  const raw = asRecord(record.raw)
  const sourceValue = firstValue(
    record.gps_source,
    record.source,
    record.location_source,
    record.provider,
    record.gps_fix_source,
    raw?.gps_source,
    raw?.source,
    raw?.location_source,
    raw?.provider
  )
  const source = String(sourceValue ?? '').trim().toLowerCase()
  if (!VERIFIED_GPS_SOURCES.includes(source as (typeof VERIFIED_GPS_SOURCES)[number])) return null

  const flags = [record.gps_valid, record.gps_fix, record.has_gps_fix, record.valid].filter(
    (flag) => flag !== undefined && flag !== null && flag !== ''
  )
  const explicitStatus = firstValue(
    record.gps_status,
    record.validity,
    record.fix_status,
    raw?.gps_status,
    raw?.validity,
    raw?.fix_status
  )
  const genericStatus = String(record.status ?? '').trim().toUpperCase()
  const statusValue = firstValue(
    explicitStatus,
    VALID_STATUS_VALUES.has(genericStatus) || INVALID_FLAG_VALUES.has(genericStatus)
      ? genericStatus
      : undefined
  )
  const rawStatus = extractRawPacketStatus(
    firstValue(record.raw, record.raw_packet, record.gps_packet, raw?.raw, raw?.raw_packet, raw?.gps_packet)
  )
  const status = String(firstValue(statusValue, rawStatus) ?? '').trim().toUpperCase()
  const recognizedStatus = VALID_STATUS_VALUES.has(status)
  if (status && !recognizedStatus) return null
  if (flags.some(isInvalidFlag) || flags.some((flag) => !isValidFlag(flag))) return null
  if (flags.length === 0 && !recognizedStatus) return null

  const latitudeValue = firstValue(
    record.latitude,
    record.lat,
    record.last_latitude,
    raw?.latitude,
    raw?.lat,
    raw?.last_latitude
  )
  const longitudeValue = firstValue(
    record.longitude,
    record.lon,
    record.lng,
    record.last_longitude,
    raw?.longitude,
    raw?.lon,
    raw?.lng,
    raw?.last_longitude
  )
  if (latitudeValue == null || longitudeValue == null) return null
  const latitude = Number(latitudeValue)
  const longitude = Number(longitudeValue)
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) return null

  const timestamp = parseTimestamp(firstValue(
    record.last_valid_gps_time,
    record.gps_timestamp,
    record.gps_time,
    record.recorded_at,
    record.timestamp,
    record.device_timestamp,
    record.received_at,
    record.gps_update_time,
    record.at,
    raw?.last_valid_gps_time,
    raw?.gps_timestamp,
    raw?.gps_time,
    raw?.recorded_at,
    raw?.timestamp,
    raw?.device_timestamp,
    raw?.received_at,
    raw?.gps_update_time,
    raw?.at
  ))
  if (timestamp === null || timestamp > now + 60_000) return null

  const accuracyValue = Number(record.accuracy_m ?? record.accuracy ?? raw?.accuracy_m ?? raw?.accuracy)
  return {
    latitude,
    longitude,
    timestamp,
    recordedAt: new Date(timestamp).toISOString(),
    accuracy: Number.isFinite(accuracyValue) && accuracyValue > 0 ? accuracyValue : null,
    source: source as VerifiedGpsFix['source'],
    status: recognizedStatus ? status : null,
    key: `${timestamp}|${latitude.toFixed(6)},${longitude.toFixed(6)}`,
  }
}

export function isFreshGpsTimestamp(
  timestamp: number | null,
  now = Date.now(),
  maxAgeMs = GPS_FRESHNESS_MS
): boolean {
  return timestamp !== null && now - timestamp >= 0 && now - timestamp <= maxAgeMs
}

export interface MergedGpsFixes {
  history: VerifiedGpsFix[]
  current: VerifiedGpsFix | null
  latestMissingFromHistory: boolean
}

export function mergeVerifiedGpsFixes(
  historyValue: unknown,
  latestValue: unknown,
  now = Date.now()
): MergedGpsFixes {
  const rawHistory = Array.isArray(historyValue) ? historyValue : []
  const uniqueHistory = new Map<string, VerifiedGpsFix>()
  for (const value of rawHistory) {
    const fix = normalizeVerifiedGpsFix(value, now)
    if (fix) uniqueHistory.set(fix.key, fix)
  }
  const history = [...uniqueHistory.values()].sort((first, second) => first.timestamp - second.timestamp)
  const latest = normalizeVerifiedGpsFix(latestValue, now)
  const historyKeys = new Set(history.map((fix) => fix.key))
  const current = latest && isFreshGpsTimestamp(latest.timestamp, now) ? latest : null
  return {
    history,
    current,
    latestMissingFromHistory: latest !== null && !historyKeys.has(latest.key),
  }
}
