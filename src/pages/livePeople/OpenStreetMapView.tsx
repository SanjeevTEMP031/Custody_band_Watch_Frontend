import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, IconButton } from '@mui/material'
import { FullscreenOutlined, Navigation } from '@mui/icons-material'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Device } from '../../services/api'
import { isFreshGpsTimestamp, normalizeVerifiedGpsFix } from '../../services/gpsNormalization'
import { subscribeToDeviceTrips, type TripRecord } from '../../lib/firebase'
import type { SelectedGpsRouteStatus } from '../dashboard/useSelectedGpsRoute'

export type OpenStreetMapStyle = 'standard' | 'humanitarian' | 'cycle'

const mapStyles: Record<OpenStreetMapStyle, { url: string; attribution: string }> = {
  standard: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  humanitarian: {
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, tiles <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>',
  },
  cycle: {
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, style <a href="https://www.cyclosm.org/">CyclOSM</a>',
  },
}

export default function OpenStreetMapView({ devices, selectedId, showNames, aggregate, mapStyle, movementSegments, gpsRouteStatus }: {
  devices: Device[]; selectedId: number | string | null; showNames: boolean; aggregate: boolean; mapStyle: OpenStreetMapStyle
  movementSegments: Array<Array<{ lat: number; lng: number }>>
  gpsRouteStatus: SelectedGpsRouteStatus | null
}) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef<L.LayerGroup | null>(null)
  const routeLayers = useRef<L.LayerGroup | null>(null)
  const tileLayer = useRef<L.TileLayer | null>(null)
  const [tripSelection, setTripSelection] = useState<{ deviceId: string; trip: TripRecord | null }>({ deviceId: '', trip: null })
  const activeTrip = selectedId != null && tripSelection.deviceId === String(selectedId)
    ? tripSelection.trip
    : null

  const located = useMemo(
    () => devices.filter(device => {
      const fix = normalizeVerifiedGpsFix(device)
      return Boolean(fix && isFreshGpsTimestamp(fix.timestamp))
    }),
    [devices],
  )

  // Subscribe to trips for selected device to show route polyline
  useEffect(() => {
    if (selectedId == null) return

    const deviceId = String(selectedId)
    const unsubscribe = subscribeToDeviceTrips(deviceId, (trips) => {
      const active = trips.find(t => t.status === 'in_progress') ?? trips[0] ?? null
      setTripSelection({ deviceId, trip: active })
    })

    return () => unsubscribe()
  }, [selectedId])

  useEffect(() => {
    if (!canvas.current) return
    const instance = L.map(canvas.current, { zoomControl: false }).setView([20.5937, 78.9629], 4)
    L.control.zoom({ position: 'topright' }).addTo(instance)
    map.current = instance
    markers.current = L.layerGroup().addTo(instance)
    routeLayers.current = L.layerGroup().addTo(instance)

    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }))
    observer.observe(canvas.current)
    const frame = requestAnimationFrame(() => instance.invalidateSize())
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      instance.remove()
      map.current = null
      markers.current = null
      routeLayers.current = null
      tileLayer.current = null
    }
  }, [])

  useEffect(() => {
    if (!map.current) return
    tileLayer.current?.remove()
    const style = mapStyles[mapStyle]
    tileLayer.current = L.tileLayer(style.url, { maxZoom: 19, attribution: style.attribution }).addTo(map.current)
  }, [mapStyle])

  useEffect(() => {
    if (!map.current || !routeLayers.current) return
    routeLayers.current.clearLayers()
    movementSegments.forEach(segment => {
      if (segment.length > 1) {
        L.polyline(segment.map(point => [point.lat, point.lng] as L.LatLngTuple), {
          color: '#2563eb',
          weight: 3,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(routeLayers.current!)
      }
      segment.forEach(point => {
        L.circleMarker([point.lat, point.lng], {
          radius: 3,
          color: '#ffffff',
          weight: 0.5,
          fillColor: '#2563eb',
          fillOpacity: 1,
        }).addTo(routeLayers.current!)
      })
    })
  }, [movementSegments])

  useEffect(() => {
    if (!map.current || !markers.current) return
    markers.current.clearLayers()
    const routePoints = movementSegments.flatMap(segment =>
      segment.map(point => [point.lat, point.lng] as L.LatLngTuple),
    )
    // Draw device markers
    located.forEach(device => {
      const isSelected = String(device.id) === String(selectedId) || String(device.device_id) === String(selectedId)
      const marker = L.circleMarker([device.last_latitude!, device.last_longitude!], {
        radius: isSelected ? 10 : 7,
        color: '#fff',
        weight: 2,
        fillColor: isSelected ? '#2196ff' : '#00998c',
        fillOpacity: 1
      })
      const name = document.createElement('span')
      name.textContent = device.device_name ?? device.serial_number ?? ''
      marker.bindTooltip(name, { permanent: showNames, direction: 'top' })
      marker.addTo(markers.current!)
    })

    const selected = located.find(device =>
      String(device.id) === String(selectedId) || String(device.device_id) === String(selectedId),
    ) ?? located[0]
    if (aggregate && located.length > 1) {
      const boundsPoints = [
        ...located.map(device => [device.last_latitude!, device.last_longitude!] as L.LatLngTuple),
        ...routePoints,
      ]
      map.current.fitBounds(L.latLngBounds(boundsPoints), { padding: [40, 40], maxZoom: 16 })
    } else if (routePoints.length > 1) {
      map.current.fitBounds(L.latLngBounds(routePoints), { padding: [40, 40], maxZoom: 16 })
    } else if (selected) {
      map.current.setView([selected.last_latitude!, selected.last_longitude!], 15)
    }
  }, [devices, selectedId, showNames, aggregate, located, movementSegments])

  return <Box ref={root} sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 520, zIndex: 0, '&:fullscreen': { height: '100vh', width: '100vw' } }}>
    <Box ref={canvas} aria-label="Device location map" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

    {/* Route & Distance Badge */}
    {activeTrip && activeTrip.total_distance_km > 0 && (
      <Box sx={{ position: 'absolute', top: 20, left: 20, zIndex: 1000, bgcolor: 'rgba(37, 99, 235, 0.92)', color: '#ffffff', px: 2, py: 1, borderRadius: 1.5, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
        <Navigation sx={{ fontSize: 16 }} />
        {activeTrip.status === 'in_progress' ? 'Active Journey' : 'Last Trip'}: {activeTrip.total_distance_km.toFixed(2)} km
      </Box>
    )}
    {(gpsRouteStatus === 'unavailable' ||
      gpsRouteStatus === 'history-sync' ||
      gpsRouteStatus === 'unavailable-history-sync') && (
      <Box role="status" sx={{ position: 'absolute', left: 20, bottom: 20, zIndex: 1000, bgcolor: 'rgba(239, 246, 255, 0.96)', color: '#1e3a8a', px: 1.5, py: 1, borderRadius: 1, fontSize: 12, border: '1px solid #bfdbfe', maxWidth: 420 }}>
        {(gpsRouteStatus === 'history-sync' || gpsRouteStatus === 'unavailable-history-sync') && (
          <div>A valid latest GPS fix is missing from backend history and is not added to the recorded trail.</div>
        )}
        {(gpsRouteStatus === 'unavailable' || gpsRouteStatus === 'unavailable-history-sync') && (
          <div>No fresh verified GPS fix is available. Any visible trail contains verified recorded history only.</div>
        )}
      </Box>
    )}
    {movementSegments.some(segment => segment.length > 1) && activeTrip?.status !== 'in_progress' && (
      <Box sx={{ position: 'absolute', top: 20, left: 20, zIndex: 1000, bgcolor: 'rgba(37, 99, 235, 0.92)', color: '#ffffff', px: 2, py: 1, borderRadius: 1.5, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
        <Navigation sx={{ fontSize: 16 }} />
        Live tracking
      </Box>
    )}

    {located.length === 0 && (
      <Box sx={{ position: 'absolute', top: 20, left: 20, zIndex: 1000, bgcolor: 'rgba(15, 23, 42, 0.85)', color: '#f8fafc', px: 2, py: 1, borderRadius: 1, fontSize: 13, border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
        No GPS Fix Available
      </Box>
    )}
    <IconButton aria-label="Expand map to full screen" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else void root.current?.requestFullscreen().catch(() => {}) }} sx={{ position: 'absolute', right: 10, top: 85, zIndex: 1000, bgcolor: '#fff', border: '1px solid #bbb', borderRadius: .5, '&:hover': { bgcolor: '#f4f4f4' } }}><FullscreenOutlined /></IconButton>
  </Box>
}
