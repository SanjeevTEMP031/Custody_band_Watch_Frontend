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
  Search,
  Sparkles,
} from 'lucide-react'
import { isValidGpsCoord, type TripPoint, type TripRecord } from '../../lib/firebase'
import {
  buildGpsTrailSegments,
  DEFAULT_GPS_TRAIL_FILTERS,
  type GpsTrailPoint,
} from '../../services/gpsTrail'
import { getRoute, getMultiPointRoute, geocode, type Coords, type RouteData } from './RouteMap'

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Fix Leaflet's default marker icons under Vite
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})

export type MapTileProvider = 'standard' | 'humanitarian' | 'voyager'
export type PathStyleOption = 'purple-dotted' | 'blue-solid' | 'both'

type DrawableTrailPoint =
  Omit<TripPoint, 'timestamp'> &
  Omit<GpsTrailPoint, 'timestamp'> & { timestamp: number }

function getDrawableTrailSegments(points: TripPoint[]): TripPoint[][] {
  const trailPoints = points
    .map((point) => {
      const timestamp = Date.parse(point.timestamp)
      return Number.isFinite(timestamp)
        ? {
            ...point,
            timestamp,
            accuracy: point.accuracy_m ?? null,
            key: `${timestamp}|${point.latitude}|${point.longitude}`,
          }
        : null
    })
    .filter((point): point is DrawableTrailPoint => point !== null)
    .sort((first, second) => first.timestamp - second.timestamp)
  const segments = buildGpsTrailSegments(trailPoints, DEFAULT_GPS_TRAIL_FILTERS)
  return segments.map((segment) => segment.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    timestamp: new Date(point.timestamp).toISOString(),
    speed_kmh: point.speed_kmh,
    heading: point.heading,
    accuracy_m: point.accuracy_m,
    battery_pct: point.battery_pct,
  })))
}

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
  routes?: Array<{
    id: string
    label: string
    color: string
    status: TripRecord['status']
    points: TripPoint[]
  }>
  routeColor?: string
  playbackPoint?: TripPoint | null
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
  routes,
  routeColor = '#2563eb',
  playbackPoint = null,
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
  const polylineOsrmRef = useRef<L.Polyline | null>(null)
  const markerGroupRef = useRef<L.LayerGroup | null>(null)
  const playbackMarkerGroupRef = useRef<L.LayerGroup | null>(null)
  const tripRouteGroupRef = useRef<L.LayerGroup | null>(null)
  const lastFittedTripIdRef = useRef<string | null>(null)

  const [mapStyle, setMapStyle] = useState<MapTileProvider>('standard')
  const [pathStyle, setPathStyle] = useState<PathStyleOption>('blue-solid')
  const [isFullscreen, setIsFullscreen] = useState(false)

  // OSRM Driving Route State
  const [osrmRoute, setOsrmRoute] = useState<RouteData | null>(null)
  const [osrmLoading, setOsrmLoading] = useState<boolean>(false)

  // Interactive Route Search / Planning State
  const [showSearch, setShowSearch] = useState<boolean>(false)
  const [searchFrom, setSearchFrom] = useState<string>('Hitech City, Hyderabad')
  const [searchTo, setSearchTo] = useState<string>('Charminar, Hyderabad')
  const [searchPoints, setSearchPoints] = useState<{ a: Coords; b: Coords } | null>(null)
  const [searchRoute, setSearchRoute] = useState<RouteData | null>(null)
  const [searchLoading, setSearchLoading] = useState<boolean>(false)
  const [searchError, setSearchError] = useState<string>('')

  // Consolidate route points from prop or trip
  const routePoints = routes ? [] : points ?? trip?.route_points ?? []
  const gpsRouteSegments = getDrawableTrailSegments(
    routePoints.filter((point) => isValidGpsCoord(point.latitude, point.longitude))
  )
  const validRoute = gpsRouteSegments.flat()
  const routeSignature = validRoute.map((point) =>
    `${point.latitude},${point.longitude},${point.timestamp}`
  ).join('|')
  const hasMultiTripPoints = Boolean(
    routes?.some((route) => route.points.some((point) => isValidGpsCoord(point.latitude, point.longitude)))
  )

  // Determine start, end, and current locations
  const startCoord = validRoute.length > 0 ? validRoute[0] : null
  const isTripCompleted = trip?.status === 'completed'
  const recordedEndCoord = trip?.end_location &&
    isValidGpsCoord(trip.end_location.latitude, trip.end_location.longitude)
    ? {
        ...trip.end_location,
        timestamp: trip.end_location.timestamp ?? '',
      }
    : null
  const endCoord = isTripCompleted
    ? recordedEndCoord ?? validRoute[validRoute.length - 1] ?? null
    : null

  const liveCoord =
    currentLocation && isValidGpsCoord(currentLocation.latitude, currentLocation.longitude)
      ? currentLocation
      : trip?.current_location && isValidGpsCoord(trip.current_location.latitude, trip.current_location.longitude)
      ? trip.current_location
      : !isTripCompleted && validRoute.length > 0
      ? validRoute[validRoute.length - 1]
      : null

  // 1. Initialize Map with both OSRM Dotted Purple and Blue polyline layers
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
    const playbackMarkers = L.layerGroup().addTo(map)
    const tripRoutes = L.layerGroup().addTo(map)

    // Halo polyline for high contrast
    const halo = L.polyline([], {
      color: '#1e40af',
      weight: 10,
      opacity: 0.45,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map)

    // Main vibrant blue polyline
    const mainLine = L.polyline([], {
      color: '#2563eb',
      weight: 6,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map)

    // Dotted purple OSRM road path: tiny dash + round caps + thick weight = row of dots
    const osrmLine = L.polyline([], {
      color: '#4f1fd1',
      weight: 9,
      dashArray: '1 14',
      lineCap: 'round',
    }).addTo(map)

    mapInstanceRef.current = map
    tileLayerRef.current = initialTiles
    markerGroupRef.current = markers
    playbackMarkerGroupRef.current = playbackMarkers
    tripRouteGroupRef.current = tripRoutes
    polylineHaloRef.current = halo
    polylineMainRef.current = mainLine
    polylineOsrmRef.current = osrmLine

    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    observer.observe(mapContainerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapInstanceRef.current = null
      tileLayerRef.current = null
      markerGroupRef.current = null
      playbackMarkerGroupRef.current = null
      tripRouteGroupRef.current = null
      polylineHaloRef.current = null
      polylineMainRef.current = null
      polylineOsrmRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapInstanceRef.current
    const markerGroup = playbackMarkerGroupRef.current
    if (!map || !markerGroup) return

    markerGroup.clearLayers()
    if (
      !playbackPoint ||
      !isValidGpsCoord(playbackPoint.latitude, playbackPoint.longitude)
    ) return

    const marker = L.marker(
      [playbackPoint.latitude, playbackPoint.longitude],
      {
        icon: createCurrentLocationIcon(playbackPoint.heading),
        zIndexOffset: 1400,
      }
    )
    marker.bindPopup(`
      <div style="font-family: inherit; font-size: 13px; line-height: 1.4;">
        <strong>Playback position</strong>
        <div>${playbackPoint.latitude.toFixed(5)}, ${playbackPoint.longitude.toFixed(5)}</div>
        <div>${new Date(playbackPoint.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
      </div>
    `)
    marker.addTo(markerGroup)
    map.panTo([playbackPoint.latitude, playbackPoint.longitude], {
      animate: true,
      duration: 0.6,
    })
  }, [
    playbackPoint?.latitude,
    playbackPoint?.longitude,
    playbackPoint?.timestamp,
    playbackPoint?.heading,
  ])

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

  // 2b. Automatically compute OSRM Road-snapped Driving Route for Selected Journey
  useEffect(() => {
    if (routes) {
      setOsrmRoute(null)
      setOsrmLoading(false)
      return
    }
    if (!startCoord || validRoute.length < 2 || gpsRouteSegments.length !== 1) {
      setOsrmRoute(null)
      setOsrmLoading(false)
      return
    }

    const destCoord = isTripCompleted && endCoord ? endCoord : liveCoord
    if (!destCoord) {
      setOsrmRoute(null)
      return
    }

    let isCurrent = true
    setOsrmLoading(true)

    const fetchOsrmPath = async () => {
      try {
        // If there are intermediate route points, sample up to 10 points
        if (validRoute.length > 2) {
          const step = Math.max(1, Math.floor(validRoute.length / 8))
          const sampled: Coords[] = []
          for (let i = 0; i < validRoute.length; i += step) {
            sampled.push({ lat: validRoute[i].latitude, lng: validRoute[i].longitude })
          }
          const lastValid = validRoute[validRoute.length - 1]
          if (
            sampled[sampled.length - 1].lat !== lastValid.latitude ||
            sampled[sampled.length - 1].lng !== lastValid.longitude
          ) {
            sampled.push({ lat: lastValid.latitude, lng: lastValid.longitude })
          }

          if (sampled.length >= 2) {
            const data = await getMultiPointRoute(sampled)
            if (isCurrent) setOsrmRoute(data)
            return
          }
        }

        const data = await getRoute(
          { lat: startCoord.latitude, lng: startCoord.longitude },
          { lat: destCoord.latitude, lng: destCoord.longitude }
        )
        if (isCurrent) {
          setOsrmRoute(data)
        }
      } catch (err) {
        console.warn('OSRM road route calculation fallback to direct GPS points:', err)
        if (isCurrent) setOsrmRoute(null)
      } finally {
        if (isCurrent) setOsrmLoading(false)
      }
    }

    fetchOsrmPath()

    return () => {
      isCurrent = false
    }
  }, [
    startCoord?.latitude,
    startCoord?.longitude,
    endCoord?.latitude,
    endCoord?.longitude,
    liveCoord?.latitude,
    liveCoord?.longitude,
    routeSignature,
    gpsRouteSegments.length,
    isTripCompleted,
    routes,
  ])

  // 3. Render route polylines, start marker, end marker, search markers and live position marker
  useEffect(() => {
    const map = mapInstanceRef.current
    const markers = markerGroupRef.current
    const tripRoutes = tripRouteGroupRef.current
    const halo = polylineHaloRef.current
    const mainLine = polylineMainRef.current
    const osrmLine = polylineOsrmRef.current
    if (!map || !markers || !tripRoutes || !halo || !mainLine || !osrmLine) return

    markers.clearLayers()
    tripRoutes.clearLayers()

    const latLngs: L.LatLngTuple[] = validRoute.map((p) => [p.latitude, p.longitude])
    const allTripBounds: L.LatLngTuple[] = []

    if (routes) {
      routes.forEach((route) => {
        const validPoints = route.points.filter((point) =>
          isValidGpsCoord(point.latitude, point.longitude)
        )
        const segments = getDrawableTrailSegments(validPoints)
        const routePoints = segments.flat()
        segments.forEach((segment) => {
          const routeCoordinates = segment.map(
            (point): L.LatLngTuple => [point.latitude, point.longitude]
          )
          if (routeCoordinates.length > 1) {
            L.polyline(routeCoordinates, {
              color: route.color,
              weight: 5,
              opacity: 0.9,
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(tripRoutes)
          }
        })
        routePoints.forEach((point, index) => {
          const dot = L.circleMarker([point.latitude, point.longitude], {
            radius: routePoints.length === 1 ? 7 : 3.5,
            color: '#ffffff',
            weight: 1.5,
            fillColor: route.color,
            fillOpacity: 1,
          })
          if (index === 0) dot.bindTooltip(`${route.label} · start`)
          else if (index === routePoints.length - 1) dot.bindTooltip(`${route.label} · end`)
          dot.addTo(tripRoutes)
        })
        allTripBounds.push(...routePoints.map(
          (point): L.LatLngTuple => [point.latitude, point.longitude]
        ))
      })
      osrmLine.setLatLngs([])
      halo.setLatLngs([])
      mainLine.setLatLngs([])
    }

    // In-progress journey: extend live polyline to the current live coordinate
    const latLngSegments: L.LatLngTuple[][] = gpsRouteSegments.map((segment) =>
      segment.map(({ latitude, longitude }) => [latitude, longitude])
    )
    if (!routes && !isTripCompleted && liveCoord && latLngs.length > 0) {
      const lastPt = latLngs[latLngs.length - 1]
      if (lastPt[0] !== liveCoord.latitude || lastPt[1] !== liveCoord.longitude) {
        latLngs.push([liveCoord.latitude, liveCoord.longitude])
        latLngSegments[latLngSegments.length - 1]?.push([
          liveCoord.latitude,
          liveCoord.longitude,
        ])
      }
    }

    // Determine path to render for OSRM Dotted Purple line
    const activeRoadPath: L.LatLngTuple[] = searchRoute?.path ?? osrmRoute?.path ?? []

    if (!routes && pathStyle === 'purple-dotted') {
      osrmLine.setLatLngs(activeRoadPath)
      halo.setLatLngs([])
      mainLine.setLatLngs([])
    } else if (!routes && pathStyle === 'blue-solid') {
      osrmLine.setLatLngs([])
      halo.setLatLngs(latLngSegments)
      mainLine.setLatLngs(latLngSegments)
    } else if (!routes) {
      // Both
      osrmLine.setLatLngs(activeRoadPath)
      halo.setLatLngs(latLngSegments)
      mainLine.setLatLngs(latLngSegments)
    }
    if (!routes) {
      validRoute.forEach((point) => {
        L.circleMarker([point.latitude, point.longitude], {
          radius: validRoute.length === 1 ? 7 : 3,
          color: '#ffffff',
          weight: 1,
          fillColor: routeColor,
          fillOpacity: 1,
        }).addTo(markers)
      })
    }

    // --- A. START MARKER (GREEN) ---
    if (!routes && startCoord) {
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
          <div><strong>Start Time:</strong> ${startCoord.timestamp ? new Date(startCoord.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A'}</div>
          ${trip?.wearer_name ? `<div><strong>Wearer:</strong> ${trip.wearer_name}</div>` : ''}
          ${osrmRoute ? `<div style="color: #4f1fd1; font-weight: 600; margin-top: 4px;">OSRM road estimate (not recorded travel): ${osrmRoute.distanceKm.toFixed(1)} km · ${Math.round(osrmRoute.durationMin)} min</div>` : ''}
        </div>
      `
      startMarker.bindPopup(popupContent)
      markers.addLayer(startMarker)
    }

    // --- B. END MARKER (RED) ---
    if (!routes && endCoord && isTripCompleted) {
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
          <div><strong>End Time:</strong> ${endCoord.timestamp ? new Date(endCoord.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A'}</div>
          <div><strong>Total Travelled:</strong> ${trip?.total_distance_km?.toFixed(2) ?? '—'} km</div>
          ${osrmRoute ? `<div style="color: #4f1fd1; font-weight: 600; margin-top: 4px;">OSRM road estimate (not recorded travel): ${osrmRoute.distanceKm.toFixed(1)} km · ${Math.round(osrmRoute.durationMin)} min</div>` : ''}
        </div>
      `
      endMarker.bindPopup(popupContent)
      markers.addLayer(endMarker)
    }

    // --- C. CURRENT LOCATION MARKER (BLUE PULSE) ---
    if (liveCoord && (routes || !isTripCompleted || !endCoord)) {
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
          <div><strong>Last Updated:</strong> ${liveCoord.timestamp ? new Date(liveCoord.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Live'}</div>
          ${osrmRoute ? `<div style="color: #4f1fd1; font-weight: 600; margin-top: 4px;">Route from Start: ${osrmRoute.distanceKm.toFixed(1)} km · ${Math.round(osrmRoute.durationMin)} min</div>` : ''}
        </div>
      `
      currentMarker.bindPopup(popupContent)
      markers.addLayer(currentMarker)
    }

    // --- D. SEARCH ROUTE MARKERS (IF ACTIVE SEARCH) ---
    if (searchPoints) {
      const sMarker = L.marker([searchPoints.a.lat, searchPoints.a.lng]).bindPopup(
        `<div style="padding: 2px;"><strong>Start Point A:</strong> ${searchFrom}</div>`
      )
      const eMarker = L.marker([searchPoints.b.lat, searchPoints.b.lng]).bindPopup(
        `<div style="padding: 2px;"><strong>Destination Point B:</strong> ${searchTo}</div>`
      )
      markers.addLayer(sMarker)
      markers.addLayer(eMarker)
    }

    // --- E. AUTO FIT BOUNDS ---
    const tripId = trip?.id ?? 'default'
    const isNewJourney = lastFittedTripIdRef.current !== tripId

    if (searchRoute && searchRoute.path.length > 0) {
      map.fitBounds(searchRoute.path, { padding: [40, 40] })
    } else if (routes && allTripBounds.length > 0 && autoFitOnUpdate) {
      const bounds = L.latLngBounds(allTripBounds)
      if (allTripBounds.length === 1) map.setView(allTripBounds[0], 15)
      else map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 })
    } else if (autoFitOnUpdate && latLngs.length > 0 && isNewJourney) {
      lastFittedTripIdRef.current = tripId
      const boundsTarget = latLngs
      if (boundsTarget.length === 1) {
        map.setView(boundsTarget[0], 15)
      } else {
        const bounds = L.latLngBounds(boundsTarget)
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 })
      }
    } else if (liveCoord && !isTripCompleted && !isNewJourney) {
      map.panTo([liveCoord.latitude, liveCoord.longitude], { animate: true })
    }
  }, [
    validRoute.map((p) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)},${p.timestamp}`).join('|'),
    trip?.id,
    trip?.status,
    trip?.total_distance_km,
    liveCoord?.latitude,
    liveCoord?.longitude,
    liveCoord?.heading,
    liveCoord?.speed_kmh,
    liveCoord?.timestamp,
    osrmRoute?.distanceKm,
    osrmRoute?.path?.length,
    pathStyle,
    searchRoute,
    searchPoints,
    routes,
    routeColor,
  ])

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
    if (mapInstanceRef.current) {
      const allRoutesPath = routes?.flatMap((route) =>
        route.points
          .filter((point) => isValidGpsCoord(point.latitude, point.longitude))
          .map((point) => [point.latitude, point.longitude] as L.LatLngTuple)
      ) ?? []
      const targetPath = searchRoute?.path ??
        (osrmRoute?.path && osrmRoute.path.length > 0
          ? osrmRoute.path
          : allRoutesPath.length > 0
            ? allRoutesPath
            : validRoute.map((point) => [point.latitude, point.longitude] as L.LatLngTuple))
      if (targetPath.length === 1) {
        mapInstanceRef.current.setView(targetPath[0], 15)
      } else if (targetPath.length > 1) {
        const bounds = L.latLngBounds(targetPath)
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

  // Handle Search Submission
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchFrom.trim() || !searchTo.trim()) {
      setSearchError('Please provide both Start and Destination addresses')
      return
    }
    setSearchLoading(true)
    setSearchError('')
    try {
      const a = await geocode(searchFrom)
      const b = await geocode(searchTo)
      const r = await getRoute(a, b)
      setSearchPoints({ a, b })
      setSearchRoute(r)
      setPathStyle('purple-dotted')
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Could not calculate road route')
    } finally {
      setSearchLoading(false)
    }
  }

  // Auto-fill Search from device coords
  const handleUseJourneyPoints = () => {
    if (startCoord) {
      setSearchFrom(`${startCoord.latitude.toFixed(5)}, ${startCoord.longitude.toFixed(5)}`)
    }
    const dest = endCoord || liveCoord
    if (dest) {
      setSearchTo(`${dest.latitude.toFixed(5)}, ${dest.longitude.toFixed(5)}`)
    }
  }

  // Clear search and restore device route
  const handleClearSearch = () => {
    setSearchRoute(null)
    setSearchPoints(null)
    setSearchError('')
    handleFitEntireRoute()
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
      {validRoute.length === 0 && !hasMultiTripPoints && !liveCoord && !searchRoute && (
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
          No GPS Route Available for this Device / Trip. You can use "Plan / Search Route" to calculate paths.
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
          alignItems: 'center',
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

          {(validRoute.length > 1 || hasMultiTripPoints || searchRoute) && (
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
                  borderRight: '1px solid #e2e8f0',
                }}
              >
                <Navigation size={14} /> Fit Route
              </button>
            </Tooltip>
          )}

          {/* Toggle Plan / Search Route Panel */}
          <Tooltip title="Plan custom road route between addresses with OSRM">
            <button
              type="button"
              onClick={() => setShowSearch(!showSearch)}
              style={{
                background: showSearch ? '#f3e8ff' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                fontWeight: 700,
                color: '#4f1fd1',
              }}
            >
              <Search size={14} /> Plan / Search Route
            </button>
          </Tooltip>
        </ButtonGroup>

        {/* Path Style Selector */}
        {!routes && <Box
          sx={{
            display: 'flex',
            bgcolor: '#ffffff',
            borderRadius: 1.5,
            p: 0.5,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            border: '1px solid #e2e8f0',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          <button
            type="button"
            onClick={() => setPathStyle('purple-dotted')}
            style={{
              border: 'none',
              background: pathStyle === 'purple-dotted' ? '#f3e8ff' : 'transparent',
              color: pathStyle === 'purple-dotted' ? '#4f1fd1' : '#64748b',
              fontWeight: pathStyle === 'purple-dotted' ? 700 : 500,
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#4f1fd1' }} />
            Road Estimate
          </button>
          <button
            type="button"
            onClick={() => setPathStyle('blue-solid')}
            style={{
              border: 'none',
              background: pathStyle === 'blue-solid' ? '#eff6ff' : 'transparent',
              color: pathStyle === 'blue-solid' ? '#2563eb' : '#64748b',
              fontWeight: pathStyle === 'blue-solid' ? 700 : 500,
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#2563eb' }} />
            Solid Blue
          </button>
          <button
            type="button"
            onClick={() => setPathStyle('both')}
            style={{
              border: 'none',
              background: pathStyle === 'both' ? '#f8fafc' : 'transparent',
              color: pathStyle === 'both' ? '#0f172a' : '#64748b',
              fontWeight: pathStyle === 'both' ? 700 : 500,
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Both
          </button>
        </Box>}

        {/* Live OSRM Road Distance & Driving Time Pill */}
        {!routes && osrmLoading && !searchRoute && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              bgcolor: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(6px)',
              px: 1.5,
              py: 0.6,
              borderRadius: 1.5,
              border: '1px solid #d8b4fe',
              fontSize: 12,
              fontWeight: 600,
              color: '#4f1fd1',
            }}
          >
            <Sparkles size={14} color="#4f1fd1" className="animate-spin" />
            <span>Calculating Road Path…</span>
          </Box>
        )}

        {!routes && osrmRoute && !searchRoute && !osrmLoading && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              bgcolor: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(6px)',
              px: 1.5,
              py: 0.6,
              borderRadius: 1.5,
              border: '1px solid #d8b4fe',
              boxShadow: '0 2px 8px rgba(79, 31, 209, 0.12)',
              fontSize: 12,
              fontWeight: 700,
              color: '#4f1fd1',
            }}
          >
            <Sparkles size={14} color="#4f1fd1" />
            <span>Road: {osrmRoute.distanceKm.toFixed(1)} km</span>
            <span style={{ color: '#9333ea' }}>·</span>
            <span>{Math.round(osrmRoute.durationMin)} min</span>
          </Box>
        )}
      </Box>

      {/* Floating Route Search & Directions Panel */}
      {showSearch && (
        <Box
          component="form"
          onSubmit={handleSearchSubmit}
          sx={{
            position: 'absolute',
            top: 60,
            left: 14,
            right: 14,
            maxWidth: 860,
            zIndex: 1000,
            bgcolor: 'rgba(255, 255, 255, 0.98)',
            backdropFilter: 'blur(10px)',
            p: 1.5,
            borderRadius: 2,
            border: '1px solid #cbd5e1',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1.25,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: 1, minWidth: 200 }}>
            <Typography variant="caption" sx={{ fontWeight: 800, color: '#16a34a' }}>FROM:</Typography>
            <input
              value={searchFrom}
              onChange={(e) => setSearchFrom(e.target.value)}
              placeholder="From (point A)"
              style={{
                width: '100%',
                padding: '7px 10px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                outline: 'none',
              }}
            />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: 1, minWidth: 200 }}>
            <Typography variant="caption" sx={{ fontWeight: 800, color: '#dc2626' }}>TO:</Typography>
            <input
              value={searchTo}
              onChange={(e) => setSearchTo(e.target.value)}
              placeholder="To (point B)"
              style={{
                width: '100%',
                padding: '7px 10px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                outline: 'none',
              }}
            />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <button
              type="submit"
              disabled={searchLoading}
              style={{
                background: searchLoading ? '#94a3b8' : '#4f1fd1',
                color: '#ffffff',
                border: 'none',
                padding: '7px 15px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                cursor: searchLoading ? 'not-allowed' : 'pointer',
                boxShadow: '0 2px 6px rgba(79, 31, 209, 0.3)',
              }}
            >
              {searchLoading ? 'Routing…' : 'Show Route'}
            </button>

            {(startCoord || liveCoord) && (
              <button
                type="button"
                onClick={handleUseJourneyPoints}
                style={{
                  background: '#f1f5f9',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  padding: '7px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Use Device Coords
              </button>
            )}

            {searchRoute && (
              <button
                type="button"
                onClick={handleClearSearch}
                style={{
                  background: 'transparent',
                  color: '#64748b',
                  border: 'none',
                  padding: '7px 6px',
                  fontSize: 11,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Clear
              </button>
            )}
          </Box>

          {searchRoute && (
            <Box
              sx={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                bgcolor: '#f5f3ff',
                color: '#4f1fd1',
                px: 1.5,
                py: 0.75,
                borderRadius: 1,
                fontSize: 12,
                fontWeight: 700,
                border: '1px solid #d8b4fe',
              }}
            >
              <span>🛣️ OSRM Road Distance: {searchRoute.distanceKm.toFixed(1)} km</span>
              <span>⏱️ Driving Time: {Math.round(searchRoute.durationMin)} min</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: '#6d28d9' }}>(OSRM estimate, not recorded travel)</span>
            </Box>
          )}

          {searchError && (
            <Typography variant="caption" sx={{ color: '#dc2626', fontWeight: 600, width: '100%' }}>
              {searchError}
            </Typography>
          )}
        </Box>
      )}

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
      {(validRoute.length > 0 || searchRoute) && (
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
            <Box
              sx={{
                width: 24,
                height: 5,
                borderRadius: 2,
                bgcolor: '#4f1fd1',
                border: '1px dashed #ffffff',
              }}
            />
            <Typography variant="caption" sx={{ fontWeight: 700, color: '#4f1fd1' }}>
              OSRM road estimate (not recorded travel)
            </Typography>
          </Box>

          {pathStyle !== 'purple-dotted' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 20, height: 4, borderRadius: 1, bgcolor: '#2563eb' }} />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>GPS Telemetry Line</Typography>
            </Box>
          )}

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
