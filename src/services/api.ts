// =============================================================================
// TrackGuard 360 / Custody Watch Platform — API Service
// All paths are prefixed with /api/v1 (set via VITE_API_BASE_URL)
// =============================================================================

import {
  collectLastReportedGpsCandidates,
  collectGpsLatestCandidates,
  getGpsFixRejectionReasons,
  logGpsValidationDiagnostics,
  mergeVerifiedGpsFixes,
  normalizeLatestGpsReportMetadata,
  normalizeVerifiedGpsFix,
  normalizeLastReportedGpsLocation,
  withDefaultTcpGpsSource,
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
  speed?: number | null
  // telemetry
  battery?: number | null
  battery_pct?: number | null
  battery_percent?: number | null
  battery_status?: string | null
  is_charging?: boolean | null
  charging?: boolean | null
  charge_status?: string | null
  heart_rate?: number | null
  heart_rate_bpm?: number | null
  hrv?: number | null
  step_counter?: number | null
  steps?: number | null
  blood_pressure?: string | null
  systolic?: number | null
  diastolic?: number | null
  temperature?: number | null
  blood_oxygen?: number | null
  blood_glucose?: number | null
  glucose_mmol_l?: number | null
  sleep?: string | null
  sleep_report?: unknown
  sleep_allday?: unknown
  altitude_m?: number | null
  satellites?: number | null
  signal_percent?: number | null
  gsm_signal?: number | null
  rolls?: number | null
  alarms?: unknown
  cell_mcc?: number | string | null
  cell_mnc?: number | string | null
  cells?: unknown
  wifi?: unknown
  nearby_wifi_count?: number | null
  mileage_km?: number | null
  direction_deg?: number | null
  // misc
  connection_status?: string | null
  last_packet_received?: string | null
  last_valid_gps_time?: string | null
  gps_source?: string | null
  gps_valid?: boolean
  gps_locked?: boolean
  gps_current?: boolean
  tcp_connected?: boolean | null
  maps_url?: string | null
  latest?: Record<string, unknown>
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
  journey_id?: string | number | null
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
  coordinate_source?: string | null
  location_is_current?: boolean
  is_current?: boolean
  status?: string | null
  gps_status?: string | null
  validity?: string | null
  recorded_at?: string | null
  gps_time?: string | null
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
  journey_id?: string | number | null
  gps_time?: string | null
  received_at?: string | null
  gps_fix?: boolean
  coordinate_source?: string | null
  location_is_current?: boolean
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
  id: number | string
  alert_id?: string | null
  type: string
  alert_type?: string
  title?: string
  severity?: string
  status: string
  message: string
  source?: string
  device_id?: string | number | null
  device_name?: string | null
  device_model?: string | null
  imei?: string | null
  is_subcompany?: boolean
  latitude?: number | null
  longitude?: number | null
  location_source?: string | null
  location_timestamp?: string | null
  location_time?: string | null
  location_age_seconds?: number | null
  location_accuracy_m?: number | null
  location_is_stale?: boolean | null
  raw_event_code?: string | null
  event_time?: string | null
  received_at?: string | null
  created_at: string
  acknowledged_by?: number | string | null
  acknowledged_at?: string | null
  resolved_by?: string | null
  resolved_at?: string | null
  resolution_notes?: string | null
  notes?: string | null
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
  const latest = d.latest && typeof d.latest === 'object' ? d.latest : {}
  const latestStatus = latest.status ?? {}
  const latestLocation = latest.location ?? {}
  const latestLocationOnDemand = latest.location_on_demand ?? {}
  const latestHeartRate = latest.heart_rate ?? {}
  const latestBloodPressure = latest.blood_pressure ?? {}
  const firstValue = (...values: unknown[]) =>
    values.find((value) => value !== undefined && value !== null && value !== '')
  const serializeMetric = (value: unknown): string | null => {
    if (value == null || value === '') return null
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return value.map(serializeMetric).filter(Boolean).join(', ')
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item != null && item !== '')
        .map(([key, item]) => `${key.replaceAll('_', ' ')}: ${serializeMetric(item)}`)
      return entries.length ? entries.join(', ') : null
    }
    return null
  }
  const bloodPressureValue = firstValue(
    d.blood_pressure,
    latestBloodPressure.systolic != null && latestBloodPressure.diastolic != null
      ? `${latestBloodPressure.systolic}/${latestBloodPressure.diastolic}`
      : latestBloodPressure
  )
  const sleepValue = firstValue(d.sleep, latest.sleep)
  const isOnline =
    d.online === true ||
    d.is_online === true ||
    d.is_active === true ||
    String(d.status ?? '').toLowerCase() === 'online' ||
    String(d.status ?? '').toLowerCase() === 'active' ||
    String(d.connection_status ?? '').toLowerCase() === 'online'

  const rawStatus = isOnline ? 'online' : (d.status ? String(d.status).toLowerCase() : 'offline')
  const lat = d.last_latitude ?? d.latitude ?? latestLocation.latitude ?? latestLocation.lat ??
    latestLocationOnDemand.latitude ?? latestLocationOnDemand.lat ?? null
  const lng = d.last_longitude ?? d.longitude ?? latestLocation.longitude ?? latestLocation.lon ??
    latestLocationOnDemand.longitude ?? latestLocationOnDemand.lon ?? null
  const rawSpeed = firstValue(
    d.speed_kmh, d.speed, latestLocation.speed_kmh, latestLocationOnDemand.speed_kmh
  )
  const verifiedFix = normalizeVerifiedGpsFix(withDefaultTcpGpsSource(d))
  const hasGpsFix = verifiedFix !== null

  let batteryVal: number | null = null
  for (const c of [
    d.battery_percent, d.battery_pct, d.battery_level, d.battery, d.bat,
    latestStatus.battery_percent, latestLocation.battery_percent,
    latestLocationOnDemand.battery_percent,
    latest.sos_alarm?.battery_percent,
  ]) {
    const percentage = Number(c)
    if (c !== null && c !== undefined && c !== '' && Number.isFinite(percentage)) {
      batteryVal = Math.min(100, Math.max(0, Math.round(percentage)))
      break
    }
  }

  const deviceId = d.device_id ?? d.imei ?? d.serial_number ?? String(d.id ?? idx + 1)
  const lastReportedLocation = selectNewestLastReportedGpsLocation(
    collectLastReportedGpsCandidates(d).map(({ record }) => record)
  )
  const heartRate = firstValue(
    d.heart_rate, d.heart_rate_bpm, latestHeartRate.heart_rate_bpm
  )
  const steps = firstValue(
    d.steps, d.step_counter, latestStatus.steps, latestLocation.steps, latestLocationOnDemand.steps
  )
  const temperature = firstValue(d.temperature, d.temperature_c, latest.temperature?.temperature_c)
  const bloodOxygen = firstValue(
    d.blood_oxygen, d.spo2, d.spo2_percent, latest.blood_oxygen?.spo2_percent
  )
  const bloodGlucose = firstValue(
    d.blood_glucose, d.glucose_mmol_l, latest.blood_glucose?.glucose_mmol_l
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
    battery_status: d.battery_status ?? (batteryVal == null ? null : batteryVal > 20 ? 'normal' : 'low'),
    is_charging: Boolean(d.is_charging ?? d.charging ?? false),
    charging: Boolean(d.charging ?? d.is_charging ?? false),
    last_seen: d.last_seen ?? d.device_timestamp ?? null,
    last_packet_received: d.last_packet_received ?? d.last_seen ?? null,
    gps_last_fix: d.gps_last_fix ?? d.last_fix ?? null,
    gps_last_known_location:
      d.gps_last_known_location ??
      d.last_known_location ??
      lastReportedLocation,
    gps_update_time:
      verifiedFix?.recordedAt ??
      d.last_valid_gps_time ??
      d.gps_update_time ??
      d.gps_recorded_at ??
      d.gps_time ??
      d.last_gps_update ??
      null,
    last_latitude: lat != null ? Number(lat) : null,
    last_longitude: lng != null ? Number(lng) : null,
    latitude: lat != null ? Number(lat) : null,
    longitude: lng != null ? Number(lng) : null,
    speed_kmh: rawSpeed != null && Number.isFinite(Number(rawSpeed)) ? Number(rawSpeed) : null,
    heading: firstValue(d.heading, d.direction_deg, d.bearing, d.course) != null &&
      Number.isFinite(Number(firstValue(d.heading, d.direction_deg, d.bearing, d.course)))
      ? Number(firstValue(d.heading, d.direction_deg, d.bearing, d.course))
      : null,
    has_gps_fix: hasGpsFix,
    gps_fix: hasGpsFix,
    gps_status: d.gps_status ?? d.validity ?? null,
    gps_source: d.gps_source ?? d.gps_fix_source ?? null,
    gps_valid: hasGpsFix,
    gps_locked: hasGpsFix,
    heart_rate: heartRate == null ? null : Number(heartRate),
    heart_rate_bpm: heartRate == null ? null : Number(heartRate),
    hrv: firstValue(d.hrv, latestHeartRate.hrv) == null
      ? null
      : Number(firstValue(d.hrv, latestHeartRate.hrv)),
    blood_pressure: serializeMetric(bloodPressureValue),
    systolic: firstValue(d.systolic, latestBloodPressure.systolic) == null
      ? null
      : Number(firstValue(d.systolic, latestBloodPressure.systolic)),
    diastolic: firstValue(d.diastolic, latestBloodPressure.diastolic) == null
      ? null
      : Number(firstValue(d.diastolic, latestBloodPressure.diastolic)),
    temperature: temperature == null ? null : Number(temperature),
    blood_oxygen: bloodOxygen == null ? null : Number(bloodOxygen),
    blood_glucose: bloodGlucose == null ? null : Number(bloodGlucose),
    glucose_mmol_l: bloodGlucose == null ? null : Number(bloodGlucose),
    step_counter: steps == null ? null : Number(steps),
    steps: steps == null ? null : Number(steps),
    sleep: serializeMetric(sleepValue),
    sleep_report: d.sleep_report ?? latest.sleep_report ?? null,
    sleep_allday: d.sleep_allday ?? latest.sleep_allday ?? null,
    altitude_m: d.altitude_m ?? latestLocation.altitude_m ?? null,
    satellites: d.satellites ?? latestLocation.satellites ?? null,
    signal_percent: d.signal_percent ?? d.gsm_signal ?? latestLocation.signal_percent ?? null,
    gsm_signal: d.gsm_signal ?? d.signal_percent ?? latestLocation.signal_percent ?? null,
    rolls: d.rolls ?? latestLocation.rolls ?? null,
    alarms: d.alarms ?? latestLocation.alarms ?? null,
    cell_mcc: d.cell_mcc ?? latestLocation.cell_mcc ?? null,
    cell_mnc: d.cell_mnc ?? latestLocation.cell_mnc ?? null,
    cells: d.cells ?? latestLocation.cells ?? null,
    wifi: d.wifi ?? latestLocation.wifi ?? null,
    nearby_wifi_count: d.nearby_wifi_count ?? latestLocation.nearby_wifi_count ?? null,
    mileage_km: d.mileage_km ?? latestStatus.mileage_km ?? null,
    direction_deg: d.direction_deg ?? latestLocation.direction_deg ?? null,
    custody_person_id: d.custody_person_id ?? null,
    custody_person_name: d.custody_person_name ?? d.wearer_name ?? null,
  }
}

export const listDevices = async (skip = 0, limit = 100): Promise<Device[]> => {
  const raw = await request<any[]>(`/devices?skip=${skip}&limit=${limit}`)
  return (Array.isArray(raw) ? raw : [])
    .filter((d: any) => {
      const id = String(d?.device_id || d?.imei || d?.id || '')
      return !id.startsWith('TEST_') && !id.startsWith('test_') && id !== '863758061830999'
    })
    .map(normaliseDevice)
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
  lastPacketReceivedAt: number | null
  noFixReported: boolean | null
}

/** Latest verified fix and a separate display-only historical location. */
export const getLatestGpsSnapshot = async (
  deviceId: string | number,
  signal?: AbortSignal
): Promise<LatestGpsSnapshot> => {
  try {
    const response = await request<unknown>(`/gps/${deviceId}/latest`, { signal })
    const reportMetadata = normalizeLatestGpsReportMetadata(response)
    const candidates = collectGpsLatestCandidates(response)
    const selection = selectNewestVerifiedGpsCandidate(candidates)
    const reportedCandidates = collectLastReportedGpsCandidates(response)
    const lastReportedCandidates = reportedCandidates
      .map(({ record }) => normalizeLastReportedGpsLocation(record))
      .filter((location): location is LastReportedGpsLocation => location !== null)
      .sort((first, second) => (first.timestamp ?? 0) - (second.timestamp ?? 0))
    const lastReported = lastReportedCandidates[lastReportedCandidates.length - 1] ?? null
    const coordinateDiagnostics = [...candidates, ...reportedCandidates].map(
      ({ name, record }) => {
        const candidate = typeof record === 'object' && record !== null
          ? record as Record<string, unknown>
          : {}
        return {
          name,
          coordinates: {
            latitude: candidate.latitude ?? candidate.lat ?? candidate.last_latitude ?? null,
            longitude: candidate.longitude ?? candidate.lon ??
              candidate.lng ?? candidate.last_longitude ?? null,
          },
          gpsFix: candidate.gps_fix ?? candidate.has_gps_fix ?? null,
          gpsValid: candidate.gps_valid ?? candidate.valid ?? null,
          coordinateSource: candidate.coordinate_source ?? candidate.location_type ?? null,
          gpsTimestamp: candidate.gps_time ?? candidate.at ??
            candidate.last_valid_gps_time ?? candidate.timestamp ??
            candidate.received_at ?? null,
        }
      }
    )
    console.info('[gps][api] latest response candidates', {
      deviceId,
      selectedVerifiedFix: selection.selected?.fix ?? null,
      candidates: coordinateDiagnostics,
    })
    if (!selection.selected) {
      logGpsValidationDiagnostics(
        'GPS latest response',
        candidates.length > 0
          ? selection.rejected
          : [{ name: 'response', reasons: ['unrecognized-response-shape'] }]
      )
      return {
        latest: null,
        lastReported,
        lastPacketReceivedAt: reportMetadata.receivedAt,
        noFixReported: reportMetadata.noFixReported,
      }
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
      lastPacketReceivedAt: reportMetadata.receivedAt,
      noFixReported: reportMetadata.noFixReported,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        latest: null,
        lastReported: null,
        lastPacketReceivedAt: null,
        noFixReported: null,
      }
    }
    if (error instanceof ApiError && error.configurationError) throw error
    console.warn('Unable to load latest GPS fix.', error)
    return {
      latest: null,
      lastReported: null,
      lastPacketReceivedAt: null,
      noFixReported: null,
    }
  }
}

/** Latest GPS fix for a specific device */
export const getLatestGpsLocation = async (
  deviceId: string | number,
  signal?: AbortSignal
): Promise<LatestGpsLocation | null> =>
  (await getLatestGpsSnapshot(deviceId, signal)).latest

export interface GpsHistoryQueryOptions {
  limit?: number
  before_timestamp?: string
  after_timestamp?: string
  start_time?: string
  end_time?: string
  journey_id?: string
  signal?: AbortSignal
}

/** Location history / breadcrumbs for route replay */
export const getGpsHistory = async (
  deviceId: string | number,
  limitOrOptions: number | GpsHistoryQueryOptions = 500,
  signal?: AbortSignal
): Promise<GpsLocation[]> => {
  let url = `/gps/${deviceId}/history?`
  let effectiveSignal = signal

  if (typeof limitOrOptions === 'number') {
    url += `limit=${limitOrOptions}`
  } else {
    const params = new URLSearchParams()
    params.set('limit', String(limitOrOptions.limit ?? 500))
    if (limitOrOptions.before_timestamp) params.set('before_timestamp', limitOrOptions.before_timestamp)
    if (limitOrOptions.after_timestamp) params.set('after_timestamp', limitOrOptions.after_timestamp)
    if (limitOrOptions.start_time) params.set('start_time', limitOrOptions.start_time)
    if (limitOrOptions.end_time) params.set('end_time', limitOrOptions.end_time)
    if (limitOrOptions.journey_id) params.set('journey_id', limitOrOptions.journey_id)
    url += params.toString()
    if (limitOrOptions.signal) effectiveSignal = limitOrOptions.signal
  }

  const response = await request<unknown>(url, { signal: effectiveSignal })
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
  const telemetryByFix = new Map<string, Record<string, unknown>>()
  history.forEach((record) => {
    const normalizedRecord = withDefaultTcpGpsSource(record)
    const fix = normalizeVerifiedGpsFix(normalizedRecord)
    if (!fix || !record || typeof record !== 'object') return
    telemetryByFix.set(fix.key, record as Record<string, unknown>)
  })
  const optionalNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return mergeVerifiedGpsFixes(history, null).history.map((fix) => {
    const telemetry = telemetryByFix.get(fix.key) ?? {}
    return {
      latitude: fix.latitude,
      longitude: fix.longitude,
      timestamp: fix.recordedAt,
      recorded_at: fix.recordedAt,
      gps_time: typeof telemetry.gps_time === 'string' ? telemetry.gps_time : fix.recordedAt,
      received_at: typeof telemetry.received_at === 'string' ? telemetry.received_at : null,
      journey_id: typeof telemetry.journey_id === 'string' || typeof telemetry.journey_id === 'number'
        ? telemetry.journey_id
        : null,
      coordinate_source: typeof telemetry.coordinate_source === 'string'
        ? telemetry.coordinate_source
        : null,
      location_is_current: telemetry.location_is_current !== false,
      accuracy_m: fix.accuracy,
      speed_kmh: optionalNumber(telemetry.speed_kmh ?? telemetry.speed),
      heading: optionalNumber(
        telemetry.direction_deg ?? telemetry.heading ?? telemetry.bearing ?? telemetry.course
      ),
      battery_pct: optionalNumber(
        telemetry.battery_percent ?? telemetry.battery_pct ??
          telemetry.battery_level ?? telemetry.battery
      ),
      gps_fix: true,
      gps_valid: true,
      gps_status: fix.status,
      status: fix.status,
      gps_source: fix.source,
    }
  })
}

/** Force GPS poll (sends CR command to wake watch GPS chip) */
export const pollDeviceGps = (deviceId: string | number) =>
  request<unknown>(`/gps/${deviceId}/poll`, { method: 'POST' })

/** Check if a point is inside a geofence circle */
export const checkGeofence = (payload: GeofenceCheckRequest) =>
  request<unknown>('/gps/geofence/check', { method: 'POST', body: JSON.stringify(payload) })

// Legacy aliases
export const getLatestLocation = (deviceId: number | string) => getLatestGpsLocation(deviceId)
export const listLocationHistory = (
  deviceId: number | string,
  limitOrOptions: number | GpsHistoryQueryOptions = 500,
  signal?: AbortSignal
) => getGpsHistory(deviceId, limitOrOptions, signal)

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

export const acknowledgeAlert = (id: number | string, notes = 'Officer acknowledged alert') =>
  request<ApiAlert>(`/alerts/${id}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  })

export const resolveAlert = (id: number | string, resolution_notes = 'Incident cleared and verified by officer') =>
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

export interface HealthReading {
  id?: number
  device_id?: string
  timestamp?: string
  bpm?: number | null
  heart_rate?: number | null
  blood_pressure?: string | null
  spo2?: number | null
}

export interface DeviceHealthSummary {
  device_id?: string
  current_pulse_bpm?: number | null
  average_bpm?: number | null
  max_bpm?: number | null
  min_bpm?: number | null
  today_steps?: number | null
  battery_percent?: number | null
  blood_pressure?: string | null
  spo2?: number | null
  temperature?: number | null
  blood_oxygen?: number | null
  blood_glucose?: number | null
  glucose_mmol_l?: number | null
  hrv?: number | null
  sleep?: unknown
  sleep_report?: unknown
  sleep_allday?: unknown
  recent_pulse_readings?: HealthReading[]
  history?: HealthReading[]
  [key: string]: unknown
}

export const getDeviceHealthSummary = (deviceId: string | number) =>
  request<DeviceHealthSummary>(`/health-data/device/${deviceId}/summary`)

export const getHeartRateHistory = (deviceId: string | number, limit = 50) =>
  request<HealthReading[]>(`/health-data/device/${deviceId}/heart-rate?limit=${limit}`)

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
