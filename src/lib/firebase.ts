import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  limit as firestoreLimit,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { app, firebaseConfig, analytics } from '../firebase/config'
import type { Device } from '../services/api'

// Initialize services from the single shared Firebase app instance
export const db = getFirestore(app)
export const auth = getAuth(app)
export { app, firebaseConfig, analytics }

/**
 * Parses any Firestore timestamp, ISO string, or numeric epoch into millisecond epoch.
 * Returns null if the value is missing or invalid.
 */
export function parseTimestamp(val: unknown): number | null {
  if (val == null) return null
  if (typeof val === 'number') {
    // If in seconds (10 digits), convert to ms
    return val < 1e11 ? val * 1000 : val
  }

  if (typeof val === 'string') {
    const parsed = Date.parse(val)
    return isNaN(parsed) ? null : parsed
  }
  if (typeof val === 'object') {
    // Firestore Timestamp with toDate()
    if ('toDate' in val && typeof (val as any).toDate === 'function') {
      try {
        return (val as any).toDate().getTime()
      } catch {
        // Ignore and continue
      }
    }
    // Firestore Timestamp serialized: { seconds, nanoseconds }
    if ('seconds' in val && typeof (val as any).seconds === 'number') {
      return (val as any).seconds * 1000
    }
  }
  return null
}

export interface ExtractedBattery {
  percentage: number | null
  timestamp: number | null
}

/**
 * Inspects all possible battery fields in a device document and selects
 * the latest valid measurement based on the event timestamps.
 * Does NOT blindly select the first available field.
 */
export function extractLatestBattery(data: Record<string, any>): number | null {
  if (!data || typeof data !== 'object') return null

  interface Candidate {
    value: number
    time: number
    priority: number // Fallback priority if timestamps are identical
  }

  const candidates: Candidate[] = []

  const addCandidate = (val: unknown, timeVal: unknown, priority: number) => {
    if (val !== null && val !== undefined && val !== '') {
      const percentage = Number(val)
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return
      const time = parseTimestamp(timeVal) ?? 0
      candidates.push({ value: Math.round(percentage), time, priority })
    }
  }

  // 1. Nested latest.status
  addCandidate(
    data.latest?.status?.battery_percent,
    data.latest?.status?.received_at ?? data.latest?.status?.timestamp ?? data.updated_at,
    10
  )

  // 2. Nested latest.location
  addCandidate(
    data.latest?.location?.battery_percent ?? data.latest?.location?.battery,
    data.latest?.location?.received_at ?? data.latest?.location?.device_timestamp,
    9
  )
  // 3. Nested latest.sos_alarm
  addCandidate(
    data.latest?.sos_alarm?.battery_percent ?? data.latest?.sos_alarm?.battery,
    data.latest?.sos_alarm?.received_at ?? data.latest?.sos_alarm?.gps_time,
    7
  )

  // 4. Root level fields with general update/seen timestamps
  const rootTime = parseTimestamp(data.updated_at ?? data.last_seen_at ?? data.last_seen ?? data.received_at) ?? 0

  addCandidate(data.battery_percent, rootTime, 7)
  addCandidate(data.battery_pct, rootTime, 6)
  addCandidate(data.battery_level, rootTime, 5)
  addCandidate(data.battery, rootTime, 4)

  // 5. Legacy nested last_location
  addCandidate(
    data.last_location?.battery_level ?? data.last_location?.battery_percent,
    data.last_location?.received_at ?? data.last_location?.device_timestamp,
    3
  )

  if (candidates.length === 0) return null

  // Sort descending by timestamp, then by field priority
  candidates.sort((a, b) => {
    if (b.time !== a.time) return b.time - a.time
    return b.priority - a.priority
  })

  return candidates[0].value
}

import {
  collectLastReportedGpsCandidates,
  collectFirestoreGpsCandidates,
  logGpsValidationDiagnostics,
  normalizeFirestoreGpsLog,
  normalizeVerifiedGpsFix,
  selectNewestLastReportedGpsLocation,
  selectNewestVerifiedGpsCandidate,
} from '../services/gpsNormalization'

export interface ExtractedGps {
  latitude: number | null
  longitude: number | null
  hasGpsFix: boolean
  gpsUpdateTime: string | null
  gpsSource: string | null
  speed_kmh: number | null
  heading: number | null
}

/**
 * Parses raw hardware packet from Huateng C05 GPS wristband.
 * Format: [MNYD*ID*LEN*CMD, date, time, status, lat, lat_dir, lon, lon_dir, speed, ...]
 */
export function parseRawGpsPacket(rawStr?: string | null): {
  latitude: number
  longitude: number
  speed_kmh: number | null
  battery_pct: number | null
  gps_fix: boolean
} | null {
  if (!rawStr || typeof rawStr !== 'string') return null
  const cleaned = rawStr.replace(/^\[+|\]+$/g, '')
  const parts = cleaned.split(',')
  if (parts.length >= 8) {
    const status = parts[3]?.trim().toUpperCase() // 'A' = valid active fix, 'V' = void
    const rawLat = parseFloat(parts[4])
    const latDir = parts[5]?.trim().toUpperCase()
    const rawLon = parseFloat(parts[6])
    const lonDir = parts[7]?.trim().toUpperCase()

    if (Number.isFinite(rawLat) && Number.isFinite(rawLon) && rawLat !== 0 && rawLon !== 0) {
      const lat = latDir === 'S' ? -Math.abs(rawLat) : Math.abs(rawLat)
      const lon = lonDir === 'W' ? -Math.abs(rawLon) : Math.abs(rawLon)
      const speed = parts[8] ? parseFloat(parts[8]) : null
      const battery = parts[13] ? parseInt(parts[13], 10) : null

      return {
        latitude: lat,
        longitude: lon,
        speed_kmh: Number.isFinite(speed) ? speed : null,
        battery_pct: Number.isFinite(battery) ? battery : null,
        gps_fix: status === 'A',
      }
    }
  }
  return null
}

/**
 * Selects the newest independently verified Firestore GPS candidate.
 */
export function extractLatestGps(
  data: Record<string, any>,
  prevDevice?: Device | null
): ExtractedGps {
  const previous = prevDevice
    ? {
        latitude: prevDevice.last_latitude ?? null,
        longitude: prevDevice.last_longitude ?? null,
        timestamp: prevDevice.gps_update_time ?? null,
        source: prevDevice.gps_fix_source ?? null,
        hasGpsFix: prevDevice.has_gps_fix === true,
      }
    : null
  const candidates = collectFirestoreGpsCandidates(data, previous)
  const latest = data.latest && typeof data.latest === 'object' ? data.latest : {}
  const packetCandidates = ['location', 'location_on_demand', 'sos_alarm', 'other'].flatMap((key) => {
    const location = latest[key]
    if (!location || typeof location !== 'object' || typeof location.raw !== 'string') return []
    const parsed = parseRawGpsPacket(location.raw)
    if (
      !parsed ||
      location.gps_fix === false ||
      location.gps_valid === false ||
      location.gps_status === 'V'
    ) return []
    return [{
      name: `latest.${key}.raw`,
      record: {
        ...location,
        ...parsed,
        gps_fix: location.gps_fix ?? parsed.gps_fix,
        gps_status: parsed.gps_fix ? 'A' : 'V',
      },
    }]
  })
  const selection = selectNewestVerifiedGpsCandidate([...packetCandidates, ...candidates])
  logGpsValidationDiagnostics('Firestore device document', selection.rejected)
  const selected = selection.selected
  if (!selected) {
    return {
      latitude: null,
      longitude: null,
      hasGpsFix: false,
      gpsUpdateTime: null,
      gpsSource: null,
      speed_kmh: null,
      heading: null,
    }
  }

  const record = selected.record as Record<string, unknown>
  const finiteNumber = (...values: unknown[]): number | null => {
    for (const value of values) {
      if (value === undefined || value === null || value === '') continue
      const number = Number(value)
      if (Number.isFinite(number)) return number
    }
    return null
  }
  return {
    latitude: selected.fix.latitude,
    longitude: selected.fix.longitude,
    hasGpsFix: true,
    gpsUpdateTime: selected.fix.recordedAt,
    gpsSource: selected.fix.source,
    speed_kmh: finiteNumber(record.speed_kmh, record.speed),
    heading: finiteNumber(record.heading, record.bearing, record.course),
  }
}

/**
 * Considers a device online when its last communication was within 11 minutes.
 */
export function isDeviceOnline(data: Record<string, any>): boolean {
  if (data.deleted_at != null) return false

  const now = Date.now()
  const lastTime =
    parseTimestamp(data.last_seen) ??
    parseTimestamp(data.last_seen_at) ??
    parseTimestamp(data.updated_at) ??
    parseTimestamp(data.received_at) ??
    parseTimestamp(data.last_location?.received_at) ??
    parseTimestamp(data.latest?.location?.received_at) ??
    parseTimestamp(data.latest?.location_on_demand?.received_at)

  if (lastTime != null) {
    return now >= lastTime && now - lastTime <= 10 * 60 * 1000
  }

  const conn = String(data.connection_status || data.status || '').toLowerCase()
  return conn === 'online' || conn === 'active'
}

/**
 * Maps a Firestore document into a normalized Device object.
 * Preserves previously valid GPS coordinates if incoming update has no fix.
 */
export function mapFirestoreDocToDevice(
  id: string,
  data: Record<string, any>,
  prevDevice?: Device | null
): Device {
  const batteryPct = extractLatestBattery(data)
  const gps = extractLatestGps(data, prevDevice)
  const lastReportedGps = selectNewestLastReportedGpsLocation(
    collectLastReportedGpsCandidates(data).map(({ record }) => record)
  )
  const online = isDeviceOnline(data)

  const rawLastSeen =
    data.last_seen ??
    data.last_seen_at ??
    data.updated_at ??
    data.received_at ??
    data.last_location?.received_at ??
    data.latest?.location?.received_at ??
    null

  const lastSeenStr = rawLastSeen
    ? (typeof rawLastSeen === 'string'
        ? rawLastSeen
        : new Date(parseTimestamp(rawLastSeen) ?? 0).toISOString())
    : null

  const rawWearer =
    data.name ||
    data.device_name ||
    data.wearer_name ||
    data.assigned_person_name ||
    null

  // Never display "Demo Wearer"
  const isDemo = rawWearer && String(rawWearer).toLowerCase().includes('demo')
  const deviceName = isDemo || !rawWearer ? `Watch #${id.slice(-6)}` : rawWearer

  const imei = data.imei || data.device_id || data.vendor_device_id || id
  const latest = data.latest && typeof data.latest === 'object' ? data.latest : {}
  const latestStatus = latest.status ?? {}
  const latestLocation = latest.location ?? latest.location_on_demand ?? latest.sos_alarm ?? {}
  const latestHeartRate = latest.heart_rate ?? {}
  const latestBloodPressure = latest.blood_pressure ?? {}
  const bloodPressureValue =
    data.blood_pressure ??
    (latestBloodPressure.systolic != null && latestBloodPressure.diastolic != null
      ? `${latestBloodPressure.systolic}/${latestBloodPressure.diastolic}`
      : latestBloodPressure)
  const latestSleep = latest.sleep ?? latest.sleep_report ?? latest.sleep_allday
  const sleep = latestSleep && typeof latestSleep === 'object'
    ? ([
        latestSleep.awake_min != null ? `Awake: ${latestSleep.awake_min} min` : null,
        latestSleep.light_min != null ? `Light: ${latestSleep.light_min} min` : null,
        latestSleep.deep_min != null ? `Deep: ${latestSleep.deep_min} min` : null,
        latestSleep.total_min != null ? `Total: ${latestSleep.total_min} min` : null,
        latestSleep.sleep_min != null ? `Sleep: ${latestSleep.sleep_min} min` : null,
        latestSleep.date != null ? String(latestSleep.date) : null,
      ].filter(Boolean).join(', ') || data.sleep) ?? null
    : latestSleep ?? data.sleep ?? null
  const heartRate = latestHeartRate.heart_rate_bpm ?? data.heart_rate_bpm ?? data.heart_rate ?? null
  const bloodOxygen = latest.blood_oxygen?.spo2_percent ?? data.spo2_percent ?? data.blood_oxygen ?? null
  const bloodGlucose = latest.blood_glucose?.glucose_mmol_l ?? data.glucose_mmol_l ?? data.blood_glucose ?? null

  return {
    id: data.id ?? id,
    device_id: String(imei),
    device_name: deviceName,
    company: data.company ?? data.tenant_id ?? null,
    parent_customer: data.parent_customer ?? null,
    is_subcompany: Boolean(data.is_subcompany),
    device_sim: data.device_sim ?? data.sim_number ?? data.phone ?? null,
    device_model: data.model ?? data.device_model ?? 'Huateng C05',
    activation_time: data.activated_at ?? data.activation_time ?? null,
    expire_time: data.expires_at ?? data.expire_time ?? null,
    heart_rate: heartRate,
    heart_rate_bpm: heartRate,
    hrv: latestHeartRate.hrv ?? data.hrv ?? null,
    blood_pressure: typeof bloodPressureValue === 'object' && bloodPressureValue !== null
      ? `${bloodPressureValue.systolic ?? ''}${bloodPressureValue.systolic != null && bloodPressureValue.diastolic != null ? '/' : ''}${bloodPressureValue.diastolic ?? ''}`
      : bloodPressureValue,
    systolic: latestBloodPressure.systolic ?? data.systolic ?? null,
    diastolic: latestBloodPressure.diastolic ?? data.diastolic ?? null,
    temperature: latest.temperature?.temperature_c ?? data.temperature_c ?? data.temperature ?? null,
    step_counter: data.steps ?? data.step_counter ?? latestStatus.steps ?? latestLocation.steps ?? null,
    steps: data.steps ?? data.step_counter ?? latestStatus.steps ?? latestLocation.steps ?? null,
    sleep,
    blood_oxygen: bloodOxygen,
    blood_glucose: bloodGlucose,
    glucose_mmol_l: bloodGlucose,
    created_at: data.created_at ? String(data.created_at) : null,
    serial_number: imei,
    imei: imei,
    status: online ? 'active' : 'offline',
    battery_pct: batteryPct,
    battery_percent: batteryPct,
    battery_status: data.battery_status ?? (batteryPct == null ? null : batteryPct > 20 ? 'normal' : 'low'),
    is_charging: Boolean(data.is_charging ?? data.charging ?? false),
    charging: Boolean(data.charging ?? data.is_charging ?? false),
    charge_status: data.charge_status ?? (data.is_charging || data.charging ? 'charging' : 'discharging'),
    last_seen: lastSeenStr,
    last_latitude: gps.latitude,
    last_longitude: gps.longitude,
    custody_person_id: data.assigned_person_id ?? data.custody_person_id ?? null,
    // Custom metadata properties:
    ...({
      has_gps_fix: gps.hasGpsFix,
      gps_update_time: gps.gpsUpdateTime,
      gps_fix_source: gps.gpsSource,
      gps_source: gps.gpsSource,
      gps_fix: gps.hasGpsFix,
      gps_valid: gps.hasGpsFix,
      gps_status: data.gps_status ?? data.validity ?? null,
      gps_last_fix: data.gps_last_fix ?? data.last_fix ?? null,
      gps_last_known_location: data.last_known_location ?? lastReportedGps,
      speed_kmh: gps.speed_kmh,
      speed: gps.speed_kmh,
      heading: gps.heading,
      direction_deg: gps.heading ?? data.direction_deg ?? latestLocation.direction_deg ?? null,
      altitude_m: data.altitude_m ?? latestLocation.altitude_m ?? null,
      satellites: data.satellites ?? latestLocation.satellites ?? null,
      signal_percent: data.signal_percent ?? latestLocation.signal_percent ?? null,
      gsm_signal: data.gsm_signal ?? data.signal_percent ?? latestLocation.signal_percent ?? null,
      rolls: data.rolls ?? latestLocation.rolls ?? null,
      alarms: data.alarms ?? latestLocation.alarms ?? null,
      cell_mcc: data.cell_mcc ?? latestLocation.cell_mcc ?? null,
      cell_mnc: data.cell_mnc ?? latestLocation.cell_mnc ?? null,
      cells: data.cells ?? latestLocation.cells ?? null,
      wifi: data.wifi ?? latestLocation.wifi ?? null,
      nearby_wifi_count: data.nearby_wifi_count ?? latestLocation.nearby_wifi_count ?? null,
      mileage_km: data.mileage_km ?? latestStatus.mileage_km ?? null,
      sleep_report: data.sleep_report ?? latest.sleep_report ?? null,
      sleep_allday: data.sleep_allday ?? latest.sleep_allday ?? null,
      latest,
      last_packet_received: lastSeenStr,
      last_valid_gps_time: gps.gpsUpdateTime,
      tcp_connected: data.tcp_connected ?? null,
      maps_url: data.maps_url ?? null,
      wearer_name: isDemo ? null : (data.wearer_name ?? data.assigned_person_name ?? null),
      connection_status: online ? 'online' : 'offline',
      tamper_status: data.tamper_status ?? 'normal',
      sos_status: data.sos_status ?? 'normal',
    } as any),
  }
}

// In-memory cache of previously known valid device locations across listener snapshots
const deviceLocationCache = new Map<string, Device>()

/**
 * Subscribes to real-time changes in the 'devices' Firestore collection.
 * Uses onSnapshot() and cleans up properly when unsubscribed.
 */
export function subscribeToDevices(
  onUpdate: (devices: Device[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const devicesCollection = collection(db, 'devices')

  return onSnapshot(
    devicesCollection,
    (snapshot) => {
      const deviceList: Device[] = []
      snapshot.forEach((docSnapshot) => {
        const id = docSnapshot.id
        const rawData = docSnapshot.data()
        const prev = deviceLocationCache.get(id)
        const device = mapFirestoreDocToDevice(id, rawData, prev)

        // Cache the latest device to retain coordinates on future fix losses
        deviceLocationCache.set(id, device)
        deviceList.push(device)
      })
      onUpdate(deviceList)
    },
    (err) => {
      console.error('Firestore devices subscription error:', err)
      if (onError) onError(err)
    }
  )
}

const DEVICE_TELEMETRY_FIELDS = [
  'battery',
  'battery_pct',
  'battery_percent',
  'battery_status',
  'is_charging',
  'charging',
  'charge_status',
  'heart_rate',
  'heart_rate_bpm',
  'hrv',
  'blood_pressure',
  'systolic',
  'diastolic',
  'temperature',
  'step_counter',
  'steps',
  'sleep',
  'sleep_report',
  'sleep_allday',
  'blood_oxygen',
  'blood_glucose',
  'glucose_mmol_l',
  'altitude_m',
  'satellites',
  'signal_percent',
  'gsm_signal',
  'rolls',
  'alarms',
  'cell_mcc',
  'cell_mnc',
  'cells',
  'wifi',
  'nearby_wifi_count',
  'mileage_km',
  'direction_deg',
  'gps_last_fix',
  'gps_last_known_location',
  'last_seen',
  'last_packet_received',
  'status',
  'connection_status',
  'online',
  'is_online',
  'is_active',
] as const

const DEVICE_POSITION_FIELDS = [
  'last_latitude',
  'last_longitude',
  'latitude',
  'longitude',
  'gps_update_time',
  'last_valid_gps_time',
  'gps_fix_source',
  'gps_source',
  'has_gps_fix',
  'gps_fix',
  'gps_valid',
  'gps_locked',
  'gps_status',
  'speed_kmh',
  'speed',
  'heading',
  'maps_url',
] as const

function deviceIdentifiers(device: Device): string[] {
  return [device.device_id, device.imei, device.serial_number, String(device.id)]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
}

/**
 * Combines REST device metadata with Firestore's current TCP telemetry.
 * Firestore contributes live GPS only when its fix passed validation.
 */
export function mergeDevicesWithFirestore(
  apiDevices: readonly Device[],
  firestoreDevices: readonly Device[]
): Device[] {
  const firestoreByIdentifier = new Map<string, Device>()
  for (const device of firestoreDevices) {
    for (const identifier of deviceIdentifiers(device)) {
      firestoreByIdentifier.set(identifier, device)
    }
  }

  const matchedFirestore = new Set<Device>()
  const merged = apiDevices.map((apiDevice) => {
    const firestoreDevice = deviceIdentifiers(apiDevice)
      .map((identifier) => firestoreByIdentifier.get(identifier))
      .find((device): device is Device => device !== undefined)
    if (!firestoreDevice) return apiDevice
    matchedFirestore.add(firestoreDevice)

    const result: Device = { ...apiDevice }
    const firestoreSeen = parseTimestamp(firestoreDevice.last_seen)
    const apiSeen = parseTimestamp(apiDevice.last_seen)
    const firestoreIsNewer = firestoreSeen !== null &&
      (apiSeen === null || firestoreSeen >= apiSeen)
    for (const field of DEVICE_TELEMETRY_FIELDS) {
      const value = firestoreDevice[field]
      const currentValue = apiDevice[field]
      const isConnectionState = field === 'status' ||
        field === 'connection_status' ||
        field === 'online' ||
        field === 'is_online' ||
        field === 'is_active' ||
        field === 'last_seen'
      if (
        value !== undefined &&
        value !== null &&
        value !== '' &&
        (
          isConnectionState ||
          currentValue === undefined ||
          currentValue === null ||
          currentValue === '' ||
          firestoreIsNewer
        )
      ) {
        Object.assign(result, { [field]: value })
      }
    }
    const firestoreFix = normalizeVerifiedGpsFix(firestoreDevice)
    const apiFix = normalizeVerifiedGpsFix(apiDevice)
    if (
      firestoreFix &&
      (!apiFix || firestoreFix.timestamp > apiFix.timestamp)
    ) {
      for (const field of DEVICE_POSITION_FIELDS) {
        const value = firestoreDevice[field]
        if (value !== undefined && value !== null && value !== '') {
          Object.assign(result, { [field]: value })
        }
      }
      Object.assign(result, {
        last_latitude: firestoreFix.latitude,
        last_longitude: firestoreFix.longitude,
        latitude: firestoreFix.latitude,
        longitude: firestoreFix.longitude,
        gps_update_time: firestoreFix.recordedAt,
        recorded_at: firestoreFix.recordedAt,
        gps_time: firestoreFix.recordedAt,
        gps_fix: true,
        gps_valid: true,
        has_gps_fix: true,
        gps_source: firestoreFix.source,
        gps_fix_source: firestoreFix.source,
        coordinate_source: null,
      })
    }
    result.device_id = firestoreDevice.device_id || apiDevice.device_id
    return result
  })

  for (const device of firestoreDevices) {
    if (!matchedFirestore.has(device)) merged.push(device)
  }
  return merged
}

/**
 * Subscribes to a single device document in real-time.
 */
export function subscribeToDevice(
  deviceId: string,
  onUpdate: (device: Device | null) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const deviceDoc = doc(db, 'devices', deviceId)

  return onSnapshot(
    deviceDoc,
    (snapshot) => {
      if (!snapshot.exists()) {
        onUpdate(null)
        return
      }
      const prev = deviceLocationCache.get(deviceId)
      const device = mapFirestoreDocToDevice(snapshot.id, snapshot.data(), prev)
      deviceLocationCache.set(deviceId, device)
      onUpdate(device)
    },
    (err) => {
      console.error(`Firestore device subscription error (${deviceId}):`, err)
      if (onError) onError(err)
    }
  )
}

// ============================================================================
// TRIP TRACKING, HAVERSINE DISTANCE & ROUTE HIGHLIGHTING
// ============================================================================

export interface TripPoint {
  latitude: number
  longitude: number
  timestamp: string
  speed_kmh?: number | null
  heading?: number | null
  accuracy_m?: number | null
  battery_pct?: number | null
}

function mapFirestoreGpsLogToTripPoint(data: Record<string, unknown>): TripPoint | null {
  const fix = normalizeFirestoreGpsLog(data)
  if (!fix) return null
  const numberOrNull = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    timestamp: fix.recordedAt,
    speed_kmh: numberOrNull(data.speed_kmh ?? data.speed),
    heading: numberOrNull(data.direction_deg ?? data.heading ?? data.bearing ?? data.course),
    accuracy_m: numberOrNull(data.accuracy_meters ?? data.accuracy_m),
    battery_pct: numberOrNull(data.battery_percent ?? data.battery_pct),
  }
}

/**
 * Subscribes to verified GPS log points so route views update as ingest logs arrive.
 */
export function subscribeToFirestoreLocationHistory(
  deviceId: string,
  maxPoints: number,
  onUpdate: (points: TripPoint[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const logsQuery = query(
    collection(db, 'logs'),
    where('device_id', '==', deviceId),
    where('type', 'in', ['location', 'location_on_demand', 'sos_alarm']),
    firestoreLimit(maxPoints)
  )

  return onSnapshot(
    logsQuery,
    (snapshot) => {
      const points = new Map<string, TripPoint>()
      snapshot.forEach((docSnapshot) => {
        const point = mapFirestoreGpsLogToTripPoint(docSnapshot.data())
        if (!point) return
        const key = `${point.timestamp}|${point.latitude}|${point.longitude}`
        points.set(key, point)
      })
      onUpdate(
        [...points.values()].sort(
          (first, second) =>
            (parseTimestamp(first.timestamp) ?? 0) - (parseTimestamp(second.timestamp) ?? 0)
        )
      )
    },
    (error) => {
      console.error(`Firestore GPS logs subscription failed for device ${deviceId}:`, error)
      onError?.(error)
    }
  )
}

export interface TripLocation {
  latitude: number
  longitude: number
  timestamp?: string
  address?: string | null
}

export interface TripRecord {
  id: string
  device_id: string
  wearer_name?: string | null
  status: 'in_progress' | 'completed'
  start_time: string
  end_time?: string | null
  start_location: TripLocation
  end_location?: TripLocation | null
  current_location?: TripLocation & {
    speed_kmh?: number | null
    heading?: number | null
  }
  total_distance_km: number
  point_count: number
  route_points: TripPoint[]
  created_at?: string
  updated_at?: string
}

// Aliases for Journey terminology
export type JourneyRecord = TripRecord
export type JourneyPoint = TripPoint

/**
 * Validates whether a coordinate pair is a genuine GPS fix.
 * Rejects (0, 0), NaN, non-finite, and out-of-bounds coordinates.
 */
export function isValidGpsCoord(lat: unknown, lon: unknown): boolean {
  if (lat == null || lon == null) return false
  const nLat = Number(lat)
  const nLon = Number(lon)
  if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return false
  if (nLat === 0 && nLon === 0) return false
  return nLat >= -90 && nLat <= 90 && nLon >= -180 && nLon <= 180
}

/**
 * Calculates the great-circle distance between two valid GPS coordinates
 * using the strict Haversine formula.
 *
 * Formula:
 *   a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
 *   c = 2 · atan2( √a, √(1−a) )
 *   d = R · c
 *
 * @returns Distance in kilometres.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (!isValidGpsCoord(lat1, lon1) || !isValidGpsCoord(lat2, lon2)) return 0
  if (lat1 === lat2 && lon1 === lon2) return 0

  const R = 6371.0 // Earth radius in kilometers
  const toRad = Math.PI / 180.0

  const phi1 = lat1 * toRad
  const phi2 = lat2 * toRad
  const deltaPhi = (lat2 - lat1) * toRad
  const deltaLambda = (lon2 - lon1) * toRad

  const a =
    Math.sin(deltaPhi / 2.0) * Math.sin(deltaPhi / 2.0) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2.0) * Math.sin(deltaLambda / 2.0)

  // Clamp a to [0, 1] to prevent floating point inaccuracies causing NaN
  const clampedA = Math.max(0, Math.min(1, a))
  const c = 2.0 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1.0 - clampedA))

  return R * c
}

/**
 * Validates consecutive GPS points, filtering duplicate jitter and unrealistic GPS jumps.
 *
 * Rules:
 * - Both points must be valid coordinates.
 * - Distance must be at least 3 meters (0.003 km) to discard micro-jitter when stationary.
 * - If timestamps are present and realistic: speed must not exceed 250 km/h (unrealistic for wearable tracker).
 *   If teleportation jump (> 10 km within 10 seconds), reject as outlier fix.
 */
export function isValidPointProgression(
  prevPoint: TripPoint,
  nextPoint: TripPoint
): { valid: boolean; distanceKm: number } {
  if (!isValidGpsCoord(prevPoint.latitude, prevPoint.longitude)) {
    return { valid: false, distanceKm: 0 }
  }
  if (!isValidGpsCoord(nextPoint.latitude, nextPoint.longitude)) {
    return { valid: false, distanceKm: 0 }
  }

  const distKm = haversineDistanceKm(
    prevPoint.latitude,
    prevPoint.longitude,
    nextPoint.latitude,
    nextPoint.longitude
  )

  // 1. Stationary micro-jitter filter: ignore movement under 3 meters (0.003 km)
  if (distKm < 0.003) {
    return { valid: false, distanceKm: 0 }
  }

  // 2. Unrealistic jump filter: verify against delta time if timestamps exist
  const t1 = parseTimestamp(prevPoint.timestamp)
  const t2 = parseTimestamp(nextPoint.timestamp)

  if (t1 != null && t2 != null && t2 > t1) {
    const deltaSeconds = (t2 - t1) / 1000.0
    if (deltaSeconds > 0) {
      const impliedSpeedKmh = (distKm / deltaSeconds) * 3600.0
      // 250 km/h threshold for human wearable tracker
      if (impliedSpeedKmh > 250) {
        console.warn(
          `[GPS Filter] Rejected jump: ${distKm.toFixed(2)} km in ${deltaSeconds.toFixed(1)}s (${impliedSpeedKmh.toFixed(0)} km/h)`
        )
        return { valid: false, distanceKm: 0 }
      }
    }
  } else if (distKm > 50) {
    // If no valid timestamps but distance is > 50km in consecutive packets, reject
    return { valid: false, distanceKm: 0 }
  }

  return { valid: true, distanceKm: distKm }
}

/**
 * Calculates total travelled distance by incrementally summing distances
 * between consecutive valid GPS points using the Haversine formula.
 *
 * Does NOT calculate distance using straight-line distance between start and end.
 */
export function calculateRouteDistance(points: TripPoint[]): number {
  if (!points || points.length < 2) return 0

  let totalKm = 0
  let lastAcceptedPoint = points[0]

  for (let i = 1; i < points.length; i++) {
    const currentPoint = points[i]
    const { valid, distanceKm } = isValidPointProgression(lastAcceptedPoint, currentPoint)
    if (valid) {
      totalKm += distanceKm
      lastAcceptedPoint = currentPoint
    }
  }

  return Number(totalKm.toFixed(3))
}

/**
 * Starts a new trip for a device.
 * Captures start coordinates, marks status 'in_progress', and stores in Firestore.
 */
export async function startTrip(
  deviceId: string,
  wearerName?: string | null,
  startLat?: number | null,
  startLon?: number | null
): Promise<TripRecord> {
  const tripId = `trip_${deviceId}_${Date.now()}`
  const nowIso = new Date().toISOString()

  const hasValidStart = isValidGpsCoord(startLat, startLon)
  const initialPoint: TripPoint[] = hasValidStart
    ? [
        {
          latitude: Number(startLat),
          longitude: Number(startLon),
          timestamp: nowIso,
        },
      ]
    : []

  const newTrip: TripRecord = {
    id: tripId,
    device_id: deviceId,
    wearer_name: wearerName ?? null,
    status: 'in_progress',
    start_time: nowIso,
    end_time: null,
    start_location: {
      latitude: hasValidStart ? Number(startLat) : 0,
      longitude: hasValidStart ? Number(startLon) : 0,
      timestamp: nowIso,
    },
    end_location: null,
    current_location: hasValidStart
      ? {
          latitude: Number(startLat),
          longitude: Number(startLon),
          timestamp: nowIso,
        }
      : undefined,
    total_distance_km: 0,
    point_count: initialPoint.length,
    route_points: initialPoint,
    created_at: nowIso,
    updated_at: nowIso,
  }

  // 1. Save trip to Firestore `trips` collection
  const tripRef = doc(db, 'trips', tripId)
  await setDoc(tripRef, newTrip)

  // 2. Mark active trip on the device document
  try {
    const deviceRef = doc(db, 'devices', deviceId)
    await updateDoc(deviceRef, {
      active_trip_id: tripId,
      updated_at: nowIso,
    })
  } catch (err) {
    console.warn(`Could not update active_trip_id on device ${deviceId}:`, err)
  }

  return newTrip
}

/**
 * Appends a new valid GPS coordinate to an in-progress trip,
 * recalculating distance incrementally and updating Firestore.
 */
export async function addTripPoint(
  tripId: string,
  newPoint: TripPoint,
  currentTrip: TripRecord
): Promise<TripRecord> {
  if (!isValidGpsCoord(newPoint.latitude, newPoint.longitude)) {
    return currentTrip
  }

  const existingPoints = currentTrip.route_points || []
  let updatedDistance = currentTrip.total_distance_km || 0
  let shouldAdd = false

  if (existingPoints.length === 0) {
    shouldAdd = true
  } else {
    const lastPoint = existingPoints[existingPoints.length - 1]
    const { valid, distanceKm } = isValidPointProgression(lastPoint, newPoint)
    if (valid) {
      updatedDistance = Number((updatedDistance + distanceKm).toFixed(3))
      shouldAdd = true
    }
  }

  if (!shouldAdd) {
    return currentTrip
  }

  const updatedPoints = [...existingPoints, newPoint]
  const nowIso = new Date().toISOString()

  const updatedTrip: TripRecord = {
    ...currentTrip,
    route_points: updatedPoints,
    point_count: updatedPoints.length,
    total_distance_km: updatedDistance,
    current_location: {
      latitude: newPoint.latitude,
      longitude: newPoint.longitude,
      timestamp: newPoint.timestamp,
      speed_kmh: newPoint.speed_kmh,
      heading: newPoint.heading,
    },
    // If trip started without valid coords, set start_location from first valid fix
    start_location:
      currentTrip.start_location.latitude === 0 && currentTrip.start_location.longitude === 0
        ? {
            latitude: newPoint.latitude,
            longitude: newPoint.longitude,
            timestamp: newPoint.timestamp,
          }
        : currentTrip.start_location,
    updated_at: nowIso,
  }

  try {
    const tripRef = doc(db, 'trips', tripId)
    await updateDoc(tripRef, {
      route_points: updatedPoints,
      point_count: updatedPoints.length,
      total_distance_km: updatedDistance,
      current_location: updatedTrip.current_location,
      start_location: updatedTrip.start_location,
      updated_at: nowIso,
    })
  } catch (err) {
    console.error(`Failed to update trip ${tripId} in Firestore:`, err)
  }

  return updatedTrip
}

/**
 * Ends an active trip.
 * Captures final valid coordinate, marks status 'completed', saves end timestamp,
 * and clears active_trip_id from the device document.
 */
export async function endTrip(
  tripId: string,
  deviceId: string,
  endLat?: number | null,
  endLon?: number | null
): Promise<void> {
  const nowIso = new Date().toISOString()
  const tripRef = doc(db, 'trips', tripId)
  const tripSnap = await getDoc(tripRef)

  let endLocation: TripLocation | null = null
  let finalPoints: TripPoint[] = []
  let finalDistance = 0

  if (tripSnap.exists()) {
    const data = tripSnap.data() as TripRecord
    finalPoints = data.route_points || []
    finalDistance = data.total_distance_km || 0

    if (isValidGpsCoord(endLat, endLon)) {
      const finalPt: TripPoint = {
        latitude: Number(endLat),
        longitude: Number(endLon),
        timestamp: nowIso,
      }
      if (finalPoints.length > 0) {
        const lastPt = finalPoints[finalPoints.length - 1]
        const { valid, distanceKm } = isValidPointProgression(lastPt, finalPt)
        if (valid) {
          finalPoints.push(finalPt)
          finalDistance = Number((finalDistance + distanceKm).toFixed(3))
        }
      } else {
        finalPoints.push(finalPt)
      }
      endLocation = {
        latitude: Number(endLat),
        longitude: Number(endLon),
        timestamp: nowIso,
      }
    } else if (finalPoints.length > 0) {
      const last = finalPoints[finalPoints.length - 1]
      endLocation = {
        latitude: last.latitude,
        longitude: last.longitude,
        timestamp: last.timestamp,
      }
    }
  }

  await updateDoc(tripRef, {
    status: 'completed',
    end_time: nowIso,
    end_location: endLocation,
    route_points: finalPoints,
    point_count: finalPoints.length,
    total_distance_km: finalDistance,
    updated_at: nowIso,
  })

  // Clear active_trip_id on the device document
  try {
    const deviceRef = doc(db, 'devices', deviceId)
    await updateDoc(deviceRef, {
      active_trip_id: null,
      updated_at: nowIso,
    })
  } catch (err) {
    console.warn(`Could not clear active_trip_id on device ${deviceId}:`, err)
  }
}

/**
 * Subscribes in real-time to a single trip document.
 */
export function subscribeToTrip(
  tripId: string,
  onUpdate: (trip: TripRecord | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const tripRef = doc(db, 'trips', tripId)

  return onSnapshot(
    tripRef,
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null)
        return
      }
      onUpdate({ id: snap.id, ...snap.data() } as TripRecord)
    },
    (err) => {
      console.error(`Firestore trip subscription error (${tripId}):`, err)
      if (onError) onError(err)
    }
  )
}

/**
 * Subscribes in real-time to all trips for a given device, ordered descending by start_time.
 */
export function subscribeToDeviceTrips(
  deviceId: string,
  onUpdate: (trips: TripRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const tripsCol = collection(db, 'trips')
  const q = query(tripsCol, where('device_id', '==', deviceId))

  return onSnapshot(
    q,
    (snap) => {
      const list: TripRecord[] = []
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as TripRecord)
      })
      // Sort descending by start_time or created_at in memory
      list.sort((a, b) => {
        const ta = parseTimestamp(a.start_time ?? a.created_at) ?? 0
        const tb = parseTimestamp(b.start_time ?? b.created_at) ?? 0
        return tb - ta
      })
      onUpdate(list)
    },
    (err) => {
      console.error(`Firestore device trips subscription error (${deviceId}):`, err)
      if (onError) onError(err)
    }
  )
}

/**
 * Retrieves verified GPS telemetry from the TCP ingest `logs` collection,
 * falling back to legacy history collections when no log fixes are available.
 */
export async function fetchFirestoreLocationHistory(
  deviceId: string,
  maxPoints: number = 500
): Promise<TripPoint[]> {
  const points = new Map<string, TripPoint>()

  // The TCP ingest script writes one record per message to logs/{autoId}.
  try {
    const logsQuery = query(
      collection(db, 'logs'),
      where('device_id', '==', deviceId),
      where('type', 'in', ['location', 'location_on_demand', 'sos_alarm']),
      firestoreLimit(maxPoints)
    )
    const logsSnapshot = await getDocs(logsQuery)
    logsSnapshot.forEach((docSnapshot) => {
      const point = mapFirestoreGpsLogToTripPoint(docSnapshot.data())
      if (!point) return
      const key = `${point.timestamp}|${point.latitude}|${point.longitude}`
      points.set(key, point)
    })
  } catch (error) {
    console.warn(`Firestore GPS logs query failed for device ${deviceId}:`, error)
  }

  if (points.size > 0) {
    return [...points.values()].sort(
      (first, second) => (parseTimestamp(first.timestamp) ?? 0) - (parseTimestamp(second.timestamp) ?? 0)
    )
  }

  // 1. Try devices/{id}/history subcollection first
  try {
    const subCol = collection(db, 'devices', deviceId, 'history')
    const subSnap = await getDocs(query(subCol, firestoreLimit(maxPoints)))
    subSnap.forEach((docSnap) => {
      const data = docSnap.data()
      const lat = data.latitude ?? data.lat
      const lon = data.longitude ?? data.lon ?? data.lng
      if (data.gps_fix === true || data.gps_valid === true) {
        const timestamp = data.gps_time ?? data.timestamp ?? data.at ?? data.location_time ?? data.received_at
        const fix = normalizeFirestoreGpsLog({ ...data, type: 'location', gps_time: timestamp })
        if (fix && isValidGpsCoord(lat, lon)) {
          points.set(fix.key, {
            latitude: Number(lat),
            longitude: Number(lon),
            timestamp: fix.recordedAt,
            speed_kmh: data.speed_kmh ?? data.speed ?? null,
            heading: data.heading ?? data.bearing ?? data.course ?? null,
            accuracy_m: data.accuracy_meters ?? null,
            battery_pct: data.battery ?? data.battery_percent ?? null,
          })
        }
      }
    })
  } catch (err) {
    console.warn(`Firestore GPS history query failed for device ${deviceId}:`, err)
  }

  // 2. If no verified records were found, check the legacy top-level locations collection.
  if (points.size === 0) {
    try {
      const locCol = collection(db, 'locations')
      const q = query(locCol, where('device_id', '==', deviceId), firestoreLimit(maxPoints))
      const locSnap = await getDocs(q)
      locSnap.forEach((docSnap) => {
        const data = docSnap.data()
        const lat = data.latitude ?? data.lat
        const lon = data.longitude ?? data.lon ?? data.lng
        if (data.gps_fix === true || data.gps_valid === true) {
          const timestamp = data.gps_time ?? data.device_timestamp ?? data.timestamp ?? data.received_at
          const fix = normalizeFirestoreGpsLog({ ...data, type: 'location', gps_time: timestamp })
          if (fix && isValidGpsCoord(lat, lon)) {
            points.set(fix.key, {
              latitude: Number(lat),
              longitude: Number(lon),
              timestamp: fix.recordedAt,
              speed_kmh: data.speed_kmh ?? null,
              heading: data.heading_degrees ?? data.heading ?? null,
              accuracy_m: data.accuracy_meters ?? null,
              battery_pct: data.battery_level ?? null,
            })
          }
        }
      })
    } catch (err) {
      console.warn(`Legacy Firestore location query failed for device ${deviceId}:`, err)
    }
  }

  // Sort ascending by timestamp
  return [...points.values()].sort((a, b) => {
    const ta = parseTimestamp(a.timestamp) ?? 0
    const tb = parseTimestamp(b.timestamp) ?? 0
    return ta - tb
  })
}

/**
 * Builds a synthesized TripRecord from raw historical GPS points.
 */
export function buildTripFromPoints(
  deviceId: string,
  points: TripPoint[],
  wearerName?: string | null
): TripRecord | null {
  if (!points || points.length === 0) return null

  // Filter valid points
  const validPoints = points.filter((p) => isValidGpsCoord(p.latitude, p.longitude))
  if (validPoints.length === 0) return null

  const startPt = validPoints[0]
  const endPt = validPoints[validPoints.length - 1]
  const totalKm = calculateRouteDistance(validPoints)

  return {
    id: `history_${deviceId}_${Date.parse(startPt.timestamp) || startPt.timestamp}`,
    device_id: deviceId,
    wearer_name: wearerName ?? null,
    status: 'completed',
    start_time: startPt.timestamp,
    end_time: endPt.timestamp,
    start_location: {
      latitude: startPt.latitude,
      longitude: startPt.longitude,
      timestamp: startPt.timestamp,
    },
    end_location: {
      latitude: endPt.latitude,
      longitude: endPt.longitude,
      timestamp: endPt.timestamp,
    },
    total_distance_km: totalKm,
    point_count: validPoints.length,
    route_points: validPoints,
    created_at: startPt.timestamp,
    updated_at: endPt.timestamp,
  }
}
