import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Box, ButtonGroup, IconButton, Tooltip, Typography } from '@mui/material'
import {
  Maximize2,
  Minimize2,
  Navigation,
  MapPin,
  Flag,
  Crosshair,
} from 'lucide-react'
import { isValidGpsCoord, type TripPoint, type TripRecord } from '../../lib/firebase'

export type MapTileProvider = 'standard' | 'humanitarian' | 'voyager'

const TILE_PROVIDERS: Record<MapTileProvider, { name: string; url: string; attribution: string }> = {
  standard: {
    name: 'Standard OSM',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  humanitarian: {
    name: 'Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, HOT',
  },
  voyager: {
    name: 'Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO',
  },
}

interface RouteTrackingMapProps {
  trip: TripRecord | null
  points?: TripPoint[]
  currentLocation?: {
    latitude: number
    longitude: number
    speed_kmh?: number | null
    heading?: number | null
    timestamp?: string
  } | null
  height?: string | number
  autoFitOnUpdate?: boolean
}

function createStartIcon(): L.DivIcon {
  return L.divIcon({
    className: 'trip-start-marker',
    html: `
      <div style="
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: #16a34a;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px 4px 7px;
        border-radius: 14px;
        box-shadow: 0 4px 12px rgba(22, 163, 74, 0.45), 0 1px 3px rgba(0,0,0,0.2);
        border: 2px solid #ffffff;
        cursor: pointer;
        transform: translate(-50%, -100%);
      ">
        <span style="
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 0 4px rgba(0,0,0,0.3);
        "></span>
        START
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

function createEndIcon(distanceKm?: number): L.DivIcon {
  const distLabel = distanceKm != null ? ` (${distanceKm.toFixed(1)} km)` : ''
  return L.divIcon({
    className: 'trip-end-marker',
    html: `
      <div style="
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: #dc2626;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 9px 4px 7px;
        border-radius: 14px;
        box-shadow: 0 4px 12px rgba(220, 38, 38, 0.45), 0 1px 3px rgba(0,0,0,0.2);
        border: 2px solid #ffffff;
        cursor: pointer;
        transform: translate(-50%, -100%);
      ">
        <span style="
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 0 4px rgba(0,0,0,0.3);
        "></span>
        END${distLabel}
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

function createCurrentLocationIcon(heading?: number | null): L.DivIcon {
  const rot = heading != null && Number.isFinite(heading) ? heading : 0
  return L.divIcon({
    className: 'trip-current-marker',
    html: `
      <div style="
        position: relative;
        width: 32px;
        height: 32px;
        transform: translate(-50%, -50%);
        cursor: pointer;
      ">
        <div style="
          position: absolute;
          inset: 0;
          background: #2563eb;
          opacity: 0.35;
          border-radius: 50%;
          animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
        "></div>
        <div style="
          position: absolute;
          inset: 4px;
          background: #1d4ed8;
          border: 2.5px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 3px 10px rgba(29, 78, 216, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
        ">
          <div style="transform: rotate(${rot}deg); font-size: 11px; font-weight: bold; line-height: 1;">
            ▲
          </div>
        </div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

export default function RouteTrackingMap({
  trip,
  points,
  currentLocation,
  height = 540,
  autoFitOnUpdate = true,
}: RouteTrackingMapProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const polylineHaloRef = useRef<L.Polyline | null>(null)
  const polylineMainRef = useRef<L.Polyline | null>(null)
  const markerGroupRef = useRef<L.LayerGroup | null>(null)

  const [mapStyle, setMapStyle] = useState<MapTileProvider>('standard')
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Consolidate route points from prop or trip
  const routePoints = points ?? trip?.route_points ?? []
  const validRoute = routePoints.filter((p) => isValidGpsCoord(p.latitude, p.longitude))

  // Determine start, end, and current locations
  const startCoord = validRoute.length > 0 ? validRoute[0] : null
  const isTripCompleted = trip?.status === 'completed'
  const endCoord = isTripCompleted && validRoute.length > 1 ? validRoute[validRoute.length - 1] : null

  const liveCoord =
    currentLocation && isValidGpsCoord(currentLocation.latitude, currentLocation.longitude)
      ? currentLocation
      : trip?.current_location && isValidGpsCoord(trip.current_location.latitude, trip.current_location.longitude)
      ? trip.current_location
      : !isTripCompleted && validRoute.length > 0
      ? validRoute[validRoute.length - 1]
      : null

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return

    const initialCenter: [number, number] =
      validRoute.length > 0
        ? [validRoute[0].latitude, validRoute[0].longitude]
        : [20.5937, 78.9629]

    const initialZoom = validRoute.length > 0 ? 15 : 5

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false,
    })

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    const initialTiles = L.tileLayer(TILE_PROVIDERS[mapStyle].url, {
      maxZoom: 19,
      attribution: TILE_PROVIDERS[mapStyle].attribution,
    }).addTo(map)

    const markers = L.layerGroup().addTo(map)

    // Polyline layers
    // Halo underneath for high contrast
    const halo = L.polyline([], {
      color: '#1e40af',
      weight: 8,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map)

    // Main vibrant blue polyline
    const mainLine = L.polyline([], {
      color: '#2563eb',
      weight: 5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map)

    mapInstanceRef.current = map
    tileLayerRef.current = initialTiles
    markerGroupRef.current = markers
    polylineHaloRef.current = halo
    polylineMainRef.current = mainLine

    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    observer.observe(mapContainerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapInstanceRef.current = null
      tileLayerRef.current = null
      markerGroupRef.current = null
      polylineHaloRef.current = null
      polylineMainRef.current = null
    }
  }, [])

  // 2. Tile layer change handler
  useEffect(() => {
    if (!mapInstanceRef.current) return
    tileLayerRef.current?.remove()
    const provider = TILE_PROVIDERS[mapStyle]
    tileLayerRef.current = L.tileLayer(provider.url, {
      maxZoom: 19,
      attribution: provider.attribution,
    }).addTo(mapInstanceRef.current)
  }, [mapStyle])

  // 3. Render route polyline, start marker, end marker, and current location marker
  useEffect(() => {
    const map = mapInstanceRef.current
    const markers = markerGroupRef.current
    const halo = polylineHaloRef.current
    const mainLine = polylineMainRef.current
    if (!map || !markers || !halo || !mainLine) return

    markers.clearLayers()

    const latLngs: L.LatLngTuple[] = validRoute.map((p) => [p.latitude, p.longitude])

    halo.setLatLngs(latLngs)
    mainLine.setLatLngs(latLngs)

    // --- A. START MARKER (GREEN) ---
    if (startCoord) {
      const startMarker = L.marker([startCoord.latitude, startCoord.longitude], {
        icon: createStartIcon(),
        zIndexOffset: 1000,
      })

      const popupContent = `
        <div style="font-family: inherit; font-size: 13px; line-height: 1.4; padding: 2px;">
          <div style="font-weight: 700; color: #16a34a; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a;"></span>
            Journey Start Location
          </div>
          <div><strong>Coordinates:</strong> ${startCoord.latitude.toFixed(5)}, ${startCoord.longitude.toFixed(5)}</div>
          <div><strong>Start Time:</strong> ${startCoord.timestamp ? new Date(startCoord.timestamp).toLocaleString() : 'N/A'}</div>
          ${trip?.wearer_name ? `<div><strong>Wearer:</strong> ${trip.wearer_name}</div>` : ''}
        </div>
      `
      startMarker.bindPopup(popupContent)
      markers.addLayer(startMarker)
    }

    // --- B. END MARKER (RED) ---
    if (endCoord && isTripCompleted) {
      const endMarker = L.marker([endCoord.latitude, endCoord.longitude], {
        icon: createEndIcon(trip?.total_distance_km),
        zIndexOffset: 1000,
      })

      const popupContent = `
        <div style="font-family: inherit; font-size: 13px; line-height: 1.4; padding: 2px;">
          <div style="font-weight: 700; color: #dc2626; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626;"></span>
            Journey Completed (End Location)
          </div>
          <div><strong>Coordinates:</strong> ${endCoord.latitude.toFixed(5)}, ${endCoord.longitude.toFixed(5)}</div>
          <div><strong>End Time:</strong> ${endCoord.timestamp ? new Date(endCoord.timestamp).toLocaleString() : 'N/A'}</div>
          <div><strong>Total Travelled:</strong> ${trip?.total_distance_km?.toFixed(2) ?? '—'} km</div>
        </div>
      `
      endMarker.bindPopup(popupContent)
      markers.addLayer(endMarker)
    }

    // --- C. CURRENT LOCATION MARKER (BLUE PULSE) ---
    if (liveCoord && (!isTripCompleted || !endCoord)) {
      const currentMarker = L.marker([liveCoord.latitude, liveCoord.longitude], {
        icon: createCurrentLocationIcon(liveCoord.heading),
        zIndexOffset: 1100,
      })

      const popupContent = `
        <div style="font-family: inherit; font-size: 13px; line-height: 1.4; padding: 2px;">
          <div style="font-weight: 700; color: #2563eb; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2563eb;"></span>
            Current Live Location
          </div>
          <div><strong>Coordinates:</strong> ${liveCoord.latitude.toFixed(5)}, ${liveCoord.longitude.toFixed(5)}</div>
          ${liveCoord.speed_kmh != null ? `<div><strong>Speed:</strong> ${liveCoord.speed_kmh} km/h</div>` : ''}
          ${liveCoord.heading != null ? `<div><strong>Direction:</strong> ${liveCoord.heading}°</div>` : ''}
          <div><strong>Last Updated:</strong> ${liveCoord.timestamp ? new Date(liveCoord.timestamp).toLocaleTimeString() : 'Live'}</div>
        </div>
      `
      currentMarker.bindPopup(popupContent)
      markers.addLayer(currentMarker)
    }

    // --- D. AUTO FIT BOUNDS TO ENTIRE ROUTE ---
    if (autoFitOnUpdate && latLngs.length > 0) {
      if (latLngs.length === 1) {
        map.setView(latLngs[0], 15)
      } else {
        const bounds = L.latLngBounds(latLngs)
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 })
      }
    }
  }, [validRoute.length, trip?.id, trip?.status, trip?.total_distance_km, liveCoord?.latitude, liveCoord?.longitude])

  // Center on Start
  const handleCenterStart = () => {
    if (startCoord && mapInstanceRef.current) {
      mapInstanceRef.current.setView([startCoord.latitude, startCoord.longitude], 16)
    }
  }

  // Center on Current / End
  const handleCenterCurrentOrEnd = () => {
    const target = isTripCompleted && endCoord ? endCoord : liveCoord
    if (target && mapInstanceRef.current) {
      mapInstanceRef.current.setView([target.latitude, target.longitude], 16)
    }
  }

  // Fit Entire Route Bounds
  const handleFitEntireRoute = () => {
    if (mapInstanceRef.current && validRoute.length > 0) {
      if (validRoute.length === 1) {
        mapInstanceRef.current.setView([validRoute[0].latitude, validRoute[0].longitude], 15)
      } else {
        const bounds = L.latLngBounds(validRoute.map((p) => [p.latitude, p.longitude]))
        mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 })
      }
    }
  }

  // Toggle Fullscreen
  const toggleFullscreen = () => {
    if (!rootRef.current) return
    if (!document.fullscreenElement) {
      rootRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  return (
    <Box
      ref={rootRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: height,
        borderRadius: 2.5,
        overflow: 'hidden',
        border: '1px solid #cbd5e1',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
        bgcolor: '#f1f5f9',
        '&:fullscreen': {
          borderRadius: 0,
          border: 'none',
          height: '100vh',
          width: '100vw',
        },
      }}
    >
      {/* Map Canvas */}
      <Box
        ref={mapContainerRef}
        sx={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          inset: 0,
        }}
      />

      {/* Empty State Overlay */}
      {validRoute.length === 0 && (
        <Box
          sx={{
            position: 'absolute',
            top: 20,
            left: 20,
            zIndex: 1000,
            bgcolor: 'rgba(15, 23, 42, 0.88)',
            color: '#f8fafc',
            px: 2,
            py: 1.25,
            borderRadius: 1.5,
            fontSize: 13,
            fontWeight: 500,
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
          }}
        >
          No GPS Route Available for this Device / Trip
        </Box>
      )}

      {/* Top Left Navigation Quick Controls */}
      <Box
        sx={{
          position: 'absolute',
          top: 14,
          left: 14,
          zIndex: 1000,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <ButtonGroup
          size="small"
          variant="contained"
          sx={{
            bgcolor: '#ffffff',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
            borderRadius: 1.5,
            overflow: 'hidden',
            '& .MuiButton-root': {
              bgcolor: '#ffffff',
              color: '#334155',
              borderColor: '#e2e8f0',
              fontWeight: 600,
              fontSize: 12,
              px: 1.5,
              py: 0.75,
              textTransform: 'none',
              '&:hover': {
                bgcolor: '#f8fafc',
                color: '#0f172a',
              },
            },
          }}
        >
          {validRoute.length > 0 && (
            <Tooltip title="Zoom to start location">
              <button
                type="button"
                onClick={handleCenterStart}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#16a34a',
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                <MapPin size={14} /> Start
              </button>
            </Tooltip>
          )}

          {validRoute.length > 0 && (
            <Tooltip title={isTripCompleted ? 'Zoom to end location' : 'Zoom to live current position'}>
              <button
                type="button"
                onClick={handleCenterCurrentOrEnd}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  color: isTripCompleted ? '#dc2626' : '#2563eb',
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                {isTripCompleted ? <Flag size={14} /> : <Crosshair size={14} />}
                {isTripCompleted ? 'End' : 'Current'}
              </button>
            </Tooltip>
          )}

          {validRoute.length > 1 && (
            <Tooltip title="Fit complete journey route in view">
              <button
                type="button"
                onClick={handleFitEntireRoute}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#0284c7',
                }}
              >
                <Navigation size={14} /> Fit Route
              </button>
            </Tooltip>
          )}
        </ButtonGroup>
      </Box>

      {/* Top Right Controls: Tile Switcher & Fullscreen */}
      <Box
        sx={{
          position: 'absolute',
          top: 14,
          right: 14,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        {/* Style Selector */}
        <Box
          sx={{
            display: 'flex',
            bgcolor: '#ffffff',
            borderRadius: 1.5,
            p: 0.5,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            border: '1px solid #e2e8f0',
          }}
        >
          {(['standard', 'humanitarian', 'voyager'] as MapTileProvider[]).map((styleKey) => (
            <button
              key={styleKey}
              type="button"
              onClick={() => setMapStyle(styleKey)}
              style={{
                border: 'none',
                background: mapStyle === styleKey ? '#eff6ff' : 'transparent',
                color: mapStyle === styleKey ? '#2563eb' : '#64748b',
                fontWeight: mapStyle === styleKey ? 700 : 500,
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {styleKey}
            </button>
          ))}
        </Box>

        {/* Fullscreen Button */}
        <IconButton
          onClick={toggleFullscreen}
          size="small"
          aria-label="Toggle Fullscreen"
          sx={{
            bgcolor: '#ffffff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            border: '1px solid #e2e8f0',
            color: '#334155',
            '&:hover': { bgcolor: '#f8fafc' },
          }}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </IconButton>
      </Box>

      {/* Bottom Route Legend Bar */}
      {validRoute.length > 0 && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 14,
            left: 14,
            zIndex: 1000,
            bgcolor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            px: 2,
            py: 1,
            borderRadius: 1.5,
            border: '1px solid #cbd5e1',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: 2.5,
            fontSize: 12,
            color: '#334155',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#16a34a' }} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>Start Location</Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 20, height: 4, borderRadius: 1, bgcolor: '#2563eb' }} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>Travelled Route</Typography>
          </Box>

          {isTripCompleted ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#dc2626' }} />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>End Location</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#2563eb' }} />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>Current Live Position</Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

