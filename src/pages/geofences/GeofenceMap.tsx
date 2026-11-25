import { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Device, Geofence, GeofenceShape } from '../../services/api'
import { isFreshGpsTimestamp, normalizeVerifiedGpsFix } from '../../services/gpsNormalization'

export interface GeofenceDraft {
  type: GeofenceShape
  latitude: number | null
  longitude: number | null
  radius: number
  polygon: [number, number][]
}

export interface GeofenceMapLocation {
  latitude: number
  longitude: number
  timestamp: number | null
  accuracy: number | null
  verified: boolean
  isCurrent: boolean
  deviceId?: string
  gpsStatus?: string | null
  batteryPct?: number | null
}

export interface GeofenceRouteOption {
  id: string
  name: string
  points: [number, number][]
  distanceKm: number | null
  durationMinutes: number | null
}

const EMPTY_ROUTE_ENDPOINTS: { origin: [number, number] | null; destination: [number, number] | null } = {
  origin: null,
  destination: null,
}

interface GeofenceMapProps {
  device?: Device | null
  devices?: Device[]
  geofences: Geofence[]
  deviceLocation?: GeofenceMapLocation | null
  draft?: GeofenceDraft | null
  drawingMode?: boolean
  selectedGeofenceId?: number | string | null
  violationActive?: boolean
  focusRequest?: number
  onDraftChange?: (draft: GeofenceDraft) => void
  approvedRoute?: [number, number][]
  travelledRoute?: [number, number][]
  deviationRoute?: [number, number][][]
  backendDeviationLocation?: [number, number] | null
  routeOptions?: GeofenceRouteOption[]
  selectedRouteId?: string
  approvedRouteId?: string | null
  onRouteSelect?: (routeId: string) => void
  fitRoutesRequest?: number
  pointPickMode?: 'origin' | 'destination' | null
  routeEndpoints?: { origin?: [number, number] | null; destination?: [number, number] | null }
  focusRoutePoint?: [number, number] | null
  onMapPointPick?: (point: [number, number], mode: 'origin' | 'destination') => void
}

function fenceCenter(fence: Geofence): [number, number] | null {
  const lat = fence.center_latitude ?? fence.latitude
  const lon = fence.center_longitude ?? fence.longitude
  return lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
    ? [lat, lon]
    : null
}

function fenceIsActive(fence: Geofence): boolean {
  return fence.active ?? fence.is_active ?? true
}

export default function GeofenceMap({
  device = null,
  devices = [],
  geofences,
  deviceLocation = null,
  draft = null,
  drawingMode = false,
  selectedGeofenceId = null,
  violationActive = false,
  focusRequest = 0,
  onDraftChange,
  approvedRoute = [],
  travelledRoute = [],
  deviationRoute = [],
  backendDeviationLocation = null,
  routeOptions = [],
  selectedRouteId = '',
  approvedRouteId = null,
  onRouteSelect,
  fitRoutesRequest = 0,
  pointPickMode = null,
  routeEndpoints = EMPTY_ROUTE_ENDPOINTS,
  focusRoutePoint = null,
  onMapPointPick,
}: GeofenceMapProps) {
  const canvas = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const overlays = useRef<L.LayerGroup | null>(null)
  const draftRef = useRef(draft)
  const drawingModeRef = useRef(drawingMode)
  const onDraftChangeRef = useRef(onDraftChange)
  const pointPickModeRef = useRef(pointPickMode)
  const onMapPointPickRef = useRef(onMapPointPick)
  const onRouteSelectRef = useRef(onRouteSelect)
  const hasInitialFit = useRef(false)
  const previousSelectedGeofenceId = useRef<string | null>(null)
  const previousFocusRequest = useRef(focusRequest)
  const previousRouteFitRequest = useRef(fitRoutesRequest)

  useEffect(() => {
    draftRef.current = draft
    drawingModeRef.current = drawingMode
    onDraftChangeRef.current = onDraftChange
    pointPickModeRef.current = pointPickMode
    onMapPointPickRef.current = onMapPointPick
    onRouteSelectRef.current = onRouteSelect
  }, [draft, drawingMode, onDraftChange, pointPickMode, onMapPointPick, onRouteSelect])

  useEffect(() => {
    if (!canvas.current) return
    const instance = L.map(canvas.current).setView([20.5937, 78.9629], 5)
    const gpsPane = instance.createPane('gpsLocation')
    gpsPane.style.zIndex = '650'
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance)
    overlays.current = L.layerGroup().addTo(instance)
    instance.on('click', event => {
      const pickMode = pointPickModeRef.current
      if (pickMode) {
        const latitude = event.latlng.lat
        const longitude = event.latlng.lng
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return
        const point: [number, number] = [latitude, longitude]
        onMapPointPickRef.current?.(point, pickMode)
        return
      }
      const currentDraft = draftRef.current
      if (!drawingModeRef.current || !currentDraft) return
      const next = currentDraft.type === 'CIRCLE'
        ? { ...currentDraft, latitude: event.latlng.lat, longitude: event.latlng.lng }
        : { ...currentDraft, polygon: [...currentDraft.polygon, [event.latlng.lat, event.latlng.lng] as [number, number]] }
      onDraftChangeRef.current?.(next)
    })
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
    if (!instance || !focusRoutePoint) return
    instance.setView(focusRoutePoint, Math.max(instance.getZoom(), 15), { animate: true })
  }, [focusRoutePoint])

  useEffect(() => {
    const instance = map.current
    const layer = overlays.current
    if (!instance || !layer) return
    layer.clearLayers()
    const bounds: L.LatLngExpression[] = []

    if (!device) devices.forEach(item => {
      const fix = normalizeVerifiedGpsFix(item)
      if (!fix) return
      const position: [number, number] = [fix.latitude, fix.longitude]
      bounds.push(position)
      const current = isFreshGpsTimestamp(fix.timestamp)
      L.circleMarker(position, {
        radius: 6,
        color: '#fff',
        weight: 2,
        fillColor: current ? '#475569' : '#94a3b8',
        fillOpacity: 1,
      })
        .bindTooltip(`${item.device_name ?? item.serial_number ?? String(item.id)} · ${current ? 'GPS fix' : 'Last verified GPS'}`)
        .addTo(layer)
    })

    geofences.forEach(fence => {
      const center = fenceCenter(fence)
      const coords = fence.polygon_coordinates
      const active = fenceIsActive(fence)
      const selected = String(fence.id) === String(selectedGeofenceId)
      const color = selected && violationActive
        ? '#b91c1c'
        : !active ? '#8a8a8a' : fence.fence_type?.toLowerCase() === 'inclusion' ? '#00998c' : '#d32f2f'
      const popup = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = fence.name
      const details = document.createElement('div')
      details.textContent = `${fence.type ?? 'CIRCLE'} · ${fence.fence_type} · ${active ? 'Active' : 'Disabled'}`
      popup.append(title, details)

      if ((fence.type ?? 'CIRCLE').toUpperCase() === 'POLYGON' && coords?.length) {
        const polygonBounds = coords.map(([lat, lon]) => [lat, lon] as [number, number])
        bounds.push(...polygonBounds)
        L.polygon(polygonBounds, {
          color,
          fillColor: color,
          fillOpacity: selected ? 0.28 : active ? 0.16 : 0.08,
          weight: selected ? 4 : 2,
        }).bindPopup(popup).addTo(layer)
      } else if (center) {
        bounds.push(center)
        const circle = L.circle(center, {
          radius: fence.radius_meters ?? fence.radius_m ?? 500,
          color,
          fillColor: color,
          fillOpacity: selected ? 0.28 : active ? 0.16 : 0.08,
          weight: selected ? 4 : 2,
        }).bindPopup(popup).addTo(layer)
        const circleBounds = circle.getBounds()
        bounds.push(circleBounds.getSouthWest(), circleBounds.getNorthEast())
      }
    })

    const validRouteOptions = routeOptions.filter(route => route.points.length > 1)
    validRouteOptions.forEach(route => {
      bounds.push(...route.points)
      const approved = route.id === approvedRouteId
      const selected = route.id === selectedRouteId
      const color = approved ? '#16a34a' : selected ? '#7c3aed' : '#64748b'
      const polyline = L.polyline(route.points, {
        color,
        weight: selected || approved ? 7 : 5,
        opacity: selected || approved ? 0.96 : 0.58,
        dashArray: selected || approved ? undefined : '8 8',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layer)
      const distance = route.distanceKm == null ? '' : ` · ${route.distanceKm} km`
      const eta = route.durationMinutes == null ? '' : ` · ${route.durationMinutes} min`
      polyline.bindTooltip(`${route.name}${distance}${eta}${approved ? ' · approved' : selected ? ' · selected' : ''}`)
      if (!approvedRouteId) polyline.on('click', event => {
        L.DomEvent.stopPropagation(event)
        onRouteSelectRef.current?.(route.id)
      })
    })
    if (approvedRoute.length > 1 && validRouteOptions.length === 0) {
      bounds.push(...approvedRoute)
      L.polyline(approvedRoute, { color: '#16a34a', weight: 7, opacity: 0.96 }).bindTooltip('Approved route').addTo(layer)
    }
    if (validRouteOptions.length > 0) {
      const origin = validRouteOptions.find(route => route.id === selectedRouteId)?.points[0] ?? validRouteOptions[0].points[0]
      const destination = validRouteOptions.find(route => route.id === selectedRouteId)?.points.at(-1) ?? validRouteOptions[0].points.at(-1)
      if (origin) L.circleMarker(origin, { radius: 7, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).bindTooltip('Journey origin').addTo(layer)
      if (destination) L.circleMarker(destination, { radius: 7, color: '#fff', weight: 2, fillColor: '#334155', fillOpacity: 1 }).bindTooltip('Journey destination').addTo(layer)
    }
    if (validRouteOptions.length === 0 && routeEndpoints.origin) {
      bounds.push(routeEndpoints.origin)
      L.circleMarker(routeEndpoints.origin, { radius: 8, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).bindTooltip('Selected origin').addTo(layer)
    }
    if (validRouteOptions.length === 0 && routeEndpoints.destination) {
      bounds.push(routeEndpoints.destination)
      L.circleMarker(routeEndpoints.destination, { radius: 8, color: '#fff', weight: 2, fillColor: '#334155', fillOpacity: 1 }).bindTooltip('Selected destination').addTo(layer)
    }
    if (travelledRoute.length > 1) {
      bounds.push(...travelledRoute)
      L.polyline(travelledRoute, { color: '#2563eb', weight: 5, opacity: 0.9 }).bindTooltip('Device route').addTo(layer)
    }
    deviationRoute.forEach(segment => {
      if (segment.length > 1) {
        bounds.push(...segment)
        L.polyline(segment, { color: '#dc2626', weight: 7, opacity: 0.95 }).bindTooltip('Route deviation').addTo(layer)
      }
    })

    const selectedFix = deviceLocation

    if (selectedFix) {
      const position: [number, number] = [selectedFix.latitude, selectedFix.longitude]
      bounds.push(position)
      const deviceName = device?.device_name ?? device?.serial_number ?? device?.device_id ?? 'Selected device'
      const locationLabel = selectedFix.verified
        ? selectedFix.isCurrent ? 'Current verified GPS' : 'Last verified GPS'
        : 'Last-known GPS (stale)'
      const locationTime = selectedFix.timestamp === null
        ? ''
        : ` · ${new Date(selectedFix.timestamp).toLocaleString()}`
      const accuracy = selectedFix.accuracy === null ? '' : ` · ±${Math.round(selectedFix.accuracy)} m`
      const popup = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = deviceName
      const details = [
        `Device ID: ${selectedFix.deviceId ?? device?.device_id ?? 'Unavailable'}`,
        `GPS time: ${selectedFix.timestamp === null ? 'Unavailable' : new Date(selectedFix.timestamp).toLocaleString()}`,
        `GPS status: ${selectedFix.gpsStatus ?? (selectedFix.isCurrent ? 'Valid' : 'No current fix')}`,
        `Battery: ${selectedFix.batteryPct == null ? 'Unavailable' : `${Math.round(selectedFix.batteryPct)}%`}`,
        `Location: ${locationLabel}`,
      ]
      popup.append(title)
      details.forEach(text => {
        const row = document.createElement('div')
        row.textContent = text
        popup.append(row)
      })
      L.circleMarker(position, {
        pane: 'gpsLocation',
        radius: 10,
        color: violationActive ? '#b91c1c' : '#fff',
        weight: 3,
        fillColor: selectedFix.isCurrent && selectedFix.verified ? '#1976d2' : '#64748b',
        fillOpacity: 1,
      })
        .bindTooltip(`${deviceName} · ${locationLabel}${locationTime}${accuracy}`)
        .bindPopup(popup)
        .addTo(layer)
    }

    if (backendDeviationLocation) {
      L.circleMarker(backendDeviationLocation, {
        pane: 'gpsLocation',
        radius: 10,
        color: '#fff',
        weight: 3,
        fillColor: '#dc2626',
        fillOpacity: 1,
      }).bindTooltip('Backend-confirmed route deviation').addTo(layer)
    }

    if (draft) {
      if (draft.type === 'CIRCLE' && draft.latitude != null && draft.longitude != null) {
        const center: [number, number] = [draft.latitude, draft.longitude]
        const circle = L.circle(center, {
          radius: draft.radius,
          color: '#2563eb',
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          dashArray: '6 5',
          weight: 2,
        }).addTo(layer)
        bounds.push(center)
        const centerMarker = L.marker(center, {
          draggable: true,
          icon: L.divIcon({ className: 'geofence-map-handle', html: '<span style="display:block;width:12px;height:12px;border:2px solid white;border-radius:50%;background:#2563eb"></span', iconSize: [12, 12] }),
        }).addTo(layer)
        centerMarker.on('dragend', event => {
          const position = (event.target as L.Marker).getLatLng()
          onDraftChangeRef.current?.({ ...draft, latitude: position.lat, longitude: position.lng })
        })
        const radiusHandleLat = draft.latitude + draft.radius / 111320
        const radiusMarker = L.marker([radiusHandleLat, draft.longitude], {
          draggable: true,
          icon: L.divIcon({ className: 'geofence-map-handle', html: '<span style="display:block;width:12px;height:12px;border:2px solid white;border-radius:50%;background:#f97316"></span', iconSize: [12, 12] }),
        }).addTo(layer)
        radiusMarker.on('dragend', event => {
          const position = (event.target as L.Marker).getLatLng()
          const nextRadius = Math.max(10, Math.round(instance.distance(center, position)))
          onDraftChangeRef.current?.({ ...draft, radius: nextRadius })
        })
        circle.bindTooltip('Drag blue handle to move center; orange handle to change radius')
      } else if (draft.type === 'POLYGON' && draft.polygon.length) {
        const polygon = L.polygon(draft.polygon, {
          color: '#2563eb',
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          dashArray: '6 5',
          weight: 2,
        }).addTo(layer)
        bounds.push(...draft.polygon)
        draft.polygon.forEach(([lat, lon], index) => {
          L.marker([lat, lon], {
            draggable: true,
            icon: L.divIcon({ className: 'geofence-map-handle', html: '<span style="display:block;width:12px;height:12px;border:2px solid white;border-radius:50%;background:#2563eb"></span', iconSize: [12, 12] }),
          }).addTo(layer).on('dragend', event => {
            const position = (event.target as L.Marker).getLatLng()
            const nextPolygon = draft.polygon.map((point, pointIndex) =>
              pointIndex === index ? [position.lat, position.lng] as [number, number] : point
            )
            onDraftChangeRef.current?.({ ...draft, polygon: nextPolygon })
          })
        })
        if (draft.polygon.length >= 3) polygon.bindTooltip('Drag a blue vertex to adjust the boundary')
      }
    }

    const selectionKey = selectedGeofenceId == null ? null : String(selectedGeofenceId)
    const selectionChanged = selectionKey !== previousSelectedGeofenceId.current
    previousSelectedGeofenceId.current = selectionKey
    const focusRequested = focusRequest !== previousFocusRequest.current
    previousFocusRequest.current = focusRequest
    const fitRoutesRequested = fitRoutesRequest !== previousRouteFitRequest.current
    previousRouteFitRequest.current = fitRoutesRequest
    const selectedFence = selectedGeofenceId == null
      ? null
      : geofences.find(item => String(item.id) === String(selectedGeofenceId))
    const selectedCenter = selectedFence ? fenceCenter(selectedFence) : null

    if (focusRequested && selectedFix) {
      instance.setView(
        [selectedFix.latitude, selectedFix.longitude],
        Math.max(instance.getZoom(), 15),
        { animate: true },
      )
    } else if (fitRoutesRequested && (validRouteOptions.length > 0 || approvedRoute.length > 0)) {
      const routeBounds = validRouteOptions.length > 0
        ? validRouteOptions.flatMap(route => route.points)
        : approvedRoute
      instance.fitBounds(L.latLngBounds(routeBounds), { padding: [52, 52], maxZoom: 14, animate: true })
      hasInitialFit.current = true
    } else if (!hasInitialFit.current) {
      if (selectedCenter) {
        instance.setView(selectedCenter, 15)
        hasInitialFit.current = true
      } else if (bounds.length > 0) {
        instance.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 15 })
        hasInitialFit.current = true
      } else if (selectedFix) {
        instance.setView([selectedFix.latitude, selectedFix.longitude], 17)
        hasInitialFit.current = true
      }
    } else if (selectionChanged && selectedCenter) {
      instance.setView(selectedCenter, 15)
    }
  }, [approvedRoute, approvedRouteId, backendDeviationLocation, device, deviceLocation, devices, draft, focusRequest, fitRoutesRequest, geofences, selectedGeofenceId, violationActive, travelledRoute, deviationRoute, routeOptions, selectedRouteId, routeEndpoints])

  return (
    <Box
      ref={canvas}
      aria-label="Map showing devices and configured geofences"
      sx={{
        width: '100%',
        height: { xs: 320, md: 440 },
        borderRadius: 1,
        overflow: 'hidden',
        zIndex: 0,
        cursor: drawingMode || pointPickMode ? 'crosshair' : 'grab',
      }}
    />
  )
}
