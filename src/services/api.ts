// =============================================================================
// Trackin360 / Custody Watch Platform — API Service
// All paths are prefixed with /api/v1 (set via VITE_API_BASE_URL)
// =============================================================================

import {
  collectLastReportedGpsCandidates,
  collectGpsLatestCandidates,
  getGpsFixRejectionReasons,
  logGpsValidationDiagnostics,
  mergeVerifiedGpsFixes,
  normalizeLastReportedGpsLocation,
  selectNewestLastReportedGpsLocation,
  selectNewestVerifiedGpsCandidate,
  unwrapGpsHistoryResponse,
  type LastReportedGpsLocation,
} from './gpsNormalization'
import { getJsonContentTypeError } from './apiResponse'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/+$/, '')
const HAS_API_SERVER_PROXY = import.meta.env.VITE_API_SERVER_PROXY === 'true'
const ACCESS_TOKEN_KEY = 'trackin360-access-token'

// =============================================================================
// TYPES — aligned to backend OpenAPI schemas
// =============================================================================

export interface Token {
  access_token: string
  token_type: string
  expires_in_minutes: number
}

export interface ApiUser {
  id: number
  email: string
  full_name: string
  role: string
  is_active: boolean
  created_at: string
  company?: string | null
  login_name?: string | null
  contact?: string | null
  phone?: string | number | null
  is_subcompany?: boolean
  reference_no?: string
  date_of_birth?: string | null
  status?: string
  badge_number?: string | null
  phone_number?: string | null
  department?: string | null
}

export interface CustodyPerson {
  id: number
  reference_no: string
  full_name: string
  date_of_birth: string | null
  status: string
  notes?: string | null
  created_at?: string
}

/** Backend DeviceCreate schema */
export interface DeviceCreate {
  device_id: string          // Watch IMEI / Serial Number
  maker?: string             // default: "MNYD"
  wearer_name?: string | null
  case_number?: string | null
  is_active?: boolean
}

/** Backend DeviceUpdate schema */
export interface DeviceUpdate {
  wearer_name?: string | null
  case_number?: string | null
  is_active?: boolean | null
}

/** Flat device object returned by GET /api/v1/devices */
export interface Device {
  // identifiers
  id: string | number         // internal DB id
  device_id: string           // IMEI — primary key used in all sub-routes
  imei?: string | null
  serial_number: string
  device_name?: string | null
  maker?: string | null
  company?: string | null
  parent_customer?: string | null
  is_subcompany?: boolean
  device_sim?: string | null
  device_model?: string | null
  activation_time?: string | null
  expire_time?: string | null
  created_at?: string | null
  // assignment
  wearer_name?: string | null
  case_number?: string | null
  custody_person_id?: number | null
  custody_person_name?: string | null
  // status
  status?: string | null
  is_active?: boolean
  online?: boolean
  is_online?: boolean
  // last seen
  last_seen?: string | null
  device_timestamp?: string | null
  gps_update_time?: string | null
  // location snapshot
  last_latitude?: number | null
  last_longitude?: number | null
  latitude?: number | null
  longitude?: number | null
  speed_kmh?: number | null
  // telemetry
  battery?: number | null
  battery_pct?: number | null
  battery_percent?: number | null
  heart_rate?: number | null
  heart_rate_bpm?: number | null
  step_counter?: number | null
  steps?: number | null
  blood_pressure?: string | null
  temperature?: number | null
  blood_oxygen?: number | null
  sleep?: string | null
  // misc
  connection_status?: string | null
  has_gps_fix?: boolean
  gps_fix?: boolean
  gps_status?: string | null
  gps_fix_source?: string | null
  gps_last_fix?: unknown
  gps_last_known_location?: unknown
  heading?: number | null
}

/** GPS live/history location point */
export interface GpsLocation {
  device_id?: string
  latitude: number
  longitude: number
  speed_kmh?: number | null
  heading?: number | null
  accuracy_m?: number | null
  battery_pct?: number | null
  satellites?: number | null
  gps_fix?: boolean
  gps_valid?: boolean | number | string
  gps_source?: string | null
  source?: string | null
  status?: string | null
  gps_status?: string | null
  validity?: string | null
  recorded_at?: string | null
  received_at?: string | null
  timestamp?: string | null
  raw?: unknown
}

export interface LatestGpsLocation extends GpsLocation {
  recorded_at: string
  gps_source: string
}

/** Alias kept for backwards compatibility with existing map components */
export type LocationRecord = GpsLocation & { id?: number; device_id?: any }

export interface JourneyLocation {
  latitude: number
  longitude: number
  timestamp?: string
  address?: string | null
}

export interface JourneyPoint {
  latitude: number
  longitude: number
  timestamp: string
  speed_kmh?: number | null
  heading?: number | null
  accuracy_m?: number | null
  battery_pct?: number | null
}

export interface Journey {
  journey_id?: string | number
  id?: string | number
  device_id: string | number
  wearer_name?: string | null
  status: 'active' | 'in_progress' | 'completed' | 'ended'
  start_time: string
  end_time?: string | null
  start_location?: JourneyLocation | null
  end_location?: JourneyLocation | null
  current_location?: (JourneyLocation & { speed_kmh?: number | null; heading?: number | null }) | null
  total_distance_km?: number
  distance_km?: number
  distance_meters?: number
  duration_seconds?: number
  point_count?: number
  route_points?: JourneyPoint[]
  points?: JourneyPoint[]
  created_at?: string
  updated_at?: string
}

export interface StartJourneyRequest {
  device_id: string | number
  wearer_name?: string | null
  start_latitude?: number | null
  start_longitude?: number | null
  timestamp?: string
}

export interface EndJourneyRequest {
  journey_id?: string | number
  device_id?: string | number
  end_latitude?: number | null
  end_longitude?: number | null
  timestamp?: string
}

/** Backend GeofenceCreate schema (note: center_latitude/longitude + radius_meters) */
export interface GeofenceCreate {
  name: string
  fence_type?: 'INCLUSION' | 'EXCLUSION'  // default: INCLUSION
  center_latitude: number
  center_longitude: number
  radius_meters?: number                   // default: 500, min: 10
  assigned_device_id?: string | null       // watch IMEI
  is_active?: boolean
}

export interface Geofence {
  id: number
  name: string
  fence_type: string
  center_latitude: number
  center_longitude: number
  // legacy aliases (some backends still return these)
  latitude: number
  longitude: number
  radius_meters?: number
  radius_m?: number
  assigned_device_id?: string | null
  is_active: boolean
  created_at?: string | null
}

export type FenceType = 'INCLUSION' | 'EXCLUSION'

export interface GeofenceCheckRequest {
  latitude: number
  longitude: number
  center_latitude: number
  center_longitude: number
  radius_meters: number
}

export interface GeofenceValidateRequest {
  device_id: string
  latitude: number
  longitude: number
}

export interface ApiAlert {
  id: number
  type: string
  alert_type?: string
  severity?: string
  status: string
  message: string
  device_id?: string | number | null
  device_name?: string | null
  device_model?: string | null
  imei?: string | null
  is_subcompany?: boolean
  latitude?: number | null
  longitude?: number | null
  location_time?: string | null
  created_at: string
  acknowledged_by?: number | string | null
  acknowledged_at?: string | null
  resolution_notes?: string | null
}

export interface DashboardStats {
  total_devices: number
  online_devices: number
  offline_devices: number
  low_battery_devices: number
  active_alerts_count: number
  live_tcp_sockets?: number
}

export interface AccountUpdate {
  full_name?: string | null
  badge_number?: string | null
  phone_number?: string | null
  department?: string | null
  is_active?: boolean | null
}

export interface SendCommandRequest {
  device_id: string           // Target watch IMEI
  command_type?: string       // CR | RESET | UPLOAD | SETIP | POWEROFF | FACTORY
  parameters?: string | null  // e.g. "60" for UPLOAD interval
}

export interface WebhookCreateRequest {
  name: string
  target_url: string
  events?: string             // ALL | SOS | STRAP_CUT | GEOFENCE_BREACH
}

// =============================================================================
// ERROR
// =============================================================================

export class ApiError extends Error {
  readonly status: number
  readonly configurationError: boolean

  constructor(message: string, status: number, configurationError = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.configurationError = configurationError
  }
}

// =============================================================================
// TOKEN HELPERS
// =============================================================================

export const getAccessToken = () =>
  window.localStorage.getItem(ACCESS_TOKEN_KEY) ?? window.sessionStorage.getItem(ACCESS_TOKEN_KEY)

export const clearAccessToken = () => {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY)
}

// =============================================================================
// CORE REQUEST
// =============================================================================

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (
    import.meta.env.PROD &&
    !/^https?:\/\//i.test(API_BASE_URL) &&
    !HAS_API_SERVER_PROXY
  ) {
    throw new ApiError(
      'Production API configuration error: VITE_API_BASE_URL must be an absolute backend URL. Static Firebase Hosting cannot serve API requests from a relative /api/v1 path without a working server-side proxy.',
      0,
      true
    )
  }
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    API_BASE_URL.startsWith('http://')
  ) {
    throw new ApiError(
      'The API is configured with HTTP, but this page is served over HTTPS. Browsers block this mixed-content request. Configure an HTTPS backend URL or a working HTTPS server-side proxy.',
      0,
      true
    )
  }

  const headers = new Headers(init.headers)
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof URLSearchParams) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const message = error instanceof Error ? error.message : 'Network request failed.'
    throw new ApiError(`Cannot reach the API at ${API_BASE_URL}: ${message}`, 0)
  }

  if (!response.ok) {
    let message = `API request failed (${response.status}).`
    try {
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType === 'application/json') {
        const body: unknown = await response.json()
        if (typeof body === 'object' && body !== null && 'detail' in body) {
          const detail = (body as any).detail
          message = typeof detail === 'string' ? detail : JSON.stringify(detail)
        }
      }
    } catch {
      // Keep the status-based message when the server response is not JSON.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  const contentTypeError = getJsonContentTypeError(
    response.headers.get('content-type'),
    API_BASE_URL
  )
  if (contentTypeError) {
    throw new ApiError(
      contentTypeError,
      response.status,
      true
    )
  }
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(
      `The API at ${API_BASE_URL} declared application/json but returned an invalid JSON body.`,
      response.status,
      true
    )
  }
}

// =============================================================================
// AUTH  —  POST /api/v1/auth/login  (JSON body, NOT form-encoded)
// =============================================================================

export async function loginApi(email: string, password: string, remember = true): Promise<ApiUser> {
  const token = await request<Token>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  const storage = remember ? window.localStorage : window.sessionStorage
  storage.setItem(ACCESS_TOKEN_KEY, token.access_token)
  try {
    return await getCurrentUser()
  } catch (error) {
    clearAccessToken()
    throw error
  }
}

export const getCurrentUser = () => request<ApiUser>('/auth/me')

export const registerUser = (payload: { email: string; password: string; full_name?: string; role?: string }) =>
  request<ApiUser>('/auth/register', { method: 'POST', body: JSON.stringify(payload) })

// =============================================================================
// DASHBOARD  —  /api/v1/dashboard/...
// =============================================================================

export const getDashboardStats = () => request<DashboardStats>('/dashboard/stats')
export const getDashboardOverview = () => request<unknown>('/dashboard/overview')
// Legacy alias
export const getDashboardSummary = getDashboardOverview

// =============================================================================
// DEVICES  —  /api/v1/devices
// =============================================================================

/** Normalises a raw device object from the backend into a consistent Device shape */
function normaliseDevice(d: any, idx: number): Device {
  const isOnline =
    d.online === true ||
    d.is_online === true ||
    d.is_active === true ||
    String(d.status ?? '').toLowerCase() === 'online' ||
    String(d.status ?? '').toLowerCase() === 'active' ||
    String(d.connection_status ?? '').toLowerCase() === 'online'

  const rawStatus = isOnline ? 'online' : (d.status ? String(d.status).toLowerCase() : 'offline')
  const lat = d.last_latitude ?? d.latitude ?? null
  const lng = d.last_longitude ?? d.longitude ?? null
  const rawSpeed = d.speed_kmh ?? d.speed
  const gpsStatus = String(
    d.gps_status ?? d.validity ?? (typeof d.gps_fix === 'string' ? d.gps_fix : d.status) ?? ''
  ).trim().toUpperCase()
  const gpsFlagsValid = [d.gps_fix, d.gps_valid].every(
    (flag) =>
      flag !== false &&
      flag !== 0 &&
      String(flag).trim().toLowerCase() !== 'false' &&
      String(flag).trim() !== '0' &&
      String(flag).trim().toUpperCase() !== 'V'
  )
  const hasGpsFix = gpsFlagsValid && gpsStatus !== 'V'

  let batteryVal: number | null = null
  for (const c of [d.battery, d.battery_pct, d.battery_percent, d.battery_level, d.bat]) {
    if (c !== null && c !== undefined && c !== '' && !Number.isNaN(Number(c))) {
      batteryVal = Math.min(100, Math.max(0, Math.round(Number(c))))
      break
    }
  }

  const deviceId = d.device_id ?? d.imei ?? d.serial_number ?? String(d.id ?? idx + 1)
  const lastReportedLocation = selectNewestLastReportedGpsLocation(
    collectLastReportedGpsCandidates(d).map(({ record }) => record)
  )

  return {
    ...d,
    device_id: deviceId,
    id: d.id ?? d.device_id ?? String(idx + 1),
    serial_number: d.serial_number ?? deviceId,
    imei: d.imei ?? deviceId,
    device_name: d.device_name ?? d.wearer_name ?? d.name ?? `Watch #${deviceId}`,
    wearer_name: d.wearer_name ?? d.custody_person_name ?? null,
    status: rawStatus,
    connection_status: rawStatus,
    online: isOnline,
    is_online: isOnline,
    is_active: isOnline,
    battery: batteryVal,
    battery_pct: batteryVal,
    battery_percent: batteryVal,
    last_seen: d.last_seen ?? d.device_timestamp ?? null,
    gps_last_fix: d.gps_last_fix ?? d.last_fix ?? null,
    gps_last_known_location:
      d.gps_last_known_location ??
      d.last_known_location ??
      lastReportedLocation,
    gps_update_time:
      d.gps_update_time ??
      d.gps_recorded_at ??
      d.gps_time ??
      d.last_gps_update ??
      (hasGpsFix ? d.recorded_at ?? null : null),
    last_latitude: lat != null ? Number(lat) : null,
    last_longitude: lng != null ? Number(lng) : null,
    latitude: lat != null ? Number(lat) : null,
    longitude: lng != null ? Number(lng) : null,
    speed_kmh: rawSpeed != null && Number.isFinite(Number(rawSpeed)) ? Number(rawSpeed) : null,
    heading: d.heading != null && Number.isFinite(Number(d.heading)) ? Number(d.heading) : null,
    has_gps_fix: hasGpsFix,
    gps_fix: hasGpsFix,
    gps_status: d.gps_status ?? d.validity ?? null,
    custody_person_id: d.custody_person_id ?? null,
    custody_person_name: d.custody_person_name ?? d.wearer_name ?? null,
  }
}

export const listDevices = async (skip = 0, limit = 100): Promise<Device[]> => {
  const raw = await request<any[]>(`/devices?skip=${skip}&limit=${limit}`)
  return (Array.isArray(raw) ? raw : []).map(normaliseDevice)
}

export const getDevice = async (deviceId: string | number): Promise<Device> => {
  const raw = await request<any>(`/devices/${deviceId}`)
  return normaliseDevice(raw, 0)
}

export const createDevice = (payload: DeviceCreate) =>
  request<Device>('/devices', { method: 'POST', body: JSON.stringify(payload) })

export const updateDevice = (deviceId: string, payload: DeviceUpdate) =>
  request<Device>(`/devices/${deviceId}`, { method: 'PUT', body: JSON.stringify(payload) })

/** Send a protocol command directly to a watch (e.g. CR for GPS poll, RESET) */
export const sendDeviceCommand = (deviceId: string, command = 'CR') =>
  request<unknown>(`/devices/${deviceId}/command`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  })

// Legacy helpers kept for backwards compat
export const unassignDevice = (deviceId: number | string) =>
  updateDevice(String(deviceId), { wearer_name: null, case_number: null })

export const assignDevice = (deviceId: number | string, _custodyPersonId: number, wearerName?: string) =>
  updateDevice(String(deviceId), { wearer_name: wearerName ?? null })

// =============================================================================
// GPS & LOCATIONS  —  /api/v1/gps/...
// =============================================================================

/** All active wearers' latest coordinates — ideal for live map dashboard */
export const getLiveLocations = () => request<GpsLocation[]>('/gps/live')

export interface LatestGpsSnapshot {
  latest: LatestGpsLocation | null
  lastReported: LastReportedGpsLocation | null
}

/** Latest verified fix and a separate display-only historical location. */
export const getLatestGpsSnapshot = async (
  deviceId: string | number,
  signal?: AbortSignal
): Promise<LatestGpsSnapshot> => {
  try {
    const response = await request<unknown>(`/gps/${deviceId}/latest`, { signal })
    const candidates = collectGpsLatestCandidates(response)
    const selection = selectNewestVerifiedGpsCandidate(candidates)
    const lastReportedCandidates = collectLastReportedGpsCandidates(response)
      .map(({ record }) => normalizeLastReportedGpsLocation(record))
      .filter((location): location is LastReportedGpsLocation => location !== null)
      .sort((first, second) => (first.timestamp ?? 0) - (second.timestamp ?? 0))
    const lastReported = lastReportedCandidates[lastReportedCandidates.length - 1] ?? null
    if (!selection.selected) {
      logGpsValidationDiagnostics(
        'GPS latest response',
        candidates.length > 0
          ? selection.rejected
          : [{ name: 'response', reasons: ['unrecognized-response-shape'] }]
      )
      return { latest: null, lastReported }
    }
    const raw = selection.selected.record as Record<string, unknown>
    const fix = selection.selected.fix

    const finiteNumber = (...values: unknown[]): number | null => {
      const value = values.find((candidate) => candidate !== undefined && candidate !== null)
      if (value == null) return null
      const number = Number(value)
      return Number.isFinite(number) ? number : null
    }

    return {
      latest: {
        ...raw,
        latitude: fix.latitude,
        longitude: fix.longitude,
        speed_kmh: finiteNumber(raw.speed_kmh, raw.speed),
        heading: finiteNumber(raw.heading, raw.bearing, raw.course),
        battery_pct: finiteNumber(raw.battery_pct, raw.battery_percent, raw.battery),
        recorded_at: fix.recordedAt,
        gps_source: fix.source,
        accuracy_m: fix.accuracy,
        satellites: finiteNumber(raw.satellites, raw.sat_count),
        gps_fix: true,
        gps_valid: true,
        status: fix.status,
        gps_status: fix.status,
        validity: fix.status,
        raw,
      },
      lastReported,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { latest: null, lastReported: null }
    }
    if (error instanceof ApiError && error.configurationError) throw error
    console.warn('Unable to load latest GPS fix.', error)
    return { latest: null, lastReported: null }
  }
}

/** Latest GPS fix for a specific device */
export const getLatestGpsLocation = async (
  deviceId: string | number,
  signal?: AbortSignal
): Promise<LatestGpsLocation | null> =>
  (await getLatestGpsSnapshot(deviceId, signal)).latest

/** Location history / breadcrumbs for route replay */
export const getGpsHistory = async (
  deviceId: string | number,
  limit = 100,
  signal?: AbortSignal
): Promise<GpsLocation[]> => {
  const response = await request<unknown>(`/gps/${deviceId}/history?limit=${limit}`, { signal })
  const history = unwrapGpsHistoryResponse(response)
  if (!history) {
    console.warn('GPS history response did not contain a recognized record list.')
    return []
  }
  const rejected = history.flatMap((record, index) => {
    const reasons = getGpsFixRejectionReasons(record)
    return reasons.length > 0 ? [{ name: `record-${index + 1}`, reasons }] : []
  })
  logGpsValidationDiagnostics('GPS history response', rejected)
  return mergeVerifiedGpsFixes(history, null).history.map((fix) => ({
    latitude: fix.latitude,
    longitude: fix.longitude,
    timestamp: fix.recordedAt,
    recorded_at: fix.recordedAt,
    accuracy_m: fix.accuracy,
    gps_fix: true,
    gps_valid: true,
    gps_status: fix.status,
    status: fix.status,
    gps_source: fix.source,
  }))
}

/** Force GPS poll (sends CR command to wake watch GPS chip) */
export const pollDeviceGps = (deviceId: string | number) =>
  request<unknown>(`/gps/${deviceId}/poll`, { method: 'POST' })

/** Check if a point is inside a geofence circle */
export const checkGeofence = (payload: GeofenceCheckRequest) =>
  request<unknown>('/gps/geofence/check', { method: 'POST', body: JSON.stringify(payload) })

// Legacy aliases
export const getLatestLocation = (deviceId: number | string) => getLatestGpsLocation(deviceId)
export const listLocationHistory = (deviceId: number | string, limit = 500) => getGpsHistory(deviceId, limit)

// =============================================================================
// GEOFENCES  —  /api/v1/geofences
// =============================================================================

export const listGeofences = (skip = 0, limit = 100) =>
  request<Geofence[]>(`/geofences?skip=${skip}&limit=${limit}`)

export const getGeofence = (id: number) => request<Geofence>(`/geofences/${id}`)

export const createGeofence = (payload: GeofenceCreate) =>
  request<Geofence>('/geofences', { method: 'POST', body: JSON.stringify(payload) })

export const deleteGeofence = (id: number) => request<unknown>(`/geofences/${id}`, { method: 'DELETE' })

export const validateGeofencePosition = (payload: GeofenceValidateRequest) =>
  request<unknown>('/geofences/validate-position', { method: 'POST', body: JSON.stringify(payload) })

// Legacy alias — the backend no longer has PATCH, use createGeofence or deleteGeofence
export const updateGeofence = (_id: number, _payload: unknown) => {
  console.warn('updateGeofence: backend does not support PATCH; delete and re-create the geofence instead.')
  return Promise.reject(new Error('Geofence PATCH not supported — please delete and re-create.'))
}

// =============================================================================
// ALERTS  —  /api/v1/alerts
// =============================================================================

export interface ListAlertsParams {
  status?: string | null       // NEW | ACKNOWLEDGED | RESOLVED
  alert_type?: string | null   // SOS | STRAP_CUT | LOW_BATTERY | GEOFENCE_BREACH
  device_id?: string | null    // filter by IMEI
  limit?: number
}

export const listAlerts = (skipOrParams: number | ListAlertsParams = 0, limit = 100) => {
  const q = new URLSearchParams()
  if (typeof skipOrParams === 'number') {
    q.set('skip', String(skipOrParams))
    q.set('limit', String(limit))
  } else {
    if (skipOrParams.status) q.set('status', skipOrParams.status)
    if (skipOrParams.alert_type) q.set('alert_type', skipOrParams.alert_type)
    if (skipOrParams.device_id) q.set('device_id', skipOrParams.device_id)
    if (skipOrParams.limit != null) q.set('limit', String(skipOrParams.limit))
  }
  const qs = q.toString()
  return request<ApiAlert[]>(`/alerts${qs ? `?${qs}` : ''}`)
}

export const getAlert = (id: number) => request<ApiAlert>(`/alerts/${id}`)

export const acknowledgeAlert = (id: number, notes = 'Officer acknowledged alert') =>
  request<ApiAlert>(`/alerts/${id}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  })

export const resolveAlert = (id: number, resolution_notes = 'Incident cleared and verified by officer') =>
  request<ApiAlert>(`/alerts/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution_notes }),
  })

// Dashboard alerts (lighter endpoint, no auth required)
export const getDashboardAlerts = (limit = 20) =>
  request<ApiAlert[]>(`/dashboard/alerts?limit=${limit}`)

// =============================================================================
// MONITORING  —  /api/v1/monitoring/...
// =============================================================================

/** Full live grid for all wearers (coordinates, battery, heart rate, security flags) */
export const getLiveGrid = () => request<unknown[]>('/monitoring/live-grid')

/** Real-time summary KPIs for dispatcher screens */
export const getMonitoringSummary = () => request<unknown>('/monitoring/summary')

// =============================================================================
// PLAYBACK  —  /api/v1/playback/{device_id}
// =============================================================================

export interface PlaybackParams {
  limit?: number       // max 1000, default 200
  start_date?: string  // YYYY-MM-DD
  end_date?: string    // YYYY-MM-DD
}

export const getPlaybackRoute = (deviceId: string | number, params: PlaybackParams = {}) => {
  const q = new URLSearchParams()
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.start_date) q.set('start_date', params.start_date)
  if (params.end_date) q.set('end_date', params.end_date)
  const qs = q.toString()
  return request<unknown>(`/playback/${deviceId}${qs ? `?${qs}` : ''}`)
}

// =============================================================================
// HEALTH & BIOMETRICS  —  /api/v1/health-data/...
// =============================================================================

export const getDeviceHealthSummary = (deviceId: string | number) =>
  request<unknown>(`/health-data/device/${deviceId}/summary`)

export const getHeartRateHistory = (deviceId: string | number, limit = 50) =>
  request<unknown[]>(`/health-data/device/${deviceId}/heart-rate?limit=${limit}`)

// =============================================================================
// STATISTICS  —  /api/v1/statistics/...
// =============================================================================

export const getFleetStatistics = () => request<unknown>('/statistics/overview')

// =============================================================================
// ACCOUNTS  —  /api/v1/accounts  (requires Bearer token)
// =============================================================================

export const listAccounts = (skip = 0, limit = 100) =>
  request<ApiUser[]>(`/accounts?skip=${skip}&limit=${limit}`)
export const getAccount = (email: string) => request<ApiUser>(`/accounts/${email}`)
export const updateAccount = (email: string, payload: AccountUpdate) =>
  request<ApiUser>(`/accounts/${email}`, { method: 'PUT', body: JSON.stringify(payload) })
export const deactivateAccount = (email: string) =>
  request<unknown>(`/accounts/${email}`, { method: 'DELETE' })
export const changePassword = (email: string, current_password: string, new_password: string) =>
  request<unknown>(`/accounts/${email}/change-password`, {
    method: 'POST',
    body: JSON.stringify({ current_password, new_password }),
  })

export const listUsers = (skip = 0, limit = 100) =>
  request<ApiUser[]>(`/users?skip=${skip}&limit=${limit}`)

export const listPeople = (skip = 0, limit = 100) =>
  request<CustodyPerson[]>(`/custody?skip=${skip}&limit=${limit}`)

// =============================================================================
// COMMANDS  —  /api/v1/commands/...
// =============================================================================

export const sendCommand = (payload: SendCommandRequest) =>
  request<unknown>('/commands/send', { method: 'POST', body: JSON.stringify(payload) })

export const getCommandHistory = (device_id?: string, limit = 50) => {
  const q = new URLSearchParams({ limit: String(limit) })
  if (device_id) q.set('device_id', device_id)
  return request<unknown[]>(`/commands/history?${q}`)
}

export const getSupportedCommands = () => request<Record<string, string>>('/commands/supported')

// =============================================================================
// ROLES & RBAC  —  /api/v1/roles/...
// =============================================================================

export const listRoles = () => request<unknown[]>('/roles')
export const getRole = (role_name: string) => request<unknown>(`/roles/${role_name}`)
export const assignRole = (user_email: string, role_name: string) =>
  request<unknown>('/roles/assign', { method: 'POST', body: JSON.stringify({ user_email, role_name }) })

// =============================================================================
// EXPORTS & LEGAL EVIDENCE  —  /api/v1/exports/...
// =============================================================================

export const getTelemetryCsvUrl = (deviceId: string | number, limit = 500) =>
  `${API_BASE_URL}/exports/telemetry/${deviceId}/csv?limit=${limit}`

export const getAlertsCsvUrl = (limit = 500) =>
  `${API_BASE_URL}/exports/alerts/csv?limit=${limit}`

export const getCourtEvidencePacket = (deviceId: string | number) =>
  request<unknown>(`/exports/court-evidence/${deviceId}`)

// =============================================================================
// INTEGRATIONS & WEBHOOKS  —  /api/v1/integrations/...
// =============================================================================

export const getIntegrationsStatus = () => request<unknown>('/integrations/status')
export const listWebhooks = () => request<unknown[]>('/integrations/webhooks')
export const createWebhook = (payload: WebhookCreateRequest) =>
  request<unknown>('/integrations/webhooks', { method: 'POST', body: JSON.stringify(payload) })
export const testWebhook = () =>
  request<unknown>('/integrations/webhooks/test', { method: 'POST' })

// =============================================================================
// JOURNEYS  — kept for backwards compat (may need backend route if added later)
// =============================================================================

export const startJourney = async (body: StartJourneyRequest): Promise<Journey> =>
  request<Journey>('/journeys/start', { method: 'POST', body: JSON.stringify(body) })

export const endJourney = async (body: EndJourneyRequest): Promise<Journey> =>
  request<Journey>('/journeys/end', { method: 'POST', body: JSON.stringify(body) })

export const getActiveJourney = async (deviceId: string | number): Promise<Journey | null> =>
  request<Journey | null>(`/journeys/active/${deviceId}`).catch(() => null)

export const getDeviceJourneys = async (deviceId: string | number): Promise<Journey[]> => {
  const res = await request<Journey[] | { items: Journey[] }>(`/journeys/device/${deviceId}`).catch(() => [])
  return Array.isArray(res) ? res : (res as any).items ?? []
}

export const getJourney = async (journeyId: string | number): Promise<Journey> =>
  request<Journey>(`/journeys/${journeyId}`)

// =============================================================================
// RAW GPS PACKET PARSER  (Huateng C05 hardware protocol)
// =============================================================================

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
    const status = parts[3]?.trim().toUpperCase() // 'A' = valid fix, 'V' = void
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
