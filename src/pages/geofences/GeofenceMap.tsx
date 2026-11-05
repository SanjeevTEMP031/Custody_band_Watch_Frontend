import { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Device, Geofence } from '../../services/api'

export default function GeofenceMap({ device, geofences }: { device: Device | null; geofences: Geofence[] }) {
  const canvas = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const overlays = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!canvas.current) return
    const instance = L.map(canvas.current).setView([20, 0], 2)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance)
    overlays.current = L.layerGroup().addTo(instance)
    map.current = instance
    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }))
    observer.observe(canvas.current)
    const frame = requestAnimationFrame(() => instance.invalidateSize())

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      instance.remove()
      map.current = null
      overlays.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    const layer = overlays.current
    if (!instance || !layer) return
    layer.clearLayers()

    if (
      device?.last_latitude != null
      && device.last_longitude != null
      && Number.isFinite(device.last_latitude)
      && Number.isFinite(device.last_longitude)
    ) {
      L.circleMarker([device.last_latitude, device.last_longitude], {
        radius: 9,
        color: '#fff',
        weight: 2,
        fillColor: '#1976d2',
        fillOpacity: 1,
      })
        .bindTooltip(device.device_name ?? device.serial_number)
        .addTo(layer)
      instance.setView([device.last_latitude, device.last_longitude], 14)
    } else if (geofences.length > 0) {
      const bounds = L.latLngBounds(geofences.map(fence => [fence.latitude, fence.longitude] as L.LatLngTuple))
      instance.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 })
    } else {
      instance.setView([20, 0], 2)
    }

    geofences.forEach(fence => {
      const color = !fence.is_active ? '#8a8a8a' : fence.fence_type === 'inclusion' ? '#00998c' : '#d32f2f'
      const popup = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = fence.name
      const details = document.createElement('div')
      details.textContent = `${fence.fence_type} · ${fence.radius_m} m · ${fence.is_active ? 'Active' : 'Disabled'}`
      popup.append(title, details)

      L.circle([fence.latitude, fence.longitude], {
        radius: fence.radius_m,
        color,
        fillColor: color,
        fillOpacity: fence.is_active ? 0.16 : 0.08,
        weight: 2,
      })
        .bindPopup(popup)
        .addTo(layer)
    })
  }, [device, geofences])

  return <Box
    ref={canvas}
    aria-label="Map showing the device location and configured geofences"
    sx={{ width: '100%', height: { xs: 320, md: 440 }, borderRadius: 1, overflow: 'hidden', zIndex: 0 }}
  />
}
