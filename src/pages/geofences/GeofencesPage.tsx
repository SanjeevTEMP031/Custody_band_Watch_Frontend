import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { AddOutlined, DeleteOutlined, EditOutlined, InfoOutlined, MyLocationOutlined, UndoOutlined } from '@mui/icons-material'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { useRealtimeDevices } from '../../hooks/useRealtimeDevices'
import { mergeDevicesWithFirestore } from '../../lib/firebase'
import {
  acknowledgeGeofenceAlert,
  assignDevicesToGeofence,
  createGeofence,
  deleteGeofence,
  evaluateDeviceGeofences,
  getDeviceAlertStatus,
  getActiveJourney,
  getJourney,
  getJourneyApprovedRoute,
  getJourneyAlerts,
  getJourneyLivePosition,
  getJourneyRouteAlternatives,
  getJourneyTravelledPath,
  getGeofenceAlerts,
  getGeofenceDevices,
  getLatestGpsSnapshot,
  listDevices,
  listGeofences,
  listJourneys,
  removeDeviceFromGeofence,
  resolveGeofenceAlert,
  createScheduledJourney,
  acknowledgeAlert,
  resolveAlert,
  selectJourneyRoute,
  startScheduledJourney,
  completeJourney,
  updateGeofence,
  type ApiAlert,
  type FenceType,
  type Geofence,
  type GeofenceCreate,
  type GeofenceShape,
  type LatestGpsSnapshot,
  type Journey,
  type JourneyCreateRequest,
  type RouteAlternativesRequest,
} from '../../services/api'
import {
  isFreshGpsTimestamp,
  normalizeVerifiedGpsFix,
  parseGpsTimestamp,
} from '../../services/gpsNormalization'
import GeofenceMap, { type GeofenceDraft, type GeofenceMapLocation } from './GeofenceMap'
import { startAlertAlarm, stopAlertAlarm } from '../../utils/alertSounds'
type AlarmType = 'only_enter' | 'only_out' | 'in_and_out'
const DEFAULT_GEOFENCE_WATCH_ID = '863758061830955'
const DEFAULT_ROUTE_CORRIDOR_METERS = 100

function isActive(fence: Geofence): boolean {
  return fence.active ?? fence.is_active ?? true
}

function getCenter(fence: Geofence): [number, number] | null {
  const lat = fence.center_latitude ?? fence.latitude
  const lon = fence.center_longitude ?? fence.longitude
  return lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
    ? [lat, lon]
    : null
}

function getAssignedDeviceIds(fence: Geofence): string[] {
  return fence.device_ids?.map(String) ??
    fence.devices?.map(item => typeof item === 'object' ? String(item.device_id ?? item.id) : String(item)) ??
    (fence.assigned_device_id ? [fence.assigned_device_id] : [])
}

function getAlarmType(fence: Geofence): AlarmType {
  if (fence.entry_alert && fence.exit_alert) return 'in_and_out'
  if (fence.entry_alert) return 'only_enter'
  if (fence.exit_alert) return 'only_out'
  return fence.fence_type?.toLowerCase() === 'inclusion' ? 'only_enter' : 'only_out'
}

function formatTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function parseCoordinate(value: string, min: number, max: number): number | null {
  if (!value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}

type ZoneEvaluation = {
  id: string
  name: string
  state: 'Inside' | 'Outside' | 'Safe' | 'Violation' | 'Unknown'
}

type GeofenceEvaluation = {
  status: 'SAFE' | 'VIOLATION' | 'UNKNOWN'
  zones: ZoneEvaluation[]
}

type PlannedRoute = {
  id: string
  name: string
  points: [number, number][]
  distanceKm: number | null
  durationMinutes: number | null
  safetyScore: number | null
  riskLevel: string | null
}
/** onRoute is the backend's corridor verdict for the point (null when the backend did not report one). */
type JourneyGpsPoint = { latitude: number; longitude: number; timestamp: number; onRoute: boolean | null }

/** Backend route monitor default corridor (route_monitor.DEFAULT_CORRIDOR_METERS). */
const BACKEND_DEFAULT_CORRIDOR_METERS = 75
type GeocoderSuggestion = {
  latitude: number
  longitude: number
  displayName: string
  query: string
}

type ParsedCoordinateInput =
  | { kind: 'coordinates'; value: [number, number] }
  | { kind: 'invalid' }
  | { kind: 'place' }

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function parseCoordinateInput(value: string): ParsedCoordinateInput {
  const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/)
  if (!match) return { kind: 'place' }
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    ? { kind: 'coordinates', value: [latitude, longitude] }
    : { kind: 'invalid' }
}

function parseRoutes(value: unknown, fallbackRouteId?: string): PlannedRoute[] {
  const root = objectValue(value)
  const nested = objectValue(root?.data) ?? objectValue(root?.result) ?? objectValue(root?.payload)
  const collection = root?.routes ?? root?.alternatives ?? root?.items ??
    nested?.routes ?? nested?.alternatives ?? nested?.items ??
    root?.approved_route ?? root?.route ?? nested?.approved_route ?? nested?.route
  const candidates = Array.isArray(value)
    ? fallbackRouteId ? [{ route_id: fallbackRouteId, route_points: value }] : []
    : Array.isArray(collection)
      ? collection
      : collection == null
        ? root && (root.route_id != null || root.id != null || fallbackRouteId || root.route_points != null || root.points != null || root.coordinates != null)
          ? [root]
          : []
        : [collection]
  return candidates.flatMap((raw, index) => {
    const item = objectValue(raw)
    if (!item) return []
    const geometry = objectValue(item.geometry) ?? objectValue(item.geojson) ?? objectValue(item.route_geometry)
    const geoJsonCoordinates = geometry?.coordinates
    const geoJson = Array.isArray(geoJsonCoordinates)
    const rawPoints = item.points ?? item.route_points ?? item.coordinates ?? item.path ?? geoJsonCoordinates
    const routeId = item.route_id ?? item.id ?? item.selected_route_id ??
      (fallbackRouteId ? `${fallbackRouteId}-${index + 1}` : undefined)
    if (!Array.isArray(rawPoints) || routeId == null) return []
    const points = rawPoints.flatMap(point => {
      const pointRecord = objectValue(point)
      if (pointRecord) {
        const latitude = Number(pointRecord.latitude ?? pointRecord.lat)
        const longitude = Number(pointRecord.longitude ?? pointRecord.lng ?? pointRecord.lon)
        return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
          ? [[latitude, longitude] as [number, number]]
          : []
      }
      if (!Array.isArray(point) || point.length < 2 || point[0] == null || point[1] == null) return []
      const a = Number(point[0]); const b = Number(point[1])
      if (!Number.isFinite(a) || !Number.isFinite(b)) return []
      const latLon: [number, number] = geoJson || Math.abs(a) > 90 ? [b, a] : [a, b]
      return Math.abs(latLon[0]) <= 90 && Math.abs(latLon[1]) <= 180 ? [latLon] : []
    })
    return points.length < 2 ? [] : [{
      id: String(routeId), name: String(item.name ?? item.label ?? item.route_name ?? item.via ?? `Alternative ${index + 1}`), points,
      distanceKm: item.distance_km != null && item.distance_km !== '' && Number.isFinite(Number(item.distance_km))
        ? Number(item.distance_km)
        : item.distance_meters != null && item.distance_meters !== '' && Number.isFinite(Number(item.distance_meters))
          ? Math.round(Number(item.distance_meters) / 100) / 10
          : item.distance != null && item.distance !== '' && Number.isFinite(Number(item.distance))
            ? Math.round(Number(item.distance) / 100) / 10
          : null,
      durationMinutes: item.duration_minutes != null && item.duration_minutes !== '' && Number.isFinite(Number(item.duration_minutes))
        ? Number(item.duration_minutes)
        : item.duration_seconds != null && item.duration_seconds !== '' && Number.isFinite(Number(item.duration_seconds))
          ? Math.round(Number(item.duration_seconds) / 60)
          : item.duration != null && item.duration !== '' && Number.isFinite(Number(item.duration))
            ? Math.round(Number(item.duration) / 60)
          : null,
      safetyScore: item.safety_score != null && item.safety_score !== '' && Number.isFinite(Number(item.safety_score))
        ? Number(item.safety_score)
        : null,
      riskLevel: typeof (item.risk_level ?? item.safety_rating ?? item.risk) === 'string'
        ? String(item.risk_level ?? item.safety_rating ?? item.risk).trim() || null
        : null,
    }]
  })
}

function isDevelopment(): boolean {
  return import.meta.env.DEV
}

function locationNotFound(label: 'Origin' | 'Destination'): Error {
  return new Error(`${label} not found`)
}

function locationSearchQueries(query: string): string[] {
  const complete = query.trim().replace(/\s*,\s*/g, ', ')
  const parts = complete.split(',').map(part => part.trim()).filter(Boolean)
  const queries = [complete]
  if (parts.length > 2) {
    for (let end = parts.length - 1; end > 1; end -= 1) {
      queries.push([...parts.slice(0, end - 1), parts[parts.length - 1]].join(', '))
    }
  }
  if (parts.length > 1) queries.push(parts[0])
  return [...new Set(queries)]
}

async function searchPreviewLocations(query: string, label: 'Origin' | 'Destination'): Promise<GeocoderSuggestion[]> {
  const value = query.trim()
  const parsed = parseCoordinateInput(value)
  if (isDevelopment()) {
    console.debug('[geofence-route] coordinate parsing', { field: label, kind: parsed.kind })
  }
  if (parsed.kind === 'coordinates') {
    throw new Error(`${label} is already a coordinate pair and does not need address search.`)
  }
  if (parsed.kind === 'invalid') {
    throw new Error(`${label} coordinates must be within latitude -90 to 90 and longitude -180 to 180.`)
  }
  if (!value) throw locationNotFound(label)

  const endpoint = String(import.meta.env.VITE_ROUTE_GEOCODER_URL ?? '').trim()
  if (!endpoint) throw new Error('The local address search service is not configured.')

  for (const candidate of locationSearchQueries(value)) {
    const url = new URL(endpoint, window.location.origin)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '5')
    url.searchParams.set('q', candidate)
    let response: Response
    try {
      response = await fetch(url.toString(), { headers: { Accept: 'application/json' }, credentials: 'omit' })
    } catch {
      throw new Error('The local address search service could not be reached.')
    }
    if (!response.ok) {
      throw new Error(`The local address search service returned HTTP ${response.status}.`)
    }

    let results: unknown
    try {
      results = await response.json()
    } catch {
      throw new Error('The local address search service returned an invalid response.')
    }
    if (isDevelopment()) {
      console.debug('[geofence-route] geocoding status', {
        field: label,
        query: candidate,
        status: response.status,
        resultCount: Array.isArray(results) ? results.length : 0,
      })
    }
    if (!Array.isArray(results)) continue
    const suggestions = results.flatMap(result => {
      const item = objectValue(result)
      if (item?.lat == null || item.lat === '' || item.lon == null || item.lon === '') return []
      const latitude = Number(item?.lat)
      const longitude = Number(item?.lon)
      const displayName = typeof item?.display_name === 'string' ? item.display_name.trim() : ''
      return displayName && Number.isFinite(latitude) && Number.isFinite(longitude) &&
        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
        ? [{ latitude, longitude, displayName, query: candidate }]
        : []
    })
    if (suggestions.length > 0) return suggestions
  }
  throw new Error(`${label} not found. Try a shorter address or select a point on the map.`)
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function recordCollection(value: unknown): Record<string, unknown>[] {
  const root = recordValue(value)
  const nested = recordValue(root?.data) ?? recordValue(root?.result)
  const items = Array.isArray(value)
    ? value
    : [root?.alerts, root?.items, root?.events, nested?.alerts, nested?.items, nested?.events].find(Array.isArray) ?? []
  return items.map(recordValue).filter((item): item is Record<string, unknown> => item !== null)
}

function alertId(alert: Record<string, unknown>): string {
  const id = alert.alert_id ?? alert.event_id ?? alert.id
  return id == null || String(id).trim() === '' ? '' : String(id)
}

function alertType(alert: Record<string, unknown>): string {
  const explicit = String(alert.event_type ?? alert.alert_type ?? alert.type ?? alert.raw_event_code ?? '').trim().toUpperCase()
  if (explicit) return explicit
  // /geofences/alerts rows may lack event_type; the backend title/message still say which way the device crossed.
  if (alert.geofence_id == null && alert.geofence_alert_id == null) return ''
  const text = `${String(alert.title ?? '')} ${String(alert.message ?? '')}`.toUpperCase()
  if (text.includes('OUTSIDE GEOFENCE') || /\bEXITED\b/.test(text)) return 'GEOFENCE_EXIT'
  if (text.includes('INSIDE GEOFENCE') || /\bENTERED\b/.test(text)) return 'GEOFENCE_ENTRY'
  return 'GEOFENCE_EVENT'
}

/** Backend broadcasts that are state/telemetry updates rather than operator alerts. */
const NON_ALERT_EVENT_TYPES = new Set([
  'JOURNEY_LIVE_UPDATE',
  'ROUTE_REJOINED',
  'DESTINATION_ARRIVAL',
  'JOURNEY_STARTED',
  'JOURNEY_COMPLETED',
  'GEOFENCE_ALERT_ACKNOWLEDGED',
  'GEOFENCE_ALERT_RESOLVED',
])

function alertIsUnresolved(alert: Record<string, unknown>): boolean {
  return alert.acknowledged !== true && alert.acknowledged_at == null &&
    !['ACKNOWLEDGED', 'RESOLVED', 'CLOSED'].includes(String(alert.status ?? '').toUpperCase())
}

function alertEventTime(alert: Record<string, unknown>): number {
  const timestamp = Date.parse(String(alert.event_time ?? alert.created_at ?? alert.timestamp ?? ''))
  return Number.isFinite(timestamp) ? timestamp : 0
}

function verifiedAlertLocation(alert: Record<string, unknown>): [number, number] | null {
  if (alert.gps_valid !== true || alert.location_is_stale !== false) return null
  if (alert.latitude == null || alert.longitude == null || alert.latitude === '' || alert.longitude === '') return null
  const timestamp = parseGpsTimestamp(alert.location_timestamp ?? alert.location_time ?? alert.event_time)
  if (timestamp === null || !isFreshGpsTimestamp(timestamp)) return null
  const latitude = Number(alert.latitude)
  const longitude = Number(alert.longitude)
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? [latitude, longitude]
    : null
}

/**
 * Location where the backend confirmed a route deviation for a journey record. This is the
 * recorded deviation position (route-monitor alerts store the verified fix itself), shown as
 * history; it is never used as the device's current position.
 */
function recordedDeviationLocation(alert: Record<string, unknown>): [number, number] | null {
  if (alert.gps_valid !== true) return null
  if (alert.latitude == null || alert.longitude == null || alert.latitude === '' || alert.longitude === '') return null
  const latitude = Number(alert.latitude)
  const longitude = Number(alert.longitude)
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? [latitude, longitude]
    : null
}

interface AlertTableRow {
  key: string
  kind: 'geofence' | 'journey' | 'marker'
  time: string | null
  device: string
  context: string
  message: string
  severity: string
  status: string
  actionId: string
  geofenceAlert?: ApiAlert
  deviation?: boolean
}

function alertDedupeKey(alert: Record<string, unknown>): string {
  const id = alertId(alert)
  if (id) return id
  return [alertType(alert), alert.device_id ?? alert.imei, alert.geofence_id, alert.event_time ?? alert.created_at]
    .map(value => String(value ?? '')).join(':')
}

function uniqueAlerts(...groups: Record<string, unknown>[][]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>()
  groups.flat().forEach(alert => {
    const key = alertDedupeKey(alert)
    if (!key.replaceAll(':', '')) return
    const current = byId.get(key)
    if (!current || alertEventTime(alert) >= alertEventTime(current)) byId.set(key, alert)
  })
  return [...byId.values()].sort((first, second) => alertEventTime(second) - alertEventTime(first))
}

function uniqueJourneys(journeys: Journey[]): Journey[] {
  const seen = new Set<string>()
  return journeys.filter(journey => {
    const id = journey.journey_id ?? journey.id
    if (id == null) return true
    const key = String(id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function verifiedJourneyPoints(value: unknown): JourneyGpsPoint[] {
  const root = recordValue(value)
  const nested = recordValue(root?.data) ?? recordValue(root?.result)
  const candidates = Array.isArray(value)
    ? value
    : [root?.points, root?.path, root?.travelled_path, nested?.points, nested?.path, nested?.travelled_path].find(Array.isArray) ?? []
  return candidates.flatMap(candidate => {
    const point = recordValue(candidate)
    if (!point || !(point.gps_fix === true || point.gps_valid === true || point.location_is_current === true)) return []
    if (point.valid === false || String(point.gps_status ?? '').toUpperCase() === 'V') return []
    const latitude = Number(point.latitude ?? point.lat)
    const longitude = Number(point.longitude ?? point.lng ?? point.lon)
    const timestamp = parseGpsTimestamp(point.gps_time ?? point.timestamp ?? point.recorded_at ?? point.received_at)
    return Number.isFinite(latitude) && Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && timestamp !== null
      ? [{
          latitude,
          longitude,
          timestamp,
          onRoute: typeof point.on_route === 'boolean'
            ? point.on_route
            : point.on_route === 1 || point.on_route === 0 ? point.on_route === 1 : null,
        }]
      : []
  }).sort((first, second) => first.timestamp - second.timestamp)
}

/**
 * Red segments of the travelled path. Prefers the backend's per-point on_route verdict (the same
 * one that raises ROUTE_DEVIATION_ALERT); falls back to the client distance check otherwise.
 */
function travelledDeviationSegments(
  path: JourneyGpsPoint[],
  approvedRoute: [number, number][],
  toleranceMeters: number | null,
): [number, number][][] {
  if (path.length < 2) return []
  const segments: [number, number][][] = []
  let current: [number, number][] = []
  path.forEach((point, index) => {
    const coordinates: [number, number] = [point.latitude, point.longitude]
    let outside = false
    if (point.onRoute !== null) {
      outside = !point.onRoute
    } else if (approvedRoute.length > 1 && toleranceMeters !== null) {
      const distance = distanceFromRouteMeters(coordinates, approvedRoute)
      outside = distance !== null && distance > toleranceMeters
    }
    if (outside) {
      if (current.length === 0 && index > 0) current.push([path[index - 1].latitude, path[index - 1].longitude])
      current.push(coordinates)
    } else if (current.length > 0) {
      current.push(coordinates)
      if (current.length > 1) segments.push(current)
      current = []
    }
  })
  if (current.length > 1) segments.push(current)
  return segments
}

function distanceFromRouteMeters(point: [number, number], route: [number, number][]): number | null {
  if (route.length < 2) return null
  const [latitude, longitude] = point
  const metersPerDegree = 111320
  let minimumDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < route.length; index += 1) {
    const [startLatitude, startLongitude] = route[index - 1]
    const [endLatitude, endLongitude] = route[index]
    const meanLatitude = ((latitude + startLatitude + endLatitude) / 3) * Math.PI / 180
    const metersPerLongitudeDegree = metersPerDegree * Math.cos(meanLatitude)
    const dx = (endLongitude - startLongitude) * metersPerLongitudeDegree
    const dy = (endLatitude - startLatitude) * metersPerDegree
    const pointX = (longitude - startLongitude) * metersPerLongitudeDegree
    const pointY = (latitude - startLatitude) * metersPerDegree
    const lengthSquared = dx * dx + dy * dy
    const fraction = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (pointX * dx + pointY * dy) / lengthSquared))
    minimumDistance = Math.min(minimumDistance, Math.hypot(pointX - fraction * dx, pointY - fraction * dy))
  }
  return Number.isFinite(minimumDistance) ? minimumDistance : null
}

function journeyLivePosition(value: unknown): Record<string, unknown> | null {
  const root = recordValue(value)
  if (!root) return null
  return recordValue(root.location) ?? recordValue(root.live_position) ??
    recordValue(root.position) ?? root
}

function evaluationState(value: unknown): GeofenceEvaluation['status'] {
  if (typeof value === 'boolean') return value ? 'VIOLATION' : 'SAFE'
  if (typeof value !== 'string') return 'UNKNOWN'
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (['SAFE', 'COMPLIANT', 'NO_VIOLATION', 'OUTSIDE_ALL'].includes(normalized)) return 'SAFE'
  if (['VIOLATION', 'BREACH', 'NON_COMPLIANT', 'INSIDE_EXCLUSION'].includes(normalized)) return 'VIOLATION'
  return 'UNKNOWN'
}

function normalizeGeofenceEvaluation(value: unknown): GeofenceEvaluation {
  const root = recordValue(value)
  const data = recordValue(root?.result) ?? recordValue(root?.data) ?? root
  if (!data && !Array.isArray(value)) return { status: 'UNKNOWN', zones: [] }

  const explicitViolation = data?.is_violation ?? data?.violation
  const explicitCompliance = data?.is_compliant ?? data?.compliant ?? data?.safe
  let status = evaluationState(data?.overall_status ?? data?.violation_status ?? data?.status ?? data?.state)
  if (typeof explicitViolation === 'boolean') status = explicitViolation ? 'VIOLATION' : 'SAFE'
  else if (typeof explicitCompliance === 'boolean') status = explicitCompliance ? 'SAFE' : 'VIOLATION'

  const rawZones = Array.isArray(value)
    ? value
    : [data?.geofences, data?.zones, data?.results, data?.items].find(Array.isArray) ?? []
  const zones: ZoneEvaluation[] = rawZones.map((rawZone, index) => {
    const zone = recordValue(rawZone)
    if (!zone) return { id: String(index), name: `Zone ${index + 1}`, state: 'Unknown' }
    const rawZoneStatus = String(zone.violation_status ?? zone.zone_state ?? zone.status ?? '').toUpperCase()
    const zoneStatus = evaluationState(rawZoneStatus)
    const inside = zone.is_inside ?? zone.inside
    const explicitZoneViolation = zone.is_violation ?? zone.violation
    let zoneState: ZoneEvaluation['state'] = zoneStatus === 'VIOLATION' || explicitZoneViolation === true
      ? 'Violation'
      : zoneStatus === 'SAFE'
        ? 'Safe'
        : 'Unknown'
    if (zoneState !== 'Violation') {
      if (rawZoneStatus.includes('INSIDE')) zoneState = 'Inside'
      else if (rawZoneStatus.includes('OUTSIDE')) zoneState = 'Outside'
    }
    if (typeof inside === 'boolean' && zoneState === 'Unknown') zoneState = inside ? 'Inside' : 'Outside'
    if (zoneState === 'Violation') status = 'VIOLATION'
    return {
      id: String(zone.geofence_id ?? zone.id ?? index),
      name: String(zone.geofence_name ?? zone.name ?? `Zone ${index + 1}`),
      state: zoneState,
    }
  })

  return { status, zones }
}

function GeofencesPage() {
  const [params] = useSearchParams()
  const deviceParam = params.get('device')
  const geofenceParam = params.get('geofence')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingFence, setEditingFence] = useState<Geofence | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Geofence | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [name, setName] = useState('')
  const [remark, setRemark] = useState('')
  const [alarmType, setAlarmType] = useState<AlarmType>('in_and_out')
  const [active, setActive] = useState(true)
  const [entryAlert, setEntryAlert] = useState(true)
  const [exitAlert, setExitAlert] = useState(true)
  const [draft, setDraft] = useState<GeofenceDraft | null>(null)
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [selectedGeofenceId, setSelectedGeofenceId] = useState<number | string | null>(() => geofenceParam)
  const [alertBusyId, setAlertBusyId] = useState<string | null>(null)
  const [gpsSnapshotState, setGpsSnapshotState] = useState<{
    deviceKey: string
    snapshot: LatestGpsSnapshot
  } | null>(null)
  const [gpsError, setGpsError] = useState('')
  const [geofenceAssignmentState, setGeofenceAssignmentState] = useState<{
    deviceKey: string
    fenceKey: string
    assignments: Record<string, 'assigned' | 'not_assigned' | 'unknown'>
    error: string
  } | null>(null)
  const [focusDeviceRequest, setFocusDeviceRequest] = useState(0)
  const [deviceStatusState, setDeviceStatusState] = useState<{
    deviceKey: string
    status: Awaited<ReturnType<typeof getDeviceAlertStatus>>
  } | null>(null)
  const [deviceStatusErrorState, setDeviceStatusErrorState] = useState<{ deviceKey: string; error: string } | null>(null)
  const [geofenceEvaluation, setGeofenceEvaluation] = useState<{
    fixKey: string
    value: GeofenceEvaluation
  } | null>(null)
  const [evaluationErrorState, setEvaluationErrorState] = useState<{ fixKey: string; error: string } | null>(null)
  const [evaluationRetry, setEvaluationRetry] = useState(0)
  const [alertSocketConnected, setAlertSocketConnected] = useState(
    () => document.documentElement.dataset.alertSocket === 'connected',
  )
  const [liveViolation, setLiveViolation] = useState<{ deviceId: string; geofenceId: string } | null>(null)
  const [routeOrigin, setRouteOrigin] = useState('')
  const [routeDestination, setRouteDestination] = useState('')
  const [routeCorridorMeters, setRouteCorridorMeters] = useState(String(DEFAULT_ROUTE_CORRIDOR_METERS))
  const [routeChoices, setRouteChoices] = useState<PlannedRoute[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [routeOriginPosition, setRouteOriginPosition] = useState<[number, number] | null>(null)
  const [routeDestinationPosition, setRouteDestinationPosition] = useState<[number, number] | null>(null)
  const [routeOriginConfirmed, setRouteOriginConfirmed] = useState(false)
  const [routeDestinationConfirmed, setRouteDestinationConfirmed] = useState(false)
  const [routeOriginSuggestions, setRouteOriginSuggestions] = useState<GeocoderSuggestion[]>([])
  const [routeDestinationSuggestions, setRouteDestinationSuggestions] = useState<GeocoderSuggestion[]>([])
  const [routeMapFocusPoint, setRouteMapFocusPoint] = useState<[number, number] | null>(null)
  const [locationSearchBusy, setLocationSearchBusy] = useState<'origin' | 'destination' | null>(null)
  const [pointPickMode, setPointPickMode] = useState<'origin' | 'destination' | null>(null)
  const [fitRoutesRequest, setFitRoutesRequest] = useState(0)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeMessage, setRouteMessage] = useState('')
  const [approvedRouteId, setApprovedRouteId] = useState<string | null>(null)
  const [approvedJourneyId, setApprovedJourneyId] = useState<string | null>(null)
  const [journeyRecord, setJourneyRecord] = useState<Journey | null>(null)
  const [journeyHistoryState, setJourneyHistoryState] = useState<{ deviceKey: string; journeys: Journey[] } | null>(null)
  const [journeyHistoryErrorState, setJourneyHistoryErrorState] = useState<{ deviceKey: string; error: string } | null>(null)
  const [journeyInactive, setJourneyInactive] = useState(false)
  const [approvedRoutePoints, setApprovedRoutePoints] = useState<[number, number][]>([])
  const [journeyLiveDetails, setJourneyLiveDetails] = useState<Record<string, unknown> | null>(null)
  const [journeyMonitorError, setJourneyMonitorError] = useState('')
  const [journeyAlerts, setJourneyAlerts] = useState<Record<string, unknown>[]>([])
  const [journeyPathPoints, setJourneyPathPoints] = useState<JourneyGpsPoint[]>([])
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null)
  const [playbackPlaying, setPlaybackPlaying] = useState(false)
  const [liveMonitoringAlerts, setLiveMonitoringAlerts] = useState<Record<string, unknown>[]>([])
  const [alertActionBusy, setAlertActionBusy] = useState(false)
  const [alertActionError, setAlertActionError] = useState('')
  const [silencedAlertId, setSilencedAlertId] = useState('')
  const silencedAlertIds = useRef<Set<string>>(new Set())
  const routeDeviceKey = useRef('')
  const journeyOwnerDeviceKey = useRef('')
  const routeFitJourneyKey = useRef('')
  const currentRoute = routeChoices.find(route => route.id === selectedRouteId) ?? null
  const routeOriginReady = routeOriginPosition
    ? routeOriginConfirmed
    : parseCoordinateInput(routeOrigin).kind === 'coordinates'
  const routeDestinationReady = routeDestinationPosition
    ? routeDestinationConfirmed
    : parseCoordinateInput(routeDestination).kind === 'coordinates'
  const routeEndpoints = useMemo(() => ({
    origin: routeOriginPosition,
    destination: routeDestinationPosition,
  }), [routeDestinationPosition, routeOriginPosition])
  const lastEvaluationKey = useRef('')

  const handleRouteMapSelect = useCallback((routeId: string) => {
    if (approvedRouteId) return
    setSelectedRouteId(routeId)
    setRouteMessage('Route selected from the map. Approve the route when ready.')
  }, [approvedRouteId])

  const handleRouteMapPointPick = useCallback((point: [number, number], mode: 'origin' | 'destination') => {
    const [latitude, longitude] = point
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setRouteMessage(`The selected ${mode} coordinates are invalid. Please choose another point on the map.`)
      return
    }
    if (mode === 'origin') {
      setRouteOriginPosition(point)
      setRouteOriginConfirmed(true)
      setRouteOriginSuggestions([])
    } else {
      setRouteDestinationPosition(point)
      setRouteDestinationConfirmed(true)
      setRouteDestinationSuggestions([])
    }
    setRouteMapFocusPoint(null)
    setRouteChoices([])
    setSelectedRouteId('')
    setPointPickMode(null)
    setRouteMessage(`${mode === 'origin' ? 'Origin' : 'Destination'} selected from the map.`)
  }, [])

  const searchRouteLocation = async (mode: 'origin' | 'destination') => {
    if (routeBusy || locationSearchBusy || approvedRouteId) return
    const label = mode === 'origin' ? 'Origin' : 'Destination'
    const query = mode === 'origin' ? routeOrigin : routeDestination
    const parsed = parseCoordinateInput(query)
    if (parsed.kind === 'invalid') {
      setRouteMessage(`${label} coordinates must be within latitude -90 to 90 and longitude -180 to 180.`)
      return
    }
    if (parsed.kind === 'coordinates') {
      if (mode === 'origin') {
        setRouteOriginPosition(parsed.value)
        setRouteOriginConfirmed(true)
        setRouteOriginSuggestions([])
      } else {
        setRouteDestinationPosition(parsed.value)
        setRouteDestinationConfirmed(true)
        setRouteDestinationSuggestions([])
      }
      setRouteMapFocusPoint(parsed.value)
      setFitRoutesRequest(current => current + 1)
      setRouteChoices([])
      setSelectedRouteId('')
      setRouteMessage(`${label} coordinates are ready for routing.`)
      return
    }

    setLocationSearchBusy(mode)
    setRouteMessage('')
    if (mode === 'origin') {
      setRouteOriginPosition(null)
      setRouteOriginConfirmed(false)
      setRouteOriginSuggestions([])
    } else {
      setRouteDestinationPosition(null)
      setRouteDestinationConfirmed(false)
      setRouteDestinationSuggestions([])
    }
    try {
      const suggestions = await searchPreviewLocations(query, label)
      if (mode === 'origin') setRouteOriginSuggestions(suggestions)
      else setRouteDestinationSuggestions(suggestions)
      setRouteMessage(`${label} matches found. Select a result to preview it on the map, then confirm the location.`)
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'No matching locations were found.'
      setRouteMessage(`${label} search failed: ${detail}`)
    } finally {
      setLocationSearchBusy(null)
    }
  }

  const selectRouteLocation = (suggestion: GeocoderSuggestion, mode: 'origin' | 'destination') => {
    const point: [number, number] = [suggestion.latitude, suggestion.longitude]
    if (mode === 'origin') {
      setRouteOriginPosition(point)
      setRouteOriginConfirmed(false)
    } else {
      setRouteDestinationPosition(point)
      setRouteDestinationConfirmed(false)
    }
    setRouteMapFocusPoint(point)
    setRouteChoices([])
    setSelectedRouteId('')
    setFitRoutesRequest(current => current + 1)
    setRouteMessage(`Review the selected ${mode} on the map, then confirm it before finding routes.`)
  }

  const findRouteAlternatives = async () => {
    if (routeBusy || locationSearchBusy || approvedRouteId || pointPickMode) return
    setRouteBusy(true)
    setRouteMessage('')
    setRouteChoices([])
    try {
      let origin = routeOriginPosition
      if (origin && !routeOriginConfirmed) {
        setRouteMessage('Review and confirm the selected origin on the map before finding routes.')
        return
      }
      if (!origin) {
        const parsed = parseCoordinateInput(routeOrigin)
        if (parsed.kind === 'coordinates') {
          origin = parsed.value
          setRouteOriginPosition(origin)
          setRouteOriginConfirmed(true)
          setRouteMapFocusPoint(origin)
        } else {
          setRouteMessage('Origin search required: search for a place, select a matching result, and confirm it on the map.')
          return
        }
      }

      let destination = routeDestinationPosition
      if (destination && !routeDestinationConfirmed) {
        setRouteMessage('Review and confirm the selected destination on the map before finding routes.')
        return
      }
      if (!destination) {
        const parsed = parseCoordinateInput(routeDestination)
        if (parsed.kind === 'coordinates') {
          destination = parsed.value
          setRouteDestinationPosition(destination)
          setRouteDestinationConfirmed(true)
          setRouteMapFocusPoint(destination)
        } else {
          setRouteMessage('Destination search required: search for a place, select a matching result, and confirm it on the map.')
          return
        }
      }

      const request: RouteAlternativesRequest = {
        origin_latitude: origin[0],
        origin_longitude: origin[1],
        destination_latitude: destination[0],
        destination_longitude: destination[1],
        origin_name: routeOrigin.trim() || null,
        destination_name: routeDestination.trim() || null,
      }
      const choices = parseRoutes(await getJourneyRouteAlternatives(request), 'route')
      if (choices.length === 0) {
        throw new Error('The route alternatives API returned no usable route geometry.')
      }
      setRouteChoices(choices)
      setSelectedRouteId(choices[0].id)
      setFitRoutesRequest(current => current + 1)
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Unable to load route alternatives.'
      setRouteMessage(`Route alternatives failed: ${detail}`)
    } finally { setRouteBusy(false) }
  }

  const approveSelectedRoute = async () => {
    const route = routeChoices.find(item => item.id === selectedRouteId)
    if (!route || !routeOriginPosition || !routeDestinationPosition ||
        !routeOriginConfirmed || !routeDestinationConfirmed || !selectedDeviceId) {
      setRouteMessage('Choose origin and destination points on the map, load routes, then select a route to approve.')
      return
    }
    const corridorMeters = Number(routeCorridorMeters)
    if (!Number.isFinite(corridorMeters) || corridorMeters <= 0) {
      setRouteMessage('Enter a positive route deviation tolerance in meters.')
      return
    }
    setRouteBusy(true)
    setRouteMessage('')
    try {
      const payload: JourneyCreateRequest = {
        device_id: selectedDeviceId,
        origin_name: routeOrigin.trim() || null, destination_name: routeDestination.trim() || null,
        origin_latitude: routeOriginPosition[0], origin_longitude: routeOriginPosition[1],
        destination_latitude: routeDestinationPosition[0], destination_longitude: routeDestinationPosition[1],
        selected_route_id: route.id,
        route_corridor_meters: corridorMeters,
        status: 'SCHEDULED',
      }
      const journey = await createScheduledJourney(payload)
      const journeyId = journey.journey_id ?? journey.id
      if (journeyId == null) throw new Error('The journey response did not include an ID.')
      await selectJourneyRoute(journeyId, { route_id: route.id, journey_id: String(journeyId), approved_by: 'Administrator' })
      journeyOwnerDeviceKey.current = selectedDeviceId
      setApprovedJourneyId(String(journeyId))
      setApprovedRouteId(route.id)
      setJourneyRecord({
        ...journey,
        route_corridor_meters: journey.route_corridor_meters ?? corridorMeters,
      })
      setRouteMessage(`Backend approved ${route.name}. Start the journey when ready.`)
    } catch (reason) {
      setRouteMessage(reason instanceof Error ? reason.message : 'Unable to approve this route.')
    } finally { setRouteBusy(false) }
  }

  const startApprovedJourney = async () => {
    if (!approvedJourneyId) return
    setRouteBusy(true)
    setRouteMessage('')
    try {
      const started = await startScheduledJourney(approvedJourneyId)
      setJourneyRecord(current => ({
        ...started,
        route_corridor_meters: started.route_corridor_meters ?? current?.route_corridor_meters,
      }))
      setRouteMessage(`Journey status: ${String(started.status ?? 'UNKNOWN').toUpperCase()}.`)
    } catch (reason) {
      setRouteMessage(reason instanceof Error ? reason.message : 'Unable to start the approved journey.')
    } finally { setRouteBusy(false) }
  }

  const completeApprovedJourney = async () => {
    if (!approvedJourneyId) return
    setRouteBusy(true)
    setRouteMessage('')
    try {
      const completed = await completeJourney(approvedJourneyId)
      setJourneyRecord(current => ({
        ...completed,
        route_corridor_meters: completed.route_corridor_meters ?? current?.route_corridor_meters,
      }))
      setJourneyHistoryState(current => ({
        deviceKey: selectedDeviceId,
        journeys: uniqueJourneys([
          completed,
          ...(current?.deviceKey === selectedDeviceId ? current.journeys : []),
        ]),
      }))
      setRouteMessage('Journey completed. The approved route and recorded GPS path are retained for history.')
    } catch (reason) {
      setRouteMessage(reason instanceof Error ? reason.message : 'Unable to complete the journey.')
    } finally { setRouteBusy(false) }
  }

  const selectMonitoredJourney = (journeyId: string) => {
    setJourneyRecord(null)
    setJourneyLiveDetails(null)
    setJourneyMonitorError('')
    setJourneyAlerts([])
    setJourneyPathPoints([])
    setApprovedRoutePoints([])
    setApprovedRouteId(null)
    setRouteChoices([])
    setSelectedRouteId('')
    setPlaybackIndex(null)
    setPlaybackPlaying(false)
    setJourneyInactive(false)
    if (journeyId) {
      journeyOwnerDeviceKey.current = selectedDeviceId
      setApprovedJourneyId(journeyId)
    } else {
      journeyOwnerDeviceKey.current = ''
      setApprovedJourneyId(null)
    }
  }

  const loadDevices = useCallback(() => listDevices(0, 500), [])
  const { data: apiDevices, loading: devicesLoading, error: devicesError } = useApiData(loadDevices)
  const { devices: realtimeDevices } = useRealtimeDevices()
  const devices = useMemo(
    () => mergeDevicesWithFirestore(apiDevices ?? [], realtimeDevices),
    [apiDevices, realtimeDevices],
  )
  const loadGeofenceAlerts = useCallback(() => {
    const monitoringDevice = deviceParam ?? DEFAULT_GEOFENCE_WATCH_ID
    const matchedDevice = apiDevices?.find(item =>
      String(item.device_id) === monitoringDevice ||
      String(item.id) === monitoringDevice ||
      String(item.imei) === monitoringDevice
    )
    const deviceFilter = matchedDevice?.device_id ?? monitoringDevice
    return getGeofenceAlerts({
      device_id: String(deviceFilter),
      skip: 0,
      limit: 100,
    })
  }, [apiDevices, deviceParam])
  const {
    data: geofenceAlerts,
    loading: alertsLoading,
    error: alertsError,
    reload: reloadAlerts,
  } = useApiData(loadGeofenceAlerts)

  const loadGeofences = useCallback(() => {
    const matchedDevice = deviceParam
      ? apiDevices?.find(item =>
          String(item.device_id) === deviceParam ||
          String(item.id) === deviceParam ||
          String(item.imei) === deviceParam
        )
      : null
    const deviceFilter = matchedDevice?.device_id ?? deviceParam
    return listGeofences(deviceFilter
      ? { device_id: String(deviceFilter), skip: 0, limit: 500 }
      : { skip: 0, limit: 500 })
  }, [apiDevices, deviceParam])
  const { data: geofences, loading, error, reload } = useApiData(loadGeofences)

  const monitoringDeviceParam = deviceParam ?? DEFAULT_GEOFENCE_WATCH_ID
  const requestedDevice = devices?.find(item =>
    String(item.device_id) === monitoringDeviceParam ||
    String(item.id) === monitoringDeviceParam ||
    String(item.imei) === monitoringDeviceParam
  ) ?? null
  const gpsLookupId = requestedDevice?.device_id ?? requestedDevice?.imei ?? requestedDevice?.id ?? null
  const deviceKey = gpsLookupId === null ? '' : String(gpsLookupId)
  const deviceStatus = deviceStatusState?.deviceKey === deviceKey ? deviceStatusState.status : null
  const deviceStatusError = deviceStatusErrorState?.deviceKey === deviceKey ? deviceStatusErrorState.error : ''
  const gpsSnapshot = gpsSnapshotState?.deviceKey === String(gpsLookupId)
    ? gpsSnapshotState.snapshot
    : null
  const geofenceListKey = (geofences ?? []).map(fence => String(fence.id)).sort().join(',')
  const assignmentDeviceIds = useMemo(() => [
    requestedDevice?.device_id,
    requestedDevice?.imei,
    requestedDevice?.id,
  ].filter((id): id is string | number => id !== undefined && id !== null && String(id) !== '')
    .map(String), [requestedDevice?.device_id, requestedDevice?.imei, requestedDevice?.id])
  useEffect(() => {
    if (assignmentDeviceIds.length === 0 || gpsLookupId === null || geofences == null) return

    const requestDeviceKey = String(gpsLookupId)
    const requestFenceKey = geofenceListKey
    const fences = geofences
    if (fences.length === 0) return

    const controller = new AbortController()
    let cancelled = false

    const verifyAssignments = async () => {
      try {
        const results = await Promise.all(fences.map(async fence => {
          const assignedDevices = await getGeofenceDevices(fence.id, controller.signal)
          const hasIdentifiers = assignedDevices.every(device =>
            device.device_id != null || device.imei != null || device.id != null
          )
          const isAssigned = assignedDevices.some(device =>
            [device.device_id, device.imei, device.id]
              .filter((id): id is string | number => id !== undefined && id !== null)
              .some(id => assignmentDeviceIds.includes(String(id)))
          )
          const status = !hasIdentifiers
            ? 'unknown'
            : isAssigned ? 'assigned' : 'not_assigned'
          return [String(fence.id), status] as const
        }))
        if (cancelled) return
        setGeofenceAssignmentState({
          deviceKey: requestDeviceKey,
          fenceKey: requestFenceKey,
          assignments: Object.fromEntries(results),
          error: '',
        })
      } catch (reason) {
        if (!cancelled && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setGeofenceAssignmentState({
            deviceKey: requestDeviceKey,
            fenceKey: requestFenceKey,
            assignments: {},
            error: reason instanceof Error ? reason.message : 'Unable to verify geofence assignments.',
          })
        }
      }
    }

    void verifyAssignments()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [assignmentDeviceIds, geofenceListKey, geofences, gpsLookupId])

  useEffect(() => {
    if (gpsLookupId === null) return

    const controller = new AbortController()
    let cancelled = false
    let inFlight = false
    const refreshGps = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const nextSnapshot = await getLatestGpsSnapshot(gpsLookupId, controller.signal)
        if (cancelled) return
        setGpsSnapshotState(current => {
          const previous = current?.deviceKey === String(gpsLookupId) ? current.snapshot : null
          const previousFix = previous?.latest
            ? normalizeVerifiedGpsFix(previous.latest)
            : null
          const nextFix = nextSnapshot.latest
            ? normalizeVerifiedGpsFix(nextSnapshot.latest)
            : null
          if (previousFix && (!nextFix || nextFix.timestamp <= previousFix.timestamp)) {
            return {
              deviceKey: String(gpsLookupId),
              snapshot: { ...nextSnapshot, latest: previous?.latest ?? null },
            }
          }
          return { deviceKey: String(gpsLookupId), snapshot: nextSnapshot }
        })
        setGpsError('')
      } catch (reason) {
        if (!cancelled && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setGpsError(reason instanceof Error ? reason.message : 'Unable to refresh this device location.')
        }
      } finally {
        inFlight = false
      }
    }

    void refreshGps()
    const timer = window.setInterval(() => void refreshGps(), 5000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [gpsLookupId])

  useEffect(() => {
    if (gpsLookupId === null) return

    const controller = new AbortController()
    let cancelled = false
    let inFlight = false
    const refreshStatus = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const status = await getDeviceAlertStatus(gpsLookupId, controller.signal)
        if (!cancelled) {
          setDeviceStatusState({ deviceKey: String(gpsLookupId), status })
          setDeviceStatusErrorState(null)
        }
      } catch (reason) {
        if (!cancelled && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setDeviceStatusState(current => current?.deviceKey === String(gpsLookupId) ? null : current)
          setDeviceStatusErrorState({
            deviceKey: String(gpsLookupId),
            error: reason instanceof Error ? reason.message : 'Unable to retrieve device status.',
          })
        }
      } finally {
        inFlight = false
      }
    }
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 5000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [gpsLookupId])

  const selectedGpsFix = gpsSnapshot?.gpsValid === true && gpsSnapshot.locationIsCurrent === true &&
    gpsSnapshot.latest
    ? normalizeVerifiedGpsFix(gpsSnapshot.latest)
    : null
  const selectedReportedLocation = gpsSnapshot?.lastReported ?? null
  const batteryPct = gpsSnapshot?.batteryPct ??
    gpsSnapshot?.latest?.battery_pct ??
    requestedDevice?.battery_pct ??
    requestedDevice?.battery_percent ??
    requestedDevice?.battery ??
    null
  const gpsStatus = gpsSnapshot?.gpsStatus ??
    selectedGpsFix?.status ??
    selectedReportedLocation?.gpsStatus ??
    null
  const noFixAfterVerifiedPoint = Boolean(
    selectedGpsFix &&
    gpsSnapshot?.noFixReported === true &&
    (gpsSnapshot.lastPacketReceivedAt === null ||
      gpsSnapshot.lastPacketReceivedAt >= selectedGpsFix.timestamp)
  )
  const selectedMapLocation: GeofenceMapLocation | null = selectedGpsFix &&
    isFreshGpsTimestamp(selectedGpsFix.timestamp) &&
    !noFixAfterVerifiedPoint
    ? {
        latitude: selectedGpsFix.latitude,
        longitude: selectedGpsFix.longitude,
        timestamp: selectedGpsFix.timestamp,
        accuracy: selectedGpsFix.accuracy,
        verified: true,
        isCurrent: true,
        deviceId: String(gpsLookupId ?? ''),
        gpsStatus,
        batteryPct,
      }
    : selectedReportedLocation
      ? {
          latitude: selectedReportedLocation.latitude,
          longitude: selectedReportedLocation.longitude,
          timestamp: selectedReportedLocation.timestamp,
          accuracy: null,
          verified: false,
          isCurrent: false,
          deviceId: String(gpsLookupId ?? ''),
          gpsStatus,
          batteryPct,
        }
      : selectedGpsFix
        ? {
            latitude: selectedGpsFix.latitude,
            longitude: selectedGpsFix.longitude,
            timestamp: selectedGpsFix.timestamp,
            accuracy: selectedGpsFix.accuracy,
            verified: true,
            isCurrent: false,
            deviceId: String(gpsLookupId ?? ''),
            gpsStatus,
            batteryPct,
          }
      : null
  const activeAssignmentState = geofences != null &&
    geofenceAssignmentState?.deviceKey === String(gpsLookupId) &&
    geofenceAssignmentState.fenceKey === geofenceListKey
    ? geofenceAssignmentState
    : null
  const assignmentLoading = Boolean(requestedDevice && (
    loading ||
    geofences == null ||
    (geofences.length > 0 && !activeAssignmentState)
  ))
  const assignmentStates = activeAssignmentState?.assignments ?? {}
  const unverifiedAssignmentNames = (geofences ?? [])
    .filter(fence => assignmentStates[String(fence.id)] === 'unknown')
    .map(fence => fence.name)
  const mismatchedAssignmentNames = (geofences ?? [])
    .filter(fence => assignmentStates[String(fence.id)] === 'not_assigned')
    .map(fence => fence.name)
  const assignmentError = activeAssignmentState?.error ||
    (unverifiedAssignmentNames.length > 0
      ? `The assignment endpoint did not return device identifiers for ${unverifiedAssignmentNames.join(', ')}.`
      : deviceParam && mismatchedAssignmentNames.length > 0
        ? `The backend did not confirm this device on ${mismatchedAssignmentNames.join(', ')}.`
        : '')
  const assignedGeofences = requestedDevice
    ? (geofences ?? []).filter(fence => assignmentStates[String(fence.id)] === 'assigned')
    : []
  const gpsLoading = Boolean(gpsLookupId !== null && gpsSnapshot === null && !gpsError)
  const selectedLatitude = selectedMapLocation?.latitude ?? null
  const selectedLongitude = selectedMapLocation?.longitude ?? null
  const selectedTimestamp = selectedMapLocation?.timestamp ?? null
  const selectedFixVerified = selectedMapLocation?.verified === true
  const selectedFixIsCurrent = selectedMapLocation?.isCurrent === true
  const assignedGeofenceKey = assignedGeofences.map(fence => String(fence.id)).sort().join(',')
  const evaluationDeviceId = requestedDevice?.device_id == null
    ? String(gpsLookupId ?? '')
    : String(requestedDevice.device_id)
  const selectedDeviceId = requestedDevice?.device_id == null ? '' : String(requestedDevice.device_id)
  const journeyHistory = journeyHistoryState?.deviceKey === selectedDeviceId ? journeyHistoryState.journeys : []
  const journeyHistoryError = journeyHistoryErrorState?.deviceKey === selectedDeviceId ? journeyHistoryErrorState.error : ''
  const selectedFixKey = selectedFixVerified && selectedFixIsCurrent
    ? `${evaluationDeviceId}:${selectedTimestamp}:${selectedLatitude}:${selectedLongitude}:${assignedGeofenceKey}`
    : ''
  const evaluationError = evaluationErrorState?.fixKey === selectedFixKey
    ? evaluationErrorState.error
    : ''
  const journeyStatus = String(journeyRecord?.status ?? '').toUpperCase().replace(/[\s-]+/g, '_')
  const journeyIsLive = ['ACTIVE', 'IN_PROGRESS', 'STARTED'].includes(journeyStatus)
  const storedRouteTolerance = Number(journeyRecord?.route_corridor_meters)
  const requestedRouteTolerance = Number(routeCorridorMeters)
  const routeToleranceMeters = journeyRecord
    ? Number.isFinite(storedRouteTolerance) && storedRouteTolerance > 0 ? storedRouteTolerance : null
    : Number.isFinite(requestedRouteTolerance) && requestedRouteTolerance > 0 ? requestedRouteTolerance : null
  // The backend monitors every journey with a corridor; when none was saved it uses its default.
  const effectiveToleranceMeters = routeToleranceMeters ??
    (journeyRecord && approvedRoutePoints.length > 1 ? BACKEND_DEFAULT_CORRIDOR_METERS : null)
  const liveFixTimestamp = selectedMapLocation?.verified && selectedMapLocation.isCurrent
    ? typeof selectedMapLocation.timestamp === 'number'
      ? selectedMapLocation.timestamp
      : Date.parse(String(selectedMapLocation.timestamp ?? ''))
    : Number.NaN
  const liveFixLatitude = selectedMapLocation?.latitude ?? null
  const liveFixLongitude = selectedMapLocation?.longitude ?? null
  // Extend the recorded path to the current live fix so the blue line follows the blue dot
  // between /path polls instead of lagging behind it.
  const liveJourneyPath = ((): JourneyGpsPoint[] => {
    if (!journeyIsLive || !Number.isFinite(liveFixTimestamp) ||
      liveFixLatitude === null || liveFixLongitude === null) return journeyPathPoints
    const last = journeyPathPoints[journeyPathPoints.length - 1]
    if (last && last.timestamp >= liveFixTimestamp) return journeyPathPoints
    const distance = approvedRoutePoints.length > 1
      ? distanceFromRouteMeters([liveFixLatitude, liveFixLongitude], approvedRoutePoints)
      : null
    const onRoute = distance === null || effectiveToleranceMeters === null
      ? null
      : distance <= effectiveToleranceMeters
    return [...journeyPathPoints, {
      latitude: liveFixLatitude,
      longitude: liveFixLongitude,
      timestamp: liveFixTimestamp,
      onRoute,
    }]
  })()
  const fullTravelledRoute = liveJourneyPath.map(point => [point.latitude, point.longitude] as [number, number])
  const travelledRoute = playbackIndex === null
    ? fullTravelledRoute
    : fullTravelledRoute.slice(0, playbackIndex + 1)
  const deviationRoute = travelledDeviationSegments(
    playbackIndex === null ? liveJourneyPath : liveJourneyPath.slice(0, playbackIndex + 1),
    approvedRoutePoints,
    effectiveToleranceMeters,
  )
  const currentRouteDeviationMeters = journeyIsLive && playbackIndex === null &&
    selectedMapLocation?.verified && selectedMapLocation.isCurrent &&
    approvedRoutePoints.length > 1 && effectiveToleranceMeters !== null
    ? distanceFromRouteMeters([selectedMapLocation.latitude, selectedMapLocation.longitude], approvedRoutePoints)
    : null
  const currentRouteDeviationActive = currentRouteDeviationMeters !== null &&
    effectiveToleranceMeters !== null && currentRouteDeviationMeters > effectiveToleranceMeters

  // Journey start / end notifications. Detected from the polled journey status so they work for the
  // Start/Complete buttons and for backend auto-start / destination arrival. The event_id matches the
  // backend broadcast, so AppShell shows a single popup either way.
  const journeyStatusTracker = useRef<{ id: string; status: string } | null>(null)
  useEffect(() => {
    const id = journeyRecord ? String(journeyRecord.journey_id ?? journeyRecord.id ?? '') : ''
    const previous = journeyStatusTracker.current
    journeyStatusTracker.current = id && journeyStatus ? { id, status: journeyStatus } : null
    if (!id || !journeyStatus || !previous || previous.id !== id || previous.status === journeyStatus) return
    const liveStatuses = ['ACTIVE', 'IN_PROGRESS', 'STARTED']
    const type = liveStatuses.includes(journeyStatus) && !liveStatuses.includes(previous.status)
      ? 'JOURNEY_STARTED'
      : ['COMPLETED', 'ENDED', 'ARRIVED'].includes(journeyStatus)
        ? 'JOURNEY_COMPLETED'
        : ''
    if (!type) return
    const origin = journeyRecord?.start_location?.address
    const destination = journeyRecord?.end_location?.address
    const routeText = origin || destination ? ` (${origin ?? 'Origin'} → ${destination ?? 'Destination'})` : ''
    window.dispatchEvent(new CustomEvent('trackguard:journey-lifecycle', {
      detail: {
        type,
        event_type: type,
        event_id: `${id}:${type}`,
        journey_id: id,
        device_id: String(journeyRecord?.device_id ?? selectedDeviceId),
        severity: 'INFO',
        title: type === 'JOURNEY_STARTED' ? 'Journey Started' : 'Journey Completed',
        message: type === 'JOURNEY_STARTED'
          ? `Journey ${id}${routeText} is now active and being monitored.`
          : `Journey ${id}${routeText} has ended.`,
        requires_alarm: false,
        timestamp: new Date().toISOString(),
      },
    }))
  }, [journeyRecord, journeyStatus, selectedDeviceId])

  useEffect(() => {
    if (!playbackPlaying || fullTravelledRoute.length < 2) return
    const lastIndex = fullTravelledRoute.length - 1
    const nextIndex = Math.min((playbackIndex ?? 0) + 1, lastIndex)
    const timer = window.setTimeout(() => {
      setPlaybackIndex(nextIndex)
      if (nextIndex >= lastIndex) setPlaybackPlaying(false)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [fullTravelledRoute.length, playbackIndex, playbackPlaying])

  useEffect(() => {
    if (routeDeviceKey.current === selectedDeviceId) return
    routeDeviceKey.current = selectedDeviceId
    journeyOwnerDeviceKey.current = ''
    routeFitJourneyKey.current = ''
    setApprovedRouteId(null)
    setApprovedJourneyId(null)
    setJourneyRecord(null)
    setJourneyInactive(false)
    setJourneyAlerts([])
    setApprovedRoutePoints([])
    setJourneyLiveDetails(null)
    setJourneyMonitorError('')
    setSelectedRouteId('')
    setRouteChoices([])
    setRouteOriginPosition(null)
    setRouteDestinationPosition(null)
    setRouteOriginConfirmed(false)
    setRouteDestinationConfirmed(false)
    setRouteOriginSuggestions([])
    setRouteDestinationSuggestions([])
    setRouteMapFocusPoint(null)
    setJourneyPathPoints([])
    setPlaybackIndex(null)
    setPlaybackPlaying(false)
    setLiveMonitoringAlerts([])
    setJourneyMonitorError('')
  }, [selectedDeviceId])

  useEffect(() => {
    if (!selectedDeviceId) return
    const controller = new AbortController()
    let cancelled = false
    const refreshJourneyHistory = async () => {
      try {
        const history = await listJourneys(selectedDeviceId, undefined, controller.signal)
        if (!cancelled) {
          setJourneyHistoryState({ deviceKey: selectedDeviceId, journeys: history })
          setJourneyHistoryErrorState(null)
        }
      } catch (reason) {
        if (!cancelled && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setJourneyHistoryErrorState({
            deviceKey: selectedDeviceId,
            error: reason instanceof Error ? reason.message : 'Unable to load journey history.',
          })
        }
      }
    }
    void refreshJourneyHistory()
    const timer = window.setInterval(() => void refreshJourneyHistory(), 15000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [selectedDeviceId])

  useEffect(() => {
    if (!selectedDeviceId) return
    const controller = new AbortController()
    let cancelled = false
    let inFlight = false
    const refreshJourney = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const journey = approvedJourneyId && journeyOwnerDeviceKey.current === selectedDeviceId
          ? await getJourney(approvedJourneyId)
          : await getActiveJourney(selectedDeviceId)
        if (cancelled) return
        if (!journey) {
          setJourneyInactive(true)
          setJourneyRecord(null)
          setApprovedRoutePoints([])
          setJourneyPathPoints([])
          setJourneyLiveDetails(null)
          setJourneyAlerts([])
          setJourneyMonitorError('')
          return
        }
        setJourneyInactive(false)
        const journeyId = journey.journey_id ?? journey.id
        if (journeyId == null) {
          setJourneyMonitorError('The backend journey response did not include a journey ID.')
          return
        }
        setJourneyRecord(current => {
          const currentId = current?.journey_id ?? current?.id
          const retainedCorridor = currentId != null && String(currentId) === String(journeyId)
            ? current?.route_corridor_meters
            : null
          return {
            ...journey,
            route_corridor_meters: journey.route_corridor_meters ?? retainedCorridor,
          }
        })
        if (approvedJourneyId !== String(journeyId)) setApprovedJourneyId(String(journeyId))
        journeyOwnerDeviceKey.current = selectedDeviceId

        // Automatically recorded journeys have no approved route; asking for one only
        // produces a 404 that was being reported as "backend data unavailable".
        const hasApprovedRoute = String(journey.selected_route_id ?? '').trim() !== ''
        const [routeResult, pathResult, alertsResult, liveResult] = await Promise.allSettled([
          hasApprovedRoute ? getJourneyApprovedRoute(journeyId, controller.signal) : Promise.resolve(null),
          getJourneyTravelledPath(journeyId, controller.signal),
          getJourneyAlerts(journeyId, controller.signal),
          getJourneyLivePosition(journeyId, controller.signal),
        ])
        if (cancelled) return
        const errors: string[] = []
        if (!hasApprovedRoute) {
          setApprovedRouteId(null)
          setApprovedRoutePoints([])
        } else if (routeResult.status === 'fulfilled') {
          const selectedId = String(journey.selected_route_id ?? '')
          const routes = parseRoutes(routeResult.value, selectedId || undefined)
          const approved = routes.find(route => route.id === selectedId) ?? routes[0]
          setApprovedRouteId(selectedId || approved?.id || null)
          setApprovedRoutePoints(approved?.points ?? [])
          if (approved?.points.length && routeFitJourneyKey.current !== String(journeyId)) {
            routeFitJourneyKey.current = String(journeyId)
            setFitRoutesRequest(current => current + 1)
          }
          if (approved && selectedId) {
            const backendApproved = { ...approved, id: selectedId }
            setRouteChoices(current => current.some(route => route.id === selectedId)
              ? current.map(route => route.id === selectedId ? backendApproved : route)
              : [...current, backendApproved])
            setSelectedRouteId(selectedId)
          }
          if (!approved || approved.points.length < 2) errors.push('approved route geometry')
        } else {
          setApprovedRoutePoints([])
          errors.push('approved route')
        }
        if (pathResult.status === 'fulfilled') {
          const points = verifiedJourneyPoints(pathResult.value)
          // Always replace: keeping the previous journey's points showed a stale track.
          setJourneyPathPoints(points)
        } else {
          errors.push('verified journey path')
        }
        if (alertsResult.status === 'fulfilled') {
          const records = recordCollection(alertsResult.value)
          setJourneyAlerts(records)
        } else {
          errors.push('journey alerts')
        }
        if (liveResult.status === 'fulfilled') {
          setJourneyLiveDetails(journeyLivePosition(liveResult.value))
        } else {
          errors.push('journey live status')
        }
        setJourneyMonitorError(errors.length
          ? `Backend journey data unavailable: ${errors.join(', ')}.`
          : '')
      } catch (reason) {
        if (!cancelled && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setJourneyInactive(false)
          setJourneyMonitorError(reason instanceof Error ? reason.message : 'Unable to refresh backend journey data.')
        }
      } finally {
        inFlight = false
      }
    }
    void refreshJourney()
    const timer = window.setInterval(() => void refreshJourney(), 5000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [approvedJourneyId, selectedDeviceId])

  useEffect(() => {
    if (
      !selectedDeviceId ||
      gpsLookupId === null ||
      assignedGeofences.length === 0 ||
      !selectedFixVerified ||
      !selectedFixIsCurrent ||
      selectedLatitude === null ||
      selectedLongitude === null ||
      !selectedFixKey
    ) {
      return
    }
    if (lastEvaluationKey.current === selectedFixKey) return

    const controller = new AbortController()
    let cancelled = false
    let retryTimer: number | null = null
    lastEvaluationKey.current = selectedFixKey
    const evaluate = async () => {
      try {
        const result = await evaluateDeviceGeofences({
          device_id: evaluationDeviceId,
          latitude: selectedLatitude,
          longitude: selectedLongitude,
        }, controller.signal)
        if (cancelled) return
        setGeofenceEvaluation({ fixKey: selectedFixKey, value: normalizeGeofenceEvaluation(result) })
        setEvaluationErrorState(null)
      } catch (reason) {
        if (!cancelled && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          lastEvaluationKey.current = ''
          setEvaluationErrorState({
            fixKey: selectedFixKey,
            error: reason instanceof Error ? reason.message : 'Unable to evaluate this GPS fix.',
          })
          retryTimer = window.setTimeout(() => setEvaluationRetry(value => value + 1), 10000)
        }
      }
    }
    void evaluate()
    return () => {
      cancelled = true
      controller.abort()
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [
    assignedGeofences.length,
    evaluationRetry,
    gpsLookupId,
    evaluationDeviceId,
    selectedDeviceId,
    selectedFixIsCurrent,
    selectedFixKey,
    selectedFixVerified,
    selectedLatitude,
    selectedLongitude,
  ])

  useEffect(() => {
    const acceptBackendAlert = (alert: Record<string, unknown>) => {
      const eventDeviceId = String(alert.device_id ?? alert.imei ?? '')
      if (eventDeviceId && selectedDeviceId && eventDeviceId !== selectedDeviceId) return
      const type = alertType(alert)
      if (type === 'ROUTE_REJOINED') {
        // Backend auto-resolves the deviation alert; mirror that for the live copy so the siren stops.
        setLiveMonitoringAlerts(current => current.map(item =>
          alertType(item).includes('ROUTE_DEVIATION') ? { ...item, status: 'RESOLVED' } : item
        ))
        reloadAlerts()
        return
      }
      if (NON_ALERT_EVENT_TYPES.has(type)) return
      setLiveMonitoringAlerts(current => uniqueAlerts(current, [alert]))
    }
    const handleLiveAlert = (event: Event) => {
      const detail = recordValue((event as CustomEvent<unknown>).detail)
      if (!detail) return
      acceptBackendAlert(detail)
      const eventDeviceId = String(detail.device_id ?? detail.imei ?? '')
      const eventFenceId = String(detail.geofence_id ?? '')
      const eventTypes = [detail.event_type, detail.alert_type, detail.type].map(value => String(value ?? '').toUpperCase())
      const eventType = eventTypes.find(value => value.includes('GEOFENCE')) ?? (eventTypes.find(Boolean) || alertType(detail))
      // Live WS payloads omit fence_type, so resolve it from the loaded geofence list.
      const knownFence = (geofences ?? []).find(fence => String(fence.id) === eventFenceId)
      const eventFenceType = String(detail.fence_type ?? detail.geofence_type ?? knownFence?.fence_type ?? 'INCLUSION').toUpperCase()
      const isEntry = eventType.includes('ENTRY')
      const isExit = eventType.includes('EXIT')
      if (
        selectedDeviceId &&
        eventDeviceId &&
        eventDeviceId === selectedDeviceId &&
        eventFenceId
      ) {
        const breached = eventType.includes('VIOLATION') || eventType.includes('BREACH') ||
          (eventFenceType === 'EXCLUSION' ? isEntry : isExit)
        const recovered = eventType.includes('RECOVERY') ||
          (eventFenceType === 'EXCLUSION' ? isExit : isEntry)
        if (breached) {
          setLiveViolation({ deviceId: eventDeviceId, geofenceId: eventFenceId })
          setSelectedGeofenceId(eventFenceId)
        } else if (recovered) {
          setLiveViolation(current => current?.geofenceId === eventFenceId ? null : current)
        }
      }
      reloadAlerts()
    }
    const handleLiveJourneyAlert = (event: Event) => {
      const detail = recordValue((event as CustomEvent<unknown>).detail)
      if (detail) acceptBackendAlert(detail)
    }
    const handleAlertRefresh = () => reloadAlerts()
    const handleSocketStatus = (event: Event) => {
      const detail = recordValue((event as CustomEvent<unknown>).detail)
      setAlertSocketConnected(detail?.connected === true)
      if (detail?.connected === true) reloadAlerts()
    }
    window.addEventListener('trackguard:geofence-live-alert', handleLiveAlert)
    window.addEventListener('trackguard:journey-live-alert', handleLiveJourneyAlert)
    window.addEventListener('trackguard:geofence-alert-refresh', handleAlertRefresh)
    window.addEventListener('trackguard:alert-socket', handleSocketStatus)
    return () => {
      window.removeEventListener('trackguard:geofence-live-alert', handleLiveAlert)
      window.removeEventListener('trackguard:journey-live-alert', handleLiveJourneyAlert)
      window.removeEventListener('trackguard:geofence-alert-refresh', handleAlertRefresh)
      window.removeEventListener('trackguard:alert-socket', handleSocketStatus)
    }
  }, [geofences, reloadAlerts, selectedDeviceId])

  const monitoringAlerts = uniqueAlerts(
    (geofenceAlerts ?? []).map(alert => alert as unknown as Record<string, unknown>),
    journeyAlerts,
    liveMonitoringAlerts,
  ).filter(alert => !NON_ALERT_EVENT_TYPES.has(alertType(alert)))
  const journeyEventHistory = uniqueAlerts(
    journeyAlerts,
    (geofenceAlerts ?? []).map(alert => alert as unknown as Record<string, unknown>),
  )
  const activeRouteDeviationAlert = monitoringAlerts.find(alert =>
    alertIsUnresolved(alert) && alertType(alert).includes('ROUTE_DEVIATION')
  ) ?? null
  const activeMonitoringAlert = activeRouteDeviationAlert ?? monitoringAlerts.find(alertIsUnresolved) ?? null
  const activeMonitoringAlertId = activeMonitoringAlert ? alertId(activeMonitoringAlert) : ''
  const activeMonitoringAlertType = activeMonitoringAlert ? alertType(activeMonitoringAlert) : ''
  const backendRouteDeviationActive = activeRouteDeviationAlert !== null
  // Live: the unresolved deviation's current verified fix. Otherwise (resolved, or a
  // completed journey being reviewed): where the backend recorded this journey's latest deviation.
  const recordedJourneyDeviationLocation = useMemo(() => {
    const deviations = journeyAlerts
      .filter(alert => alertType(alert).includes('ROUTE_DEVIATION'))
      .sort((first, second) => alertEventTime(second) - alertEventTime(first))
    for (const alert of deviations) {
      const location = recordedDeviationLocation(alert)
      if (location) return location
    }
    return null
  }, [journeyAlerts])
  const backendDeviationLocation = (activeRouteDeviationAlert
    ? verifiedAlertLocation(activeRouteDeviationAlert)
    : null) ?? recordedJourneyDeviationLocation
  // "Recent geofence alerts": with a journey selected, show everything from its start to its
  // end — geofence entry/exit alerts, route deviation/schedule alerts, and the journey's own
  // start/completion times. Without a journey, the device's geofence alert history as before.
  const journeyWindow = useMemo(() => {
    if (!journeyRecord) return null
    const record = journeyRecord as unknown as Record<string, unknown>
    const startValue = String(record.actual_departure ?? record.start_time ?? record.created_at ?? '')
    const endValue = record.end_time == null ? '' : String(record.end_time)
    const start = Date.parse(startValue)
    const end = Date.parse(endValue)
    return {
      id: String(record.journey_id ?? record.id ?? ''),
      deviceId: String(record.device_id ?? ''),
      status: String(record.status ?? '').toUpperCase(),
      startValue,
      endValue,
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
    }
  }, [journeyRecord])
  const alertTableRows = useMemo<AlertTableRow[]>(() => {
    const geofenceRows: AlertTableRow[] = (geofenceAlerts ?? []).map(alert => ({
      key: `geofence:${String(alert.alert_id ?? alert.id)}`,
      kind: 'geofence',
      time: alert.event_time ?? alert.created_at ?? null,
      device: String(alert.device_name ?? alert.device_id ?? alert.imei ?? 'Device'),
      context: String(alert.geofence_name ?? alert.geofence_id ?? 'Geofence'),
      message: String(alert.message ?? alert.type ?? alert.alert_type ?? 'Geofence event'),
      severity: String(alert.severity ?? '—'),
      status: String(alert.status ?? 'NEW'),
      actionId: String(alert.alert_id ?? alert.id),
      geofenceAlert: alert,
    }))
    if (!journeyWindow || journeyWindow.start === null) return geofenceRows

    const inWindow = (value: unknown) => {
      const time = Date.parse(String(value ?? ''))
      if (!Number.isFinite(time) || journeyWindow.start === null) return false
      return time >= journeyWindow.start && (journeyWindow.end === null || time <= journeyWindow.end)
    }
    const routeLabel = `Journey ${journeyWindow.id}`
    const journeyRows: AlertTableRow[] = journeyAlerts
      .filter(alert => alert.geofence_alert_id == null && alert.geofence_id == null && !alertType(alert).includes('GEOFENCE'))
      .map(alert => ({
        key: `journey:${alertDedupeKey(alert)}`,
        kind: 'journey' as const,
        time: String(alert.event_time ?? alert.created_at ?? alert.timestamp ?? ''),
        device: String(alert.device_id ?? alert.imei ?? 'Device'),
        context: routeLabel,
        message: String(alert.message ?? alert.title ?? alertType(alert) ?? 'Journey alert'),
        severity: String(alert.severity ?? '—'),
        status: String(alert.status ?? 'ACTIVE'),
        actionId: alertId(alert),
        deviation: alertType(alert).includes('ROUTE_DEVIATION'),
      }))
    const markerRows: AlertTableRow[] = [{
      key: `marker:start:${journeyWindow.id}`,
      kind: 'marker',
      time: journeyWindow.startValue,
      device: journeyWindow.deviceId || 'Device',
      context: routeLabel,
      message: 'Journey started',
      severity: 'INFO',
      status: 'STARTED',
      actionId: '',
    }]
    if (journeyWindow.end !== null) {
      markerRows.push({
        key: `marker:end:${journeyWindow.id}`,
        kind: 'marker',
        time: journeyWindow.endValue,
        device: journeyWindow.deviceId || 'Device',
        context: routeLabel,
        message: `Journey ${journeyWindow.status === 'CANCELLED' ? 'cancelled' : 'completed'}`,
        severity: 'INFO',
        status: journeyWindow.status || 'COMPLETED',
        actionId: '',
      })
    }
    return [...geofenceRows.filter(row => inWindow(row.time)), ...journeyRows, ...markerRows]
      .sort((first, second) => (Date.parse(String(second.time ?? '')) || 0) - (Date.parse(String(first.time ?? '')) || 0))
  }, [geofenceAlerts, journeyAlerts, journeyWindow])

  const activeAlertRequiresSound = Boolean(activeMonitoringAlert && (
    activeMonitoringAlert.requires_alarm === true || activeMonitoringAlertType.includes('ROUTE_DEVIATION')
  ))

  useEffect(() => {
    if (currentRouteDeviationActive) {
      startAlertAlarm('HIGH')
      return () => stopAlertAlarm()
    }
    if (!activeMonitoringAlertId || !activeAlertRequiresSound || silencedAlertIds.current.has(activeMonitoringAlertId)) {
      stopAlertAlarm()
      return
    }
    startAlertAlarm(String(activeMonitoringAlert?.severity ?? 'HIGH'))
    return () => stopAlertAlarm()
  }, [activeMonitoringAlert?.severity, activeMonitoringAlertId, activeAlertRequiresSound, currentRouteDeviationActive])

  const silenceActiveMonitoringAlert = () => {
    if (activeMonitoringAlertId) {
      silencedAlertIds.current.add(activeMonitoringAlertId)
      setSilencedAlertId(activeMonitoringAlertId)
    }
    stopAlertAlarm()
  }

  const acknowledgeActiveMonitoringAlert = async () => {
    if (!activeMonitoringAlert) return
    if (!activeMonitoringAlertId) {
      setAlertActionError('This backend alert does not include an alert ID to acknowledge.')
      return
    }
    setAlertActionBusy(true)
    setAlertActionError('')
    try {
      const response = activeMonitoringAlertType.includes('GEOFENCE') || activeMonitoringAlert.geofence_id != null
        ? await acknowledgeGeofenceAlert(activeMonitoringAlertId, 'Acknowledged by operator')
        : await acknowledgeAlert(activeMonitoringAlertId, 'Acknowledged by operator')
      stopAlertAlarm()
      const acknowledged = recordValue(response)
      if (acknowledged) setLiveMonitoringAlerts(current => uniqueAlerts(
        current.filter(item => alertDedupeKey(item) !== activeMonitoringAlertId),
        [acknowledged],
      ))
      setSilencedAlertId(activeMonitoringAlertId)
      silencedAlertIds.current.add(activeMonitoringAlertId)
      reloadAlerts()
    } catch (reason) {
      setAlertActionError(reason instanceof Error ? reason.message : 'Unable to acknowledge this backend alert.')
    } finally {
      setAlertActionBusy(false)
    }
  }

  const geofenceSource = deviceParam && requestedDevice ? assignedGeofences : geofences ?? []
  const searchNeedle = search.trim().toLowerCase()
  const visibleGeofences = searchNeedle
    ? geofenceSource.filter(fence => {
        const devicesText = [
          ...(fence.device_ids ?? []),
          fence.assigned_device_id ?? '',
          ...(fence.devices ?? []).map(item => typeof item === 'object' ? item.device_id ?? item.id : item),
        ].join(' ')
        return `${fence.name} ${fence.fence_type} ${fence.type ?? ''} ${devicesText}`.toLowerCase().includes(searchNeedle)
      })
    : geofenceSource

  const resetForm = () => {
    setEditingFence(null)
    setName('')
    setRemark('')
    setAlarmType('in_and_out')
    setActive(true)
    setEntryAlert(true)
    setExitAlert(true)
    setSelectedDeviceIds(requestedDevice ? [requestedDevice.device_id] : [])
    setDraft({
      type: 'CIRCLE',
      latitude: requestedDevice?.last_latitude ?? null,
      longitude: requestedDevice?.last_longitude ?? null,
      radius: 200,
      polygon: [],
    })
    setActionError('')
  }

  const openCreateDialog = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEditDialog = (fence: Geofence) => {
    const center = getCenter(fence)
    setEditingFence(fence)
    setName(fence.name ?? '')
    setRemark(fence.description ?? '')
    setAlarmType(getAlarmType(fence))
    setActive(isActive(fence))
    setEntryAlert(Boolean(fence.entry_alert))
    setExitAlert(Boolean(fence.exit_alert))
    setSelectedDeviceIds(getAssignedDeviceIds(fence))
    setDraft({
      type: (fence.type?.toUpperCase() === 'POLYGON' ? 'POLYGON' : 'CIRCLE') as GeofenceShape,
      latitude: center?.[0] ?? null,
      longitude: center?.[1] ?? null,
      radius: fence.radius_meters ?? fence.radius_m ?? 500,
      polygon: fence.polygon_coordinates ?? [],
    })
    setActionError('')
    setDialogOpen(true)
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setActionError('')
    if (!draft) return
    if (draft.type === 'CIRCLE' && (draft.latitude == null || draft.longitude == null)) {
      setActionError('Choose a valid circle center on the map or enter valid coordinates.')
      return
    }
    if (draft.type === 'POLYGON' && draft.polygon.length < 3) {
      setActionError('A polygon needs at least three boundary points. Add them by clicking the map.')
      return
    }
    if (draft.type === 'CIRCLE' && (!Number.isFinite(draft.radius) || draft.radius < 10 || draft.radius > 50000)) {
      setActionError('Radius must be between 10 and 50,000 meters.')
      return
    }

    setActionBusy(true)
    try {
      const fenceType: FenceType = alarmType === 'only_enter' ? 'INCLUSION' : 'EXCLUSION'
      const payload: GeofenceCreate = {
        name: name.trim(),
        description: remark.trim() || null,
        type: draft.type,
        fence_type: fenceType,
        center_latitude: draft.type === 'CIRCLE' ? draft.latitude : null,
        center_longitude: draft.type === 'CIRCLE' ? draft.longitude : null,
        radius_meters: draft.type === 'CIRCLE' ? draft.radius : null,
        polygon_coordinates: draft.type === 'POLYGON' ? draft.polygon : null,
        active,
        entry_alert: entryAlert,
        exit_alert: exitAlert,
      }

      const saved = editingFence
        ? await updateGeofence(editingFence.id, payload)
        : await createGeofence(payload)
      const savedId = editingFence?.id ?? saved.id
      if (!editingFence) setEditingFence(saved)
      try {
        if (editingFence) {
          const removedDeviceIds = getAssignedDeviceIds(editingFence)
            .filter(deviceId => !selectedDeviceIds.includes(deviceId))
          await Promise.all(removedDeviceIds.map(deviceId => removeDeviceFromGeofence(savedId, deviceId)))
        }
        if (selectedDeviceIds.length > 0) {
          await assignDevicesToGeofence(savedId, selectedDeviceIds)
        }
      } catch (reason) {
        reload()
        setActionError(`Geofence saved, but device assignments could not be updated: ${reason instanceof Error ? reason.message : 'Unknown API error.'}`)
        return
      }
      setDialogOpen(false)
      reload()
      reloadAlerts()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to save geofence.')
    } finally {
      setActionBusy(false)
    }
  }

  const handleToggle = async (fence: Geofence) => {
    setActionError('')
    try {
      await updateGeofence(fence.id, { active: !isActive(fence) })
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to update geofence.')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setActionError('')
    setActionBusy(true)
    try {
      await deleteGeofence(deleteTarget.id)
      setDeleteTarget(null)
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to delete geofence.')
    } finally {
      setActionBusy(false)
    }
  }

  const handleAlertAction = async (alert: ApiAlert, action: 'acknowledge' | 'resolve') => {
    const id = alert.alert_id ?? alert.id
    const key = String(id)
    setAlertBusyId(key)
    setActionError('')
    try {
      if (action === 'acknowledge') await acknowledgeGeofenceAlert(id)
      else await resolveGeofenceAlert(id)
      reloadAlerts()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to update geofence alert.')
    } finally {
      setAlertBusyId(null)
    }
  }

  const handleAlertRowAction = async (row: AlertTableRow, action: 'acknowledge' | 'resolve') => {
    if (row.kind === 'geofence' && row.geofenceAlert) {
      await handleAlertAction(row.geofenceAlert, action)
      return
    }
    if (row.kind !== 'journey' || !row.actionId) return
    setAlertBusyId(row.actionId)
    setActionError('')
    try {
      const response = action === 'acknowledge'
        ? await acknowledgeAlert(row.actionId)
        : await resolveAlert(row.actionId)
      const updated = recordValue(response)
      if (updated) {
        setJourneyAlerts(current => current.map(item => alertId(item) === row.actionId ? { ...item, ...updated } : item))
      }
      reloadAlerts()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to update journey alert.')
    } finally {
      setAlertBusyId(null)
    }
  }

  const handleAlarmTypeChange = (next: AlarmType) => {
    setAlarmType(next)
    setEntryAlert(next !== 'only_out')
    setExitAlert(next !== 'only_enter')
  }

  const updateCoordinate = (axis: 'latitude' | 'longitude', value: string) => {
    if (!draft) return
    const coordinate = parseCoordinate(value, axis === 'latitude' ? -90 : -180, axis === 'latitude' ? 90 : 180)
    setDraft({ ...draft, [axis]: coordinate })
  }

  const removeLastPolygonPoint = () => {
    if (draft) setDraft({ ...draft, polygon: draft.polygon.slice(0, -1) })
  }

  const selectedLocationLabel = selectedMapLocation?.verified && selectedMapLocation.isCurrent && !noFixAfterVerifiedPoint
    ? 'GPS VALID'
    : 'GPS UNKNOWN'
  const currentEvaluation = geofenceEvaluation?.fixKey === selectedFixKey
    ? geofenceEvaluation.value
    : null
  const hasCurrentGps = Boolean(selectedMapLocation?.verified && selectedMapLocation.isCurrent)
  const liveViolationApplies = Boolean(
    hasCurrentGps &&
    liveViolation?.deviceId === selectedDeviceId &&
    assignedGeofences.some(fence => String(fence.id) === liveViolation.geofenceId),
  )
  const overallGeofenceState: GeofenceEvaluation['status'] = assignedGeofences.length === 0 || !hasCurrentGps
    ? 'UNKNOWN'
    : liveViolationApplies
      ? 'VIOLATION'
      : currentEvaluation?.status ?? 'UNKNOWN'
  const connectionStatus = String(deviceStatus?.connectivity_status ?? 'UNKNOWN').toUpperCase()
  const connectionLabel = ['ONLINE', 'CONNECTED'].includes(connectionStatus)
    ? 'Online'
    : ['OFFLINE', 'DISCONNECTED'].includes(connectionStatus)
      ? 'Offline'
      : 'Unknown'
  const zoneEvaluations = assignedGeofences.map(fence => ({
    fence,
    result: currentEvaluation?.zones.find(zone => zone.id === String(fence.id)),
  }))
  const violationActive = overallGeofenceState === 'VIOLATION'

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {deviceParam ? 'Device Electronic Fence' : 'Electronic Fence Management'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create and manage circular or polygon boundaries, device assignments, and entry/exit alerts.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {deviceParam && (
            <Button component={Link} to={`/admin/monitoring-center?device=${encodeURIComponent(deviceParam)}`} sx={{ textTransform: 'none' }}>
              Back to Monitoring
            </Button>
          )}
          <Button
            variant="outlined"
            component={Link}
            to="/admin/alerts?type=geofence"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Geofence alert history
          </Button>
          <Button
            variant="contained"
            onClick={openCreateDialog}
            startIcon={<AddOutlined />}
            sx={{ bgcolor: '#0284c7', textTransform: 'none', fontWeight: 600, px: 2 }}
          >
            Create geofence
          </Button>
        </Stack>
      </Box>

      <Alert severity="info" icon={<InfoOutlined />} sx={{ fontSize: 13 }}>
        <strong>Manual map placement:</strong> click the map to place a circle center or add polygon vertices. Drag the blue handle to move a circle; drag the orange handle to resize it. No address is sent to a third-party geocoder.
      </Alert>

      {actionError && <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert>}
      {devicesError && <ApiFeedback loading={false} error={devicesError} empty={false} emptyMessage="" />}
      {devicesLoading && !apiDevices && <ApiFeedback loading empty={false} error="" emptyMessage="" />}
      {!devicesLoading && apiDevices && !requestedDevice && (
        <Alert severity="warning">
          {deviceParam
            ? 'This device is not available in the device list.'
            : `The configured GPS watch (${DEFAULT_GEOFENCE_WATCH_ID}) is not available in the device list.`}
        </Alert>
      )}
      {gpsError && <Alert severity="warning" onClose={() => setGpsError('')}>{gpsError}</Alert>}
      {requestedDevice && (
        <Card sx={{ border: '1px solid #e2e8f0', boxShadow: 'none' }}>
          <CardContent>
            <Stack spacing={1.5}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>LIVE DEVICE GEOFENCE STATUS</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {requestedDevice.device_name ?? requestedDevice.device_id} · Device ID: {requestedDevice.device_id}
                  </Typography>
                </Box>
                <Chip
                  color={overallGeofenceState === 'VIOLATION' ? 'error' : overallGeofenceState === 'SAFE' ? 'success' : 'default'}
                  label={`Overall Status: ${overallGeofenceState}`}
                />
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 3 }} sx={{ flexWrap: 'wrap' }}>
                <Typography variant="body2">Connection: {connectionLabel}</Typography>
                <Typography variant="body2">
                  GPS validity: {hasCurrentGps ? 'VALID' : 'UNKNOWN'}
                </Typography>
                <Typography variant="body2">
                  Last GPS Fix: {selectedMapLocation?.timestamp == null
                    ? 'Unavailable'
                    : new Date(selectedMapLocation.timestamp).toLocaleString()}
                </Typography>
                <Typography variant="body2">
                  Last packet received: {gpsSnapshot?.lastPacketReceivedAt == null
                    ? 'Unavailable'
                    : new Date(gpsSnapshot.lastPacketReceivedAt).toLocaleString()}
                </Typography>
                <Typography variant="body2">GPS Status: {hasCurrentGps ? gpsStatus ?? 'VALID' : 'UNKNOWN'}</Typography>
                <Typography variant="body2">
                  Alert WebSocket: {alertSocketConnected ? 'Connected' : 'Disconnected'}
                </Typography>
              </Stack>
              <Typography variant="body2">
                Geofence assignment: {loading || (geofences === undefined && !error)
                  ? 'Loading'
                  : error
                    ? 'Unavailable'
                    : assignmentLoading
                      ? 'Verifying'
                      : assignmentError
                        ? 'Not confirmed'
                        : assignedGeofences.length > 0
                          ? `Confirmed: ${assignedGeofences.map(fence => fence.name).join(', ')}`
                          : 'No geofences assigned'}
              </Typography>
              {deviceStatusError && <Alert severity="error">Device status unavailable: {deviceStatusError}</Alert>}
              {evaluationError && <Alert severity="warning">Geofence evaluation unavailable: {evaluationError}</Alert>}
              {assignmentError && <Alert severity="warning">Unable to confirm geofence assignment: {assignmentError}</Alert>}
              {!assignmentLoading && !assignmentError && assignedGeofences.length === 0 ? (
                <Alert severity="info">No geofences are assigned to this device. Status remains UNKNOWN.</Alert>
              ) : (
                !assignmentLoading && assignedGeofences.length > 0 && (
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {zoneEvaluations.map(({ fence, result }) => (
                      <Chip
                        key={fence.id}
                        variant="outlined"
                        color={result?.state === 'Violation' ? 'error' : 'default'}
                        label={`${fence.name}: ${result?.state ?? 'Unknown'}`}
                      />
                    ))}
                    {assignedGeofences.map(fence => (
                      <Chip
                        key={`assignment-${fence.id}`}
                        size="small"
                        color="success"
                        variant="outlined"
                        label={`Assigned: ${fence.name}`}
                      />
                    ))}
                  </Stack>
                )
              )}
              {deviceStatus === null && !deviceStatusError && (
                <Typography variant="caption" color="text.secondary">Waiting for the backend device-status response.</Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {requestedDevice && (
        <Card sx={{ border: '1px solid #e2e8f0', boxShadow: 'none' }}>
          <CardContent>
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {requestedDevice.device_name ?? requestedDevice.serial_number}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Device ID: {requestedDevice.device_id} · GPS status refreshes every 5 seconds
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  color={selectedMapLocation?.isCurrent && selectedMapLocation.verified ? 'success' : 'warning'}
                  label={selectedLocationLabel}
                />
              </Box>
              {gpsLoading ? (
                <Alert severity="info">Loading the latest GPS status from the watch…</Alert>
              ) : selectedMapLocation ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 3 }} sx={{ flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    Latitude: {selectedMapLocation.latitude.toFixed(6)}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    Longitude: {selectedMapLocation.longitude.toFixed(6)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    GPS time: {selectedMapLocation.timestamp === null
                      ? 'Unavailable'
                      : new Date(selectedMapLocation.timestamp).toLocaleString()}
                  </Typography>
                  {selectedMapLocation.accuracy !== null && (
                    <Typography variant="body2" color="text.secondary">
                      Reported accuracy: ±{Math.round(selectedMapLocation.accuracy)} m
                    </Typography>
                  )}
                </Stack>
              ) : (
                <Alert severity="info">
                  No current GPS fix or last-known location is available from the GPS endpoint. Device-list coordinates are not used as a fallback.
                </Alert>
              )}
              {selectedMapLocation?.verified && selectedMapLocation.isCurrent && (
                <Typography variant="caption" color="text.secondary">
                  Displayed coordinates are the watch’s recorded GPS fix; actual precision depends on the GPS accuracy reported by the watch.
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Card sx={{ border: '1px solid #bfdbfe', boxShadow: 'none' }}>
        <CardContent>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Route selection and live deviation monitoring</Typography>
              <Typography variant="body2" color="text.secondary">Search for place names, enter latitude and longitude, or pick points on the map. Review address matches on the map before confirming them and comparing route options.</Typography>
            </Box>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} component="form" onSubmit={event => { event.preventDefault(); void findRouteAlternatives() }}>
              <Box sx={{ display: 'flex', flex: 1, minWidth: 0, gap: 1 }}>
                <TextField
                  size="small"
                  label="Origin name"
                  value={routeOrigin}
                  disabled={routeBusy || locationSearchBusy !== null || !!approvedRouteId}
                  onChange={event => {
                    setRouteOrigin(event.target.value)
                    setRouteOriginPosition(null)
                    setRouteOriginConfirmed(false)
                    setRouteOriginSuggestions([])
                    setRouteMapFocusPoint(null)
                    setRouteChoices([])
                    setSelectedRouteId('')
                    setRouteMessage('')
                  }}
                  placeholder="Place name or latitude, longitude"
                  fullWidth
                />
                <Button
                  type="button"
                  variant="outlined"
                  disabled={routeBusy || locationSearchBusy !== null || !!approvedRouteId}
                  onClick={() => void searchRouteLocation('origin')}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {locationSearchBusy === 'origin' ? 'Searching…' : 'Search origin'}
                </Button>
              </Box>
              <Box sx={{ display: 'flex', flex: 1, minWidth: 0, gap: 1 }}>
                <TextField
                  size="small"
                  label="Destination name"
                  value={routeDestination}
                  disabled={routeBusy || locationSearchBusy !== null || !!approvedRouteId}
                  onChange={event => {
                    setRouteDestination(event.target.value)
                    setRouteDestinationPosition(null)
                    setRouteDestinationConfirmed(false)
                    setRouteDestinationSuggestions([])
                    setRouteMapFocusPoint(null)
                    setRouteChoices([])
                    setSelectedRouteId('')
                    setRouteMessage('')
                  }}
                  placeholder="Place name or latitude, longitude"
                  fullWidth
                />
                <Button
                  type="button"
                  variant="outlined"
                  disabled={routeBusy || locationSearchBusy !== null || !!approvedRouteId}
                  onClick={() => void searchRouteLocation('destination')}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {locationSearchBusy === 'destination' ? 'Searching…' : 'Search destination'}
                </Button>
              </Box>
              <Button
                type="submit"
                variant="outlined"
                disabled={routeBusy || locationSearchBusy !== null || !!pointPickMode || !!approvedRouteId || !routeOriginReady || !routeDestinationReady}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {routeBusy ? 'Finding…' : 'Find routes'}
              </Button>
            </Stack>
            {routeOriginSuggestions.length > 0 && (
              <Stack spacing={0.75} role="group" aria-label="Origin search results">
                <Typography variant="caption" color="text.secondary">
                  Origin matches from: {routeOriginSuggestions[0].query}
                </Typography>
                {routeOriginSuggestions.map((suggestion, index) => (
                  <Button
                    key={`origin-${suggestion.latitude}-${suggestion.longitude}-${index}`}
                    variant={routeOriginPosition?.[0] === suggestion.latitude && routeOriginPosition[1] === suggestion.longitude ? 'contained' : 'outlined'}
                    onClick={() => selectRouteLocation(suggestion, 'origin')}
                    disabled={routeBusy || !!approvedRouteId}
                    sx={{ justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none', whiteSpace: 'normal' }}
                  >
                    {suggestion.displayName}
                  </Button>
                ))}
              </Stack>
            )}
            {routeDestinationSuggestions.length > 0 && (
              <Stack spacing={0.75} role="group" aria-label="Destination search results">
                <Typography variant="caption" color="text.secondary">
                  Destination matches from: {routeDestinationSuggestions[0].query}
                </Typography>
                {routeDestinationSuggestions.map((suggestion, index) => (
                  <Button
                    key={`destination-${suggestion.latitude}-${suggestion.longitude}-${index}`}
                    variant={routeDestinationPosition?.[0] === suggestion.latitude && routeDestinationPosition[1] === suggestion.longitude ? 'contained' : 'outlined'}
                    onClick={() => selectRouteLocation(suggestion, 'destination')}
                    disabled={routeBusy || !!approvedRouteId}
                    sx={{ justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none', whiteSpace: 'normal' }}
                  >
                    {suggestion.displayName}
                  </Button>
                ))}
              </Stack>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant={pointPickMode === 'origin' ? 'contained' : 'outlined'} size="small" disabled={routeBusy || !!approvedRouteId} onClick={() => setPointPickMode('origin')}>Pick origin on map</Button>
              <Typography variant="caption" color="text.secondary">{routeOriginPosition ? `Origin: ${routeOriginPosition[0].toFixed(6)}, ${routeOriginPosition[1].toFixed(6)}` : 'Origin coordinates not selected'}</Typography>
              {routeOriginPosition && !routeOriginConfirmed && <Button size="small" variant="contained" disabled={routeBusy || !!approvedRouteId} onClick={() => { setRouteOriginConfirmed(true); setRouteMessage('Origin location confirmed on the map.') }}>Confirm origin on map</Button>}
              <Button variant={pointPickMode === 'destination' ? 'contained' : 'outlined'} size="small" disabled={routeBusy || !!approvedRouteId} onClick={() => setPointPickMode('destination')}>Pick destination on map</Button>
              <Typography variant="caption" color="text.secondary">{routeDestinationPosition ? `Destination: ${routeDestinationPosition[0].toFixed(6)}, ${routeDestinationPosition[1].toFixed(6)}` : 'Destination coordinates not selected'}</Typography>
              {routeDestinationPosition && !routeDestinationConfirmed && <Button size="small" variant="contained" disabled={routeBusy || !!approvedRouteId} onClick={() => { setRouteDestinationConfirmed(true); setRouteMessage('Destination location confirmed on the map.') }}>Confirm destination on map</Button>}
              {pointPickMode && <Chip size="small" color="info" label={`Click map to set ${pointPickMode}`} />}
            </Stack>
            <TextField
              size="small"
              type="number"
              label="Route deviation tolerance (meters)"
              value={routeCorridorMeters}
              onChange={event => setRouteCorridorMeters(event.target.value)}
              disabled={Boolean(approvedRouteId)}
              slotProps={{ htmlInput: { min: 1, step: 10 } }}
              sx={{ maxWidth: 320 }}
              helperText="Saved with the approved journey; deviations beyond this distance are highlighted and alerted."
            />
            {routeChoices.length > 0 && (
              <Stack spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Route alternatives — review the available safety information and select the safest route
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {routeChoices.map((route, index) => {
                    const selected = route.id === selectedRouteId
                    const approved = route.id === approvedRouteId
                    return (
                      <Button
                        key={route.id}
                        variant={selected ? 'contained' : 'outlined'}
                        color={approved ? 'success' : selected ? 'secondary' : 'primary'}
                        disabled={routeBusy || Boolean(approvedRouteId)}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedRouteId(route.id)
                          setRouteMessage(`Selected ${route.name}. Review and approve it when ready.`)
                        }}
                        sx={{ minWidth: { xs: '100%', md: 250 }, justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none' }}
                      >
                        <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {approved ? 'Approved: ' : `Route ${index + 1}: `}{route.name}
                          </Typography>
                          <Typography variant="caption">
                            {route.distanceKm === null ? 'Distance unavailable' : `${route.distanceKm.toFixed(1)} km`}
                            {' · '}
                            {route.durationMinutes === null ? 'Duration unavailable' : `${Math.round(route.durationMinutes)} min`}
                          </Typography>
                          <Typography variant="caption">
                            {route.safetyScore !== null
                              ? `Safety score: ${route.safetyScore}`
                              : route.riskLevel
                                ? `Risk: ${route.riskLevel}`
                                : 'No safety rating supplied by backend'}
                          </Typography>
                        </Stack>
                      </Button>
                    )
                  })}
                </Stack>
              </Stack>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {!approvedRouteId && routeChoices.length > 0 && (
                <Button
                  variant="contained"
                  disabled={routeBusy || !selectedDeviceId || !currentRoute}
                  onClick={() => void approveSelectedRoute()}
                  sx={{ textTransform: 'none' }}
                >
                  {routeBusy ? 'Approving…' : 'Approve selected route'}
                </Button>
              )}
              {approvedJourneyId && ['SCHEDULED', 'APPROVED', 'PAUSED'].includes(journeyStatus) && (
                <Button variant="contained" disabled={routeBusy} onClick={() => void startApprovedJourney()} sx={{ textTransform: 'none' }}>
                  {routeBusy ? 'Starting…' : 'Start journey'}
                </Button>
              )}
              {approvedJourneyId && journeyIsLive && (
                <Button variant="outlined" color="error" disabled={routeBusy} onClick={() => void completeApprovedJourney()} sx={{ textTransform: 'none' }}>
                  {routeBusy ? 'Completing…' : 'Complete journey'}
                </Button>
              )}
            </Stack>
            {routeMessage && <Alert severity={/not found|failed|invalid|outside/i.test(routeMessage) ? 'error' : routeMessage.toLowerCase().includes('approved') || routeMessage.toLowerCase().includes('status:') ? 'success' : 'info'}>{routeMessage}</Alert>}
            {journeyMonitorError && <Alert severity="warning">{journeyMonitorError}</Alert>}
            {currentRouteDeviationActive && (
              <Alert severity="error">
                Route deviation detected: the current verified GPS fix is {Math.round(currentRouteDeviationMeters ?? 0)} m from the approved route, beyond the {effectiveToleranceMeters} m tolerance.
              </Alert>
            )}
            {approvedRoutePoints.length > 1 && routeToleranceMeters === null && (
              <Alert severity="warning">
                This journey has no saved route-deviation tolerance, so the backend default of {BACKEND_DEFAULT_CORRIDOR_METERS} m is used for deviation detection.
              </Alert>
            )}
            <Box sx={{ borderTop: '1px solid #e2e8f0', pt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>Journey status</Typography>
              <FormControl size="small" fullWidth sx={{ mb: 1.25, maxWidth: 600 }}>
                <InputLabel id="journey-history-label">Journey history / playback</InputLabel>
                <Select
                  labelId="journey-history-label"
                  label="Journey history / playback"
                  value={approvedJourneyId ?? ''}
                  onChange={event => selectMonitoredJourney(String(event.target.value))}
                >
                  <MenuItem value="">Monitor active journey / plan a new journey</MenuItem>
                  {journeyHistory.map(journey => {
                    const id = journey.journey_id ?? journey.id
                    if (id == null) return null
                    const status = String(journey.status ?? 'UNKNOWN').toUpperCase().replace(/[_-]+/g, ' ')
                    const origin = journey.start_location?.address
                    const destination = journey.end_location?.address
                    return (
                      <MenuItem key={String(id)} value={String(id)}>
                        {`Journey ${String(id)} · ${status}${origin ? ` · ${origin}` : ''}${destination ? ` → ${destination}` : ''}`}
                      </MenuItem>
                    )
                  })}
                </Select>
                {journeyHistoryError && <Typography variant="caption" color="error">{journeyHistoryError}</Typography>}
              </FormControl>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Chip size="small" label={`Journey: ${journeyRecord?.status ? String(journeyRecord.status).toUpperCase().replace(/_/g, ' ') : journeyInactive ? 'NOT STARTED' : 'UNKNOWN'}`} />
                <Chip size="small" color={hasCurrentGps ? 'success' : selectedMapLocation?.verified ? 'warning' : 'default'} label={`GPS: ${hasCurrentGps ? 'LIVE' : selectedMapLocation?.verified ? 'STALE' : 'UNAVAILABLE'}`} />
                <Chip size="small" label={`Journey feed: ${journeyLiveDetails ? 'RESPONDING' : journeyInactive ? 'NOT STARTED' : 'UNKNOWN'}`} />
                <Chip size="small" label={`Last location update: ${selectedMapLocation?.timestamp == null ? 'UNKNOWN' : new Date(selectedMapLocation.timestamp).toLocaleString()}`} />
                <Chip size="small" color={backendRouteDeviationActive || currentRouteDeviationActive ? 'error' : activeMonitoringAlert ? 'warning' : 'default'} label={`Active alert: ${backendRouteDeviationActive || currentRouteDeviationActive ? 'ROUTE DEVIATION' : activeMonitoringAlert ? 'YES' : 'NONE'}`} />
              </Stack>
              {journeyEventHistory.length > 0 && (
                <Stack spacing={0.5} sx={{ mt: 1.25 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>Journey and geofence event history</Typography>
                  {journeyEventHistory.slice(0, 8).map((event, index) => (
                    <Typography key={alertId(event) || `${alertType(event)}-${index}`} variant="caption" color="text.secondary">
                      {formatTime(String(event.event_time ?? event.created_at ?? ''))} · {alertType(event) || 'Monitoring event'} · {String(event.message ?? event.title ?? 'Event recorded')}
                    </Typography>
                  ))}
                </Stack>
              )}
              {fullTravelledRoute.length > 0 && (
                <Stack spacing={0.75} sx={{ mt: 1.5, maxWidth: 620 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    Journey playback · {fullTravelledRoute.length} verified GPS point{fullTravelledRoute.length === 1 ? '' : 's'}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={fullTravelledRoute.length < 2}
                      onClick={() => {
                        if (playbackPlaying) {
                          setPlaybackPlaying(false)
                          return
                        }
                        const atEnd = playbackIndex === fullTravelledRoute.length - 1
                        setPlaybackIndex(atEnd || playbackIndex === null ? 0 : playbackIndex)
                        setPlaybackPlaying(true)
                      }}
                    >
                      {playbackPlaying ? 'Pause' : 'Play'}
                    </Button>
                    <Button size="small" variant="text" onClick={() => { setPlaybackPlaying(false); setPlaybackIndex(null) }}>
                      Show full journey
                    </Button>
                  </Stack>
                  <Slider
                    size="small"
                    min={0}
                    max={Math.max(fullTravelledRoute.length - 1, 0)}
                    step={1}
                    value={playbackIndex ?? Math.max(fullTravelledRoute.length - 1, 0)}
                    onChange={(_, value) => {
                      setPlaybackPlaying(false)
                      setPlaybackIndex(Array.isArray(value) ? value[0] : value)
                    }}
                    aria-label="Journey playback position"
                  />
                </Stack>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {activeMonitoringAlert && (
        <Alert
          severity={backendRouteDeviationActive || String(activeMonitoringAlert.severity ?? '').toUpperCase() === 'CRITICAL' ? 'error' : 'warning'}
          action={(
            <Stack direction="row" spacing={0.5}>
              <Button color="inherit" size="small" onClick={silenceActiveMonitoringAlert} disabled={!activeMonitoringAlertId || silencedAlertId === activeMonitoringAlertId}>Silence</Button>
              <Button color="inherit" size="small" onClick={() => void acknowledgeActiveMonitoringAlert()} disabled={alertActionBusy || !activeMonitoringAlertId}>{alertActionBusy ? 'Saving…' : 'Acknowledge'}</Button>
            </Stack>
          )}
        >
          <strong>{String(activeMonitoringAlert.title ?? activeMonitoringAlert.event_type ?? activeMonitoringAlert.alert_type ?? activeMonitoringAlert.type ?? 'Monitoring alert')}</strong>
          <Typography variant="body2">{String(activeMonitoringAlert.message ?? 'Backend alert received.')}</Typography>
          <Typography variant="caption" color="text.secondary">Alert ID: {activeMonitoringAlertId || 'Unavailable'} · {formatTime(String(activeMonitoringAlert.event_time ?? activeMonitoringAlert.created_at ?? ''))}</Typography>
          {alertActionError && <Typography variant="body2" role="alert" sx={{ mt: 0.5 }}>{alertActionError}</Typography>}
        </Alert>
      )}
      {backendRouteDeviationActive && (
        <Alert severity="info">
          The backend confirmed a route deviation alert. Red route segments require deviation geometry from the journey path API; its current frontend response type is undocumented (`unknown`), so no deviation path is inferred from GPS points.
        </Alert>
      )}

      <Card sx={{ border: '1px solid #e2e8f0', boxShadow: 'none' }}>
        <CardContent>
          {deviceParam && requestedDevice && !assignmentLoading && !assignmentError && assignedGeofences.length === 0 && (
            <Alert severity="info" sx={{ mb: 1.5 }}>No saved geofences are assigned to this device.</Alert>
          )}
          {deviceParam && requestedDevice && assignmentError && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>Unable to confirm which saved geofences are assigned to this device: {assignmentError}</Alert>
          )}
          {requestedDevice && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<MyLocationOutlined />}
                disabled={!selectedMapLocation}
                onClick={() => setFocusDeviceRequest(request => request + 1)}
                sx={{ textTransform: 'none' }}
              >
                Focus Device
              </Button>
            </Box>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Compare route options on the map. Click a route line or choose an alternative above; the approved route is green, the verified GPS track is blue, and out-of-tolerance travelled segments are red.
          </Typography>
          <GeofenceMap
            device={requestedDevice}
            devices={devices ?? []}
            geofences={deviceParam ? assignedGeofences : geofences ?? []}
            deviceLocation={selectedMapLocation}
            selectedGeofenceId={selectedGeofenceId}
            violationActive={violationActive}
            focusRequest={focusDeviceRequest}
            approvedRoute={approvedRoutePoints}
            travelledRoute={travelledRoute}
            deviationRoute={deviationRoute}
            backendDeviationLocation={backendDeviationLocation}
            routeOptions={routeChoices}
            selectedRouteId={approvedRouteId ?? selectedRouteId}
            approvedRouteId={approvedRouteId}
            fitRoutesRequest={fitRoutesRequest}
            pointPickMode={pointPickMode}
            routeEndpoints={routeEndpoints}
            focusRoutePoint={routeMapFocusPoint}
            onMapPointPick={handleRouteMapPointPick}
            onRouteSelect={handleRouteMapSelect}
          />
          <Stack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="success.main">Green line: approved route</Typography>
            <Typography variant="caption" sx={{ color: '#7c3aed' }}>Purple line: selected route before approval</Typography>
            <Typography variant="caption" color="text.secondary">Dashed gray lines: other route options</Typography>
            <Typography variant="caption" color="primary.main">Blue line: verified actual GPS path</Typography>
            <Typography variant="caption" color="error.main">Red line: actual path outside the configured tolerance</Typography>
            <Typography variant="caption" color="error.main">Red dot: backend-confirmed deviation location (when verified coordinates are supplied)</Typography>
            <Typography variant="caption" color="text.secondary">Blue marker: current GPS fix · gray marker: stale last-known GPS</Typography>
            <Typography variant="caption" color="success.main">Green boundary: inclusion</Typography>
            <Typography variant="caption" color="error.main">Red boundary: exclusion</Typography>
            <Typography variant="caption" color="text.secondary">Gray boundary: inactive</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ border: '1px solid #e2e8f0', boxShadow: 'none' }}>
        <CardContent sx={{ overflowX: 'auto', p: 0 }}>
          <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Configured geofences</Typography>
            <TextField
              size="small"
              label="Search geofences"
              value={search}
              onChange={event => setSearch(event.target.value)}
              sx={{ minWidth: 240 }}
            />
          </Box>
          <Table sx={{ minWidth: 950 }}>
            <TableHead sx={{ bgcolor: '#f8fafc' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Geofence</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Shape / alarms</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Assigned devices</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Center / points</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleGeofences.map(fence => {
                const center = getCenter(fence)
                const fenceActive = isActive(fence)
                const assignments = fence.device_ids ??
                  fence.devices?.map(item => typeof item === 'object' ? item.device_id ?? String(item.id) : String(item)) ??
                  (fence.assigned_device_id ? [fence.assigned_device_id] : [])
                const polygonCount = fence.polygon_coordinates?.length ?? 0
                return (
                  <TableRow key={fence.id} hover onClick={() => setSelectedGeofenceId(fence.id)} sx={{ cursor: 'pointer' }}>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{fence.name}</Typography>
                      {fence.description && <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">{fence.description}</Typography>}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={(fence.type ?? 'CIRCLE').toUpperCase()} sx={{ mb: 0.5, fontWeight: 600 }} />
                      <Typography variant="caption" sx={{ display: 'block' }}>
                        {getAlarmType(fence).replaceAll('_', ' ')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {assignments.length
                        ? assignments.map(id => <Chip key={String(id)} size="small" label={devices?.find(d => d.device_id === String(id))?.device_name ?? id} sx={{ mr: 0.5, mb: 0.5 }} />)
                        : 'None'}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      {(fence.type ?? 'CIRCLE').toUpperCase() === 'POLYGON'
                        ? `${polygonCount} vertices`
                        : center ? `${center[0].toFixed(5)}, ${center[1].toFixed(5)} · ${fence.radius_meters ?? fence.radius_m ?? '—'} m` : 'Not set'}
                    </TableCell>
                    <TableCell>
                      <Chip label={fenceActive ? 'Active' : 'Inactive'} size="small" color={fenceActive ? 'success' : 'default'} />
                    </TableCell>
                    <TableCell align="right" onClick={event => event.stopPropagation()}>
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                        <Button size="small" startIcon={<EditOutlined />} onClick={() => openEditDialog(fence)} sx={{ textTransform: 'none' }}>Edit</Button>
                        <Button size="small" onClick={() => void handleToggle(fence)} sx={{ textTransform: 'none' }}>{fenceActive ? 'Disable' : 'Enable'}</Button>
                        <Button size="small" color="error" startIcon={<DeleteOutlined />} onClick={() => setDeleteTarget(fence)} sx={{ textTransform: 'none' }}>Delete</Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
              {geofences && visibleGeofences.length === 0 && (
                <TableRow><TableCell colSpan={6}><ApiFeedback loading={false} error="" empty emptyMessage="No matching geofences." /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {!geofences && <ApiFeedback loading={loading} error={error} empty={false} emptyMessage="" />}
        </CardContent>
      </Card>

      <Card sx={{ border: '1px solid #e2e8f0', boxShadow: 'none' }}>
        <CardContent sx={{ p: 0 }}>
          <Box sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Recent geofence alerts</Typography>
            <Typography variant="body2" color="text.secondary">
              {journeyWindow?.start != null
                ? `Geofence entry/exit and route deviation alerts from start to end of journey ${journeyWindow.id}.`
                : 'Entry and exit events from the backend alert history.'}
            </Typography>
          </Box>
          <Table sx={{ minWidth: 800 }}>
            <TableHead sx={{ bgcolor: '#f8fafc' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Time</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Device / Geofence</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Event</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Severity / status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {geofenceAlerts && alertTableRows.map(row => {
                const status = row.status.toLowerCase()
                const busyKey = row.kind === 'geofence' ? row.actionId : row.actionId || row.key
                const actionable = row.kind !== 'marker' && Boolean(row.actionId)
                return (
                  <TableRow key={row.key} hover>
                    <TableCell>{formatTime(row.time)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.device}</Typography>
                      <Typography variant="caption" color="text.secondary">{row.context}</Typography>
                    </TableCell>
                    <TableCell>{row.message}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={row.deviation ? 'error' : 'default'}
                        label={`${row.severity} · ${row.status}`}
                      />
                    </TableCell>
                    <TableCell>
                      {actionable && (
                        <Stack direction="row" spacing={0.5}>
                          {status !== 'acknowledged' && status !== 'resolved' && (
                            <Button size="small" disabled={alertBusyId === busyKey} onClick={() => void handleAlertRowAction(row, 'acknowledge')}>Acknowledge</Button>
                          )}
                          {status !== 'resolved' && (
                            <Button size="small" color="success" disabled={alertBusyId === busyKey} onClick={() => void handleAlertRowAction(row, 'resolve')}>Resolve</Button>
                          )}
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {geofenceAlerts && alertTableRows.length === 0 && (
                <TableRow><TableCell colSpan={5}><ApiFeedback loading={false} error="" empty emptyMessage="No geofence alerts recorded." /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {!geofenceAlerts && <ApiFeedback loading={alertsLoading} error={alertsError} empty={false} emptyMessage="" />}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => !actionBusy && setDialogOpen(false)} fullWidth maxWidth="md">
        <Box component="form" onSubmit={handleSave}>
          <DialogTitle sx={{ fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>
            {editingFence ? 'Edit geofence' : 'Create geofence'}
          </DialogTitle>
          <DialogContent sx={{ pt: 2.5 }}>
            <Stack spacing={2.5}>
              {actionError && <Alert severity="error">{actionError}</Alert>}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Geofence name" value={name} onChange={event => setName(event.target.value)} required size="small" fullWidth />
                <TextField label="Description / remark" value={remark} onChange={event => setRemark(event.target.value)} size="small" fullWidth />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="geofence-shape-label">Boundary shape</InputLabel>
                  <Select
                    labelId="geofence-shape-label"
                    label="Boundary shape"
                    value={draft?.type ?? 'CIRCLE'}
                    onChange={event => setDraft(current => current ? { ...current, type: event.target.value as GeofenceShape } : current)}
                  >
                    <MenuItem value="CIRCLE">Circle</MenuItem>
                    <MenuItem value="POLYGON">Polygon</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel id="alarm-type-label">Trigger alerts</InputLabel>
                  <Select
                    labelId="alarm-type-label"
                    label="Trigger alerts"
                    value={alarmType}
                    onChange={event => handleAlarmTypeChange(event.target.value as AlarmType)}
                  >
                    <MenuItem value="only_enter">On entry</MenuItem>
                    <MenuItem value="only_out">On exit</MenuItem>
                    <MenuItem value="in_and_out">On entry and exit</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              <FormControl fullWidth size="small">
                <InputLabel id="geofence-device-label">Assign devices</InputLabel>
                <Select
                  labelId="geofence-device-label"
                  multiple
                  value={selectedDeviceIds}
                  label="Assign devices"
                  onChange={event => setSelectedDeviceIds(typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value)}
                  renderValue={selected => selected.map(id => devices?.find(d => d.device_id === id)?.device_name ?? id).join(', ')}
                >
                  {(devices ?? []).map(deviceOption => (
                    <MenuItem key={deviceOption.device_id} value={deviceOption.device_id}>
                      <Checkbox checked={selectedDeviceIds.includes(deviceOption.device_id)} />
                      <ListItemText primary={deviceOption.device_name ?? deviceOption.serial_number} secondary={deviceOption.device_id} />
                    </MenuItem>
                  ))}
                </Select>
                {devicesLoading && <Typography variant="caption" color="text.secondary">Loading devices…</Typography>}
                {devicesError && <Typography variant="caption" color="error">{devicesError}</Typography>}
              </FormControl>

              {draft?.type === 'CIRCLE' ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Radius (meters)"
                    type="number"
                    value={draft.radius}
                    onChange={event => setDraft(current => current ? { ...current, radius: Number(event.target.value) } : current)}
                    required
                    size="small"
                    slotProps={{ htmlInput: { step: 10, min: 10, max: 50000 } }}
                    fullWidth
                  />
                  <TextField
                    label="Center latitude"
                    type="number"
                    value={draft.latitude ?? ''}
                    onChange={event => updateCoordinate('latitude', event.target.value)}
                    required
                    size="small"
                    slotProps={{ htmlInput: { step: 'any', min: -90, max: 90 } }}
                    fullWidth
                  />
                  <TextField
                    label="Center longitude"
                    type="number"
                    value={draft.longitude ?? ''}
                    onChange={event => updateCoordinate('longitude', event.target.value)}
                    required
                    size="small"
                    slotProps={{ htmlInput: { step: 'any', min: -180, max: 180 } }}
                    fullWidth
                  />
                </Stack>
              ) : (
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">
                    Click the map to add boundary points. {draft?.polygon.length ?? 0} point(s); at least 3 required.
                  </Typography>
                  <Button size="small" startIcon={<UndoOutlined />} disabled={!draft?.polygon.length} onClick={removeLastPolygonPoint}>Undo point</Button>
                </Stack>
              )}
              {draft && (
                <GeofenceMap
                  geofences={geofences ?? []}
                  draft={draft}
                  drawingMode
                  onDraftChange={setDraft}
                  selectedGeofenceId={editingFence?.id}
                />
              )}
              <FormControlLabel
                control={<Checkbox checked={active} onChange={event => setActive(event.target.checked)} />}
                label="Geofence is active"
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 1, borderTop: '1px solid #e2e8f0' }}>
            <Button onClick={() => setDialogOpen(false)} disabled={actionBusy} sx={{ textTransform: 'none' }}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={actionBusy || !name.trim()} sx={{ bgcolor: '#0284c7', textTransform: 'none', px: 2.5 }}>
              {actionBusy ? 'Saving…' : editingFence ? 'Save changes' : 'Create geofence'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => !actionBusy && setDeleteTarget(null)}>
        <DialogTitle>Delete geofence?</DialogTitle>
        <DialogContent>
          <Typography>Delete “{deleteTarget?.name}”? This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={actionBusy}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void handleDelete()} disabled={actionBusy}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export default GeofencesPage
