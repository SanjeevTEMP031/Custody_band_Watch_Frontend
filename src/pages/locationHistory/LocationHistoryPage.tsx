import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { listDevices, listLocationHistory, type Device } from '../../services/api'
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
  type TripPoint,
} from '../../lib/firebase'
import RouteTrackingMap from './RouteTrackingMap'
import TripSummaryCard from './TripSummaryCard'

function LocationHistoryPage() {
  const [params, setParams] = useSearchParams()
  const initialDeviceParam = params.get('device') ?? ''

  // Real-time devices from Firestore
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

  // Keep selectedDeviceId synced if not yet chosen
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

  // --- TRIP STATE ---
  const [deviceTrips, setDeviceTrips] = useState<TripRecord[]>([])
  const [selectedTripId, setSelectedTripId] = useState<string>('active_or_latest')
  const [rawHistoryPoints, setRawHistoryPoints] = useState<TripPoint[]>([])
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false)
  const [isSubmittingTrip, setIsSubmittingTrip] = useState<boolean>(false)
  const [tripActionNotice, setTripActionNotice] = useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null)
  const [viewTab, setViewTab] = useState<'map' | 'table'>('map')

  // Subscribe to real-time trips for selected device
  useEffect(() => {
    if (!selectedDeviceId) return

    const unsubscribe = subscribeToDeviceTrips(
      selectedDeviceId,
      (trips) => {
        setDeviceTrips(trips)
      },
      (err) => {
        console.error('Error subscribing to trips:', err)
      }
    )

    return () => {
      unsubscribe()
    }
  }, [selectedDeviceId])

  // Fetch raw history points when selected device changes
  const refreshRawHistory = useCallback(async () => {
    if (!selectedDeviceId) return
    setLoadingHistory(true)
    try {
      // 1. Fetch from Firestore history / locations
      const fsPoints = await fetchFirestoreLocationHistory(selectedDeviceId, 500)
      if (fsPoints.length > 0) {
        setRawHistoryPoints(fsPoints)
        setLoadingHistory(false)
        return
      }

      // 2. Fallback to REST API
      const apiLocs = await listLocationHistory(selectedDeviceId, 500)
      const mapped: TripPoint[] = (apiLocs || [])
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
    } catch (err) {
      console.warn('Error fetching location history:', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [selectedDeviceId])

  useEffect(() => {
    refreshRawHistory()
  }, [refreshRawHistory])

  // Active in-progress trip (if any)
  const activeTrip = useMemo(() => {
    return deviceTrips.find((t) => t.status === 'in_progress') ?? null
  }, [deviceTrips])

  // Synthesized trip from raw history points
  const rawHistoryTrip = useMemo(() => {
    return buildTripFromPoints(
      selectedDeviceId,
      rawHistoryPoints,
      selectedDevice?.device_name ?? (selectedDevice as any)?.wearer_name
    )
  }, [selectedDeviceId, rawHistoryPoints, selectedDevice])

  // Determine current active display trip
  const currentDisplayTrip: TripRecord | null = useMemo(() => {
    if (selectedTripId === 'raw_telemetry') {
      return rawHistoryTrip
    }
    if (selectedTripId === 'active_or_latest') {
      return activeTrip ?? (deviceTrips.length > 0 ? deviceTrips[0] : rawHistoryTrip)
    }
    const matched = deviceTrips.find((t) => t.id === selectedTripId)
    return matched ?? activeTrip ?? (deviceTrips.length > 0 ? deviceTrips[0] : rawHistoryTrip)
  }, [selectedTripId, activeTrip, deviceTrips, rawHistoryTrip])

  // Live Location of selected device
  const liveLocation = useMemo(() => {
    if (!selectedDevice) return null
    const lat = selectedDevice.last_latitude ?? (selectedDevice as any).latitude
    const lon = selectedDevice.last_longitude ?? (selectedDevice as any).longitude
    if (!isValidGpsCoord(lat, lon)) return null

    return {
      latitude: Number(lat),
      longitude: Number(lon),
      speed_kmh: (selectedDevice as any).speed_kmh ?? null,
      heading: (selectedDevice as any).heading ?? null,
      timestamp: selectedDevice.last_seen ?? new Date().toISOString(),
    }
  }, [selectedDevice])

  // Auto-record live points if a trip is currently in progress
  useEffect(() => {
    if (!activeTrip || !liveLocation) return
    const route = activeTrip.route_points || []
    const lastPoint = route[route.length - 1]

    if (
      !lastPoint ||
      lastPoint.latitude !== liveLocation.latitude ||
      lastPoint.longitude !== liveLocation.longitude
    ) {
      addTripPoint(
        activeTrip.id,
        {
          latitude: liveLocation.latitude,
          longitude: liveLocation.longitude,
          timestamp: liveLocation.timestamp,
          speed_kmh: liveLocation.speed_kmh,
          heading: liveLocation.heading,
        },
        activeTrip
      ).catch((err) => {
        console.error('Failed auto-recording trip point:', err)
      })
    }
  }, [activeTrip?.id, liveLocation?.latitude, liveLocation?.longitude, liveLocation?.timestamp])

  // --- ACTIONS: START TRIP ---
  const handleStartTrip = async () => {
    if (!selectedDevice) return
    setIsSubmittingTrip(true)
    setTripActionNotice(null)

    try {
      const lat = selectedDevice.last_latitude ?? (selectedDevice as any).latitude
      const lon = selectedDevice.last_longitude ?? (selectedDevice as any).longitude
      const hasCoords = isValidGpsCoord(lat, lon)

      const wearer = (selectedDevice as any)?.wearer_name ?? selectedDevice.device_name ?? `Device ${selectedDevice.id}`
      const created = await startTrip(
        String(selectedDevice.id),
        wearer,
        hasCoords ? Number(lat) : null,
        hasCoords ? Number(lon) : null
      )

      setSelectedTripId(created.id)
      setTripActionNotice({
        message: hasCoords
          ? `Journey tracking started! Green START marker recorded at [${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}].`
          : 'Journey tracking started! Awaiting first valid GPS lock from device.',
        severity: 'success',
      })
    } catch (err) {
      console.error('Error starting trip:', err)
      setTripActionNotice({
        message: err instanceof Error ? err.message : 'Failed to start trip in Firestore.',
        severity: 'error',
      })
    } finally {
      setIsSubmittingTrip(false)
    }
  }

  // --- ACTIONS: END TRIP ---
  const handleEndTrip = async () => {
    if (!activeTrip) return
    setIsSubmittingTrip(true)
    setTripActionNotice(null)

    try {
      const lat = selectedDevice?.last_latitude ?? (selectedDevice as any)?.latitude
      const lon = selectedDevice?.last_longitude ?? (selectedDevice as any)?.longitude

      await endTrip(
        activeTrip.id,
        String(activeTrip.device_id),
        isValidGpsCoord(lat, lon) ? Number(lat) : null,
        isValidGpsCoord(lat, lon) ? Number(lon) : null
      )

      setTripActionNotice({
        message: `Journey completed! Red END marker recorded. Total travelled distance saved.`,
        severity: 'success',
      })
    } catch (err) {
      console.error('Error ending trip:', err)
      setTripActionNotice({
        message: err instanceof Error ? err.message : 'Failed to end trip.',
        severity: 'error',
      })
    } finally {
      setIsSubmittingTrip(false)
    }
  }

  // Calculate incremental distances for table display
  const tableDataWithDistance = useMemo(() => {
    const pts = currentDisplayTrip?.route_points || rawHistoryPoints
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
  }, [currentDisplayTrip?.route_points, rawHistoryPoints])

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
              Travel Distance & Route Playback
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Real-time GPS route highlighting, point-by-point Haversine distance, and trip history
          </Typography>
        </Box>

        {/* Device & Trip Controls */}
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
              setSelectedTripId('active_or_latest')
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

          {/* Trip Selector */}
          <TextField
            select
            size="small"
            label="Journey Selection"
            value={selectedTripId}
            onChange={(event) => setSelectedTripId(event.target.value)}
            sx={{ minWidth: 260, bgcolor: 'background.paper', borderRadius: 1 }}
            disabled={!selectedDeviceId}
          >
            {activeTrip && (
              <MenuItem value={activeTrip.id} sx={{ fontWeight: 700, color: '#16a34a' }}>
                🟢 Active Journey (In Progress)
              </MenuItem>
            )}
            <MenuItem value="active_or_latest">
              {activeTrip ? 'Current In-Progress Trip' : 'Latest Recorded Trip'}
            </MenuItem>
            {deviceTrips
              .filter((t) => t.id !== activeTrip?.id)
              .map((trip) => {
                const dateStr = new Date(trip.start_time).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
                return (
                  <MenuItem key={trip.id} value={trip.id}>
                    Trip: {dateStr} ({trip.total_distance_km.toFixed(1)} km)
                  </MenuItem>
                )
              })}
            <MenuItem value="raw_telemetry">
              📍 All Recorded Telemetry ({rawHistoryPoints.length} points)
            </MenuItem>
          </TextField>

          {/* Start / End Trip Buttons */}
          {activeTrip ? (
            <Button
              variant="contained"
              color="error"
              size="medium"
              startIcon={isSubmittingTrip ? <CircularProgress size={16} color="inherit" /> : <Square size={16} />}
              onClick={handleEndTrip}
              disabled={isSubmittingTrip}
              sx={{ fontWeight: 700, textTransform: 'none', px: 2.5 }}
            >
              End Active Trip
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              size="medium"
              startIcon={isSubmittingTrip ? <CircularProgress size={16} color="inherit" /> : <Play size={16} />}
              onClick={handleStartTrip}
              disabled={isSubmittingTrip || !selectedDeviceId}
              sx={{ fontWeight: 700, textTransform: 'none', px: 2.5 }}
            >
              Start New Trip
            </Button>
          )}

          <Button
            variant="outlined"
            size="medium"
            startIcon={<RotateCw size={16} />}
            onClick={() => refreshRawHistory()}
            disabled={loadingHistory}
            sx={{ textTransform: 'none' }}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Notifications / Alerts */}
      {tripActionNotice && (
        <Alert
          severity={tripActionNotice.severity}
          onClose={() => setTripActionNotice(null)}
          sx={{ borderRadius: 2 }}
        >
          {tripActionNotice.message}
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

      {/* TRIP SUMMARY CARD */}
      <TripSummaryCard
        trip={currentDisplayTrip}
        currentSpeed={liveLocation?.speed_kmh}
      />

      {/* View Switcher: Route Map vs Raw Table */}
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

        {currentDisplayTrip?.status === 'in_progress' && (
          <Chip
            icon={<Radio size={14} className="animate-pulse" />}
            label="Live Real-Time Journey Tracking Active"
            color="success"
            size="small"
            sx={{ fontWeight: 600, mr: 1 }}
          />
        )}
      </Box>

      {/* TAB 1: INTERACTIVE MAP */}
      {viewTab === 'map' && (
        <Card elevation={0} sx={{ borderRadius: 2.5, border: '1px solid #cbd5e1', overflow: 'hidden' }}>
          <RouteTrackingMap
            trip={currentDisplayTrip}
            points={currentDisplayTrip?.route_points || rawHistoryPoints}
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
                  <TableCell sx={{ fontWeight: 700 }}>Point Leg</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Cumulative Distance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tableDataWithDistance.map((pt, idx) => {
                  const isStart = idx === 0
                  const isEnd = idx === tableDataWithDistance.length - 1 && currentDisplayTrip?.status === 'completed'
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
                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        No recorded GPS telemetry points found for this trip.
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
