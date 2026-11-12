import { useEffect, useRef } from 'react'
import L from 'leaflet'
import {
  ApiError,
  getGpsHistory,
  getLatestGpsLocation,
  type GpsLocation,
} from '../../services/api'
import {
  isFreshGpsTimestamp,
  normalizeVerifiedGpsFix,
} from '../../services/gpsNormalization'
import {
  appendGpsTrailPoint,
  DEFAULT_GPS_TRAIL_FILTERS,
} from '../../services/gpsTrail'

interface RoutePoint {
  latitude: number
  longitude: number
  timestamp: number
  accuracy: number | null
  source: string
  key: string
}

interface RouteState {
  segments: RoutePoint[][]
  keys: Set<string>
  historyPointKeys: Set<string>
  layers: L.Polyline[]
  dots: L.CircleMarker[]
  dotKeys: Set<string>
  latest: RoutePoint | null
  currentFix: RoutePoint | null
  latestApiFix: RoutePoint | null
  lastMovementPoint: RoutePoint | null
  historyLatestTimestamp: number | null
  historyLoaded: boolean
  firestoreHistoryMismatch: boolean
  latestHistoryMismatch: boolean
}

export const SELECTED_GPS_POLL_INTERVAL_MS = 3_000
export const GPS_TRAIL_CONFIG = {
  dotColor: '#2563EB',
  lineColor: '#2563EB',
  dotRadius: 3,
  lineWidth: 3,
  minMovementMeters: 5,
} as const

export type SelectedGpsRouteStatus =
  | 'loading'
  | 'available'
  | 'unavailable'
  | 'history-sync'
  | 'unavailable-history-sync'
  | 'configuration-error'
export type SelectedGpsRouteSegment = Array<{
  latitude: number
  longitude: number
  timestamp: number
}>

const HISTORY_REFRESH_INTERVAL_MS = 30_000
function parsePoint(value: unknown): RoutePoint | null {
  const fix = normalizeVerifiedGpsFix(value)
  if (!fix) return null
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    timestamp: fix.timestamp,
    accuracy: fix.accuracy,
    source: fix.source,
    key: fix.key,
  }
}

function addPoint(route: RouteState, point: RoutePoint): boolean {
  return appendGpsTrailPoint(route, point, {
    ...DEFAULT_GPS_TRAIL_FILTERS,
    minMovementMeters: GPS_TRAIL_CONFIG.minMovementMeters,
  })
}

function routeSegments(route: RouteState): SelectedGpsRouteSegment[] {
  return route.segments.map((segment) => segment.map(({ latitude, longitude, timestamp }) => ({
    latitude,
    longitude,
    timestamp,
  })))
}

function getRouteStatus(route: RouteState): SelectedGpsRouteStatus {
  const freshHistoryFix = route.latest && isFreshGpsTimestamp(route.latest.timestamp)
  const freshCurrentFix = route.currentFix && isFreshGpsTimestamp(route.currentFix.timestamp)
  const hasFreshFix = Boolean(freshHistoryFix || freshCurrentFix)
  const historySync = route.firestoreHistoryMismatch || route.latestHistoryMismatch
  if (historySync) return hasFreshFix ? 'history-sync' : 'unavailable-history-sync'
  return hasFreshFix ? 'available' : 'unavailable'
}

function syncLayers(map: L.Map | null, route: RouteState, visible: boolean): void {
  if (!map) return
  if (!visible) {
    route.layers.forEach((layer) => layer.remove())
    route.layers = []
    route.dots.forEach((dot) => dot.remove())
    route.dots = []
    route.dotKeys.clear()
    return
  }
  route.segments.forEach((segment, index) => {
    if (segment.length >= 2) {
      const coordinates: [number, number][] = segment.map(({ latitude, longitude }) => [
        latitude,
        longitude,
      ])
      const layer = route.layers[index]
      if (layer) layer.setLatLngs(coordinates)
      else {
        route.layers[index] = L.polyline(coordinates, {
          color: GPS_TRAIL_CONFIG.lineColor,
          weight: GPS_TRAIL_CONFIG.lineWidth,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round',
          className: 'gps-trail-line',
        }).addTo(map)
      }
    }
    segment.forEach((point) => {
      if (route.dotKeys.has(point.key)) return
      route.dots.push(L.circleMarker([point.latitude, point.longitude], {
        radius: GPS_TRAIL_CONFIG.dotRadius,
        color: '#ffffff',
        weight: 0.5,
        fillColor: GPS_TRAIL_CONFIG.dotColor,
        fillOpacity: 1,
        className: 'gps-trail-dot',
      }).addTo(map))
      route.dotKeys.add(point.key)
    })
  })
  route.layers.splice(route.segments.length).forEach((layer) => layer.remove())
}

export function useSelectedGpsRoute(
  map: L.Map | null,
  deviceId: string | null,
  visible: boolean,
  onFreshPoint: (point: GpsLocation) => void,
  onRouteChange?: (segments: SelectedGpsRouteSegment[]) => void,
  onStatusChange?: (status: SelectedGpsRouteStatus) => void,
  enabled = true,
  firestoreLatest?: GpsLocation | null
): void {
  const onFreshPointRef = useRef(onFreshPoint)
  const onRouteChangeRef = useRef(onRouteChange)
  const onStatusChangeRef = useRef(onStatusChange)
  const firestoreLatestRef = useRef(firestoreLatest)
  const routeRef = useRef<RouteState | null>(null)
  const visibleRef = useRef(visible)
  useEffect(() => {
    onFreshPointRef.current = onFreshPoint
  }, [onFreshPoint])
  useEffect(() => {
    onRouteChangeRef.current = onRouteChange
  }, [onRouteChange])
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])
  useEffect(() => {
    firestoreLatestRef.current = firestoreLatest
    const route = routeRef.current
    if (!route?.historyLoaded) return
    const firestorePoint = firestoreLatest ? parsePoint(firestoreLatest) : null
    route.firestoreHistoryMismatch = Boolean(
      firestorePoint &&
      !route.historyPointKeys.has(firestorePoint.key) &&
      (route.historyLatestTimestamp === null || firestorePoint.timestamp > route.historyLatestTimestamp)
    )
    onStatusChangeRef.current?.(getRouteStatus(route))
  }, [firestoreLatest])
  useEffect(() => {
    visibleRef.current = visible
    if (map && routeRef.current) syncLayers(map, routeRef.current, visible)
  }, [map, visible])

  useEffect(() => {
    if (!enabled) return
    if (!deviceId) {
      onRouteChangeRef.current?.([])
      onStatusChangeRef.current?.('unavailable')
      return
    }
    const route: RouteState = {
      segments: [],
      keys: new Set(),
      historyPointKeys: new Set(),
      layers: [],
      dots: [],
      dotKeys: new Set(),
      latest: null,
      currentFix: null,
      latestApiFix: null,
      lastMovementPoint: null,
      historyLatestTimestamp: null,
      historyLoaded: false,
      firestoreHistoryMismatch: false,
      latestHistoryMismatch: false,
    }
    routeRef.current = route
    let cancelled = false
    let timer: number | undefined
    let lastHistoryRefreshAt = 0
    const requestController = new AbortController()
    onRouteChangeRef.current?.([])
    onStatusChangeRef.current?.('loading')

    const pollLatest = async () => {
      if (cancelled) return
      try {
        const latest = await getLatestGpsLocation(deviceId, requestController.signal)
        const point = latest ? parsePoint(latest) : null
        route.latestApiFix = point
        route.currentFix = point && isFreshGpsTimestamp(point.timestamp) ? point : null
        route.latestHistoryMismatch = Boolean(point && !route.historyPointKeys.has(point.key))
        if (latest && point && route.currentFix) {
          onFreshPointRef.current(latest)
        }
        onStatusChangeRef.current?.(getRouteStatus(route))
        if (Date.now() - lastHistoryRefreshAt >= HISTORY_REFRESH_INTERVAL_MS) {
          await refreshHistory()
        }
      } catch (error) {
        if (!cancelled) {
          const configurationError = error instanceof ApiError && error.configurationError
          onStatusChangeRef.current?.(
            configurationError ? 'configuration-error' : getRouteStatus(route)
          )
          console.warn(`Unable to refresh GPS route for device ${deviceId}.`, error)
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(pollLatest, SELECTED_GPS_POLL_INTERVAL_MS)
      }
    }

    const refreshHistory = async () => {
      lastHistoryRefreshAt = Date.now()
      const history = await getGpsHistory(deviceId, 500, requestController.signal)
      if (cancelled) return
      const points = history
        .map(parsePoint)
        .filter((point): point is RoutePoint => point !== null)
      const uniquePoints = new Map(points.map((point) => [point.key, point]))
      const sortedPoints = [...uniquePoints.values()]
        .sort((first, second) => first.timestamp - second.timestamp)
      route.historyPointKeys = new Set(sortedPoints.map((point) => point.key))
      route.historyLatestTimestamp = sortedPoints.length > 0
        ? sortedPoints[sortedPoints.length - 1].timestamp
        : null
      route.historyLoaded = true
      for (const point of sortedPoints) {
        if (addPoint(route, point)) syncLayers(map, route, visibleRef.current)
      }
      route.latestHistoryMismatch = Boolean(
        route.latestApiFix && !route.historyPointKeys.has(route.latestApiFix.key)
      )
      const firestorePoint = firestoreLatestRef.current
        ? parsePoint(firestoreLatestRef.current)
        : null
      route.firestoreHistoryMismatch = Boolean(
        firestorePoint &&
        !route.historyPointKeys.has(firestorePoint.key) &&
        (route.historyLatestTimestamp === null || firestorePoint.timestamp > route.historyLatestTimestamp)
      )
      syncLayers(map, route, visibleRef.current)
      onRouteChangeRef.current?.(routeSegments(route))
      onStatusChangeRef.current?.(getRouteStatus(route))
      if (route.latest && isFreshGpsTimestamp(route.latest.timestamp)) {
        onFreshPointRef.current({
          latitude: route.latest.latitude,
          longitude: route.latest.longitude,
          recorded_at: new Date(route.latest.timestamp).toISOString(),
          accuracy_m: route.latest.accuracy,
          gps_fix: true,
          gps_valid: true,
          gps_source: route.latest.source,
          gps_status: 'GPS VALID',
        })
      }
    }

    const loadHistory = async () => {
      try {
        await refreshHistory()
      } catch (error) {
        if (!cancelled) {
          if (error instanceof ApiError && error.configurationError) {
            onStatusChangeRef.current?.('configuration-error')
          }
          console.warn(`Unable to load GPS history for device ${deviceId}.`, error)
        }
      }
      if (!cancelled) void pollLatest()
    }

    void loadHistory()
    return () => {
      cancelled = true
      requestController.abort()
      if (timer !== undefined) window.clearTimeout(timer)
      route.layers.forEach((layer) => layer.remove())
      route.dots.forEach((dot) => dot.remove())
      if (routeRef.current === route) routeRef.current = null
    }
  }, [enabled, map, deviceId])
}
