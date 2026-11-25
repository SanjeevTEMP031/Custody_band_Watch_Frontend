import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { Navigation, Play, RotateCw } from 'lucide-react'
import type { Device, Journey, JourneyPoint } from '../../services/api'
import {
  acknowledgeAlert,
  acknowledgeGeofenceAlert,
  createScheduledJourney,
  getGeofenceAlerts,
  getJourneyAlerts,
  getJourneyApprovedRoute,
  getJourneyLivePosition,
  getJourneyRouteAlternatives,
  getJourneyTravelledPath,
  getLatestGpsSnapshot,
  listAlerts,
  listJourneys,
  selectJourneyRoute,
  startScheduledJourney,
  type JourneyCreateRequest,
  type RouteAlternativesRequest,
} from '../../services/api'
import { isFreshGpsTimestamp, normalizeVerifiedGpsFix, parseGpsTimestamp } from '../../services/gpsNormalization'
import { geocode } from './RouteMap'
import RouteTrackingMap from './RouteTrackingMap'

type RouteChoice = {
  id: string
  name: string
  points: [number, number][]
  distanceKm: number | null
  durationMinutes: number | null
}

type JourneyAlert = Record<string, unknown> & {
  id?: string | number
  alert_id?: string | number
  event_id?: string | number
  event_type?: string
  type?: string
  message?: string
  severity?: string
  status?: string
  created_at?: string
  event_time?: string
  requires_alarm?: boolean
}

type CurrentGpsPosition = {
  latitude: number
  longitude: number
  timestamp: string
  speed_kmh?: number | null
  heading?: number | null
  gpsStatus: string | null
  isCurrent: boolean
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function pointCoordinates(value: unknown, geoJson = false): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const first = finiteNumber(value[0])
    const second = finiteNumber(value[1])
    if (first === null || second === null) return null
    const [latitude, longitude] = geoJson || Math.abs(first) > 90
      ? [second, first]
      : [first, second]
    return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
      ? [latitude, longitude]
      : null
  }
  const item = record(value)
  if (!item) return null
  const latitude = finiteNumber(item.latitude ?? item.lat)
  const longitude = finiteNumber(item.longitude ?? item.lng ?? item.lon)
  return latitude !== null && longitude !== null &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? [latitude, longitude]
    : null
}

function routeAlternatives(value: unknown): RouteChoice[] {
  const root = record(value)
  const nested = record(root?.data) ?? record(root?.result) ?? record(root?.payload)
  const collection = root?.routes ?? root?.alternatives ?? root?.items ??
    nested?.routes ?? nested?.alternatives ?? nested?.items ??
    root?.approved_route ?? root?.route ?? nested?.approved_route ?? nested?.route
  const candidates = Array.isArray(value)
    ? [{ route_id: 'approved', route_points: value }]
    : Array.isArray(collection)
    ? collection
    : collection == null
      ? root && (root.route_id != null || root.id != null || root.route_points != null ||
          root.points != null || root.coordinates != null || root.path != null || root.route_geometry != null)
        ? [root]
        : []
      : [collection]

  return candidates.flatMap((candidate, index) => {
    const route = record(candidate)
    if (!route) return []
    const routeId = route.route_id ?? route.id ?? route.selected_route_id ?? 'approved'
    const geometry = record(route.geometry) ?? record(route.geojson) ?? record(route.route_geometry)
    const geoJson = Boolean(geometry?.coordinates)
    const rawPoints = route.points ?? route.route_points ?? route.coordinates ?? route.path ?? route.polyline ??
      geometry?.coordinates
    if (typeof rawPoints === 'string' || !Array.isArray(rawPoints)) return []
    const points = rawPoints
      .map(point => pointCoordinates(point, geoJson))
      .filter((point): point is [number, number] => point !== null)
    if (points.length < 2) return []
    return [{
      id: String(routeId),
      name: String(route.name ?? route.label ?? route.route_name ?? route.via ?? `Alternative ${index + 1}`),
      points,
      distanceKm: finiteNumber(route.distance_km ?? route.distanceKm) ??
        (finiteNumber(route.distance_meters ?? route.distance) !== null
          ? Number((Number(route.distance_meters ?? route.distance) / 1000).toFixed(2))
          : null),
      durationMinutes: finiteNumber(route.duration_minutes ?? route.durationMin) ??
        (finiteNumber(route.duration_seconds ?? route.duration) !== null
          ? Math.round(Number(route.duration_seconds ?? route.duration) / 60)
          : null),
    }]
  })
}

function storedJourneyRoute(journey: Journey | null): [number, number][] {
  return routeAlternatives(journey).find(route => route.id === String(journey?.selected_route_id))?.points ??
    routeAlternatives(journey)[0]?.points ?? []
}

function journeyId(journey: Journey): string {
  return String(journey.journey_id ?? journey.id ?? '')
}

function journeyStatus(journey: Journey): string {
  return String(journey.status ?? 'UNKNOWN').replace(/_/g, ' ').toUpperCase()
}

function extractJourneyPoints(value: unknown): JourneyPoint[] {
  const root = record(value)
  const collection = Array.isArray(value)
    ? value
    : root?.points ?? root?.path ?? root?.travelled_path ?? root?.locations
  if (!Array.isArray(collection)) return []
  return collection.flatMap((candidate): JourneyPoint[] => {
    const item = record(candidate)
    if (!item) return []
    const invalid = [item.gps_fix, item.gps_valid, item.valid].some(flag =>
      flag === false || flag === 0 || String(flag).toUpperCase() === 'V'
    ) || String(item.gps_status ?? item.status ?? '').trim().toUpperCase() === 'V'
    if (invalid) return []
    const coordinates = pointCoordinates(item)
    const timestamp = parseGpsTimestamp(
      item.gps_time ?? item.timestamp ?? item.recorded_at ?? item.received_at
    )
    if (!coordinates || timestamp === null) return []
    return [{
      latitude: coordinates[0],
      longitude: coordinates[1],
      timestamp: new Date(timestamp).toISOString(),
      journey_id: typeof item.journey_id === 'string' || typeof item.journey_id === 'number'
        ? item.journey_id
        : null,
      gps_fix: true,
      gps_time: typeof item.gps_time === 'string' ? item.gps_time : null,
      received_at: typeof item.received_at === 'string' ? item.received_at : null,
      speed_kmh: finiteNumber(item.speed_kmh ?? item.speed),
      heading: finiteNumber(item.heading ?? item.direction_deg),
      accuracy_m: finiteNumber(item.accuracy_m ?? item.accuracy),
      battery_pct: finiteNumber(item.battery_pct ?? item.battery_percent ?? item.battery),
    }]
  }).sort((first, second) => Date.parse(first.timestamp) - Date.parse(second.timestamp))
}

function extractLivePosition(value: unknown): Record<string, unknown> | null {
  const root = record(value)
  if (!root) return null
  return record(root.location) ?? record(root.live_position) ?? record(root.position) ?? root
}

function alertId(alert: JourneyAlert): string {
  return String(alert.alert_id ?? alert.id ?? alert.event_id ?? '')
}

function alertType(alert: JourneyAlert): string {
  return String(alert.event_type ?? alert.type ?? '').toUpperCase()
}

async function loadJourneyAlerts(journeyId: string, deviceId: string, signal?: AbortSignal): Promise<JourneyAlert[]> {
  try {
    const result = await getJourneyAlerts(journeyId, signal)
    return Array.isArray(result) ? result.map(record).filter((item): item is JourneyAlert => item !== null) : []
  } catch (journeyEndpointError) {
    if (journeyEndpointError instanceof DOMException && journeyEndpointError.name === 'AbortError') throw journeyEndpointError
    try {
      const alerts = await listAlerts({ device_id: deviceId, limit: 100 })
      return alerts
        .map(record)
        .filter((item): item is JourneyAlert => item !== null)
        .filter(item => {
          const alertJourneyId = item.journey_id == null ? '' : String(item.journey_id)
          const type = [alertType(item), item.alert_type, item.title, item.message]
            .filter(Boolean).join(' ').toUpperCase()
          return alertJourneyId === journeyId || type.includes('JOURNEY') || type.includes('ROUTE') || type.includes('DEVIATION')
        })
    } catch {
      throw journeyEndpointError
    }
  }
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function formatTime(value?: string | null): string {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
}

interface JourneyMonitoringPanelProps {
  device: Device | undefined
}

export default function JourneyMonitoringPanel({ device }: JourneyMonitoringPanelProps) {
  const deviceId = String(device?.device_id ?? device?.imei ?? '')
  const [journeys, setJourneys] = useState<Journey[]>([])
  const [selectedJourneyId, setSelectedJourneyId] = useState('')
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyError, setJourneyError] = useState('')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [scheduledDeparture, setScheduledDeparture] = useState('')
  const [scheduledArrival, setScheduledArrival] = useState('')
  const [originCoordinates, setOriginCoordinates] = useState<[number, number] | null>(null)
  const [destinationCoordinates, setDestinationCoordinates] = useState<[number, number] | null>(null)
  const [routeChoices, setRouteChoices] = useState<RouteChoice[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [routeLoading, setRouteLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [monitorError, setMonitorError] = useState('')
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [actualPath, setActualPath] = useState<JourneyPoint[]>([])
  const [approvedRoutePoints, setApprovedRoutePoints] = useState<[number, number][]>([])
  const [journeyLiveDetails, setJourneyLiveDetails] = useState<Record<string, unknown> | null>(null)
  const [livePosition, setLivePosition] = useState<CurrentGpsPosition | null>(null)
  const [liveDataAvailable, setLiveDataAvailable] = useState(false)
  const [journeyAlerts, setJourneyAlerts] = useState<JourneyAlert[]>([])
  const [alertActionError, setAlertActionError] = useState('')
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  const selectedJourney = journeys.find(item => journeyId(item) === selectedJourneyId) ?? null
  const selectedRoute = routeChoices.find(item => item.id === selectedRouteId) ?? null
  const gpsFresh = Boolean(liveDataAvailable && livePosition?.isCurrent)
  const mapPosition = livePosition
    ? {
        latitude: livePosition.latitude,
        longitude: livePosition.longitude,
        timestamp: livePosition.timestamp,
        speed_kmh: livePosition.speed_kmh,
        heading: livePosition.heading,
        gpsStatus: livePosition.gpsStatus,
        isCurrent: gpsFresh,
      }
    : null

  const loadJourneys = useCallback(async (signal?: AbortSignal) => {
    if (!deviceId) {
      setJourneys([])
      setSelectedJourneyId('')
      setJourneyError('')
      setActualPath([])
      setApprovedRoutePoints([])
      setJourneyLiveDetails(null)
      setJourneyAlerts([])
      setLivePosition(null)
      setLiveDataAvailable(false)
      return
    }
    setJourneyLoading(true)
    try {
      const result = await listJourneys(deviceId, undefined, signal)
      setJourneys(result)
      setJourneyError('')
      setSelectedJourneyId(current => {
        if (current && result.some(item => journeyId(item) === current)) return current
        const active = result.find(item => ['ACTIVE', 'IN PROGRESS', 'PAUSED'].includes(journeyStatus(item)))
        return active ? journeyId(active) : result[0] ? journeyId(result[0]) : ''
      })
      if (result.length === 0) {
        setActualPath([])
        setApprovedRoutePoints([])
        setJourneyLiveDetails(null)
        setJourneyAlerts([])
        setLivePosition(null)
        setLiveDataAvailable(false)
      }
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setJourneyError(reason instanceof Error ? reason.message : 'Unable to load journeys.')
      }
    } finally {
      setJourneyLoading(false)
    }
  }, [deviceId])

  useEffect(() => {
    const controller = new AbortController()
    const initialTimer = window.setTimeout(() => void loadJourneys(controller.signal), 0)
    const timer = window.setInterval(() => void loadJourneys(controller.signal), 15000)
    return () => {
      controller.abort()
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [loadJourneys])

  useEffect(() => {
    if (!selectedJourneyId) {
      return
    }
    let cancelled = false
    let inFlight = false
    const controller = new AbortController()
    const refresh = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      setMonitorLoading(true)
      const [liveResult, pathResult, routeResult, alertsResult, gpsResult, geofenceAlertsResult] = await Promise.allSettled([
        getJourneyLivePosition(selectedJourneyId, controller.signal),
        getJourneyTravelledPath(selectedJourneyId, controller.signal),
        getJourneyApprovedRoute(selectedJourneyId, controller.signal),
        loadJourneyAlerts(selectedJourneyId, deviceId, controller.signal),
        deviceId ? getLatestGpsSnapshot(deviceId, controller.signal) : Promise.resolve(null),
        deviceId ? getGeofenceAlerts({ device_id: deviceId, limit: 100 }) : Promise.resolve([]),
      ])
      if (!cancelled) {
        const errors: string[] = []
        if (pathResult.status === 'fulfilled') {
          setActualPath(extractJourneyPoints(pathResult.value))
        } else errors.push('travelled path')
        const approvedRoutes = routeResult.status === 'fulfilled'
          ? routeAlternatives(routeResult.value)
          : []
        const savedRoutePoints = storedJourneyRoute(selectedJourney)
        const approvedPoints = approvedRoutes[0]?.points ?? savedRoutePoints
        setApprovedRoutePoints(approvedPoints)
        if (approvedPoints.length < 2) errors.push('approved route')
        if (alertsResult.status === 'fulfilled') {
          const journeyAlerts = alertsResult.value
          const geofenceAlerts = geofenceAlertsResult.status === 'fulfilled'
            ? geofenceAlertsResult.value.map(record).filter((item): item is JourneyAlert => item !== null)
            : []
          setJourneyAlerts([...geofenceAlerts, ...journeyAlerts])
        } else errors.push('journey alerts')
        if (geofenceAlertsResult.status === 'rejected') errors.push('geofence alerts')
        if (liveResult.status === 'fulfilled') {
          const live = extractLivePosition(liveResult.value)
          setJourneyLiveDetails(live)
          if (live) {
            const timestampMs = parseGpsTimestamp(
              live.gps_time ?? live.timestamp ?? live.recorded_at ?? live.received_at
            )
            const latitude = finiteNumber(live.latitude ?? live.lat)
            const longitude = finiteNumber(live.longitude ?? live.lng ?? live.lon)
            if (timestampMs !== null && latitude !== null && longitude !== null &&
              Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
              setLivePosition({
                latitude,
                longitude,
                timestamp: new Date(timestampMs).toISOString(),
                speed_kmh: finiteNumber(live.speed_kmh ?? live.speed),
                heading: finiteNumber(live.heading ?? live.direction_deg),
                gpsStatus: String(live.gps_status ?? live.status ?? 'Unknown'),
                isCurrent: live.gps_valid === true && live.location_is_current === true &&
                  isFreshGpsTimestamp(timestampMs),
              })
              setLiveDataAvailable(true)
            } else {
              setLiveDataAvailable(false)
            }
          }
        } else errors.push('journey live position')
        if (gpsResult.status === 'fulfilled' && gpsResult.value) {
          const snapshot = gpsResult.value
          const fix = snapshot.latest ? normalizeVerifiedGpsFix(snapshot.latest) : null
          const noFixAfterLast = Boolean(fix && snapshot.noFixReported === true &&
            (snapshot.lastPacketReceivedAt === null || snapshot.lastPacketReceivedAt >= fix.timestamp))
          if (fix) {
            setLivePosition({
              latitude: fix.latitude,
              longitude: fix.longitude,
              timestamp: fix.recordedAt,
              speed_kmh: snapshot.latest?.speed_kmh ?? null,
              heading: snapshot.latest?.heading ?? null,
              gpsStatus: snapshot.gpsStatus ?? fix.status,
              isCurrent: snapshot.gpsValid === true &&
                snapshot.locationIsCurrent === true &&
                isFreshGpsTimestamp(fix.timestamp) &&
                !noFixAfterLast,
            })
            setLiveDataAvailable(true)
          } else if (snapshot.lastReported) {
            setLivePosition({
              latitude: snapshot.lastReported.latitude,
              longitude: snapshot.lastReported.longitude,
              timestamp: snapshot.lastReported.recordedAt ?? '',
              gpsStatus: snapshot.gpsStatus ?? snapshot.lastReported.gpsStatus,
              isCurrent: false,
            })
            setLiveDataAvailable(true)
          } else {
            setLivePosition(null)
            setLiveDataAvailable(false)
          }
        } else if (gpsResult.status === 'rejected') errors.push('latest GPS')
        setMonitorError(errors.length > 0
          ? `Some journey monitoring data is unavailable: ${errors.join(', ')}.`
          : '')
        setMonitorLoading(false)
      }
      inFlight = false
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [deviceId, selectedJourney, selectedJourneyId])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const refreshAlerts = () => {
      if (!selectedJourneyId || !deviceId) return
      void Promise.all([
        loadJourneyAlerts(selectedJourneyId, deviceId),
        getGeofenceAlerts({ device_id: deviceId, limit: 100 }),
      ]).then(([journey, geofence]) => {
        setJourneyAlerts([
          ...geofence.map(record).filter((item): item is JourneyAlert => item !== null),
          ...journey,
        ])
      }).catch(reason => setMonitorError(reason instanceof Error ? reason.message : 'Unable to refresh journey alerts.'))
    }
    window.addEventListener('trackguard:journey-live-alert', refreshAlerts)
    window.addEventListener('trackguard:geofence-live-alert', refreshAlerts)
    window.addEventListener('trackguard:alert-socket', refreshAlerts)
    return () => {
      window.removeEventListener('trackguard:journey-live-alert', refreshAlerts)
      window.removeEventListener('trackguard:geofence-live-alert', refreshAlerts)
      window.removeEventListener('trackguard:alert-socket', refreshAlerts)
    }
  }, [deviceId, selectedJourneyId])

  const monitoringRoutes = useMemo(() => routeChoices.map(route => ({
    id: route.id,
    label: route.name,
    coordinates: route.points,
    selected: route.id === (selectedJourney?.selected_route_id ?? selectedRouteId),
  })).concat(
    approvedRoutePoints.length > 1 &&
      !routeChoices.some(route => route.id === selectedJourney?.selected_route_id)
      ? [{
          id: String(selectedJourney?.selected_route_id ?? 'approved'),
          label: 'Backend-approved route',
          coordinates: approvedRoutePoints,
          selected: true,
        }]
      : []
  ), [approvedRoutePoints, routeChoices, selectedJourney?.selected_route_id, selectedRouteId])

  const findRoutes = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setRouteLoading(true)
    setRouteChoices([])
    setSelectedRouteId('')
    try {
      if (!origin.trim() || !destination.trim()) throw new Error('Enter both an origin and destination.')
      const [from, to] = await Promise.all([geocode(origin.trim()), geocode(destination.trim())])
      const request: RouteAlternativesRequest = {
        origin_latitude: from.lat,
        origin_longitude: from.lng,
        destination_latitude: to.lat,
        destination_longitude: to.lng,
        origin_name: origin.trim(),
        destination_name: destination.trim(),
      }
      const choices = routeAlternatives(await getJourneyRouteAlternatives(request))
      if (choices.length === 0) {
        throw new Error('The route alternatives endpoint returned no selectable route geometry.')
      }
      setOriginCoordinates([from.lat, from.lng])
      setDestinationCoordinates([to.lat, to.lng])
      setRouteChoices(choices)
      setSelectedRouteId(choices[0].id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load alternative routes.')
    } finally {
      setRouteLoading(false)
    }
  }

  const scheduleJourney = async () => {
    setError('')
    if (!deviceId || !originCoordinates || !destinationCoordinates || !selectedRoute) {
      setError('Select a device, load routes, and choose a route before scheduling.')
      return
    }
    const departure = localDateTimeToIso(scheduledDeparture)
    const arrival = localDateTimeToIso(scheduledArrival)
    if (!departure || !arrival || Date.parse(arrival) <= Date.parse(departure)) {
      setError('Choose a valid arrival time later than the scheduled departure.')
      return
    }
    setActionLoading(true)
    try {
      const payload: JourneyCreateRequest = {
        device_id: deviceId,
        origin_name: origin.trim(),
        destination_name: destination.trim(),
        origin_latitude: originCoordinates[0],
        origin_longitude: originCoordinates[1],
        destination_latitude: destinationCoordinates[0],
        destination_longitude: destinationCoordinates[1],
        scheduled_departure: departure,
        scheduled_arrival: arrival,
        selected_route_id: selectedRoute.id,
        status: 'SCHEDULED',
      }
      const created = await createScheduledJourney(payload)
      const id = created.journey_id ?? created.id
      if (id == null) throw new Error('The backend created a journey but did not return its journey ID.')
      await selectJourneyRoute(id, {
        route_id: selectedRoute.id,
        journey_id: String(id),
        approved_by: 'Officer',
        notes: `Approved route: ${selectedRoute.name}`,
      })
      await loadJourneys()
      setSelectedJourneyId(String(id))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create and approve this journey.')
    } finally {
      setActionLoading(false)
    }
  }

  const startJourney = async () => {
    if (!selectedJourneyId) return
    setError('')
    setActionLoading(true)
    try {
      await startScheduledJourney(selectedJourneyId)
      await loadJourneys()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start the approved journey.')
    } finally {
      setActionLoading(false)
    }
  }

  const acknowledgeJourneyAlert = async (alert: JourneyAlert) => {
    const id = alertId(alert)
    if (!id) {
      setAlertActionError('This alert has no backend ID to acknowledge.')
      return
    }
    setAlertActionError('')
    try {
      if (alertType(alert).includes('GEOFENCE')) {
        await acknowledgeGeofenceAlert(id, 'Acknowledged by officer')
      } else {
        await acknowledgeAlert(id, 'Acknowledged by officer')
      }
      setJourneyAlerts(current => current.map(item =>
        alertId(item) === id ? { ...item, status: 'ACKNOWLEDGED' } : item
      ))
      window.dispatchEvent(new Event('trackguard:geofence-alert-refresh'))
    } catch (reason) {
      setAlertActionError(reason instanceof Error ? reason.message : 'Unable to acknowledge this alert.')
    }
  }

  const journeyStatusText = selectedJourney ? journeyStatus(selectedJourney) : 'NO JOURNEY'
  const currentLocationText = livePosition
    ? `${livePosition.latitude.toFixed(5)}, ${livePosition.longitude.toFixed(5)}`
    : 'Unavailable'
  const routeComplianceValue = journeyLiveDetails?.route_compliance ??
    journeyLiveDetails?.compliance_status ??
    journeyLiveDetails?.is_on_route
  const routeCompliance = typeof routeComplianceValue === 'boolean'
    ? routeComplianceValue ? 'Compliant' : 'Deviation detected'
    : typeof routeComplianceValue === 'string' ? routeComplianceValue : null
  const liveScheduleStatus = selectedJourney?.status === 'scheduled'
    ? Date.parse(selectedJourney.scheduled_departure ?? '') < currentTime
      ? 'Scheduled departure is overdue'
      : 'Awaiting scheduled departure'
    : null

  return (
    <Card variant="outlined" sx={{ borderColor: '#dbe3ec', borderRadius: 2 }}>
      <CardContent>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Journey Route Monitoring</Typography>
              <Typography variant="body2" color="text.secondary">
                Plan and approve a route, then monitor its backend journey, GPS path, schedule, and alerts.
              </Typography>
            </Box>
            <Chip
              size="small"
              color={gpsFresh ? 'success' : livePosition ? 'warning' : 'default'}
              label={gpsFresh ? 'GPS current' : livePosition ? 'GPS stale' : 'GPS unavailable'}
            />
          </Box>

          {!deviceId && <Alert severity="warning">Select a GPS device to plan or monitor a journey.</Alert>}
          {journeyError && <Alert severity="error">{journeyError}</Alert>}
          {monitorError && <Alert severity="warning">{monitorError}</Alert>}
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          <Box component="form" onSubmit={(event) => void findRoutes(event)}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label="Origin"
                placeholder="Enter an origin"
                value={origin}
                onChange={event => setOrigin(event.target.value)}
                disabled={!deviceId || routeLoading}
              />
              <TextField
                size="small"
                label="Destination"
                placeholder="Enter a destination"
                value={destination}
                onChange={event => setDestination(event.target.value)}
                disabled={!deviceId || routeLoading}
              />
              <TextField
                size="small"
                type="datetime-local"
                label="Scheduled departure"
                value={scheduledDeparture}
                onChange={event => setScheduledDeparture(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                disabled={!deviceId}
              />
              <TextField
                size="small"
                type="datetime-local"
                label="Scheduled arrival"
                value={scheduledArrival}
                onChange={event => setScheduledArrival(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                disabled={!deviceId}
              />
              <Button
                type="submit"
                variant="outlined"
                startIcon={routeLoading ? <CircularProgress size={16} /> : <Navigation size={16} />}
                disabled={!deviceId || routeLoading}
                sx={{ textTransform: 'none' }}
              >
                Find Routes
              </Button>
            </Stack>
          </Box>

          {routeChoices.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Select an alternative route</Typography>
              {routeChoices.map(route => (
                <Box
                  key={route.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedRouteId(route.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') setSelectedRouteId(route.id)
                  }}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 1,
                    border: '1px solid',
                    borderColor: selectedRouteId === route.id ? '#2563eb' : '#e2e8f0',
                    bgcolor: selectedRouteId === route.id ? '#eff6ff' : '#fff',
                    borderRadius: 1,
                    p: 1,
                    cursor: 'pointer',
                  }}
                >
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{route.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {route.distanceKm == null ? 'Distance unavailable' : `${route.distanceKm} km`}
                      {' · '}
                      {route.durationMinutes == null ? 'Duration unavailable' : `${route.durationMinutes} min`}
                    </Typography>
                  </Box>
                  <Chip size="small" label={selectedRouteId === route.id ? 'Selected' : 'Choose'} />
                </Box>
              ))}
              <Button
                variant="contained"
                onClick={() => void scheduleJourney()}
                disabled={!selectedRoute || !scheduledDeparture || !scheduledArrival || actionLoading}
                sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
              >
                {actionLoading ? 'Saving…' : 'Approve Route & Schedule Journey'}
              </Button>
            </Stack>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', md: 'center' } }}>
            <FormControl size="small" sx={{ minWidth: 260 }}>
              <InputLabel id="journey-monitor-select-label">Journey</InputLabel>
              <Select
                labelId="journey-monitor-select-label"
                label="Journey"
                value={selectedJourneyId}
                onChange={event => {
                  setSelectedJourneyId(event.target.value)
                  setActualPath([])
                  setApprovedRoutePoints([])
                  setJourneyLiveDetails(null)
                  setJourneyAlerts([])
                  setLivePosition(null)
                  setLiveDataAvailable(false)
                }}
                disabled={journeyLoading || journeys.length === 0}
              >
                {journeys.map(journey => (
                  <MenuItem key={journeyId(journey)} value={journeyId(journey)}>
                    {journeyId(journey)} · {journeyStatus(journey)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RotateCw size={15} />}
              onClick={() => void loadJourneys()}
              disabled={journeyLoading}
              sx={{ textTransform: 'none' }}
            >
              Refresh journeys
            </Button>
            {selectedJourney && ['SCHEDULED', 'PAUSED'].includes(journeyStatusText) && (
              <Button
                size="small"
                variant="contained"
                startIcon={actionLoading ? <CircularProgress size={15} color="inherit" /> : <Play size={15} />}
                onClick={() => void startJourney()}
                disabled={actionLoading}
                sx={{ textTransform: 'none' }}
              >
                Start approved journey
              </Button>
            )}
          </Stack>

          {selectedJourney && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" label={`Device: ${deviceId}`} />
              <Chip size="small" label={`Status: ${journeyStatusText}`} />
              <Chip size="small" label={`Route: ${selectedJourney.selected_route_id ?? 'Not reported'}`} />
              <Chip size="small" label={`Location: ${currentLocationText}`} />
              <Chip size="small" label={`Departure: ${formatTime(selectedJourney.scheduled_departure)}`} />
              <Chip size="small" label={`Arrival: ${formatTime(selectedJourney.scheduled_arrival)}`} />
              <Chip size="small" color={gpsFresh ? 'success' : 'warning'} label={`GPS: ${gpsFresh ? 'Fresh' : livePosition ? 'Stale' : 'Unavailable'}`} />
              {liveScheduleStatus && <Chip size="small" color="warning" label={liveScheduleStatus} />}
              {routeCompliance && (
                <Chip
                  size="small"
                  color={routeCompliance.toLowerCase().includes('deviation') ? 'error' : 'default'}
                  label={`Route compliance: ${routeCompliance}`}
                />
              )}
              {monitorLoading && <CircularProgress size={18} />}
            </Stack>
          )}

          {selectedJourney && (
            <RouteTrackingMap
              trip={null}
              points={[]}
              monitoringRoutes={monitoringRoutes}
              actualTravelledPath={actualPath}
              currentLocation={mapPosition}
              fitBoundsKey={`${deviceId}:${selectedJourneyId}:${selectedRouteId}`}
              autoFitOnUpdate={false}
              height={380}
            />
          )}

          {journeyAlerts.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>Recent Journey Alerts</Typography>
              {alertActionError && <Alert severity="error" sx={{ mb: 1 }}>{alertActionError}</Alert>}
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Alert</TableCell>
                    <TableCell>Severity</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {journeyAlerts.map((alert, index) => {
                    const id = alertId(alert)
                    const status = String(alert.status ?? 'NEW').toUpperCase()
                    return (
                      <TableRow key={id || `${alertType(alert)}-${index}`}>
                        <TableCell>{formatTime(String(alert.event_time ?? alert.created_at ?? ''))}</TableCell>
                        <TableCell>{String(alert.message ?? alert.event_type ?? alert.type ?? 'Journey alert')}</TableCell>
                        <TableCell>{String(alert.severity ?? '—')}</TableCell>
                        <TableCell>{status}</TableCell>
                        <TableCell align="right">
                          {!['ACKNOWLEDGED', 'RESOLVED', 'CLOSED'].includes(status) && (
                            <Button size="small" onClick={() => void acknowledgeJourneyAlert(alert)}>Acknowledge</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}
