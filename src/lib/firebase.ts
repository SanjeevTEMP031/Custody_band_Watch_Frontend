import { getFirestore, collection, onSnapshot, doc, type Unsubscribe } from 'firebase/firestore'
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
    if (typeof val === 'number' && !isNaN(val) && val >= 0 && val <= 100) {
      const time = parseTimestamp(timeVal) ?? 0
      candidates.push({ value: Math.round(val), time, priority })
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

  // 3. Nested last_location
  addCandidate(
    data.last_location?.battery_level ?? data.last_location?.battery_percent,
    data.last_location?.received_at ?? data.last_location?.device_timestamp,
    8
  )

  // 4. Root level fields with general update/seen timestamps
  const rootTime = parseTimestamp(data.updated_at ?? data.last_seen_at ?? data.last_seen ?? data.received_at) ?? 0

  addCandidate(data.battery_percent, rootTime, 7)
  addCandidate(data.battery_pct, rootTime, 6)
  addCandidate(data.battery_level, rootTime, 5)
  addCandidate(data.battery, rootTime, 4)

  if (candidates.length === 0) return null

  // Sort descending by timestamp, then by field priority
  candidates.sort((a, b) => {
    if (b.time !== a.time) return b.time - a.time
    return b.priority - a.priority
  })

  return candidates[0].value
}

export interface ExtractedGps {
  latitude: number | null
  longitude: number | null
  hasGpsFix: boolean
  gpsUpdateTime: string | null
  speed_kmh: number | null
  heading: number | null
}

/**
 * Extracts the latest valid GPS coordinates from Firestore device document.
 * If gps_fix is false, does NOT replace previous valid coordinates with 0,0 or null.
 * Retains the last valid GPS coordinates.
 */
export function extractLatestGps(
  data: Record<string, any>,
  prevLat?: number | null,
  prevLon?: number | null
): ExtractedGps {
  let lat: number | null = null
  let lon: number | null = null
  let hasGpsFix = false
  let timeStr: string | null = null
  let speed: number | null = null
  let heading: number | null = null

  // Helper to validate coordinate pair
  const isValidCoord = (lt: unknown, ln: unknown): boolean => {
    if (lt == null || ln == null) return false
    const nLat = Number(lt)
    const nLon = Number(ln)
    if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return false
    if (nLat === 0 && nLon === 0) return false
    return nLat >= -90 && nLat <= 90 && nLon >= -180 && nLon <= 180
  }

  // 1. Check nested latest.location
  if (data.latest?.location) {
    const loc = data.latest.location
    const cLat = loc.lat ?? loc.latitude
    const cLon = loc.lon ?? loc.lng ?? loc.longitude
    const fixFlag = loc.gps_fix !== false && loc.gps_valid !== false && loc.gps_status !== 'V'

    if (isValidCoord(cLat, cLon)) {
      if (fixFlag) {
        lat = Number(cLat)
        lon = Number(cLon)
        hasGpsFix = true
      }
      timeStr = loc.received_at ?? loc.device_timestamp ?? null
      speed = loc.speed_kmh ?? loc.speed ?? null
      heading = loc.heading ?? loc.bearing ?? loc.course_degrees ?? null
    }
  }

  // 2. Check last_location
  if (lat == null && data.last_location) {
    const loc = data.last_location
    const cLat = loc.latitude ?? loc.lat
    const cLon = loc.longitude ?? loc.lng ?? loc.lon
    const fixFlag = loc.gps_valid !== false && loc.location_source === 'gps'

    if (isValidCoord(cLat, cLon)) {
      lat = Number(cLat)
      lon = Number(cLon)
      hasGpsFix = fixFlag
      timeStr = loc.received_at ?? loc.device_timestamp ?? null
      speed = loc.speed_kmh ?? null
      heading = loc.heading_degrees ?? null
    }
  }

  // 3. Check root level fields
  if (lat == null) {
    const cLat = data.last_latitude ?? data.latitude
    const cLon = data.last_longitude ?? data.longitude
    const fixFlag = data.gps_valid !== false && data.gps_fix !== false && data.gps_status !== 'V'

    if (isValidCoord(cLat, cLon)) {
      lat = Number(cLat)
      lon = Number(cLon)
      hasGpsFix = fixFlag
      timeStr = data.device_timestamp ?? data.last_seen ?? data.updated_at ?? null
      speed = data.speed_kmh ?? null
      heading = data.course_degrees ?? data.heading ?? null
    }
  }

  // CRITICAL REQUIREMENT:
  // If current fix is invalid/false, retain the last known valid GPS coordinates!
  // Do NOT replace previous valid location with 0,0 or null!
  if ((lat == null || !hasGpsFix) && isValidCoord(prevLat, prevLon)) {
    lat = prevLat!
    lon = prevLon!
    // hasGpsFix remains whatever was determined from the latest packet
  }

  return {
    latitude: lat,
    longitude: lon,
    hasGpsFix,
    gpsUpdateTime: timeStr,
    speed_kmh: speed != null ? Number(speed) : null,
    heading: heading != null ? Number(heading) : null,
  }
}

/**
 * Checks if the device is currently online according to backend rules:
 * Heartbeat or location received within 300 seconds (5 minutes).
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
    parseTimestamp(data.latest?.location?.received_at)

  if (lastTime != null) {
    // 300 seconds threshold (5 minutes)
    return now - lastTime <= 300 * 1000
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
  const gps = extractLatestGps(data, prevDevice?.last_latitude, prevDevice?.last_longitude)
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

  const deviceName =
    data.name ||
    data.device_name ||
    data.wearer_name ||
    data.assigned_person_name ||
    null

  const imei = data.imei || data.device_id || data.vendor_device_id || id

  return {
    id: data.id ?? id,
    device_name: deviceName,
    company: data.company ?? data.tenant_id ?? null,
    parent_customer: data.parent_customer ?? null,
    is_subcompany: Boolean(data.is_subcompany),
    device_sim: data.device_sim ?? data.sim_number ?? data.phone ?? null,
    device_model: data.model ?? data.device_model ?? 'Huateng C05',
    activation_time: data.activated_at ?? data.activation_time ?? null,
    expire_time: data.expires_at ?? data.expire_time ?? null,
    heart_rate: data.heart_rate_bpm ?? data.heart_rate ?? null,
    blood_pressure: data.blood_pressure ?? null,
    temperature: data.temperature ?? null,
    step_counter: data.steps ?? data.step_counter ?? null,
    sleep: data.sleep ?? null,
    blood_oxygen: data.blood_oxygen ?? null,
    created_at: data.created_at ? String(data.created_at) : null,
    serial_number: imei,
    imei: imei,
    status: online ? 'active' : 'offline',
    battery_pct: batteryPct,
    last_seen: lastSeenStr,
    last_latitude: gps.latitude,
    last_longitude: gps.longitude,
    custody_person_id: data.assigned_person_id ?? data.custody_person_id ?? null,
    // Custom metadata properties:
    ...({
      has_gps_fix: gps.hasGpsFix,
      gps_update_time: gps.gpsUpdateTime,
      speed_kmh: gps.speed_kmh,
      heading: gps.heading,
      wearer_name: data.wearer_name ?? data.assigned_person_name ?? null,
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

