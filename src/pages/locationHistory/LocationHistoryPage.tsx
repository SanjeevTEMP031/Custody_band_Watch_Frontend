import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
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
  Play,
  Square,
  Route,
  Table as TableIcon,
  RotateCw,
  Radio,
} from 'lucide-react'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { useRealtimeDevices } from '../../hooks/useRealtimeDevices'
import {
  listDevices,
  listLocationHistory,
  startJourney,
  endJourney,
  getActiveJourney,
  getDeviceJourneys,
  getJourney,
  getLatestGpsLocation,
  type Device,
  type Journey,
  type JourneyPoint,
} from '../../services/api'
import {
  startTrip,
  endTrip,
  addTripPoint,
  subscribeToDeviceTrips,
  fetchFirestoreLocationHistory,
  buildTripFromPoints,
  haversineDistanceKm,
  isValidGpsCoord,
  type TripRecord,
} from '../../lib/firebase'
import RouteTrackingMap from './RouteTrackingMap'
import TripSummaryCard from './TripSummaryCard'

/**
 * Normalizes backend Journey or Firestore TripRecord into a uniform TripRecord structure
 * so all components (Leaflet Map, Summary Card, Table) consume identical fields seamlessly.
 */
function normalizeToTripRecord(raw: any, deviceId: string, fallbackWearer?: string | null): TripRecord | null {
  if (!raw) return null

  const id = String(raw.journey_id ?? raw.id ?? `journey_${deviceId}_${Date.now()}`)
  const rawPoints = raw.route_points || raw.points || raw.locations || []

  const route_points: JourneyPoint[] = rawPoints.map((p: any) => {
    if (Array.isArray(p)) {
      return { latitude: Number(p[0]), longitude: Number(p[1]), timestamp: new Date().toISOString() }
    }
    return {
      latitude: Number(p.latitude ?? p.lat),
      longitude: Number(p.longitude ?? p.lng ?? p.lon),
      timestamp: p.timestamp ?? p.device_timestamp ?? p.recorded_at ?? new Date().toISOString(),
      speed_kmh: p.speed_kmh ?? p.speed ?? null,
      heading: p.heading ?? p.bearing ?? p.course ?? null,
      accuracy_m: p.accuracy_m ?? p.accuracy_meters ?? null,
      battery_pct: p.battery_pct ?? p.battery_level ?? p.battery ?? null,
    }
  }).filter((p: JourneyPoint) => isValidGpsCoord(p.latitude, p.longitude))

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

  const start_location = raw.start_location && isValidGpsCoord(raw.start_location.latitude, raw.start_location.longitude)
    ? {
        latitude: Number(raw.start_location.latitude),
        longitude: Number(raw.start_location.longitude),
        timestamp: raw.start_location.timestamp ?? raw.start_time,
      }
    : startPt
    ? {
        latitude: startPt.latitude,
        longitude: startPt.longitude,
        timestamp: startPt.timestamp,
      }
    : { latitude: 0, longitude: 0, timestamp: raw.start_time }

  const end_location = raw.end_location && isValidGpsCoord(raw.end_location.latitude, raw.end_location.longitude)
    ? {
        latitude: Number(raw.end_location.latitude),
        longitude: Number(raw.end_location.longitude),
        timestamp: raw.end_location.timestamp ?? raw.end_time,
      }
    : isCompleted && endPt
    ? {
        latitude: endPt.latitude,
        longitude: endPt.longitude,
        timestamp: endPt.timestamp,
      }
    : null

  const current_location = raw.current_location && isValidGpsCoord(raw.current_location.latitude, raw.current_location.longitude)
    ? {
        latitude: Number(raw.current_location.latitude),
        longitude: Number(raw.current_location.longitude),
        timestamp: raw.current_location.timestamp,
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
    wearer_name: raw.wearer_name ?? fallbackWearer ?? null,
    status: isCompleted ? 'completed' : 'in_progress',
    start_time: raw.start_time ?? (startPt ? startPt.timestamp : new Date().toISOString()),
    end_time: raw.end_time ?? (isCompleted ? endPt?.timestamp ?? null : null),
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

function LocationHistoryPage() {
  const [params, setParams] = useSearchParams()
  const initialDeviceParam = params.get('device') ?? ''

  // Devices: real-time Firestore + REST API fallback
  const { devices: realtimeDevices } = useRealtimeDevices()
  const loadApiDevices = useCallback(() => listDevices(0, 500), [])
  const { data: apiDevices, loading: apiLoading, error: devicesError } = useApiData(loadApiDevices)

  const devices: Device[] = useMemo(() => {
    if (realtimeDevices.length > 0) return realtimeDevices
    return apiDevices ?? []
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
  const [loadingJourneys, setLoadingJourneys] = useState<boolean>(false)
  const [isSubmittingJourney, setIsSubmittingJourney] = useState<boolean>(false)
  const [journeyNotice, setJourneyNotice] = useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null)
  const [viewTab, setViewTab] = useState<'map' | 'table'>('map')

  // 1. Fetch from backend journeys APIs (GET /api/v1/journeys/active/{id} & GET /api/v1/journeys/device/{id})
  const refreshBackendJourneys = useCallback(async () => {
    if (!selectedDeviceId) return
    setLoadingJourneys(true)

    const wearer = selectedDevice?.device_name ?? (selectedDevice as any)?.wearer_name

    try {
      // A. Check for currently active journey from backend
      // Endpoint: GET /api/v1/journeys/active/{device_id}
      const activeRes = await getActiveJourney(selectedDeviceId)
      if (activeRes) {
        const normalized = normalizeToTripRecord(activeRes, selectedDeviceId, wearer)
        setActiveBackendJourney(normalized)
      } else {
        setActiveBackendJourney(null)
      }

      // B. Fetch Journey History from backend
      // Endpoint: GET /api/v1/journeys/device/{device_id}
      const historyRes = await getDeviceJourneys(selectedDeviceId)
      if (Array.isArray(historyRes) && historyRes.length > 0) {
        const normalizedList = historyRes
          .map((j) => normalizeToTripRecord(j, selectedDeviceId, wearer))
          .filter((j): j is TripRecord => j !== null)
        setBackendJourneys(normalizedList)
      } else {
        setBackendJourneys([])
      }
    } catch (err) {
      console.warn('Backend journeys API returned error, relying on real-time Firestore sync:', err)
    } finally {
      setLoadingJourneys(false)
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

  // 3. Fallback raw location history points
  const refreshRawTelemetry = useCallback(async () => {
    if (!selectedDeviceId) return
    try {
      const fsPoints = await fetchFirestoreLocationHistory(selectedDeviceId, 500)
      if (fsPoints.length > 0) {
        setRawHistoryPoints(fsPoints)
        return
      }

      const apiLocs = await listLocationHistory(selectedDeviceId, 500)
      const mapped: JourneyPoint[] = (apiLocs || [])
        .filter((l) => isValidGpsCoord(l.latitude, l.longitude))
        .map((l) => ({
          latitude: Number(l.latitude),
          longitude: Number(l.longitude),
          timestamp: l.recorded_at,
          speed_kmh: l.speed_kmh,
          heading: l.heading,
          accuracy_m: l.accuracy_m,
          battery_pct: l.battery_pct,
        }))
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

      setRawHistoryPoints(mapped)
    } catch {
      // Continue
    }
  }, [selectedDeviceId])

  useEffect(() => {
    refreshRawTelemetry()
  }, [refreshRawTelemetry])

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
    list.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
    return list
  }, [backendJourneys, firestoreTrips])

  // Active in-progress journey
  const activeJourney = useMemo(() => {
    return (
      activeBackendJourney ??
      combinedJourneys.find((j) => j.status === 'in_progress') ??
      null
    )
  }, [activeBackendJourney, combinedJourneys])

  // Synthesized journey from raw telemetry points
  const rawTelemetryJourney = useMemo(() => {
    return buildTripFromPoints(
      selectedDeviceId,
      rawHistoryPoints,
      selectedDevice?.device_name ?? (selectedDevice as any)?.wearer_name
    )
  }, [selectedDeviceId, rawHistoryPoints, selectedDevice])

  // Current display journey based on user's Journey History selection
  const [specificSelectedJourney, setSpecificSelectedJourney] = useState<TripRecord | null>(null)

  // When selectedJourneyId changes, load specific journey if needed
  useEffect(() => {
    if (selectedJourneyId === 'active_or_latest' || selectedJourneyId === 'raw_telemetry') {
      setSpecificSelectedJourney(null)
      return
    }

    // Try finding in combined list
    const found = combinedJourneys.find((j) => j.id === selectedJourneyId)
    if (found && found.route_points && found.route_points.length > 0) {
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
  }, [selectedJourneyId, combinedJourneys, selectedDeviceId, selectedDevice])

  const currentDisplayJourney: TripRecord | null = useMemo(() => {
    if (selectedJourneyId === 'raw_telemetry') {
      return rawTelemetryJourney
    }
    if (selectedJourneyId === 'active_or_latest') {
      return activeJourney ?? (combinedJourneys.length > 0 ? combinedJourneys[0] : rawTelemetryJourney)
    }
    return specificSelectedJourney ?? activeJourney ?? (combinedJourneys.length > 0 ? combinedJourneys[0] : rawTelemetryJourney)
  }, [selectedJourneyId, specificSelectedJourney, activeJourney, combinedJourneys, rawTelemetryJourney])

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
  const isFetchingGpsRef = useRef(false)
  const activeJourneyRef = useRef<TripRecord | null>(null)
  activeJourneyRef.current = activeJourney

  // Sync baseline live location from selected device if available
  useEffect(() => {
    if (!selectedDevice) {
      setLiveLocation(null)
      setLastGpsUpdateTime(null)
      return
    }
    const lat = selectedDevice.last_latitude ?? (selectedDevice as any).latitude
    const lon = selectedDevice.last_longitude ?? (selectedDevice as any).longitude
    if (isValidGpsCoord(lat, lon)) {
      setLiveLocation((prev) => {
        if (prev) return prev
        return {
          latitude: Number(lat),
          longitude: Number(lon),
          speed_kmh: (selectedDevice as any).speed_kmh ?? null,
          heading: (selectedDevice as any).heading ?? null,
          battery_pct: selectedDevice.battery_pct ?? (selectedDevice as any).battery_percent ?? null,
          timestamp: selectedDevice.last_seen ?? new Date().toISOString(),
          gps_fix: true,
        }
      })
      if (selectedDevice.last_seen) {
        setLastGpsUpdateTime(new Date(selectedDevice.last_seen))
      }
    } else {
      setLiveLocation(null)
      setLastGpsUpdateTime(null)
    }
  }, [selectedDevice])

  // Real-Time GPS Polling: 5-second interval for selected device (Requirement 2)
  useEffect(() => {
    if (!selectedDeviceId) return

    let isCancelled = false
    const pollDeviceId = selectedDeviceId

    const pollLatestGps = async () => {
      // Prevent overlapping API requests
      if (isFetchingGpsRef.current) return
      isFetchingGpsRef.current = true

      try {
        // Backend endpoint: GET /api/v1/gps/{device_id}/latest
        const gps = await getLatestGpsLocation(pollDeviceId)
        if (isCancelled || pollDeviceId !== selectedDeviceId) return

        if (gps && isValidGpsCoord(gps.latitude, gps.longitude)) {
          // Do not reject valid coordinates just because satellite count is zero
          const recordedIso = gps.recorded_at || new Date().toISOString()
          const newPoint: JourneyPoint = {
            latitude: gps.latitude,
            longitude: gps.longitude,
            timestamp: recordedIso,
            speed_kmh: gps.speed_kmh,
            heading: gps.heading,
            battery_pct: gps.battery_pct,
          }

          setLiveLocation({
            latitude: gps.latitude,
            longitude: gps.longitude,
            speed_kmh: gps.speed_kmh,
            heading: gps.heading,
            battery_pct: gps.battery_pct,
            timestamp: recordedIso,
            satellites: gps.satellites,
            gps_fix: gps.gps_fix,
          })
          setLastGpsUpdateTime(new Date(recordedIso))

          // Append new GPS points to the currently active journey ONLY
          const currentActive = activeJourneyRef.current
          if (
            currentActive &&
            currentActive.status === 'in_progress' &&
            String(currentActive.device_id) === String(pollDeviceId)
          ) {
            const existingPoints = currentActive.route_points || []
            let isDuplicate = false

            if (existingPoints.length > 0) {
              const lastPoint = existingPoints[existingPoints.length - 1]
              // Check distance: avoid duplicate GPS points (< 3m micro-jitter considered stationary)
              const distFromLast = haversineDistanceKm(
                lastPoint.latitude,
                lastPoint.longitude,
                newPoint.latitude,
                newPoint.longitude
              )
              if (distFromLast < 0.003) {
                isDuplicate = true
              }
              // Avoid duplicate identical timestamp coordinates
              if (
                lastPoint.latitude === newPoint.latitude &&
                lastPoint.longitude === newPoint.longitude &&
                lastPoint.timestamp === newPoint.timestamp
              ) {
                isDuplicate = true
              }
            }

            if (!isDuplicate) {
              try {
                const updated = await addTripPoint(currentActive.id, newPoint, currentActive)
                if (activeBackendJourney && activeBackendJourney.id === updated.id) {
                  setActiveBackendJourney(updated)
                }
              } catch (addErr) {
                console.warn('[GPS Polling] Error adding GPS point to trip:', addErr)
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[GPS Polling] Error fetching GPS for device ${pollDeviceId}:`, err)
      } finally {
        isFetchingGpsRef.current = false
      }
    }

    // Start polling immediately when device is selected
    pollLatestGps()

    // 5-second interval
    const intervalId = window.setInterval(pollLatestGps, 5000)

    // Stop polling when component unmounts or selected device changes
    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
      isFetchingGpsRef.current = false
    }
  }, [selectedDeviceId])

  // Staleness check (> 5 minutes without update)
  const isGpsStale = useMemo(() => {
    if (!lastGpsUpdateTime) return false
    return Date.now() - lastGpsUpdateTime.getTime() > 300000
  }, [lastGpsUpdateTime, liveLocation])

  // GPS Fix status
  const hasGpsFix = useMemo(() => {
    if (!liveLocation) return false
    return isValidGpsCoord(liveLocation.latitude, liveLocation.longitude) && liveLocation.gps_fix !== false
  }, [liveLocation])

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
        console.warn('Backend POST /journeys/start failed, persisting through Firestore:', apiErr)
      }

      // 2. Real-time Firestore persistence
      const fsTrip = await startTrip(
        String(selectedDevice.id),
        wearer,
        hasCoords ? Number(lat) : null,
        hasCoords ? Number(lon) : null
      )

      const activeRecord = startedFromBackend
        ? normalizeToTripRecord(startedFromBackend, String(selectedDevice.id), wearer) ?? fsTrip
        : fsTrip

      setActiveBackendJourney(activeRecord)
      setSelectedJourneyId(activeRecord.id)

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
      // 1. Call backend API: POST /api/v1/journeys/end
      try {
        await endJourney({
          journey_id: activeJourney.id,
          device_id: selectedDevice?.id,
          end_latitude: isValidGpsCoord(lat, lon) ? Number(lat) : null,
          end_longitude: isValidGpsCoord(lat, lon) ? Number(lon) : null,
          timestamp: new Date().toISOString(),
        })
      } catch (apiErr) {
        console.warn('Backend POST /journeys/end failed, closing in Firestore:', apiErr)
      }

      // 2. Close in Firestore
      await endTrip(
        activeJourney.id,
        String(activeJourney.device_id),
        isValidGpsCoord(lat, lon) ? Number(lat) : null,
        isValidGpsCoord(lat, lon) ? Number(lon) : null
      )

      setActiveBackendJourney(null)
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

  // Table calculations
  const tableDataWithDistance = useMemo(() => {
    const pts = currentDisplayJourney?.route_points || rawHistoryPoints
    let runningDist = 0

    return pts.map((pt, idx) => {
      if (idx > 0) {
        const prev = pts[idx - 1]
        const leg = haversineDistanceKm(prev.latitude, prev.longitude, pt.latitude, pt.longitude)
        runningDist += leg
      }
      return {
        ...pt,
        accumulatedDistanceKm: runningDist,
      }
    })
  }, [currentDisplayJourney?.route_points, rawHistoryPoints])

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
            <MenuItem value="active_or_latest">
              {activeJourney ? 'Active Journey in Progress' : 'Latest Completed Journey'}
            </MenuItem>
            {combinedJourneys
              .filter((j) => j.id !== activeJourney?.id)
              .map((journey) => {
                const dateStr = new Date(journey.start_time).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
                return (
                  <MenuItem key={journey.id} value={journey.id}>
                    Journey: {dateStr} ({journey.total_distance_km.toFixed(1)} km)
                  </MenuItem>
                )
              })}
            <MenuItem value="raw_telemetry">
              📍 All Recorded Telemetry ({rawHistoryPoints.length} points)
            </MenuItem>
          </TextField>

          {/* Start Journey / End Journey Buttons (Requirement 1) */}
          {activeJourney ? (
            <Button
              variant="contained"
              color="error"
              size="medium"
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
              refreshBackendJourneys()
              refreshRawTelemetry()
            }}
            disabled={loadingJourneys}
            sx={{ textTransform: 'none' }}
          >
            Refresh
          </Button>
        </Box>
      </Box>

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

      {/* JOURNEY SUMMARY CARD (Requirements 6 & 7: Distance in KM, Start Time, End Time, Duration) */}
      <TripSummaryCard
        trip={currentDisplayJourney}
        currentLocation={liveLocation}
        currentSpeed={liveLocation?.speed_kmh}
        currentHeading={liveLocation?.heading}
        batteryPct={liveLocation?.battery_pct ?? selectedDevice?.battery_pct}
        latestGpsTime={lastGpsUpdateTime}
        isGpsStale={isGpsStale}
        hasGpsFix={hasGpsFix}
      />

      {/* View Switcher: Interactive Journey Map vs Points Table */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            value="table"
            label={`GPS Points Log (${tableDataWithDistance.length})`}
            icon={<TableIcon size={18} />}
            iconPosition="start"
          />
        </Tabs>

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

      {/* TAB 1: INTERACTIVE MAP (Requirements 2, 3, 4, 5 & 10: Green START, Red END, Thick Polyline, Auto Fit Bounds) */}
      {viewTab === 'map' && (
        <Card elevation={0} sx={{ borderRadius: 2.5, border: '1px solid #cbd5e1', overflow: 'hidden' }}>
          <RouteTrackingMap
            trip={currentDisplayJourney}
            points={currentDisplayJourney?.route_points || rawHistoryPoints}
            currentLocation={liveLocation}
            height={580}
            autoFitOnUpdate={true}
          />
        </Card>
      )}

      {/* TAB 2: DETAILED TELEMETRY TABLE */}
      {viewTab === 'table' && (
        <Card elevation={0} sx={{ borderRadius: 2.5, border: '1px solid #e2e8f0' }}>
          <CardContent sx={{ p: 0, overflowX: 'auto' }}>
            <Table sx={{ minWidth: 800 }}>
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
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
                  const isStart = idx === 0
                  const isEnd = idx === tableDataWithDistance.length - 1 && currentDisplayJourney?.status === 'completed'
                  const prev = idx > 0 ? tableDataWithDistance[idx - 1] : null
                  const legDist = prev ? haversineDistanceKm(prev.latitude, prev.longitude, pt.latitude, pt.longitude) : 0

                  return (
                    <TableRow key={idx} hover sx={{ bgcolor: isStart ? '#f0fdf4' : isEnd ? '#fef2f2' : undefined }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          {isStart ? (
                            <Chip label="START" size="small" color="success" sx={{ fontSize: 10, height: 20, fontWeight: 700 }} />
                          ) : isEnd ? (
                            <Chip label="END" size="small" color="error" sx={{ fontSize: 10, height: 20, fontWeight: 700 }} />
                          ) : (
                            <Typography variant="body2" color="text.secondary">{idx + 1}</Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>{pt.timestamp ? new Date(pt.timestamp).toLocaleString() : '—'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{pt.latitude.toFixed(6)}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{pt.longitude.toFixed(6)}</TableCell>
                      <TableCell>{pt.speed_kmh != null ? `${pt.speed_kmh} km/h` : '—'}</TableCell>
                      <TableCell>{pt.heading != null ? `${pt.heading}°` : '—'}</TableCell>
                      <TableCell>{pt.battery_pct != null ? `${pt.battery_pct}%` : '—'}</TableCell>
                      <TableCell sx={{ color: legDist > 0 ? '#2563eb' : 'text.secondary' }}>
                        {legDist >= 1 ? `${legDist.toFixed(2)} km` : legDist > 0 ? `${Math.round(legDist * 1000)} m` : '—'}
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
                    <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        No recorded GPS telemetry points found for this journey.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </Stack>
  )
}

export default LocationHistoryPage
