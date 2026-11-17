/// <reference types="google.maps" />
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Typography } from '@mui/material'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import type { Device, GpsLocation } from '../../services/api'
import {
  isFreshGpsTimestamp,
  normalizeVerifiedGpsFix,
  selectNewestLastReportedGpsLocation,
  type LastReportedGpsLocation,
} from '../../services/gpsNormalization'
import {
  useSelectedGpsRoute,
  type SelectedGpsRouteSegment,
  type SelectedGpsRouteStatus,
} from '../dashboard/useSelectedGpsRoute'
import OpenStreetMapView, { type OpenStreetMapStyle } from './OpenStreetMapView'

const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
if (mapsKey) setOptions({ key: mapsKey, v: 'weekly' })

type MovementPoint = { lat: number; lng: number }
type VerifiedMovementPoint = MovementPoint & { recordedAt: string; source: string }
type MovementSegment = MovementPoint[]

export default function MonitoringMap({ devices, selectedId, showNames, aggregate, provider, mapStyle }: { devices: Device[]; selectedId: number | string | null; showNames: boolean; aggregate: boolean; provider: string; mapStyle: OpenStreetMapStyle }) {
  const container = useRef<HTMLDivElement>(null)
  const googleMap = useRef<google.maps.Map | null>(null)
  const googleMarkers = useRef<google.maps.Marker[]>([])
  const googleMarkerConstructor = useRef<typeof google.maps.Marker | null>(null)
  const movementLines = useRef<google.maps.Polyline[]>([])
  const movementDots = useRef<google.maps.Marker[]>([])
  const lastCenteredSelectionRef = useRef<string | null>(null)
  const selectedGpsTimestampRef = useRef<{ deviceKey: string; timestamp: number } | null>(null)
  const [error, setError] = useState('')
  const [mapVersion, setMapVersion] = useState(0)
  const [movementTrail, setMovementTrail] = useState<{ deviceKey: string | null; segments: MovementSegment[] }>({ deviceKey: null, segments: [] })
  const [selectedGpsPosition, setSelectedGpsPosition] = useState<{ deviceKey: string | null; position: VerifiedMovementPoint | null }>({ deviceKey: null, position: null })
  const [selectedLastReported, setSelectedLastReported] = useState<{
    deviceKey: string | null
    location: LastReportedGpsLocation | null
    currentGpsAvailable: boolean
  }>({ deviceKey: null, location: null, currentGpsAvailable: false })
  const [gpsRouteStatus, setGpsRouteStatus] = useState<SelectedGpsRouteStatus>('loading')
  const selectedKey = selectedId == null ? null : String(selectedId)
  const selectedDevice = devices.find(device =>
    String(device.id) === selectedKey || String(device.device_id) === selectedKey,
  )
  const trackingDeviceId = selectedDevice
    ? String(selectedDevice.device_id || selectedDevice.imei || selectedDevice.serial_number || selectedDevice.id)
    : null
  const firestoreLatest = useMemo<GpsLocation | null>(() => {
    if (!selectedDevice) return null
    const fix = normalizeVerifiedGpsFix(selectedDevice)
    if (!fix) return null
    return {
      device_id: trackingDeviceId ?? undefined,
      latitude: fix.latitude,
      longitude: fix.longitude,
      recorded_at: fix.recordedAt,
      gps_fix: true,
      gps_valid: true,
      gps_source: fix.source,
      gps_status: fix.status,
      status: fix.status,
    }
  }, [selectedDevice, trackingDeviceId])
  const movementSegments = useMemo(
    () => movementTrail.deviceKey === selectedKey ? movementTrail.segments : [],
    [movementTrail, selectedKey],
  )
  const handleVerifiedGpsPoint = useCallback((point: GpsLocation) => {
    if (selectedKey == null) return
    const fix = normalizeVerifiedGpsFix(point)
    if (!fix) return
    const previous = selectedGpsTimestampRef.current
    if (previous?.deviceKey === selectedKey && fix.timestamp <= previous.timestamp) return
    selectedGpsTimestampRef.current = { deviceKey: selectedKey, timestamp: fix.timestamp }
    setSelectedGpsPosition({
      deviceKey: selectedKey,
      position: {
        lat: fix.latitude,
        lng: fix.longitude,
        recordedAt: fix.recordedAt,
        source: fix.source,
      },
    })
  }, [selectedKey])
  const handleRouteChange = useCallback((segments: SelectedGpsRouteSegment[]) => {
    setMovementTrail({
      deviceKey: selectedKey,
      segments: segments.map(segment => segment.map(point => ({ lat: point.latitude, lng: point.longitude }))),
    })
  }, [selectedKey])
  const handleLastReportedLocation = useCallback((
    location: LastReportedGpsLocation | null,
    currentGpsAvailable: boolean
  ) => {
    setSelectedLastReported((current) => ({
      deviceKey: selectedKey,
      location: location ?? (current.deviceKey === selectedKey ? current.location : null),
      currentGpsAvailable,
    }))
  }, [selectedKey])
  useSelectedGpsRoute(
    null,
    trackingDeviceId,
    true,
    handleVerifiedGpsPoint,
    handleRouteChange,
    setGpsRouteStatus,
    true,
    firestoreLatest,
    selectedDevice?.gps_last_fix,
    handleVerifiedGpsPoint,
    handleLastReportedLocation,
    false
  )
  const selectedReportedLocation = selectedLastReported.deviceKey === selectedKey
    ? selectedLastReported.currentGpsAvailable
      ? null
      : selectedLastReported.location
    : selectedDevice
      ? selectNewestLastReportedGpsLocation([
          selectedDevice.gps_last_fix,
          selectedDevice.gps_last_known_location,
        ])
      : null
  const displayDevices = useMemo(() => devices.map(device => {
    const position = selectedGpsPosition.deviceKey === selectedKey
      ? selectedGpsPosition.position
      : null
    const isSelectedDevice = String(device.id) === selectedKey || String(device.device_id) === selectedKey
    const reportedLocation = isSelectedDevice && selectedLastReported.deviceKey === selectedKey
      ? selectedLastReported.currentGpsAvailable
        ? null
        : selectedLastReported.location
      : null
    const withReportedLocation = reportedLocation
      ? {
          ...device,
          gps_last_fix: {
            latitude: reportedLocation.latitude,
            longitude: reportedLocation.longitude,
            timestamp: reportedLocation.recordedAt,
            gps_status: reportedLocation.gpsStatus,
            source: reportedLocation.source,
            verified: false,
            is_stale: reportedLocation.isStale,
          },
          gps_last_known_location: null,
        }
      : selectedLastReported.deviceKey === selectedKey && selectedLastReported.currentGpsAvailable
        ? { ...device, gps_last_fix: null, gps_last_known_location: null }
        : device
    if (!position || !isSelectedDevice) return withReportedLocation
    return {
      ...withReportedLocation,
      last_latitude: position.lat,
      last_longitude: position.lng,
      gps_update_time: position.recordedAt,
      gps_fix_source: position.source,
      has_gps_fix: true,
      gps_fix: true,
    }
  }), [devices, selectedGpsPosition, selectedKey, selectedLastReported])
  const located = useMemo(() => displayDevices.filter(device => {
    const fix = normalizeVerifiedGpsFix(device)
    return fix !== null
  }), [displayDevices])
  const selectedLocatedDevice = located.find(d =>
    String(d.id) === selectedKey || String(d.device_id) === selectedKey,
  )
  const selectedFix = selectedLocatedDevice
    ? normalizeVerifiedGpsFix(selectedLocatedDevice)
    : null
  const selectedIsLastKnown = Boolean(
    (selectedFix && !isFreshGpsTimestamp(selectedFix.timestamp)) ||
    selectedReportedLocation
  )
  const lastReportedDevices = useMemo(() => displayDevices.flatMap(device => {
    const location = selectNewestLastReportedGpsLocation([
      device.gps_last_fix,
      device.gps_last_known_location,
    ])
    if (!location) return []
    const fix = normalizeVerifiedGpsFix(device)
    if (fix && isFreshGpsTimestamp(fix.timestamp)) return []
    if (fix && fix.latitude === location.latitude && fix.longitude === location.longitude) return []
    return [{ device, location }]
  }), [displayDevices])
  const focus = located.find(d => String(d.id) === selectedKey || String(d.device_id) === selectedKey) ??
    lastReportedDevices.find(({ device }) =>
      String(device.id) === selectedKey || String(device.device_id) === selectedKey
    )?.device ??
    located[0] ??
    lastReportedDevices[0]?.device
  const focusFix = focus ? normalizeVerifiedGpsFix(focus) : null
  const focusReportedLocation = focus
    ? selectNewestLastReportedGpsLocation([focus.gps_last_fix, focus.gps_last_known_location])
    : null
  const focusIsLastKnown = Boolean(
    (focusFix && !isFreshGpsTimestamp(focusFix.timestamp)) || focusReportedLocation
  )
  const hasCoords = Boolean(focusFix || focusReportedLocation)
  const lat = focusFix?.latitude ?? focusReportedLocation?.latitude ?? 20.5937
  const lng = focusFix?.longitude ?? focusReportedLocation?.longitude ?? 78.9629
  useEffect(() => {
    if (provider !== 'google' || !mapsKey || !container.current) return
    let active = true
    Promise.all([importLibrary('maps'), importLibrary('marker')]).then(([{ Map }, { Marker }]) => {
      if (!active || !container.current) return
      const instance = new Map(container.current, { center: { lat: 20.5937, lng: 78.9629 }, zoom: 4, fullscreenControl: true, streetViewControl: true, mapTypeControl: true })
      googleMap.current = instance
      googleMarkerConstructor.current = Marker
      setError('')
      setMapVersion(version => version + 1)
    }).catch(() => { if (active) setError('The map could not load. Try OpenStreetMap.') })
    return () => {
      active = false
      googleMarkers.current.forEach(marker => marker.setMap(null))
      googleMarkers.current = []
      movementLines.current.forEach(line => line.setMap(null))
      movementLines.current = []
      movementDots.current.forEach(dot => dot.setMap(null))
      movementDots.current = []
      googleMarkerConstructor.current = null
      if (googleMap.current) google.maps.event.clearInstanceListeners(googleMap.current)
      googleMap.current = null
    }
  }, [provider])

  useEffect(() => {
    const map = googleMap.current
    if (!map) return
    movementLines.current.forEach(line => line.setMap(null))
    movementDots.current.forEach(dot => dot.setMap(null))
    movementLines.current = movementSegments
      .filter(segment => segment.length > 1)
      .map(segment => new google.maps.Polyline({
        map,
        path: segment,
        strokeColor: '#2563eb',
        strokeOpacity: 0.9,
        strokeWeight: 3,
        geodesic: true,
      }))
    movementDots.current = movementSegments.flatMap(segment => segment.map(point => new google.maps.Marker({
      map,
      position: point,
      clickable: false,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 3,
        fillColor: '#2563eb',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 1,
      },
    })))
  }, [movementSegments, mapVersion])

  useEffect(() => {
    const map = googleMap.current
    const Marker = googleMarkerConstructor.current
    if (!map || !Marker) return

    googleMarkers.current.forEach(marker => marker.setMap(null))
    googleMarkers.current = []

    located.forEach(device => {
      if (device.last_latitude == null || device.last_longitude == null || !Number.isFinite(device.last_latitude) || !Number.isFinite(device.last_longitude)) return
      const position = { lat: device.last_latitude, lng: device.last_longitude }
      googleMarkers.current.push(new Marker({
        map,
        position,
        title: `${device.device_name ?? device.serial_number} — ${
          isFreshGpsTimestamp(normalizeVerifiedGpsFix(device)?.timestamp ?? null)
            ? 'Live GPS Fix'
            : 'Last Known Location'
        }`,
        label: showNames
          ? `${device.device_name ?? device.serial_number}${
              isFreshGpsTimestamp(normalizeVerifiedGpsFix(device)?.timestamp ?? null)
                ? ''
                : ' (Last Known)'
            }`
          : undefined,
      }))
    })

    lastReportedDevices.forEach(({ device, location }) => {
      const position = { lat: location.latitude, lng: location.longitude }
      googleMarkers.current.push(new Marker({
        map,
        position,
        title: `Last Reported Location — Unverified${location.isStale ? ' (Stale)' : ''}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#f59e0b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        label: showNames
          ? `${device.device_name ?? device.serial_number} — Last Reported (Unverified)`
          : undefined,
      }))
    })
  }, [mapVersion, located, lastReportedDevices, showNames])

  useEffect(() => {
    const map = googleMap.current
    if (!map || !hasCoords) return
    const selectionKey = `${selectedKey ?? '__initial__'}:${aggregate}`
    if (lastCenteredSelectionRef.current === selectionKey) return
    if (aggregate) {
      const positions = [
        ...located.map(device => ({ lat: device.last_latitude!, lng: device.last_longitude! })),
        ...lastReportedDevices.map(({ location }) => ({
          lat: location.latitude,
          lng: location.longitude,
        })),
        ...movementSegments.flat(),
      ]
      const bounds = new google.maps.LatLngBounds()
      positions.forEach(position => bounds.extend(position))
      if (positions.length > 1) map.fitBounds(bounds, 40)
      else if (positions.length === 1) {
        map.setCenter(positions[0])
        map.setZoom(15)
      } else return
      lastCenteredSelectionRef.current = selectionKey
      return
    }
    const selectedLocation = selectedFix
      ? { lat: selectedFix.latitude, lng: selectedFix.longitude }
      : selectedReportedLocation
        ? { lat: selectedReportedLocation.latitude, lng: selectedReportedLocation.longitude }
        : focusFix
          ? { lat: focusFix.latitude, lng: focusFix.longitude }
          : focusReportedLocation
            ? { lat: focusReportedLocation.latitude, lng: focusReportedLocation.longitude }
            : null
    if (!selectedLocation) return
    map.setCenter(selectedLocation)
    map.setZoom(15)
    lastCenteredSelectionRef.current = selectionKey
  }, [
    mapVersion,
    selectedKey,
    aggregate,
    selectedFix,
    selectedReportedLocation,
    focusFix,
    focusReportedLocation,
    hasCoords,
    located,
    lastReportedDevices,
    movementSegments,
  ])
  if (provider === 'google') {
    if (!mapsKey) {
      if (!hasCoords) {
        return <Box sx={{ height: '100%', minHeight: 520, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f8fafc', color: '#64748b' }}>
          No GPS Location Available
        </Box>
      }
      return <Box sx={{ height: '100%', minHeight: 520, position: 'relative' }}>
        <Box
          component="iframe"
          title="Google Maps device location"
          src={`https://www.google.com/maps?output=embed&q=${encodeURIComponent(`${lat},${lng}`)}&z=15`}
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          sx={{ width: '100%', height: '100%', minHeight: 520, border: 0, display: 'block' }}
        />
        <Alert severity="info" sx={{ position: 'absolute', left: 12, bottom: 12, maxWidth: 430, boxShadow: 2 }}>
          {focusIsLastKnown
            ? 'Showing Last Reported Location — Unverified. No live GPS fix is currently available; this position may be outdated. '
            : ''}
          Google Maps is shown in embedded mode. Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your local <code>.env</code> file to enable device markers and aggregate view.
        </Alert>
        {selectedKey && (gpsRouteStatus === 'unavailable' ||
          gpsRouteStatus === 'history-sync' ||
          gpsRouteStatus === 'unavailable-history-sync' ||
          gpsRouteStatus === 'configuration-error') && (
          <Alert severity="warning" sx={{ position: 'absolute', left: 12, bottom: 90, maxWidth: 430 }}>
            {gpsRouteStatus === 'configuration-error' &&
              'GPS API configuration error: requests must return application/json. Check VITE_API_BASE_URL and the hosting proxy; an HTTPS page also requires an HTTPS backend or proxy. '}
            {(gpsRouteStatus === 'history-sync' || gpsRouteStatus === 'unavailable-history-sync') &&
              'A current verified GPS fix is not available. Historical tracks are in Device Management Tracking and Playback. '}
            {(gpsRouteStatus === 'unavailable' || gpsRouteStatus === 'unavailable-history-sync') &&
              (selectedIsLastKnown
                ? (selectedReportedLocation
                  ? 'GPS No Fix — Showing Last Reported Location — Unverified; this position may be outdated. '
                  : 'No live GPS fix is available. Showing the last verified location. ')
                : !selectedLocatedDevice && !selectedReportedLocation
                  ? 'No GPS Location Available for this device.'
                  : 'No fresh verified GPS fix is available. Historical tracks are in Device Management Tracking and Playback.')}
          </Alert>
        )}
      </Box>
    }
    return <Box sx={{ height: '100%', position: 'relative' }}><Box ref={container} sx={{ height: '100%' }} />{error && <Typography role="alert" sx={{ position: 'absolute', top: 10, left: 10, bgcolor: 'white', p: 1 }}>{error}</Typography>}{selectedKey && (gpsRouteStatus === 'unavailable' || gpsRouteStatus === 'history-sync' || gpsRouteStatus === 'unavailable-history-sync') && <Alert severity="warning" sx={{ position: 'absolute', left: 12, bottom: 12, maxWidth: 430 }}>{(gpsRouteStatus === 'history-sync' || gpsRouteStatus === 'unavailable-history-sync') && 'A current verified GPS fix is not available. Historical tracks are in Device Management Tracking and Playback. '}{(gpsRouteStatus === 'unavailable' || gpsRouteStatus === 'unavailable-history-sync') && (selectedIsLastKnown ? (selectedReportedLocation ? 'GPS No Fix — Showing Last Reported Location — Unverified; this position may be outdated. ' : 'No live GPS fix is available. Showing the last verified location. ') : !selectedLocatedDevice && !selectedReportedLocation ? 'No GPS Location Available for this device. ' : 'No fresh verified GPS fix is available. Historical tracks are in Device Management Tracking and Playback. ')}Only fresh verified points received while Monitoring Center is open are traced.</Alert>}</Box>
  }
  return <OpenStreetMapView devices={displayDevices} selectedId={selectedId} showNames={showNames} aggregate={aggregate} mapStyle={mapStyle} movementSegments={movementSegments} gpsRouteStatus={selectedKey ? gpsRouteStatus : null} />
}
