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
 * Retrieves raw GPS telemetry history from Firestore (`devices/{id}/history` or `locations`).
 * Maps them into sorted, valid TripPoints.
 */
export async function fetchFirestoreLocationHistory(
  deviceId: string,
  maxPoints: number = 500
): Promise<TripPoint[]> {
  const points: TripPoint[] = []

  // 1. Try devices/{id}/history subcollection first
  try {
    const subCol = collection(db, 'devices', deviceId, 'history')
    const subSnap = await getDocs(query(subCol, firestoreLimit(maxPoints)))
    subSnap.forEach((docSnap) => {
      const data = docSnap.data()
      const lat = data.latitude ?? data.lat
      const lon = data.longitude ?? data.lon ?? data.lng
      if (isValidGpsCoord(lat, lon)) {
        points.push({
          latitude: Number(lat),
          longitude: Number(lon),
          timestamp: data.timestamp ?? data.received_at ?? new Date().toISOString(),
          speed_kmh: data.speed_kmh ?? data.speed ?? null,
          heading: data.heading ?? data.bearing ?? data.course ?? null,
          accuracy_m: data.accuracy_meters ?? null,
          battery_pct: data.battery ?? data.battery_percent ?? null,
        })
      }
    })
  } catch (err) {
    // Continue to next source
  }

  // 2. If subcollection was empty, query top-level `locations` collection
  if (points.length === 0) {
    try {
      const locCol = collection(db, 'locations')
      const q = query(locCol, where('device_id', '==', deviceId), firestoreLimit(maxPoints))
      const locSnap = await getDocs(q)
      locSnap.forEach((docSnap) => {
        const data = docSnap.data()
        const lat = data.latitude ?? data.lat
        const lon = data.longitude ?? data.lon ?? data.lng
        if (isValidGpsCoord(lat, lon)) {
          points.push({
            latitude: Number(lat),
            longitude: Number(lon),
            timestamp: data.device_timestamp ?? data.timestamp ?? data.received_at ?? new Date().toISOString(),
            speed_kmh: data.speed_kmh ?? null,
            heading: data.heading_degrees ?? data.heading ?? null,
            accuracy_m: data.accuracy_meters ?? null,
            battery_pct: data.battery_level ?? null,
          })
        }
      })
    } catch (err) {
      // Continue
    }
  }

  // Sort ascending by timestamp
  points.sort((a, b) => {
    const ta = parseTimestamp(a.timestamp) ?? 0
    const tb = parseTimestamp(b.timestamp) ?? 0
    return ta - tb
  })

  return points
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
    id: `history_${deviceId}_${Date.now()}`,
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

