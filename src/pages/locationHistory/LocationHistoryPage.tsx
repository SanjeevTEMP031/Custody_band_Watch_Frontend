import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import {
  Pause,
  Play,
  RotateCcw,
  Square,
  Route,
  Table as TableIcon,
  RotateCw,
  Radio,
  Navigation,
  Clock,
  ChevronDown,
} from 'lucide-react'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { useRealtimeDevices } from '../../hooks/useRealtimeDevices'
import { mergeDevicesWithFirestore, subscribeToFirestoreLocationHistory } from '../../lib/firebase'
import {
  listDevices,
  listLocationHistory,
  startJourney,
  endJourney,
  getActiveJourney,
  getDeviceJourneys,
  getJourney,
  type Device,
  type Journey,
  type JourneyPoint,
} from '../../services/api'
import {
  startTrip,
  endTrip,
  addTripPoint,
  subscribeToDeviceTrips,
  buildTripFromPoints,
  haversineDistanceKm,
  isValidGpsCoord,
  type TripRecord,
} from '../../lib/firebase'
import {
  GPS_FRESHNESS_MS,
  normalizeVerifiedGpsFix,
  parseGpsTimestamp,
} from '../../services/gpsNormalization'
import {
  analyzeGpsTrail,
  DEFAULT_GPS_JOURNEY_INACTIVITY_MS,
  groupGpsPointsByInactivity,
} from '../../services/gpsTrail'
import RouteTrackingMap from './RouteTrackingMap'
import RouteMap from './RouteMap'
import TripSummaryCard from './TripSummaryCard'

/**
 * Normalizes backend Journey or Firestore TripRecord into a uniform TripRecord structure
 * so all components (Leaflet Map, Summary Card, Table) consume identical fields seamlessly.
 */
function normalizeToTripRecord(raw: any, deviceId: string, fallbackWearer?: string | null): TripRecord | null {
  if (!raw) return null

  const rawPoints = Array.isArray(raw.route_points)
    ? raw.route_points
    : Array.isArray(raw.points)
      ? raw.points
      : Array.isArray(raw.locations)
        ? raw.locations
        : []
  const fallbackPointTimestamp = normalizePointTimestamp(raw.start_time)

  const route_points: JourneyPoint[] = rawPoints
    .filter((point: any) => !hasExplicitGpsNoFix(point))
    .map((p: any) => {
    if (Array.isArray(p)) {
      return {
        latitude: Number(p[0]),
        longitude: Number(p[1]),
        timestamp: normalizePointTimestamp(p[2]) ?? fallbackPointTimestamp ?? '',
      }
    }
    return {
      latitude: Number(p.latitude ?? p.lat),
      longitude: Number(p.longitude ?? p.lng ?? p.lon),
      timestamp: normalizePointTimestamp(
        p.gps_time ?? p.timestamp ?? p.device_timestamp ?? p.location_time ??
        p.recorded_at ?? p.received_at
      ) ?? fallbackPointTimestamp ?? '',
      speed_kmh: p.speed_kmh ?? p.speed ?? null,
      heading: p.direction_deg ?? p.heading ?? p.bearing ?? p.course ?? null,
      accuracy_m: p.accuracy_m ?? p.accuracy_meters ?? null,
      battery_pct: p.battery_pct ?? p.battery_percent ?? p.battery_level ?? p.battery ?? null,
    }
  }).filter((p: JourneyPoint) =>
    isValidGpsCoord(p.latitude, p.longitude) &&
    Number.isFinite(Date.parse(p.timestamp))
  )

  const startTime = normalizePointTimestamp(raw.start_time) ??
    route_points[0]?.timestamp ??
    new Date().toISOString()
  const id = String(raw.journey_id ?? raw.id ?? `journey_${deviceId}_${Date.parse(startTime)}`)

  let total_distance_km = Number(raw.total_distance_km ?? raw.distance_km ?? 0)
  if (!total_distance_km && raw.distance_meters) {
    total_distance_km = Number((raw.distance_meters / 1000).toFixed(3))
  }
  if (!total_distance_km && route_points.length > 1) {
    let running = 0
    for (let i = 1; i < route_points.length; i++) {
      running += haversineDistanceKm(
        route_points[i - 1].latitude,
        route_points[i - 1].longitude,
        route_points[i].latitude,
        route_points[i].longitude
      )
    }
    total_distance_km = Number(running.toFixed(3))
  }

  const startPt = route_points.length > 0 ? route_points[0] : null
  const endPt = route_points.length > 1 ? route_points[route_points.length - 1] : null

  const rawStatus = String(raw.status || '').toLowerCase()
  const isCompleted = ['completed', 'ended', 'finished', 'closed'].includes(rawStatus)

  const startLatitude = Number(raw.start_location?.latitude ?? raw.start_location?.lat)
  const startLongitude = Number(raw.start_location?.longitude ?? raw.start_location?.lng ?? raw.start_location?.lon)
  const start_location = raw.start_location && isValidGpsCoord(startLatitude, startLongitude)
    ? {
        latitude: startLatitude,
        longitude: startLongitude,
        timestamp: normalizePointTimestamp(raw.start_location.timestamp) ?? startTime,
      }
    : startPt
    ? {
        latitude: startPt.latitude,
        longitude: startPt.longitude,
        timestamp: startPt.timestamp,
      }
    : { latitude: 0, longitude: 0, timestamp: raw.start_time }

  const endLatitude = Number(raw.end_location?.latitude ?? raw.end_location?.lat)
  const endLongitude = Number(raw.end_location?.longitude ?? raw.end_location?.lng ?? raw.end_location?.lon)
  const end_location = raw.end_location && isValidGpsCoord(endLatitude, endLongitude)
    ? {
        latitude: endLatitude,
        longitude: endLongitude,
        timestamp: normalizePointTimestamp(raw.end_location.timestamp) ??
          normalizePointTimestamp(raw.end_time) ?? undefined,
      }
    : isCompleted && endPt
    ? {
        latitude: endPt.latitude,
        longitude: endPt.longitude,
        timestamp: endPt.timestamp,
      }
    : null

  const currentLatitude = Number(raw.current_location?.latitude ?? raw.current_location?.lat)
  const currentLongitude = Number(raw.current_location?.longitude ?? raw.current_location?.lng ?? raw.current_location?.lon)
  const current_location = raw.current_location && isValidGpsCoord(currentLatitude, currentLongitude)
    ? {
        latitude: currentLatitude,
        longitude: currentLongitude,
        timestamp: normalizePointTimestamp(raw.current_location.timestamp) ?? undefined,
        speed_kmh: raw.current_location.speed_kmh,
        heading: raw.current_location.heading,
      }
    : endPt
    ? {
        latitude: endPt.latitude,
        longitude: endPt.longitude,
        timestamp: endPt.timestamp,
        speed_kmh: endPt.speed_kmh,
        heading: endPt.heading,
      }
    : undefined

  return {
    id,
    device_id: String(raw.device_id ?? deviceId),
    wearer_name: (() => {
      const w = raw.wearer_name ?? fallbackWearer ?? null
      return w && String(w).toLowerCase().includes('demo') ? `Watch #${deviceId}` : w
    })(),
    status: isCompleted ? 'completed' : 'in_progress',
    start_time: startTime,
    end_time: normalizePointTimestamp(raw.end_time) ?? (isCompleted ? endPt?.timestamp ?? null : null),
    start_location,
    end_location,
    current_location,
    total_distance_km,
    point_count: route_points.length,
    route_points,
    created_at: raw.created_at ?? raw.start_time,
    updated_at: raw.updated_at ?? new Date().toISOString(),
  }
}

function normalizePointTimestamp(value: unknown): string | null {
  const timestamp = parseGpsTimestamp(value)
  return timestamp === null ? null : new Date(timestamp).toISOString()
}

function hasExplicitGpsNoFix(point: any): boolean {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return false
  const flags = [point.gps_fix, point.gps_valid, point.valid, point.gps_status, point.status]
  return flags.some((flag) =>
    flag === false ||
    flag === 0 ||
    String(flag).trim().toLowerCase() === 'false' ||
    String(flag).trim() === '0' ||
    String(flag).trim().toUpperCase() === 'V'
  )
}

function timestampOrder(value: string | null | undefined): number {
  const timestamp = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : 0
}

function mergeJourneyPoints(
  trip: TripRecord,
  telemetryPoints: JourneyPoint[]
): JourneyPoint[] {
  const startTime = Date.parse(trip.start_time)
  const endTime = trip.end_time ? Date.parse(trip.end_time) : Number.POSITIVE_INFINITY
  const points = new Map<string, JourneyPoint>()
  for (const point of [...trip.route_points, ...telemetryPoints]) {
    const timestamp = Date.parse(point.timestamp)
    const hasJourneyId = point.journey_id != null
    if (
      !Number.isFinite(timestamp) ||
      !isValidGpsCoord(point.latitude, point.longitude) ||
      (hasJourneyId && String(point.journey_id) !== trip.id) ||
      (!hasJourneyId && Number.isFinite(startTime) && timestamp < startTime) ||
      (!hasJourneyId && Number.isFinite(endTime) && timestamp > endTime)
    ) continue
    const key = `${timestamp}|${point.latitude}|${point.longitude}`
    points.set(key, point)
  }
  return [...points.values()].sort(
    (first, second) => Date.parse(first.timestamp) - Date.parse(second.timestamp)
  )
}

interface LocationHistoryPageProps {
  defaultTab?: 'map' | 'planner' | 'table'
}

function getJourneyRouteColor(index: number): string {
  return `hsl(${(index * 137.508) % 360} 72% 42%)`
}

function filterPointsByDateRange(
  points: JourneyPoint[],
  fromMs: number | null,
  toMs: number | null
): JourneyPoint[] {
  return points.filter((point) => {
    const timestamp = Date.parse(point.timestamp)
    if (!Number.isFinite(timestamp)) return false
    if (fromMs !== null && timestamp < fromMs) return false
    if (toMs !== null && timestamp > toMs + 59_999) return false
    return true
  })
}

function calculateJourneyDistance(points: JourneyPoint[]): number {
  return analyzeGpsTrail(toGpsTrailPoints(points)).distanceMeters / 1000
}

function toGpsTrailPoints(points: JourneyPoint[]) {
  return points.map((point) => ({
    ...point,
    timestamp: Date.parse(point.timestamp),
    accuracy: point.accuracy_m ?? null,
    key: `${Date.parse(point.timestamp)}|${point.latitude}|${point.longitude}`,
  }))
}

function fromGpsTrailPoint(point: ReturnType<typeof toGpsTrailPoints>[number]): JourneyPoint {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    timestamp: new Date(point.timestamp).toISOString(),
    journey_id: point.journey_id,
    gps_time: point.gps_time,
    received_at: point.received_at,
    gps_fix: point.gps_fix,
    coordinate_source: point.coordinate_source,
    location_is_current: point.location_is_current,
    speed_kmh: point.speed_kmh,
    heading: point.heading,
    accuracy_m: point.accuracy_m ?? point.accuracy,
    battery_pct: point.battery_pct,
  }
}

function analyzeJourneyPoints(points: JourneyPoint[]) {
  const analysis = analyzeGpsTrail(toGpsTrailPoints(points))
  const acceptedPoints = analysis.acceptedPoints.map(fromGpsTrailPoint)
  return {
    acceptedPoints,
    distanceKm: Number((analysis.distanceMeters / 1000).toFixed(3)),
    diagnostics: {
      acceptedFixes: acceptedPoints.length,
      rejectedOutliers: analysis.rejectedOutlierCount,
      gpsGaps: analysis.gapCount,
      duplicateFixes: analysis.duplicateCount,
      filteredJitter: analysis.filteredJitterCount,
      distanceEstimated: analysis.gapCount > 0 ||
        analysis.rejectedOutlierCount > 0 ||
        analysis.invalidPointCount > 0,
    },
  }
}

export default function LocationHistoryPage({ defaultTab = 'map' }: LocationHistoryPageProps = {}) {
  const [params, setParams] = useSearchParams()
  const initialDeviceParam = params.get('device') ?? ''
  const tabParam = params.get('tab') as 'map' | 'planner' | 'table' | null

  // Devices: real-time Firestore + REST API fallback
  const { devices: realtimeDevices } = useRealtimeDevices()
  const loadApiDevices = useCallback(() => listDevices(0, 500), [])
  const { data: apiDevices, loading: apiLoading, error: devicesError } = useApiData(loadApiDevices)

  const devices: Device[] = useMemo(() => {
    return mergeDevicesWithFirestore(apiDevices ?? [], realtimeDevices)
  }, [realtimeDevices, apiDevices])

  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    return initialDeviceParam || ''
  })

  // Synchronize initial device selection
  useEffect(() => {
    if (!selectedDeviceId && devices.length > 0) {
      const matched = initialDeviceParam
        ? devices.find((d) => String(d.id) === initialDeviceParam || d.imei === initialDeviceParam)
        : null
      setSelectedDeviceId(matched ? String(matched.id) : String(devices[0].id))
    }
  }, [devices, selectedDeviceId, initialDeviceParam])

  const selectedDevice = useMemo(() => {
    return (
      devices.find(
        (d) => String(d.id) === selectedDeviceId || d.imei === selectedDeviceId || d.serial_number === selectedDeviceId
      ) ?? devices[0]
    )
  }, [devices, selectedDeviceId])

  // --- JOURNEYS STATE ---
  const [backendJourneys, setBackendJourneys] = useState<TripRecord[]>([])
  const [activeBackendJourney, setActiveBackendJourney] = useState<TripRecord | null>(null)
  const [firestoreTrips, setFirestoreTrips] = useState<TripRecord[]>([])
  const [selectedJourneyId, setSelectedJourneyId] = useState<string>('active_or_latest')
  const [rawHistoryPoints, setRawHistoryPoints] = useState<JourneyPoint[]>([])
  const [fromDateTime, setFromDateTime] = useState('')
  const [toDateTime, setToDateTime] = useState('')
  const [appliedFromDateTime, setAppliedFromDateTime] = useState('')
  const [appliedToDateTime, setAppliedToDateTime] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null)
  const [loadingJourneys, setLoadingJourneys] = useState<boolean>(false)
  const [isSubmittingJourney, setIsSubmittingJourney] = useState<boolean>(false)
  const [journeyNotice, setJourneyNotice] = useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null)
  const [viewTab, setViewTab] = useState<'map' | 'planner' | 'table'>(() => tabParam || defaultTab)
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null)
  const [isPlaybackPlaying, setIsPlaybackPlaying] = useState(false)
  const [specificSelectedJourney, setSpecificSelectedJourney] = useState<TripRecord | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false)
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0)
  const journeyRequestIdRef = useRef(0)
  const activeJourneySourceRef = useRef<{
    id: string
    source: 'backend' | 'firestore'
  } | null>(null)
  const apiHistoryPointsRef = useRef<JourneyPoint[]>([])
  const firestoreHistoryPointsRef = useRef<JourneyPoint[]>([])
  useEffect(() => {
    journeyRequestIdRef.current += 1
    activeJourneySourceRef.current = null
    setLoadingJourneys(false)
    setBackendJourneys([])
    setActiveBackendJourney(null)
    setFirestoreTrips([])
    setRawHistoryPoints([])
    setSpecificSelectedJourney(null)
    setSelectedJourneyId('active_or_latest')
    setFromDateTime('')
    setToDateTime('')
    setAppliedFromDateTime('')
    setAppliedToDateTime('')
  }, [selectedDeviceId])

  // 1. Fetch from backend journeys APIs (GET /api/v1/journeys/active/{id} & GET /api/v1/journeys/device/{id})
  const refreshBackendJourneys = useCallback(async () => {
    if (!selectedDeviceId) return
    const requestId = ++journeyRequestIdRef.current
    setLoadingJourneys(true)

    const wearer = selectedDevice?.device_name ?? (selectedDevice as any)?.wearer_name

    try {
      const [activeResult, journeysResult] = await Promise.allSettled([
        getActiveJourney(selectedDeviceId),
        getDeviceJourneys(selectedDeviceId),
      ])
      if (requestId !== journeyRequestIdRef.current) return

      if (activeResult.status === 'fulfilled') {
        const normalized = activeResult.value
          ? normalizeToTripRecord(activeResult.value, selectedDeviceId, wearer)
          : null
        setActiveBackendJourney(normalized)
        if (normalized) {
          activeJourneySourceRef.current = { id: normalized.id, source: 'backend' }
        }
      } else {
        console.warn(`Unable to load active journey for ${selectedDeviceId}.`, activeResult.reason)
        setActiveBackendJourney(null)
      }

      if (journeysResult.status === 'fulfilled') {
        const normalizedList = (Array.isArray(journeysResult.value) ? journeysResult.value : [])
          .map((j) => normalizeToTripRecord(j, selectedDeviceId, wearer))
          .filter((j): j is TripRecord => j !== null)
        setBackendJourneys(normalizedList)
      } else {
        console.warn(`Unable to load journey history for ${selectedDeviceId}.`, journeysResult.reason)
        setBackendJourneys([])
      }
    } catch (err) {
      if (requestId === journeyRequestIdRef.current) {
        console.warn(`Unable to load journeys for ${selectedDeviceId}; using Firestore telemetry.`, err)
      }
    } finally {
      if (requestId === journeyRequestIdRef.current) setLoadingJourneys(false)
    }
  }, [selectedDeviceId, selectedDevice])

  useEffect(() => {
    refreshBackendJourneys()
  }, [refreshBackendJourneys])

  // 2. Real-time Firestore trip/journey listener for live coordinates
  useEffect(() => {
    if (!selectedDeviceId) return

    const unsubscribe = subscribeToDeviceTrips(
      selectedDeviceId,
      (trips) => {
        setFirestoreTrips(trips)
      },
      (err) => {
        console.error('Firestore trip subscription error:', err)
      }
    )

    return () => {
      unsubscribe()
    }
  }, [selectedDeviceId])

  const historyDeviceId = String(selectedDevice?.imei ?? selectedDevice?.device_id ?? selectedDeviceId)

  // Subscribe to the ingest logs so route history updates as soon as Firestore receives a fix.
  useEffect(() => {
    if (!selectedDeviceId) {
      setHistoryLoading(false)
      setHistoryLoadError(null)
      return
    }
    let active = true
    let firestoreReceived = false
    let apiFinished = false
    setHistoryLoading(true)
    setHistoryLoadError(null)
    apiHistoryPointsRef.current = []
    firestoreHistoryPointsRef.current = []
    setRawHistoryPoints([])

    const updateLoadingState = () => {
      if (active && firestoreReceived && apiFinished) setHistoryLoading(false)
    }

    const mergeHistoryPoints = (...groups: JourneyPoint[][]) => {
      const merged = new Map<string, JourneyPoint>()
      for (const point of groups.flat()) {
        const timestamp = Date.parse(point.timestamp)
        if (
          !Number.isFinite(timestamp) ||
          !isValidGpsCoord(point.latitude, point.longitude)
        ) continue
        merged.set(
          `${timestamp}|${point.latitude}|${point.longitude}`,
          { ...point, timestamp: new Date(timestamp).toISOString() }
        )
      }
      return [...merged.values()].sort(
        (first, second) => Date.parse(first.timestamp) - Date.parse(second.timestamp)
      )
    }

    const loadApiHistory = async () => {
      try {
        const apiPoints = await listLocationHistory(historyDeviceId, 2000)
        if (!active) return
        apiHistoryPointsRef.current = apiPoints
          .map((point) => ({
            ...point,
            latitude: Number(point.latitude ?? (point as any).lat),
            longitude: Number(point.longitude ?? (point as any).lng ?? (point as any).lon),
            timestamp: normalizePointTimestamp(
              point.timestamp ?? (point as any).gps_time ??
                (point as any).location_time ?? point.recorded_at ?? point.received_at
            ) ?? '',
            speed_kmh: point.speed_kmh ?? (point as any).speed ?? null,
            heading: point.heading ?? (point as any).direction_deg ??
              (point as any).bearing ?? (point as any).course ?? null,
            battery_pct: point.battery_pct ?? (point as any).battery_percent ??
              (point as any).battery_level ?? (point as any).battery ?? null,
          }))
          .filter((point) =>
            point.gps_fix !== false &&
            point.gps_valid !== false &&
            String((point as any).gps_status ?? (point as any).gps_fix_status ?? '').toUpperCase() !== 'V' &&
            isValidGpsCoord(point.latitude, point.longitude) &&
            Number.isFinite(Date.parse(point.timestamp))
          )
        setRawHistoryPoints(
          mergeHistoryPoints(
            firestoreHistoryPointsRef.current,
            apiHistoryPointsRef.current
          )
        )
        setHasMoreHistory(apiPoints.length >= 2000)
        apiFinished = true
        updateLoadingState()
      } catch (error) {
        if (active) {
          console.warn(`Unable to load GPS history from the API for ${historyDeviceId}.`, error)
          setHistoryLoadError('The GPS history API could not be reached. Firestore history is still being checked.')
        }
        apiFinished = true
        updateLoadingState()
      }
    }

    const unsubscribe = subscribeToFirestoreLocationHistory(
      historyDeviceId,
      2000,
      (points) => {
        if (!active) return
        firestoreReceived = true
        firestoreHistoryPointsRef.current = points
        setRawHistoryPoints(
          mergeHistoryPoints(
            firestoreHistoryPointsRef.current,
            apiHistoryPointsRef.current
          )
        )
        updateLoadingState()
      },
      (error) => {
        firestoreReceived = true
        console.warn(`Firestore GPS log subscription failed for ${historyDeviceId}; API history remains active.`, error)
        if (apiFinished && apiHistoryPointsRef.current.length === 0) {
          setHistoryLoadError('Firestore and API history could not be loaded for this device.')
        }
        updateLoadingState()
      }
    )
    void loadApiHistory()

    return () => {
      active = false
      unsubscribe()
    }
  }, [selectedDeviceId, historyDeviceId, historyRefreshToken])

  const loadOlderHistory = useCallback(async () => {
    if (isLoadingOlderHistory || !historyDeviceId) return
    setIsLoadingOlderHistory(true)
    try {
      const oldestPoint = apiHistoryPointsRef.current[0]
      if (!oldestPoint?.timestamp) {
        setHasMoreHistory(false)
        setIsLoadingOlderHistory(false)
        return
      }
      const olderBatch = await listLocationHistory(historyDeviceId, {
        limit: 1000,
        before_timestamp: oldestPoint.timestamp,
      })
      if (!olderBatch || olderBatch.length === 0) {
        setHasMoreHistory(false)
      } else {
        const mapped: JourneyPoint[] = olderBatch
          .map((point) => ({
            ...point,
            latitude: Number(point.latitude ?? (point as any).lat),
            longitude: Number(point.longitude ?? (point as any).lng ?? (point as any).lon),
            timestamp: normalizePointTimestamp(
              point.timestamp ?? (point as any).gps_time ??
                (point as any).location_time ?? point.recorded_at ?? point.received_at
            ) ?? '',
            speed_kmh: point.speed_kmh ?? (point as any).speed ?? null,
            heading: point.heading ?? (point as any).direction_deg ??
              (point as any).bearing ?? (point as any).course ?? null,
            battery_pct: point.battery_pct ?? (point as any).battery_percent ??
              (point as any).battery_level ?? (point as any).battery ?? null,
          }))
          .filter((point) =>
            point.gps_fix !== false &&
            point.gps_valid !== false &&
            String((point as any).gps_status ?? (point as any).gps_fix_status ?? '').toUpperCase() !== 'V' &&
            isValidGpsCoord(point.latitude, point.longitude) &&
            Number.isFinite(Date.parse(point.timestamp))
          )

        const mergedMap = new Map<string, JourneyPoint>()
        for (const pt of [...mapped, ...apiHistoryPointsRef.current]) {
          const ts = Date.parse(pt.timestamp)
          if (!Number.isFinite(ts) || !isValidGpsCoord(pt.latitude, pt.longitude)) continue
          mergedMap.set(`${ts}|${pt.latitude}|${pt.longitude}`, pt)
        }
        const updatedApiPoints = [...mergedMap.values()].sort(
          (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
        )
        apiHistoryPointsRef.current = updatedApiPoints

        setRawHistoryPoints((current) => {
          const currentMap = new Map<string, JourneyPoint>()
          for (const pt of [...current, ...mapped]) {
            const ts = Date.parse(pt.timestamp)
            if (!Number.isFinite(ts) || !isValidGpsCoord(pt.latitude, pt.longitude)) continue
            currentMap.set(`${ts}|${pt.latitude}|${pt.longitude}`, pt)
          }
          return [...currentMap.values()].sort(
            (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
          )
        })

        if (olderBatch.length < 1000) {
          setHasMoreHistory(false)
        }
      }
    } catch (error) {
      console.warn('Unable to load older GPS history pages:', error)
    } finally {
      setIsLoadingOlderHistory(false)
    }
  }, [historyDeviceId, isLoadingOlderHistory])

  // Combine backend journeys with Firestore journeys (deduplicated by id)
  const combinedJourneys: TripRecord[] = useMemo(() => {
    const map = new Map<string, TripRecord>()

    // Prioritize backend journeys
    backendJourneys.forEach((j) => map.set(j.id, j))

    // Merge in Firestore trips
    firestoreTrips.forEach((t) => {
      if (!map.has(t.id)) {
        map.set(t.id, t)
      } else {
        // If Firestore has more route points, merge route points
        const existing = map.get(t.id)!
        if ((t.route_points?.length || 0) > (existing.route_points?.length || 0)) {
          map.set(t.id, {
            ...existing,
            route_points: t.route_points,
            point_count: t.point_count,
            total_distance_km: t.total_distance_km || existing.total_distance_km,
          })
        }
      }
    })

    const list = Array.from(map.values())
    list.sort((a, b) => timestampOrder(b.start_time) - timestampOrder(a.start_time))
    return list
  }, [backendJourneys, firestoreTrips])

  const rawTelemetryJourneys = useMemo(() => {
    const sortedPoints = rawHistoryPoints
      .filter((point) =>
        isValidGpsCoord(point.latitude, point.longitude) &&
        Number.isFinite(Date.parse(point.timestamp))
      )
    const groups = groupGpsPointsByInactivity(
      toGpsTrailPoints(sortedPoints),
      DEFAULT_GPS_JOURNEY_INACTIVITY_MS
    )
    return groups.flatMap((group) => {
      const points = group.map(fromGpsTrailPoint)
      const journey = buildTripFromPoints(
        selectedDeviceId,
        points,
        selectedDevice?.device_name ?? (selectedDevice as any)?.wearer_name
      )
      if (!journey) return []
      const route = analyzeJourneyPoints(points)
      const firstPoint = route.acceptedPoints[0]
      const lastPoint = route.acceptedPoints[route.acceptedPoints.length - 1]
      return [{
        ...journey,
        route_points: route.acceptedPoints,
        point_count: route.diagnostics.acceptedFixes,
        total_distance_km: route.distanceKm,
        route_diagnostics: route.diagnostics,
        start_time: firstPoint?.timestamp ?? journey.start_time,
        start_location: firstPoint ? {
          latitude: firstPoint.latitude,
          longitude: firstPoint.longitude,
          timestamp: firstPoint.timestamp,
        } : journey.start_location,
        end_time: lastPoint?.timestamp ?? journey.end_time,
        end_location: lastPoint ? {
          latitude: lastPoint.latitude,
          longitude: lastPoint.longitude,
          timestamp: lastPoint.timestamp,
        } : journey.end_location,
      }]
    })
  }, [selectedDeviceId, rawHistoryPoints, selectedDevice])
  const rawTelemetryJourney = rawTelemetryJourneys[rawTelemetryJourneys.length - 1] ?? null

  const journeysWithHistory = useMemo(() => {
    const sources = new Map<string, TripRecord>()
    if (activeBackendJourney) sources.set(activeBackendJourney.id, activeBackendJourney)
    combinedJourneys.forEach((journey) => sources.set(journey.id, journey))

    return [...sources.values()]
      .map((journey) => {
        const mergedPoints = mergeJourneyPoints(journey, rawHistoryPoints)
        const route = analyzeJourneyPoints(mergedPoints)
        const route_points = route.acceptedPoints
        const firstPoint = route_points[0]
        const lastPoint = route_points[route_points.length - 1]
        return {
          ...journey,
          route_points,
          point_count: route.diagnostics.acceptedFixes,
          total_distance_km: route.distanceKm,
          route_diagnostics: route.diagnostics,
          start_time: firstPoint?.timestamp ?? journey.start_time,
          start_location: firstPoint ? {
            latitude: firstPoint.latitude,
            longitude: firstPoint.longitude,
            timestamp: firstPoint.timestamp,
          } : journey.start_location,
          end_time: journey.status === 'completed'
            ? lastPoint?.timestamp ?? journey.end_time
            : null,
          end_location: journey.status === 'completed' && lastPoint ? {
            latitude: lastPoint.latitude,
            longitude: lastPoint.longitude,
            timestamp: lastPoint.timestamp,
          } : journey.status === 'completed' ? journey.end_location : null,
        }
      })
      .sort((first, second) => timestampOrder(second.start_time) - timestampOrder(first.start_time))
  }, [activeBackendJourney, combinedJourneys, rawHistoryPoints])

  const activeJourney = useMemo(
    () => journeysWithHistory.find((journey) => journey.status === 'in_progress') ?? null,
    [journeysWithHistory]
  )

  useEffect(() => {
    if (
      selectedJourneyId !== 'active_or_latest' ||
      (activeJourney?.route_points.length ?? 0) >= 2
    ) return
    const journeyWithRoute = journeysWithHistory.find((journey) => journey.route_points.length >= 2) ??
      journeysWithHistory.find((journey) => journey.route_points.length > 0)
    if (journeyWithRoute) {
      setSelectedJourneyId(journeyWithRoute.id)
      return
    }
    const telemetryWithRoute = [...rawTelemetryJourneys].reverse().find(
      (journey) => journey.route_points.length >= 2
    ) ?? rawTelemetryJourney
    if (telemetryWithRoute) setSelectedJourneyId(`telemetry:${telemetryWithRoute.id}`)
  }, [
    selectedJourneyId,
    activeJourney,
    journeysWithHistory,
    rawTelemetryJourney,
    rawTelemetryJourneys,
  ])

  // When selectedJourneyId changes, load specific journey if needed
  useEffect(() => {
    if (
      selectedJourneyId === 'active_or_latest' ||
      selectedJourneyId === 'all_trips'
    ) {
      setSpecificSelectedJourney(null)
      return
    }
    if (selectedJourneyId === 'raw_telemetry' || selectedJourneyId.startsWith('telemetry:')) {
      setSpecificSelectedJourney(null)
      return
    }

    const found = journeysWithHistory.find((journey) => journey.id === selectedJourneyId)
    if (found) {
      setSpecificSelectedJourney(found)
      return
    }

    // Otherwise fetch directly from backend: GET /api/v1/journeys/{journey_id}
    let isCurrent = true
    getJourney(selectedJourneyId)
      .then((res) => {
        if (!isCurrent) return
        const normalized = normalizeToTripRecord(
          res,
          selectedDeviceId,
          selectedDevice?.device_name ?? (selectedDevice as any)?.wearer_name
        )
        setSpecificSelectedJourney(normalized)
      })
      .catch(() => {
        if (isCurrent && found) {
          setSpecificSelectedJourney(found)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [selectedJourneyId, journeysWithHistory, selectedDeviceId, selectedDevice])

  const currentDisplayJourney: TripRecord | null = useMemo(() => {
    if (selectedJourneyId === 'all_trips') return null
    if (selectedJourneyId === 'raw_telemetry') {
      return rawTelemetryJourneys.length === 1 ? rawTelemetryJourneys[0] : null
    }
    if (selectedJourneyId.startsWith('telemetry:')) {
      const telemetryId = selectedJourneyId.slice('telemetry:'.length)
      return rawTelemetryJourneys.find((journey) => journey.id === telemetryId) ?? null
    }
    if (selectedJourneyId === 'active_or_latest') {
      return activeJourney ?? journeysWithHistory[0] ?? rawTelemetryJourney
    }
    return journeysWithHistory.find((journey) => journey.id === selectedJourneyId) ??
      specificSelectedJourney
  }, [
    selectedJourneyId,
    specificSelectedJourney,
    activeJourney,
    journeysWithHistory,
    rawTelemetryJourney,
    rawTelemetryJourneys,
  ])

  const allJourneyRoutes = useMemo(() => {
    const unassignedTelemetry = rawTelemetryJourneys.filter((telemetryJourney) => {
      const telemetryStart = Date.parse(telemetryJourney.start_time)
      const telemetryEnd = telemetryJourney.end_time
        ? Date.parse(telemetryJourney.end_time)
        : telemetryStart
      return !journeysWithHistory.some((journey) => {
        const journeyStart = Date.parse(journey.start_time)
        const journeyEnd = journey.end_time ? Date.parse(journey.end_time) : Number.POSITIVE_INFINITY
        return telemetryStart <= journeyEnd && telemetryEnd >= journeyStart
      })
    })
    const journeys = [...journeysWithHistory, ...unassignedTelemetry]
      .sort((first, second) => timestampOrder(second.start_time) - timestampOrder(first.start_time))
    return journeys.map((journey, index) => ({
      id: journey.id,
      label: journey.wearer_name
        ? `${journey.wearer_name} · ${new Date(journey.start_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
        : `Trip ${new Date(journey.start_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
      color: getJourneyRouteColor(index),
      status: journey.status,
      points: journey.route_points,
    }))
  }, [journeysWithHistory, rawTelemetryJourneys])

  const rawTelemetryRoutes = useMemo(
    () => rawTelemetryJourneys.map((journey, index) => ({
      id: journey.id,
      label: `Inferred journey ${index + 1} · ${new Date(journey.start_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
      color: getJourneyRouteColor(index),
      status: journey.status,
      points: journey.route_points,
    })),
    [rawTelemetryJourneys]
  )

  const draftFromTimeMs = fromDateTime ? new Date(fromDateTime).getTime() : null
  const draftToTimeMs = toDateTime ? new Date(toDateTime).getTime() : null
  const draftDateRangeInvalid = draftFromTimeMs !== null && draftToTimeMs !== null &&
    draftFromTimeMs > draftToTimeMs
  const fromTimeMs = appliedFromDateTime ? new Date(appliedFromDateTime).getTime() : null
  const toTimeMs = appliedToDateTime ? new Date(appliedToDateTime).getTime() : null
  const dateRangeInvalid = fromTimeMs !== null && toTimeMs !== null && fromTimeMs > toTimeMs
  const filteredJourneyRoutes = useMemo(
    () => allJourneyRoutes.map((journey) => ({
      ...journey,
      points: dateRangeInvalid
        ? []
        : filterPointsByDateRange(journey.points, fromTimeMs, toTimeMs),
    })),
    [allJourneyRoutes, dateRangeInvalid, fromTimeMs, toTimeMs]
  )
  const filteredRawTelemetryRoutes = useMemo(
    () => rawTelemetryRoutes.map((journey) => ({
      ...journey,
      points: dateRangeInvalid
        ? []
        : filterPointsByDateRange(journey.points, fromTimeMs, toTimeMs),
    })),
    [rawTelemetryRoutes, dateRangeInvalid, fromTimeMs, toTimeMs]
  )
  const isMultiRouteView = selectedJourneyId === 'all_trips' ||
    (selectedJourneyId === 'raw_telemetry' && rawTelemetryJourneys.length > 1)
  const displayedRoutes = selectedJourneyId === 'raw_telemetry'
    ? filteredRawTelemetryRoutes
    : filteredJourneyRoutes
  const selectedJourneyPoints = useMemo(() => {
    if (selectedJourneyId === 'all_trips') return []
    const points = currentDisplayJourney
      ? mergeJourneyPoints(currentDisplayJourney, rawHistoryPoints)
      : rawHistoryPoints
    const acceptedPoints = analyzeJourneyPoints(points).acceptedPoints
    return dateRangeInvalid
      ? []
      : filterPointsByDateRange(acceptedPoints, fromTimeMs, toTimeMs)
  }, [
    selectedJourneyId,
    currentDisplayJourney,
    rawHistoryPoints,
    dateRangeInvalid,
    fromTimeMs,
    toTimeMs,
  ])
  const plannerRoute = useMemo(() => {
    if (!isMultiRouteView) return null
    return [...displayedRoutes]
      .filter((route) => route.points.length >= 2)
      .sort((first, second) =>
        Date.parse(second.points[second.points.length - 1].timestamp) -
        Date.parse(first.points[first.points.length - 1].timestamp)
      )[0] ?? null
  }, [isMultiRouteView, displayedRoutes])
  const plannerPoints = isMultiRouteView
    ? plannerRoute?.points ?? []
    : selectedJourneyPoints
  const playbackPoints = useMemo(
    () => [...plannerPoints]
      .filter((point) =>
        isValidGpsCoord(point.latitude, point.longitude) &&
        Number.isFinite(Date.parse(point.timestamp)) &&
        String((point as any).gps_status ?? (point as any).gps_fix_status ?? '').toUpperCase() !== 'V' &&
        (point as any).gps_fix !== false &&
        (point as any).gps_valid !== false
      )
      .sort((first, second) => Date.parse(first.timestamp) - Date.parse(second.timestamp)),
    [plannerPoints]
  )
  const playbackPoint = playbackIndex === null ? null : playbackPoints[playbackIndex] ?? null

  useEffect(() => {
    setIsPlaybackPlaying(false)
    setPlaybackIndex(null)
  }, [selectedDeviceId, selectedJourneyId, appliedFromDateTime, appliedToDateTime])

  useEffect(() => {
    if (!isPlaybackPlaying) return
    if (
      playbackPoints.length < 2 ||
      playbackIndex === null ||
      playbackIndex >= playbackPoints.length - 1
    ) {
      setIsPlaybackPlaying(false)
      return
    }
    const timer = window.setTimeout(
      () => setPlaybackIndex((current) => current === null ? 0 : current + 1),
      1_000
    )
    return () => window.clearTimeout(timer)
  }, [isPlaybackPlaying, playbackIndex, playbackPoints.length])

  const selectedRouteColor = useMemo(() => {
    const index = allJourneyRoutes.findIndex((journey) => journey.id === currentDisplayJourney?.id)
    return getJourneyRouteColor(index < 0 ? 0 : index)
  }, [allJourneyRoutes, currentDisplayJourney?.id])

  // --- REAL-TIME LIVE GPS & TELEMETRY STATE (Requirement 2 & 5) ---
  interface LiveLocationState {
    latitude: number
    longitude: number
    speed_kmh: number | null
    heading: number | null
    battery_pct: number | null
    timestamp: string
    satellites?: number | null
    gps_fix?: boolean
  }

  const [liveLocation, setLiveLocation] = useState<LiveLocationState | null>(null)
  const [lastGpsUpdateTime, setLastGpsUpdateTime] = useState<Date | null>(null)
  const filteredLiveLocation = useMemo(() => {
    if (!liveLocation || dateRangeInvalid) return null
    const timestamp = Date.parse(liveLocation.timestamp)
    if (!Number.isFinite(timestamp)) return null
    if (fromTimeMs !== null && timestamp < fromTimeMs) return null
    if (toTimeMs !== null && timestamp > toTimeMs + 59_999) return null
    return liveLocation
  }, [liveLocation, dateRangeInvalid, fromTimeMs, toTimeMs])
  const activeJourneyRef = useRef<TripRecord | null>(null)
  const lastTripPointTimestampRef = useRef<string | null>(null)
  activeJourneyRef.current = activeJourney

  // Keep the live location and active journey in sync with Firestore device snapshots.
  useEffect(() => {
    if (!selectedDevice) {
      setLiveLocation(null)
      setLastGpsUpdateTime(null)
      return
    }
    const fix = normalizeVerifiedGpsFix(selectedDevice)
    if (!fix) {
      setLiveLocation(null)
      setLastGpsUpdateTime(null)
      return
    }
    const timestamp = new Date(fix.timestamp).toISOString()
    const newPoint: JourneyPoint = {
      latitude: fix.latitude,
      longitude: fix.longitude,
      timestamp,
      speed_kmh: selectedDevice.speed_kmh ?? null,
      heading: selectedDevice.heading ?? null,
      battery_pct: selectedDevice.battery_pct ?? null,
    }
    setLiveLocation({
      ...newPoint,
      speed_kmh: newPoint.speed_kmh ?? null,
      heading: newPoint.heading ?? null,
      battery_pct: newPoint.battery_pct ?? null,
      gps_fix: true,
    })
    setLastGpsUpdateTime(new Date(fix.timestamp))

    if (lastTripPointTimestampRef.current === timestamp) return
    lastTripPointTimestampRef.current = timestamp
    const currentActive = activeJourneyRef.current
    if (
      !currentActive ||
      currentActive.status !== 'in_progress' ||
      String(currentActive.device_id) !== String(selectedDevice.device_id)
    ) return

    const existingPoints = currentActive.route_points || []
    const lastPoint = existingPoints[existingPoints.length - 1]
    if (lastPoint && (
      haversineDistanceKm(
        lastPoint.latitude,
        lastPoint.longitude,
        newPoint.latitude,
        newPoint.longitude
      ) < 0.003 ||
      (lastPoint.latitude === newPoint.latitude &&
        lastPoint.longitude === newPoint.longitude &&
        lastPoint.timestamp === newPoint.timestamp)
    )) return

    void addTripPoint(currentActive.id, newPoint, currentActive)
      .then((updated) => {
        setActiveBackendJourney((current) => current?.id === updated.id ? updated : current)
      })
      .catch((error) => {
        console.warn('[GPS Firestore update] Error adding GPS point to trip:', error)
      })
  }, [selectedDevice])

  // Match the backend's 15-minute GPS fix validity window.
  const isGpsStale = useMemo(() => {
    if (!lastGpsUpdateTime) return false
    return Date.now() - lastGpsUpdateTime.getTime() > GPS_FRESHNESS_MS
  }, [lastGpsUpdateTime, liveLocation])

  // GPS Fix status
    // GPS Fix status
  const hasGpsFix = useMemo(() => {
    if (!liveLocation) return false
    return isValidGpsCoord(liveLocation.latitude, liveLocation.longitude) && liveLocation.gps_fix !== false
  }, [liveLocation])

  // --- FALLBACK: Show last known position instead of "No GPS Fix" when device is stale ---
  const lastKnownFix = useMemo(() => {
    if (filteredLiveLocation) return filteredLiveLocation
    
    // 1. Try current_location or end_location from the journey record
    const candidates = [
      currentDisplayJourney?.current_location,
      currentDisplayJourney?.end_location,
    ]
    for (const c of candidates) {
      if (c && isValidGpsCoord(c.latitude, c.longitude)) {
        return {
          latitude: c.latitude,
          longitude: c.longitude,
          timestamp: c.timestamp ?? '',
          speed_kmh: (c as any).speed_kmh ?? null,
          heading: (c as any).heading ?? null,
          battery_pct: (c as any).battery_pct ?? null,
        }
      }
    }
    
    // 2. Fallback to the very last point in the filtered journey points
    const last = selectedJourneyPoints[selectedJourneyPoints.length - 1]
    if (last && isValidGpsCoord(last.latitude, last.longitude)) {
      return {
        latitude: last.latitude,
        longitude: last.longitude,
        timestamp: last.timestamp,
        speed_kmh: last.speed_kmh ?? null,
        heading: last.heading ?? null,
        battery_pct: last.battery_pct ?? null,
      }
    }
    
    return null
  }, [filteredLiveLocation, currentDisplayJourney, selectedJourneyPoints])

  // --- 1. START JOURNEY (POST /api/v1/journeys/start) ---

  // --- 1. START JOURNEY (POST /api/v1/journeys/start) ---
  const handleStartJourney = async () => {
    if (!selectedDevice) return
    setIsSubmittingJourney(true)
    setJourneyNotice(null)

    const lat = selectedDevice.last_latitude ?? (selectedDevice as any).latitude
    const lon = selectedDevice.last_longitude ?? (selectedDevice as any).longitude
    const hasCoords = isValidGpsCoord(lat, lon)
    const wearer = (selectedDevice as any)?.wearer_name ?? selectedDevice.device_name ?? `Device ${selectedDevice.id}`

    try {
      // 1. Call backend API: POST /api/v1/journeys/start
      let startedFromBackend: Journey | null = null
      try {
        startedFromBackend = await startJourney({
          device_id: selectedDevice.id,
          wearer_name: wearer,
          start_latitude: hasCoords ? Number(lat) : null,
          start_longitude: hasCoords ? Number(lon) : null,
          timestamp: new Date().toISOString(),
        })
      } catch (apiErr) {
        console.warn('Backend POST /journeys/start failed; using the Firestore journey fallback.', apiErr)
      }

      // Persist through one source only; writing both stores creates duplicate journeys.
      const activeRecord = startedFromBackend
        ? normalizeToTripRecord(startedFromBackend, String(selectedDevice.id), wearer)
        : await startTrip(
            String(selectedDevice.id),
            wearer,
            hasCoords ? Number(lat) : null,
            hasCoords ? Number(lon) : null
          )
      if (!activeRecord) throw new Error('The journey API returned an invalid journey record.')
      activeJourneySourceRef.current = {
        id: activeRecord.id,
        source: startedFromBackend ? 'backend' : 'firestore',
      }

      setActiveBackendJourney(activeRecord)
      setSelectedJourneyId(activeRecord.id)
      console.info(`[journey] JOURNEY_CREATED — ${startedFromBackend ? 'backend start request' : 'Firestore fallback after backend error'}; id=${activeRecord.id}`)

      setJourneyNotice({
        message: hasCoords
          ? `Journey started! Green START marker placed at [${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}].`
          : 'Journey started! Awaiting initial GPS fix from device.',
        severity: 'success',
      })

      // Refresh list
      refreshBackendJourneys()
    } catch (err) {
      console.error('Error starting journey:', err)
      setJourneyNotice({
        message: err instanceof Error ? err.message : 'Failed to start journey.',
        severity: 'error',
      })
    } finally {
      setIsSubmittingJourney(false)
    }
  }

  // --- 2. END JOURNEY (POST /api/v1/journeys/end) ---
  const handleEndJourney = async () => {
    if (!activeJourney) return
    setIsSubmittingJourney(true)
    setJourneyNotice(null)

    const lat = selectedDevice?.last_latitude ?? (selectedDevice as any)?.latitude
    const lon = selectedDevice?.last_longitude ?? (selectedDevice as any)?.longitude

    try {
      const persistence = activeJourneySourceRef.current?.id === activeJourney.id
        ? activeJourneySourceRef.current.source
        : firestoreTrips.some((trip) => trip.id === activeJourney.id)
          ? 'firestore'
          : 'backend'

      if (persistence === 'backend') {
        await endJourney({
          journey_id: activeJourney.id,
          device_id: selectedDevice?.id,
          end_latitude: isValidGpsCoord(lat, lon) ? Number(lat) : null,
          end_longitude: isValidGpsCoord(lat, lon) ? Number(lon) : null,
          timestamp: new Date().toISOString(),
        })
      } else {
        await endTrip(
          activeJourney.id,
          String(activeJourney.device_id),
          isValidGpsCoord(lat, lon) ? Number(lat) : null,
          isValidGpsCoord(lat, lon) ? Number(lon) : null
        )
      }

      setActiveBackendJourney(null)
      activeJourneySourceRef.current = null
      console.info(`[journey] JOURNEY_COMPLETED — explicit end request; id=${activeJourney.id}`)
      setJourneyNotice({
        message: 'Journey completed! Red END marker recorded. Total travelled distance saved.',
        severity: 'success',
      })

      refreshBackendJourneys()
    } catch (err) {
      console.error('Error ending journey:', err)
      setJourneyNotice({
        message: err instanceof Error ? err.message : 'Failed to end journey.',
        severity: 'error',
      })
    } finally {
      setIsSubmittingJourney(false)
    }
  }

  const tableRoutes = isMultiRouteView
    ? displayedRoutes
    : [{
        id: currentDisplayJourney?.id ?? 'raw_telemetry',
        label: currentDisplayJourney?.wearer_name
          ? `${currentDisplayJourney.wearer_name} · ${new Date(currentDisplayJourney.start_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
          : 'Selected route',
        color: selectedRouteColor,
        status: currentDisplayJourney?.status ?? 'completed' as const,
        points: selectedJourneyPoints,
      }]
  const tableDataWithDistance = useMemo(() => {
    return tableRoutes.flatMap((journey) => {
      const analysis = analyzeGpsTrail(toGpsTrailPoints(journey.points))
      return analysis.segments.flatMap((segment) => {
        let accumulatedDistanceKm = 0
        return segment.map((point, index) => {
          const previousPoint = index > 0 ? segment[index - 1] : null
          const legDistanceKm = previousPoint
            ? haversineDistanceKm(
                previousPoint.latitude,
                previousPoint.longitude,
                point.latitude,
                point.longitude
              )
            : 0
          accumulatedDistanceKm += legDistanceKm
          return {
            ...fromGpsTrailPoint(point),
            tripId: journey.id,
            tripLabel: journey.label,
            tripColor: journey.color,
            tripStatus: journey.status,
            isTripStart: index === 0,
            isTripEnd: index === segment.length - 1,
            legDistanceKm,
            accumulatedDistanceKm,
          }
        })
      })
    })
  }, [tableRoutes])

  return (
    <Stack spacing={3}>
      {/* Header & Controls Bar */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Route size={28} color="#2563eb" />
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#0f172a' }}>
              Travel Distance & Route Tracking
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Real-time GPS journey tracking, thick Leaflet route highlighting, point-by-point Haversine distance
          </Typography>
        </Box>

        {/* Action Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
          {/* Device Selector */}
          <TextField
            select
            size="small"
            label="Tracked Device"
            value={selectedDeviceId}
            onChange={(event) => {
              const val = event.target.value
              setSelectedDeviceId(val)
              setParams({ device: val })
              setSelectedJourneyId('active_or_latest')
            }}
            sx={{ minWidth: 230, bgcolor: 'background.paper', borderRadius: 1 }}
            disabled={!devices.length}
          >
            {devices.map((device) => (
              <MenuItem key={device.id} value={String(device.id)}>
                {device.device_name || device.serial_number || `Device ${device.id}`}
                {device.imei ? ` (${device.imei.slice(-6)})` : ''}
              </MenuItem>
            ))}
          </TextField>

          {/* Journey History Selector (Requirement 8 & 9) */}
          <TextField
            select
            size="small"
            label="Journey History"
            value={selectedJourneyId}
            onChange={(event) => setSelectedJourneyId(event.target.value)}
            sx={{ minWidth: 280, bgcolor: 'background.paper', borderRadius: 1 }}
            disabled={!selectedDeviceId}
          >
            {activeJourney && (
              <MenuItem value={activeJourney.id} sx={{ fontWeight: 700, color: '#16a34a' }}>
                🟢 Active Journey (In Progress)
              </MenuItem>
            )}
            {allJourneyRoutes.length > 1 && (
              <MenuItem value="all_trips" sx={{ fontWeight: 700 }}>
                View all trips ({allJourneyRoutes.length})
              </MenuItem>
            )}
            <MenuItem value="active_or_latest">
              {activeJourney ? 'Active Journey in Progress' : 'Latest Completed Journey'}
            </MenuItem>
            <MenuItem value="raw_telemetry">
              📍 All Recorded Telemetry ({rawHistoryPoints.length} points)
            </MenuItem>
            {allJourneyRoutes
              .filter((route) => route.id !== activeJourney?.id)
              .map((route) => {
                const telemetryIndex = rawTelemetryRoutes.findIndex(
                  (telemetryRoute) => telemetryRoute.id === route.id
                )
                const telemetryRoute = telemetryIndex >= 0
                const journey = journeysWithHistory.find((item) => item.id === route.id)
                const dateValue = journey?.start_time ?? route.points[0]?.timestamp
                const dateStr = dateValue
                  ? new Date(dateValue).toLocaleDateString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
                  : 'Unknown date'
                const distanceKm = journey?.total_distance_km ??
                  calculateJourneyDistance(route.points)
                return (
                  <MenuItem
                    key={route.id}
                    value={telemetryRoute ? `telemetry:${route.id}` : route.id}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        component="span"
                        sx={{
                          width: 9,
                          height: 9,
                          borderRadius: '50%',
                          bgcolor: route.color,
                          flexShrink: 0,
                        }}
                      />
                      {telemetryRoute
                        ? `Inferred GPS group ${telemetryIndex + 1} · ${dateStr}`
                        : `Journey · ${dateStr} (${distanceKm.toFixed(1)} km`}
                    </Box>
                  </MenuItem>
                )
              })}
          </TextField>

          {/* Start Journey / End Journey Buttons (Requirement 1) */}
          {activeJourney ? (
            <Button
              variant="contained"
              color="error"
              size="medium"
              title="Closes the active journey record and saves its end time and location."
              startIcon={isSubmittingJourney ? <CircularProgress size={16} color="inherit" /> : <Square size={16} />}
              onClick={handleEndJourney}
              disabled={isSubmittingJourney}
              sx={{ fontWeight: 700, textTransform: 'none', px: 2.5 }}
            >
              End Journey
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              size="medium"
              startIcon={isSubmittingJourney ? <CircularProgress size={16} color="inherit" /> : <Play size={16} />}
              onClick={handleStartJourney}
              disabled={isSubmittingJourney || !selectedDeviceId}
              sx={{ fontWeight: 700, textTransform: 'none', px: 2.5 }}
            >
              Start Journey
            </Button>
          )}

          <Button
            variant="outlined"
            size="medium"
            startIcon={<RotateCw size={16} />}
            onClick={() => {
              void refreshBackendJourneys()
              setHistoryRefreshToken((current) => current + 1)
            }}
            disabled={loadingJourneys}
            sx={{ textTransform: 'none' }}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.5,
          p: 1.5,
          border: '1px solid #dbeafe',
          borderRadius: 2,
          bgcolor: '#f8fbff',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mr: 0.5 }}>
          <Clock size={17} color="#2563eb" />
          <Typography variant="body2" sx={{ fontWeight: 700, color: '#1e3a8a' }}>
            Playback time range
          </Typography>
        </Box>
        <TextField
          size="small"
          type="datetime-local"
          label="From"
          value={fromDateTime}
          onChange={(event) => setFromDateTime(event.target.value)}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { 'aria-label': 'Playback start date and time' },
          }}
          disabled={!selectedDeviceId}
        />
        <TextField
          size="small"
          type="datetime-local"
          label="To"
          value={toDateTime}
          onChange={(event) => setToDateTime(event.target.value)}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { 'aria-label': 'Playback end date and time' },
          }}
          disabled={!selectedDeviceId}
        />
        <Button
          size="small"
          variant="contained"
          onClick={() => {
            if (draftDateRangeInvalid) return
            setAppliedFromDateTime(fromDateTime)
            setAppliedToDateTime(toDateTime)
          }}
          disabled={
            (!fromDateTime && !toDateTime) ||
            draftDateRangeInvalid ||
            (fromDateTime === appliedFromDateTime && toDateTime === appliedToDateTime)
          }
          sx={{ textTransform: 'none' }}
        >
          Apply Filters
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            setFromDateTime('')
            setToDateTime('')
            setAppliedFromDateTime('')
            setAppliedToDateTime('')
          }}
          disabled={
            !fromDateTime && !toDateTime &&
            !appliedFromDateTime && !appliedToDateTime
          }
          sx={{ textTransform: 'none' }}
        >
          Clear dates
        </Button>
        <Typography variant="caption" color="text.secondary">
          Select a range, then apply it to the map and GPS points log.
        </Typography>
      </Box>
      {draftDateRangeInvalid && (
        <Alert severity="warning" sx={{ mt: -2 }}>
          The start date and time must be earlier than the end date and time.
        </Alert>
      )}
      {historyLoading && rawHistoryPoints.length === 0 && (
        <Alert severity="info" sx={{ mt: -2 }}>
          Loading verified GPS history from Firestore and the API…
        </Alert>
      )}
      {!historyLoading && historyLoadError && rawHistoryPoints.length === 0 && (
        <Alert severity="error" sx={{ mt: -2 }}>
          {historyLoadError}
        </Alert>
      )}
      {!historyLoading && !historyLoadError && rawHistoryPoints.length === 0 && selectedDeviceId && (
        <Alert severity="info" sx={{ mt: -2 }}>
          No verified historical GPS points were returned for this device. A valid current position may still appear on the map.
        </Alert>
      )}
      {hasMoreHistory && (
        <Alert severity="info" sx={{ mt: -2 }}>
          Showing latest {rawHistoryPoints.length} verified GPS fixes. Click &quot;Load Older Fixes&quot; in the map controls or table below to retrieve earlier route points.
        </Alert>
      )}
      {(selectedJourneyId === 'raw_telemetry' || selectedJourneyId.startsWith('telemetry:')) && (
        <Alert severity="info" sx={{ mt: -2 }}>
          These are inferred history groups, not persistent journey IDs. Without a backend journey ID, groups use a configurable 10-minute inactivity boundary; displayed routes still break at GPS gaps.
        </Alert>
      )}
      {!dateRangeInvalid &&
        rawHistoryPoints.length > 0 &&
        tableDataWithDistance.length === 0 &&
      (appliedFromDateTime || appliedToDateTime) && (
          <Alert severity="info" sx={{ mt: -2 }}>
            No GPS points fall within the selected date and time range.
          </Alert>
        )}

      {/* Action / Error Notice */}
      {journeyNotice && (
        <Alert
          severity={journeyNotice.severity}
          onClose={() => setJourneyNotice(null)}
          sx={{ borderRadius: 2 }}
        >
          {journeyNotice.message}
        </Alert>
      )}

      {devicesError && <ApiFeedback loading={false} error={devicesError} empty={false} emptyMessage="" />}
      {apiLoading && !devices.length && <ApiFeedback loading error="" empty={false} emptyMessage="" />}
      {devices.length === 0 && !apiLoading && (
        <ApiFeedback
          loading={false}
          error=""
          empty
          emptyMessage="No devices are currently registered in the platform."
        />
      )}

                  {isMultiRouteView ? (
        <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#f8fafc' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Comparing {displayedRoutes.length} {selectedJourneyId === 'raw_telemetry' ? 'inferred GPS groups' : 'trips'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Each trip has its own color. The date range and GPS points log use the same selected period.
            </Typography>
          </CardContent>
        </Card>
           ) : (
        <TripSummaryCard
          trip={currentDisplayJourney}
          currentLocation={lastKnownFix}
          currentSpeed={lastKnownFix?.speed_kmh}
          currentHeading={lastKnownFix?.heading}
          batteryPct={lastKnownFix?.battery_pct ?? selectedDevice?.battery_pct}
          
          // FIX 1: Freeze duration when GPS is stale
          // If live, use real-time Date. If stale, freeze at lastKnownFix.timestamp
          latestGpsTime={lastKnownFix
            ? (filteredLiveLocation ? lastGpsUpdateTime : new Date(lastKnownFix.timestamp))
            : null}
          
          isGpsStale={lastKnownFix !== null && (!filteredLiveLocation || isGpsStale)}
          hasGpsFix={hasGpsFix}
          
          // NEW PROP: Explicitly tell the card to stop ticking and use this frozen time
          // when the device is offline/stale. 
          // Note: You may need to add 'frozenEndTime' to TripSummaryCard props interface
          frozenEndTime={
            lastKnownFix !== null && (!filteredLiveLocation || isGpsStale)
              ? new Date(lastKnownFix.timestamp)
              : undefined
          }
        />
      )}

      {/* View Switcher: Interactive Journey Map vs Points Table */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Tabs
          value={viewTab}
          onChange={(_, val) => setViewTab(val)}
          sx={{
            '& .MuiTab-root': {
              fontWeight: 700,
              fontSize: 14,
              textTransform: 'none',
              minHeight: 48,
            },
          }}
        >
          <Tab
            value="map"
            label="Interactive Journey Map"
            icon={<Route size={18} />}
            iconPosition="start"
          />
          <Tab
            value="planner"
            label="Route Finder & OSRM Path Planner"
            icon={<Navigation size={18} />}
            iconPosition="start"
          />
          <Tab
            value="table"
            label={`GPS Points Log (${tableDataWithDistance.length})`}
            icon={<TableIcon size={18} />}
            iconPosition="start"
          />
        </Tabs>

        {viewTab === 'map' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {playbackIndex !== null && playbackPoint
                ? `Point ${playbackIndex + 1}/${playbackPoints.length} · ${new Date(playbackPoint.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
                : `${playbackPoints.length} GPS fixes`}
            </Typography>
            <Button
              size="small"
              variant="contained"
              startIcon={isPlaybackPlaying ? <Pause size={16} /> : <Play size={16} />}
              disabled={playbackPoints.length < 2}
              onClick={() => {
                if (isPlaybackPlaying) {
                  setIsPlaybackPlaying(false)
                  return
                }
                setPlaybackIndex((current) =>
                  current === null || current >= playbackPoints.length - 1 ? 0 : current
                )
                setIsPlaybackPlaying(true)
              }}
              sx={{ textTransform: 'none' }}
            >
              {isPlaybackPlaying
                ? 'Pause'
                : playbackIndex === playbackPoints.length - 1 ? 'Replay' : 'Play'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RotateCcw size={16} />}
              disabled={playbackPoints.length < 2}
              onClick={() => {
                setIsPlaybackPlaying(false)
                setPlaybackIndex(0)
              }}
              sx={{ textTransform: 'none' }}
            >
              Restart
            </Button>
            {hasMoreHistory && (
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                disabled={isLoadingOlderHistory}
                onClick={loadOlderHistory}
                sx={{ textTransform: 'none' }}
              >
                {isLoadingOlderHistory ? 'Loading…' : 'Load Older Fixes'}
              </Button>
            )}
          </Box>
        )}

        {currentDisplayJourney?.status === 'in_progress' && (
          <Chip
            icon={<Radio size={14} className="animate-pulse" />}
            label="Live Real-Time Journey Tracking Active"
            color="success"
            size="small"
            sx={{ fontWeight: 600, mr: 1 }}
          />
        )}
      </Box>

      {/* TAB 1: INTERACTIVE MAP (Requirements 2, 3, 4, 5 & 10: Green START, Red END, Dotted Purple OSRM Road Path, Auto Fit Bounds) */}
      {viewTab === 'map' && (
        <>
          {isMultiRouteView && (
            <Accordion
              disableGutters
              elevation={0}
              sx={{
                border: '1px solid #e2e8f0',
                borderRadius: '8px !important',
                bgcolor: '#f8fafc',
                '&:before': { display: 'none' },
              }}
            >
              <AccordionSummary
                expandIcon={<ChevronDown size={18} />}
                sx={{
                  minHeight: 44,
                  '& .MuiAccordionSummary-content': { my: 0.75 },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Routes on map ({displayedRoutes.filter((route) => route.points.length > 0).length})
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Expand to view route labels and colors
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                <Box sx={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {displayedRoutes
                    .filter((journey) => journey.points.length > 0)
                    .map((journey) => (
                      <Chip
                        key={journey.id}
                        label={journey.label}
                        size="small"
                        sx={{
                          bgcolor: `${journey.color}14`,
                          color: journey.color,
                          border: `1px solid ${journey.color}55`,
                          '& .MuiChip-label': { fontWeight: 700 },
                        }}
                        icon={<Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: journey.color, ml: 1 }} />}
                      />
                    ))}
                </Box>
              </AccordionDetails>
            </Accordion>
          )}
          <Card elevation={0} sx={{ borderRadius: 2.5, border: '1px solid #cbd5e1', overflow: 'hidden' }}>
            <RouteTrackingMap
              trip={currentDisplayJourney}
              points={selectedJourneyPoints}
              routes={isMultiRouteView ? displayedRoutes : undefined}
              routeColor={selectedRouteColor}
              playbackPoint={playbackPoint}
              currentLocation={playbackPoint ? null : filteredLiveLocation}
              height={580}
              autoFitOnUpdate={true}
            />
          </Card>
        </>
      )}
      

      {/* TAB 2: OSRM ROUTE FINDER & ROAD PATH PLANNER */}
      {viewTab === 'planner' && (
        plannerPoints.length < 2 ? (
          <Alert severity="info">
            At least two GPS fixes in the selected time range are needed to plan a road route.
          </Alert>
        ) : (
          <>
            {isMultiRouteView && plannerRoute && (
              <Alert severity="info">
                Planning with {plannerRoute.label}. Select a single journey to choose a different route.
              </Alert>
            )}
            <Card elevation={0} sx={{ borderRadius: 2.5, border: '1px solid #cbd5e1', overflow: 'hidden' }}>
              <RouteMap
                key={`${plannerRoute?.id ?? currentDisplayJourney?.id ?? selectedDeviceId}-${plannerPoints[0]?.timestamp}-${plannerPoints[plannerPoints.length - 1]?.timestamp}`}
                initialFrom={`${plannerPoints[0].latitude.toFixed(5)}, ${plannerPoints[0].longitude.toFixed(5)}`}
                initialTo={`${plannerPoints[plannerPoints.length - 1].latitude.toFixed(5)}, ${plannerPoints[plannerPoints.length - 1].longitude.toFixed(5)}`}
                initialPoints={{
                  a: {
                    lat: plannerPoints[0].latitude,
                    lng: plannerPoints[0].longitude,
                  },
                  b: {
                    lat: plannerPoints[plannerPoints.length - 1].latitude,
                    lng: plannerPoints[plannerPoints.length - 1].longitude,
                  },
                }}
                height={580}
                autoLoadOnMount={false}
              />
            </Card>
          </>
        )
      )}

      {/* TAB 3: DETAILED TELEMETRY TABLE */}
      {viewTab === 'table' && (
        <Card elevation={0} sx={{ borderRadius: 2.5, border: '1px solid #e2e8f0' }}>
          <CardContent sx={{ p: 0, overflowX: 'auto' }}>
            <Table sx={{ minWidth: 800 }}>
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Trip / Route</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Recorded Time</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Latitude</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Longitude</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Speed</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Heading</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Battery</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Point Leg</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Cumulative Distance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tableDataWithDistance.map((pt, idx) => {
                  return (
                    <TableRow
                      key={`${pt.tripId}-${pt.timestamp}-${pt.latitude}-${pt.longitude}`}
                      hover
                      sx={{ bgcolor: pt.isTripStart ? '#f0fdf4' : pt.isTripEnd && pt.tripStatus === 'completed' ? '#fef2f2' : undefined }}
                    >
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          {pt.isTripStart ? (
                            <Chip label="START" size="small" color="success" sx={{ fontSize: 10, height: 20, fontWeight: 700 }} />
                          ) : pt.isTripEnd && pt.tripStatus === 'completed' ? (
                            <Chip label="END" size="small" color="error" sx={{ fontSize: 10, height: 20, fontWeight: 700 }} />
                          ) : (
                            <Typography variant="body2" color="text.secondary">{idx + 1}</Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 140 }}>
                          <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: pt.tripColor, flexShrink: 0 }} />
                          <Typography variant="caption" noWrap title={pt.tripLabel}>{pt.tripLabel}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>{pt.timestamp ? new Date(pt.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{pt.latitude.toFixed(6)}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{pt.longitude.toFixed(6)}</TableCell>
                      <TableCell>{pt.speed_kmh != null ? `${pt.speed_kmh} km/h` : '—'}</TableCell>
                      <TableCell>{pt.heading != null ? `${pt.heading}°` : '—'}</TableCell>
                      <TableCell>{pt.battery_pct != null ? `${pt.battery_pct}%` : '—'}</TableCell>
                      <TableCell sx={{ color: pt.legDistanceKm > 0 ? '#2563eb' : 'text.secondary' }}>
                        {pt.legDistanceKm >= 1 ? `${pt.legDistanceKm.toFixed(2)} km` : pt.legDistanceKm > 0 ? `${Math.round(pt.legDistanceKm * 1000)} m` : '—'}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700, color: '#1d4ed8' }}>
                        {pt.accumulatedDistanceKm >= 1
                          ? `${pt.accumulatedDistanceKm.toFixed(2)} km`
                          : `${Math.round(pt.accumulatedDistanceKm * 1000)} m`}
                      </TableCell>
                    </TableRow>
                  )
                })}

                {tableDataWithDistance.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        No recorded GPS telemetry points found for this journey.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {hasMoreHistory && (
              <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={isLoadingOlderHistory}
                  onClick={loadOlderHistory}
                  sx={{ textTransform: 'none' }}
                >
                  {isLoadingOlderHistory ? 'Loading Older History…' : 'Load Older GPS Telemetry Fixes'}
                </Button>
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </Stack>
  )
}

