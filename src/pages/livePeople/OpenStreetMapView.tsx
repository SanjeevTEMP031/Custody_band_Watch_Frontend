import { useEffect, useRef, useState } from 'react'
import { Box, IconButton } from '@mui/material'
import { FullscreenOutlined, Navigation } from '@mui/icons-material'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Device } from '../../services/api'
import { subscribeToDeviceTrips, type TripRecord, isValidGpsCoord } from '../../lib/firebase'

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

export default function OpenStreetMapView({ devices, selectedId, showNames, aggregate, mapStyle }: {
  devices: Device[]; selectedId: number | string | null; showNames: boolean; aggregate: boolean; mapStyle: OpenStreetMapStyle
}) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef<L.LayerGroup | null>(null)
  const routeLine = useRef<L.Polyline | null>(null)
  const tileLayer = useRef<L.TileLayer | null>(null)
  const [activeTrip, setActiveTrip] = useState<TripRecord | null>(null)

  const located = devices.filter(device => device.last_latitude != null && device.last_longitude != null && Number.isFinite(device.last_latitude) && Number.isFinite(device.last_longitude))

  // Subscribe to trips for selected device to show route polyline
  useEffect(() => {
    if (!selectedId) {
      setActiveTrip(null)
      return
    }

    const unsubscribe = subscribeToDeviceTrips(String(selectedId), (trips) => {
      const active = trips.find(t => t.status === 'in_progress') ?? trips[0] ?? null
      setActiveTrip(active)
    })

    return () => unsubscribe()
  }, [selectedId])

  useEffect(() => {
    if (!canvas.current) return
    const first = located[0]
    const initialCenter: [number, number] = first
      ? [first.last_latitude!, first.last_longitude!]
      : [20.5937, 78.9629]
    const initialZoom = first ? 15 : 4

    const instance = L.map(canvas.current, { zoomControl: false }).setView(initialCenter, initialZoom)
    L.control.zoom({ position: 'topright' }).addTo(instance)
    map.current = instance
    markers.current = L.layerGroup().addTo(instance)
    routeLine.current = L.polyline([], {
      color: '#2563eb',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(instance)

    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }))
    observer.observe(canvas.current)
    const frame = requestAnimationFrame(() => instance.invalidateSize())
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      instance.remove()
      map.current = null
      markers.current = null
      routeLine.current = null
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
    if (!map.current || !markers.current) return
    markers.current.clearLayers()

    // 1. Draw route polyline if selected device has an active or recent journey
    const validPoints = (activeTrip?.route_points || []).filter(p => isValidGpsCoord(p.latitude, p.longitude))
    if (routeLine.current) {
      if (validPoints.length > 1) {
        const latLngs: L.LatLngTuple[] = validPoints.map(p => [p.latitude, p.longitude])
        routeLine.current.setLatLngs(latLngs)
      } else {
        routeLine.current.setLatLngs([])
      }
    }

    // 2. Draw Start Marker (Green) if active journey exists
    if (validPoints.length > 0 && activeTrip?.start_location) {
      const start = validPoints[0]
      const startMarker = L.circleMarker([start.latitude, start.longitude], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#16a34a',
        fillOpacity: 1,
      })
      startMarker.bindTooltip('START', { permanent: true, direction: 'bottom', className: 'start-tooltip' })
      markers.current.addLayer(startMarker)
    }

    // 3. Draw device markers
    const located = devices.filter(device => device.last_latitude != null && device.last_longitude != null && Number.isFinite(device.last_latitude) && Number.isFinite(device.last_longitude))
    located.forEach(device => {
      const isSelected = device.id === selectedId
      const marker = L.circleMarker([device.last_latitude!, device.last_longitude!], {
        radius: isSelected ? 10 : 7,
        color: '#fff',
        weight: 2,
        fillColor: isSelected ? '#2196ff' : '#00998c',
        fillOpacity: 1
      })
      const name = document.createElement('span')
      name.textContent = device.device_name ?? device.serial_number
      marker.bindTooltip(name, { permanent: showNames, direction: 'top' })
      marker.addTo(markers.current!)
    })

    const selected = located.find(device => device.id === selectedId) ?? located[0]
    if (aggregate && located.length > 1) {
      map.current.fitBounds(L.latLngBounds(located.map(device => [device.last_latitude!, device.last_longitude!] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 16 })
    } else if (validPoints.length > 1 && !aggregate) {
      map.current.fitBounds(L.latLngBounds(validPoints.map(p => [p.latitude, p.longitude] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 16 })
    } else if (selected) {
      map.current.setView([selected.last_latitude!, selected.last_longitude!], 15)
    }
  }, [devices, selectedId, showNames, aggregate, activeTrip])

  return <Box ref={root} sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 520, zIndex: 0, '&:fullscreen': { height: '100vh', width: '100vw' } }}>
    <Box ref={canvas} aria-label="Device location map" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

    {/* Route & Distance Badge */}
    {activeTrip && activeTrip.total_distance_km > 0 && (
      <Box sx={{ position: 'absolute', top: 20, left: 20, zIndex: 1000, bgcolor: 'rgba(37, 99, 235, 0.92)', color: '#ffffff', px: 2, py: 1, borderRadius: 1.5, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
        <Navigation sx={{ fontSize: 16 }} />
        {activeTrip.status === 'in_progress' ? 'Active Journey' : 'Last Trip'}: {activeTrip.total_distance_km.toFixed(2)} km
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
