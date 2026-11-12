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

export interface GpsFixCandidate {
  name: string
  record: unknown
}

export interface SelectedGpsFixCandidate extends GpsFixCandidate {
  fix: VerifiedGpsFix
}

export interface GpsCandidateSelection {
  selected: SelectedGpsFixCandidate | null
  rejected: Array<{ name: string; reasons: string[] }>
}

export interface PreviousVerifiedGpsPosition {
  latitude: number | null
  longitude: number | null
  timestamp: string | null
  source: string | null
  hasGpsFix: boolean
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
const VALID_FLAG_VALUES = new Set(['1', 'A', 'ACTIVE', 'TRUE', 'VALID', 'YES'])
const INVALID_FLAG_VALUES = new Set(['0', 'FALSE', 'INVALID', 'NO', 'V'])
const HISTORY_WRAPPER_KEYS = [
  'history',
  'gps_history',
  'records',
  'results',
  'locations',
  'items',
  'points',
  'payload',
  'result',
  'gps',
  'value',
  'data',
] as const
const LATEST_WRAPPER_KEYS = [
  'latest',
  'fix',
  'location',
  'gps',
  'payload',
  'result',
  'value',
  'data',
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasCoordinatePair(record: Record<string, unknown>): boolean {
  const hasLatitude = ['latitude', 'lat', 'last_latitude'].some((key) => key in record)
  const hasLongitude = ['longitude', 'lon', 'lng', 'last_longitude'].some((key) => key in record)
  return hasLatitude && hasLongitude
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function normalizeStatus(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function validDateParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): boolean {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  )
}

export function parseGpsTimestamp(value: unknown): number | null {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) && time > 0 ? time : null
  }
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: unknown; nanoseconds?: unknown; toDate?: () => Date }
    if (typeof timestamp.toDate === 'function') {
      try {
        const date = timestamp.toDate()
        const time = date instanceof Date ? date.getTime() : NaN
        return Number.isFinite(time) && time > 0 ? time : null
      } catch {
        return null
      }
    }
    if (typeof timestamp.seconds === 'number' && Number.isFinite(timestamp.seconds)) {
      const nanos = typeof timestamp.nanoseconds === 'number' &&
        Number.isFinite(timestamp.nanoseconds) &&
        timestamp.nanoseconds >= 0
        ? timestamp.nanoseconds
        : 0
      const time = timestamp.seconds * 1000 + nanos / 1_000_000
      return Number.isFinite(time) && time > 0 ? time : null
    }
    return null
  }
  if (typeof value === 'number') {
    const time = value > 0 && value < 1_000_000_000_000 ? value * 1000 : value
    return Number.isFinite(time) && time > 0 ? time : null
  }

  const text = String(value).trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text)
    if (!Number.isFinite(numeric) || numeric <= 0) return null
    const time = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
    return Number.isFinite(time) ? time : null
  }

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/i
  )
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , timezone] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (!validDateParts(year, month, day, hour, minute, second)) return null

  if (timezone && timezone.toUpperCase() !== 'Z') {
    const offset = timezone.match(/^[+-](\d{2}):?(\d{2})$/)
    if (!offset || Number(offset[1]) > 23 || Number(offset[2]) > 59) return null
  }
  const normalized = text.includes(' ') ? text.replace(' ', 'T') : text
  const withTimezone = timezone ? normalized : `${normalized}Z`
  const parsed = Date.parse(withTimezone)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function extractRawPacketStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.replace(/^\[+|\]+$/g, '').split(',')[3]?.trim().toUpperCase() ?? null
}

function inspectGpsFix(value: unknown, now: number): {
  fix: VerifiedGpsFix | null
  reasons: string[]
} {
  const record = asRecord(value)
  if (!record) return { fix: null, reasons: ['missing-record'] }

  const reasons: string[] = []
  const sourceValue = firstValue(
    record.gps_source,
    record.source,
    record.location_source,
    record.provider,
    record.gps_fix_source
  )
  const source = String(sourceValue ?? '').trim().toLowerCase()
  if (!source) reasons.push('missing-source')
  else if (!VERIFIED_GPS_SOURCES.includes(source as (typeof VERIFIED_GPS_SOURCES)[number])) {
    reasons.push('unrecognized-source')
  }

  const flags = [record.gps_valid, record.gps_fix, record.has_gps_fix, record.valid].filter(
    (flag) => flag !== undefined && flag !== null && flag !== ''
  )
  const explicitStatus = firstValue(
    record.gps_status,
    record.validity,
    record.fix_status
  )
  const genericStatus = normalizeStatus(record.status)
  const statusValue = firstValue(
    explicitStatus,
    VALID_STATUS_VALUES.has(genericStatus) || INVALID_FLAG_VALUES.has(genericStatus)
      ? genericStatus
      : undefined
  )
  const rawStatus = extractRawPacketStatus(
    firstValue(record.raw, record.raw_packet, record.gps_packet)
  )
  const status = normalizeStatus(firstValue(statusValue, rawStatus))
  const recognizedStatus = VALID_STATUS_VALUES.has(status)
  if (status && !recognizedStatus) reasons.push('invalid-status')
  if (flags.some((flag) => INVALID_FLAG_VALUES.has(String(flag).trim().toUpperCase()))) {
    reasons.push('invalid-validity-flag')
  } else if (flags.some((flag) => !VALID_FLAG_VALUES.has(String(flag).trim().toUpperCase()))) {
    reasons.push('unrecognized-validity-flag')
  }
  if (flags.length === 0 && !recognizedStatus) reasons.push('missing-validity-status')

  const latitudeValue = firstValue(record.latitude, record.lat, record.last_latitude)
  const longitudeValue = firstValue(record.longitude, record.lon, record.lng, record.last_longitude)
  if (latitudeValue == null || longitudeValue == null) {
    reasons.push('missing-coordinates')
  }
  const latitude = Number(latitudeValue)
  const longitude = Number(longitudeValue)
  if (
    latitudeValue != null &&
    longitudeValue != null &&
    (!Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      (latitude === 0 && longitude === 0))
  ) reasons.push('invalid-coordinates')

  const rawTimestamp = firstValue(
    record.recorded_at,
    record.timestamp,
    record.gps_time,
    record.gps_timestamp,
    record.device_timestamp,
    record.gps_recorded_at,
    record.at,
    record.received_at,
    record.last_valid_gps_time,
    record.gps_update_time
  )
  const timestamp = parseGpsTimestamp(rawTimestamp)
  if (rawTimestamp == null) reasons.push('missing-gps-timestamp')
  else if (timestamp === null) reasons.push('invalid-gps-timestamp')
  else if (timestamp > now) reasons.push('future-gps-timestamp')

  if (reasons.length > 0 || timestamp === null) return { fix: null, reasons }

  const accuracyValue = Number(record.accuracy_m ?? record.accuracy)
  return {
    fix: {
      latitude,
      longitude,
      timestamp,
      recordedAt: new Date(timestamp).toISOString(),
      accuracy: Number.isFinite(accuracyValue) && accuracyValue > 0 ? accuracyValue : null,
      source: source as VerifiedGpsFix['source'],
      status: recognizedStatus ? status : null,
      key: `${timestamp}|${latitude.toFixed(6)},${longitude.toFixed(6)}`,
    },
    reasons: [],
  }
}

export function getGpsFixRejectionReasons(value: unknown, now = Date.now()): string[] {
  return inspectGpsFix(value, now).reasons
}

export function normalizeVerifiedGpsFix(value: unknown, now = Date.now()): VerifiedGpsFix | null {
  return inspectGpsFix(value, now).fix
}

export function selectNewestVerifiedGpsCandidate(
  candidates: readonly GpsFixCandidate[],
  now = Date.now()
): GpsCandidateSelection {
  let selected: SelectedGpsFixCandidate | null = null
  const rejected: GpsCandidateSelection['rejected'] = []
  for (const candidate of candidates) {
    const result = inspectGpsFix(candidate.record, now)
    if (!result.fix) {
      rejected.push({ name: candidate.name, reasons: result.reasons })
    } else if (!selected || result.fix.timestamp > selected.fix.timestamp) {
      selected = { ...candidate, fix: result.fix }
    }
  }
  return { selected, rejected }
}

export function collectFirestoreGpsCandidates(
  value: unknown,
  previous?: PreviousVerifiedGpsPosition | null
): GpsFixCandidate[] {
  const data = asRecord(value)
  if (!data) return []
  const candidates: GpsFixCandidate[] = []
  const addCandidate = (name: string, candidate: unknown) => {
    if (asRecord(candidate)) candidates.push({ name, record: candidate })
  }
  const latest = asRecord(data.latest)
  addCandidate('latest.location', latest?.location)
  addCandidate('latest.location_on_demand', latest?.location_on_demand)
  addCandidate('latest.other', latest?.other)
  addCandidate('last_location', data.last_location)
  addCandidate('last_fix', data.last_fix)

  const rootFields = [
    'latitude', 'longitude', 'lat', 'lon', 'lng', 'last_latitude', 'last_longitude',
    'gps_valid', 'gps_fix', 'has_gps_fix', 'valid', 'gps_status', 'validity',
    'fix_status', 'status', 'gps_source', 'source', 'location_source', 'provider',
    'gps_fix_source', 'recorded_at', 'timestamp', 'gps_time', 'gps_timestamp',
    'device_timestamp', 'gps_recorded_at', 'at', 'received_at', 'last_valid_gps_time',
    'gps_update_time', 'accuracy', 'accuracy_m', 'speed', 'speed_kmh', 'heading',
    'bearing', 'course',
  ]
  const rootCandidate: Record<string, unknown> = {}
  for (const field of rootFields) {
    if (field in data) rootCandidate[field] = data[field]
  }
  if (hasCoordinatePair(rootCandidate)) addCandidate('root', rootCandidate)

  if (
    previous?.hasGpsFix &&
    previous.latitude !== null &&
    previous.longitude !== null &&
    previous.timestamp
  ) {
    candidates.push({
      name: 'previous_verified_position',
      record: {
        latitude: previous.latitude,
        longitude: previous.longitude,
        gps_valid: true,
        gps_source: previous.source,
        recorded_at: previous.timestamp,
      },
    })
  }
  return candidates
}

export function logGpsValidationDiagnostics(
  scope: string,
  rejected: Array<{ name: string; reasons: string[] }>
): void {
  if (typeof import.meta.env === 'undefined' || !import.meta.env.DEV || rejected.length === 0) return
  const counts = new Map<string, number>()
  for (const candidate of rejected) {
    for (const reason of new Set(candidate.reasons)) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1)
    }
  }
  console.warn(`[gps] ${scope}: rejected ${rejected.length} unverified candidate(s).`, {
    candidateNames: rejected.map(({ name }) => name),
    reasonCounts: Object.fromEntries(counts),
  })
}

export function unwrapGpsLatestResponse(value: unknown): Record<string, unknown> | null {
  const visited = new Set<object>()
  let current = value
  for (let depth = 0; depth <= 4; depth += 1) {
    const record = asRecord(current)
    if (!record || visited.has(record)) return null
    visited.add(record)
    if (hasCoordinatePair(record)) return record
    const next = LATEST_WRAPPER_KEYS
      .map((key) => record[key])
      .find((candidate) => candidate !== undefined && candidate !== null)
    if (next === undefined) return null
    current = next
  }
  return null
}

export function unwrapGpsHistoryResponse(value: unknown): unknown[] | null {
  const visited = new Set<object>()
  const unwrap = (candidate: unknown, depth: number): unknown[] | null => {
    if (Array.isArray(candidate)) return candidate
    const record = asRecord(candidate)
    if (!record || visited.has(record) || depth > 4) return null
    visited.add(record)
    for (const key of HISTORY_WRAPPER_KEYS) {
      if (record[key] === undefined || record[key] === null) continue
      const result = unwrap(record[key], depth + 1)
      if (result !== null) return result
    }
    if (hasCoordinatePair(record)) return [record]
    return null
  }
  return unwrap(value, 0)
}

export function isFreshGpsTimestamp(
  timestamp: number | null,
  now = Date.now(),
  maxAgeMs = GPS_FRESHNESS_MS
): boolean {
  return timestamp !== null && timestamp <= now && now - timestamp <= maxAgeMs
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
  const rawHistory = unwrapGpsHistoryResponse(historyValue) ?? []
  const uniqueHistory = new Map<string, VerifiedGpsFix>()
  for (const value of rawHistory) {
    const fix = normalizeVerifiedGpsFix(value, now)
    if (fix) uniqueHistory.set(fix.key, fix)
  }
  const history = [...uniqueHistory.values()].sort((first, second) => first.timestamp - second.timestamp)
  const latestRecord = unwrapGpsLatestResponse(latestValue)
  const latest = latestRecord ? normalizeVerifiedGpsFix(latestRecord, now) : null
  const historyKeys = new Set(history.map((fix) => fix.key))
  const current = latest && isFreshGpsTimestamp(latest.timestamp, now) ? latest : null
  return {
    history,
    current,
    latestMissingFromHistory: latest !== null && !historyKeys.has(latest.key),
  }
}
