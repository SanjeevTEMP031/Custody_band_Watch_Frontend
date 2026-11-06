const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/+$/, '')
const ACCESS_TOKEN_KEY = 'trackin360-access-token'

export interface ApiUser {
  company?: string | null
  login_name?: string | null
  contact?: string | null
  phone?: string | null
  is_subcompany?: boolean
  id: number
  email: string
  full_name: string
  role: string
  is_active: boolean
  created_at: string
}

export interface CustodyPerson {
  id: number
  reference_no: string
  full_name: string
  date_of_birth: string | null
  status: string
  notes: string | null
  created_at: string
}

export interface Device {
  id: number
  device_name?: string | null
  company?: string | null
  parent_customer?: string | null
  is_subcompany?: boolean
  device_sim?: string | null
  device_model?: string | null
  activation_time?: string | null
  expire_time?: string | null
  heart_rate?: number | null
  blood_pressure?: string | null
  temperature?: number | null
  step_counter?: number | null
  sleep?: string | null
  blood_oxygen?: number | null
  created_at?: string | null
  serial_number: string
  imei: string | null
  status: string
  battery_pct: number | null
  last_seen: string | null
  last_latitude: number | null
  last_longitude: number | null
  custody_person_id: number | null
}

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

export interface LocationRecord {
  id: number
  device_id: number
  latitude: number
  longitude: number
  accuracy_m: number | null
  speed_kmh: number | null
  heading: number | null
  battery_pct: number | null
  recorded_at: string
}

export interface Geofence {
  id: number
  name: string
  fence_type: string
  latitude: number
  longitude: number
  radius_m: number
  trip_id: number | null
  is_active: boolean
}

export type FenceType = 'inclusion' | 'exclusion'

export interface ApiAlert {
  device_name?: string | null
  device_model?: string | null
  imei?: string | null
  location_time?: string | null
  is_subcompany?: boolean
  id: number
  type: string
  severity: string
  status: string
  message: string
  device_id: number | null
  trip_id: number | null
  latitude: number | null
  longitude: number | null
  created_at: string
  acknowledged_by: number | null
  acknowledged_at: string | null
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const getAccessToken = () =>
  window.localStorage.getItem(ACCESS_TOKEN_KEY) ?? window.sessionStorage.getItem(ACCESS_TOKEN_KEY)

export const clearAccessToken = () => {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    const message = error instanceof Error ? error.message : 'Network request failed.'
    throw new ApiError(`Cannot reach the API at ${API_BASE_URL}: ${message}`, 0)
  }

  if (!response.ok) {
    let message = `API request failed (${response.status}).`
    try {
      const body: unknown = await response.json()
      if (typeof body === 'object' && body !== null && 'detail' in body) {
        const detail = body.detail
        message = typeof detail === 'string' ? detail : JSON.stringify(detail)
      }
    } catch {
      // Keep the status-based message when the server response is not JSON.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function loginApi(username: string, password: string, remember = true): Promise<ApiUser> {
  const body = new URLSearchParams({ username, password })
  const token = await request<{ access_token: string; token_type: string }>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
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
export const listPeople = (skip = 0, limit = 100) =>
  request<CustodyPerson[]>(`/custody?skip=${skip}&limit=${limit}`)
export const listUsers = (skip = 0, limit = 100) =>
  request<ApiUser[]>(`/users?skip=${skip}&limit=${limit}`)
export const listDevices = async (skip = 0, limit = 100): Promise<Device[]> => {
  const raw = await request<any[]>(`/devices?skip=${skip}&limit=${limit}`)
  return (Array.isArray(raw) ? raw : []).map((d: any, idx: number) => {
    // Online status detection
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

    // Exact battery percentage extraction from backend
    let batteryVal: number | null = null
    const batteryCandidates = [d.battery, d.battery_pct, d.battery_percent, d.battery_level, d.bat]
    for (const c of batteryCandidates) {
      if (c !== null && c !== undefined && c !== '' && !Number.isNaN(Number(c))) {
        batteryVal = Math.min(100, Math.max(0, Math.round(Number(c))))
        break
      }
    }

    return {
      ...d,
      id: typeof d.id === 'number' ? d.id : (Number(d.device_id) || (idx + 1)),
      serial_number: d.serial_number ?? d.device_id ?? String(d.id ?? idx + 1),
      imei: d.imei ?? d.device_id ?? null,
      device_name: d.device_name ?? d.wearer_name ?? d.name ?? `Band #${d.device_id ?? idx + 1}`,
      status: rawStatus,
      connection_status: rawStatus,
      online: isOnline,
      is_online: isOnline,
      is_active: isOnline,
      battery: batteryVal,
      battery_pct: batteryVal,
      battery_percent: batteryVal,
      last_seen: d.last_seen || d.device_timestamp || new Date().toISOString(),
      last_latitude: lat != null ? Number(lat) : null,
      last_longitude: lng != null ? Number(lng) : null,
      latitude: lat != null ? Number(lat) : null,
      longitude: lng != null ? Number(lng) : null,
      custody_person_id: d.custody_person_id ?? null,
      custody_person_name: d.custody_person_name ?? d.wearer_name ?? null,
    }
  })
}
export const createDevice = (serial_number: string, imei: string | null) =>
  request<Device>('/devices', {
    method: 'POST',
    body: JSON.stringify({ serial_number, imei }),
  })
export const unassignDevice = (deviceId: number) =>
  request<Device>(`/devices/${deviceId}/unassign`, { method: 'POST' })
export const assignDevice = (deviceId: number, custodyPersonId: number) =>
  request<Device>(`/devices/${deviceId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ custody_person_id: custodyPersonId }),
  })
export const listGeofences = (skip = 0, limit = 100) =>
  request<Geofence[]>(`/geofences?skip=${skip}&limit=${limit}`)
export const createGeofence = (payload: {
  name: string
  fence_type: FenceType
  latitude: number
  longitude: number
  radius_m: number
}) => request<Geofence>('/geofences', { method: 'POST', body: JSON.stringify(payload) })
export const updateGeofence = (id: number, payload: Partial<Pick<Geofence, 'name' | 'radius_m' | 'is_active'>>) =>
  request<Geofence>(`/geofences/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const deleteGeofence = (id: number) =>
  request<void>(`/geofences/${id}`, { method: 'DELETE' })
export const listAlerts = (skip = 0, limit = 100) =>
  request<ApiAlert[]>(`/alerts?skip=${skip}&limit=${limit}`)
export const acknowledgeAlert = (id: number, notes = 'Officer acknowledged alert') =>
  request<ApiAlert>(`/alerts/${id}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  })
export const resolveAlert = (id: number, resolutionNotes = 'Incident cleared and verified by officer') =>
  request<ApiAlert>(`/alerts/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution_notes: resolutionNotes }),
  })
export const listLocationHistory = (deviceId: number | string, limit = 500) =>
  request<LocationRecord[]>(`/locations/device/${deviceId}?limit=${limit}`)
export const getLatestLocation = (deviceId: number | string) =>
  request<LocationRecord>(`/locations/device/${deviceId}/latest`)
export const getDashboardSummary = () => request<unknown>('/dashboard')

// ============================================================================
// JOURNEYS API (POST /journeys/start, POST /journeys/end, GET /journeys/...)
// ============================================================================

export const startJourney = async (body: StartJourneyRequest): Promise<Journey> => {
  return request<Journey>('/journeys/start', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export const endJourney = async (body: EndJourneyRequest): Promise<Journey> => {
  return request<Journey>('/journeys/end', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export const getActiveJourney = async (deviceId: string | number): Promise<Journey | null> => {
  return request<Journey | null>(`/journeys/active/${deviceId}`).catch(() => null)
}

export const getDeviceJourneys = async (deviceId: string | number): Promise<Journey[]> => {
  const res = await request<Journey[] | { items: Journey[] }>(`/journeys/device/${deviceId}`).catch(() => [])
  return Array.isArray(res) ? res : res.items || []
}

export const getJourney = async (journeyId: string | number): Promise<Journey> => {
  return request<Journey>(`/journeys/${journeyId}`)
}
