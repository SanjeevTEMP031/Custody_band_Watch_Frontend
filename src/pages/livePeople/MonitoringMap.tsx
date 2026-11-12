/// <reference types="google.maps" />
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Typography } from '@mui/material'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import type { Device, GpsLocation } from '../../services/api'
import { isFreshGpsTimestamp, normalizeVerifiedGpsFix } from '../../services/gpsNormalization'
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
  const [error, setError] = useState('')
  const [mapVersion, setMapVersion] = useState(0)
  const [movementTrail, setMovementTrail] = useState<{ deviceKey: string | null; segments: MovementSegment[] }>({ deviceKey: null, segments: [] })
  const [selectedGpsPosition, setSelectedGpsPosition] = useState<{ deviceKey: string | null; position: VerifiedMovementPoint | null }>({ deviceKey: null, position: null })
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
  const handleFreshGpsPoint = useCallback((point: GpsLocation) => {
    if (selectedKey == null) return
    const fix = normalizeVerifiedGpsFix(point)
    if (!fix || !isFreshGpsTimestamp(fix.timestamp)) return
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
  useSelectedGpsRoute(
    null,
    trackingDeviceId,
    true,
    handleFreshGpsPoint,
    handleRouteChange,
    setGpsRouteStatus,
    true,
    firestoreLatest
  )
  const displayDevices = useMemo(() => devices.map(device => {
    const position = selectedGpsPosition.deviceKey === selectedKey
      ? selectedGpsPosition.position
      : null
    if (!position || (String(device.id) !== selectedKey && String(device.device_id) !== selectedKey)) return device
    return {
      ...device,
      last_latitude: position.lat,
      last_longitude: position.lng,
      gps_update_time: position.recordedAt,
      gps_fix_source: position.source,
      has_gps_fix: true,
      gps_fix: true,
    }
  }), [devices, selectedGpsPosition, selectedKey])
  const located = useMemo(() => displayDevices.filter(device => {
    const fix = normalizeVerifiedGpsFix(device)
    return Boolean(fix && isFreshGpsTimestamp(fix.timestamp))
  }), [displayDevices])
  const focus = located.find(d => String(d.id) === selectedKey || String(d.device_id) === selectedKey) ?? located[0]
  const hasCoords = focus?.last_latitude != null && focus?.last_longitude != null
  const lat = hasCoords ? focus.last_latitude! : 20.5937
  const lng = hasCoords ? focus.last_longitude! : 78.9629
  useEffect(() => {
    if (provider !== 'google' || !mapsKey || !container.current) return
    let active = true
    Promise.all([importLibrary('maps'), importLibrary('marker')]).then(([{ Map }, { Marker }]) => {
      if (!active || !container.current) return
      const instance = new Map(container.current, { center: { lat: 20.5937, lng: 78.9629 }, zoom: hasCoords ? 15 : 4, fullscreenControl: true, streetViewControl: true, mapTypeControl: true })
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
  }, [provider, hasCoords])

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
    const bounds = new google.maps.LatLngBounds()

    located.forEach(device => {
      if (device.last_latitude == null || device.last_longitude == null || !Number.isFinite(device.last_latitude) || !Number.isFinite(device.last_longitude)) return
      const position = { lat: device.last_latitude, lng: device.last_longitude }
      bounds.extend(position)
      googleMarkers.current.push(new Marker({
        map,
        position,
        title: device.device_name ?? device.serial_number,
        label: showNames ? device.device_name ?? device.serial_number : undefined,
      }))
    })

    movementSegments.flat().forEach(point => bounds.extend(point))
    if (aggregate && googleMarkers.current.length > 1) map.fitBounds(bounds, 40)
    else if (movementSegments.some(segment => segment.length > 1)) map.fitBounds(bounds, 40)
    else if (hasCoords) map.panTo({ lat, lng })
  }, [mapVersion, located, showNames, aggregate, movementSegments, hasCoords, lat, lng])
  if (provider === 'google') {
    if (!mapsKey) {
      if (!hasCoords) {
        return <Box sx={{ height: '100%', minHeight: 520, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f8fafc', color: '#64748b' }}>
          No GPS Fix Available
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
          Google Maps is shown in embedded mode. Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to <code>trackin360-admin/.env</code> to enable device markers and aggregate view.
        </Alert>
        {selectedKey && (gpsRouteStatus === 'unavailable' ||
          gpsRouteStatus === 'history-sync' ||
          gpsRouteStatus === 'unavailable-history-sync' ||
          gpsRouteStatus === 'configuration-error') && (
          <Alert severity="warning" sx={{ position: 'absolute', left: 12, bottom: 90, maxWidth: 430 }}>
            {gpsRouteStatus === 'configuration-error' &&
              'GPS API configuration error: requests must return application/json. Check VITE_API_BASE_URL and the hosting proxy; an HTTPS page also requires an HTTPS backend or proxy. '}
            {(gpsRouteStatus === 'history-sync' || gpsRouteStatus === 'unavailable-history-sync') &&
              'A valid latest GPS fix is missing from backend history and is not added to the recorded trail. '}
            {(gpsRouteStatus === 'unavailable' || gpsRouteStatus === 'unavailable-history-sync') &&
              'No fresh verified GPS fix is available.'}
          </Alert>
        )}
      </Box>
    }
    return <Box sx={{ height: '100%', position: 'relative' }}><Box ref={container} sx={{ height: '100%' }} />{error && <Typography role="alert" sx={{ position: 'absolute', top: 10, left: 10, bgcolor: 'white', p: 1 }}>{error}</Typography>}{selectedKey && (gpsRouteStatus === 'unavailable' || gpsRouteStatus === 'history-sync' || gpsRouteStatus === 'unavailable-history-sync') && <Alert severity="warning" sx={{ position: 'absolute', left: 12, bottom: 12, maxWidth: 430 }}>{(gpsRouteStatus === 'history-sync' || gpsRouteStatus === 'unavailable-history-sync') && 'A valid latest GPS fix is missing from backend history and is not added to the recorded trail. '}{(gpsRouteStatus === 'unavailable' || gpsRouteStatus === 'unavailable-history-sync') && 'No fresh verified GPS fix is available. Only verified recorded GPS points are shown.'}</Alert>}</Box>
  }
  return <OpenStreetMapView devices={displayDevices} selectedId={selectedId} showNames={showNames} aggregate={aggregate} mapStyle={mapStyle} movementSegments={movementSegments} gpsRouteStatus={selectedKey ? gpsRouteStatus : null} />
}
