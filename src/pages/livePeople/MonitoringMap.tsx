/// <reference types="google.maps" />
import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Typography } from '@mui/material'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import type { Device } from '../../services/api'
import OpenStreetMapView, { type OpenStreetMapStyle } from './OpenStreetMapView'

const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
if (mapsKey) setOptions({ key: mapsKey, v: 'weekly' })

export default function MonitoringMap({ devices, selectedId, showNames, aggregate, provider, mapStyle }: { devices: Device[]; selectedId: number | string | null; showNames: boolean; aggregate: boolean; provider: string; mapStyle: OpenStreetMapStyle }) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const located = devices.filter(d => d.last_latitude != null && d.last_longitude != null && Number.isFinite(d.last_latitude) && Number.isFinite(d.last_longitude))
  const focus = located.find(d => d.id === selectedId) ?? located[0]
  const hasCoords = focus?.last_latitude != null && focus?.last_longitude != null
  const lat = hasCoords ? focus.last_latitude! : 20.5937
  const lng = hasCoords ? focus.last_longitude! : 78.9629
  useEffect(() => {
    if (provider !== 'google' || !mapsKey || !container.current) return
    let active = true
    const markers: google.maps.Marker[] = []
    let map: google.maps.Map | undefined
    Promise.all([importLibrary('maps'), importLibrary('marker')]).then(([{ Map }, { Marker }]) => {
      if (!active || !container.current) return
      map = new Map(container.current, { center: { lat, lng }, zoom: hasCoords ? 15 : 4, fullscreenControl: true, streetViewControl: true, mapTypeControl: true })
      setError('')
      const bounds = new google.maps.LatLngBounds()
      devices.forEach(device => {
        if (device.last_latitude == null || device.last_longitude == null || !Number.isFinite(device.last_latitude) || !Number.isFinite(device.last_longitude)) return
        const position = { lat: device.last_latitude, lng: device.last_longitude }
        bounds.extend(position)
        markers.push(new Marker({ map, position, title: device.device_name ?? device.serial_number, label: showNames ? device.device_name ?? device.serial_number : undefined }))
      })
      if (aggregate && markers.length > 1) map.fitBounds(bounds, 40)
    }).catch(() => { if (active) setError('The map could not load. Try OpenStreetMap.') })
    return () => { active = false; markers.forEach(marker => marker.setMap(null)); if (map) google.maps.event.clearInstanceListeners(map) }
  }, [devices, selectedId, showNames, aggregate, provider, lat, lng, hasCoords])
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
      </Box>
    }
    return <Box sx={{ height: '100%', position: 'relative' }}><Box ref={container} sx={{ height: '100%' }} />{error && <Typography role="alert" sx={{ position: 'absolute', top: 10, left: 10, bgcolor: 'white', p: 1 }}>{error}</Typography>}</Box>
  }
  return <OpenStreetMapView devices={devices} selectedId={selectedId} showNames={showNames} aggregate={aggregate} mapStyle={mapStyle} />
}
