import { useEffect, useRef } from 'react'
import L from 'leaflet'
import {
  ApiError,
  getGpsHistory,
  getLatestGpsSnapshot,
  type GpsLocation,
} from '../../services/api'
import { subscribeToFirestoreLocationHistory } from '../../lib/firebase'
import {
  isFreshGpsTimestamp,
  matchLegacyGpsFixToVerifiedHistory,
  normalizeVerifiedGpsFix,
  type LastReportedGpsLocation,
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
  historyPoints: Map<string, RoutePoint>
  livePoints: Map<string, RoutePoint>
  startMarker: L.CircleMarker | null
  endMarker: L.CircleMarker | null
}

export const SELECTED_GPS_POLL_INTERVAL_MS = 5_000
export const GPS_TRAIL_CONFIG = {
  dotColor: '#2563EB',
  lineColor: '#2563EB',
  dotRadius: 3,
  lineWidth: 5,
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

function rebuildRoute(map: L.Map | null, route: RouteState, visible: boolean): void {
  const points = new Map([...route.historyPoints, ...route.livePoints])
  const sortedPoints = [...points.values()].sort(
    (first, second) => first.timestamp - second.timestamp
  )
  route.segments = []
  route.keys.clear()
  route.latest = null
  route.lastMovementPoint = null
  for (const point of sortedPoints) addPoint(route, point)
  syncLayers(map, route, visible)
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
    route.startMarker?.remove()
    route.startMarker = null
    route.endMarker?.remove()
    route.endMarker = null
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
          weight: 5,
          opacity: 1,
          lineJoin: 'round',
          lineCap: 'round',
          className: 'gps-trail-line',
        }).addTo(map)
      }
      route.layers[index].bringToFront()
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

  const firstPoint = route.segments.find((segment) => segment.length > 0)?.[0]
  const lastSegment = [...route.segments].reverse().find((segment) => segment.length > 0)
  const lastPoint = lastSegment?.[lastSegment.length - 1]
  if (firstPoint) {
    if (route.startMarker) route.startMarker.setLatLng([firstPoint.latitude, firstPoint.longitude])
    else {
      route.startMarker = L.circleMarker([firstPoint.latitude, firstPoint.longitude], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#16a34a',
        fillOpacity: 1,
      }).bindTooltip('Route start').addTo(map)
    }
  }
  if (lastPoint) {
    if (route.endMarker) route.endMarker.setLatLng([lastPoint.latitude, lastPoint.longitude])
    else {
      route.endMarker = L.circleMarker([lastPoint.latitude, lastPoint.longitude], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#dc2626',
        fillOpacity: 1,
      }).bindTooltip('Latest route point').addTo(map)
    }
  }
}

export function useSelectedGpsRoute(
  map: L.Map | null,
  deviceId: string | null,
  visible: boolean,
  onFreshPoint: (point: GpsLocation) => void,
  onRouteChange?: (segments: SelectedGpsRouteSegment[]) => void,
  onStatusChange?: (status: SelectedGpsRouteStatus) => void,
  enabled = true,
  firestoreLatest?: GpsLocation | null,
  firestoreLastFix?: unknown,
  onLastKnownPoint?: (point: GpsLocation) => void,
  onLastReportedLocation?: (
    location: LastReportedGpsLocation | null,
    currentGpsAvailable: boolean
  ) => void,
  includeHistory = true
): void {
  const onFreshPointRef = useRef(onFreshPoint)
  const onLastKnownPointRef = useRef(onLastKnownPoint)
  const onLastReportedLocationRef = useRef(onLastReportedLocation)
  const onRouteChangeRef = useRef(onRouteChange)
  const onStatusChangeRef = useRef(onStatusChange)
  const firestoreLatestRef = useRef(firestoreLatest)
  const firestoreLastFixRef = useRef(firestoreLastFix)
  const routeRef = useRef<RouteState | null>(null)
  const visibleRef = useRef(visible)
  useEffect(() => {
    onFreshPointRef.current = onFreshPoint
  }, [onFreshPoint])
  useEffect(() => {
    onLastKnownPointRef.current = onLastKnownPoint
  }, [onLastKnownPoint])
  useEffect(() => {
    onLastReportedLocationRef.current = onLastReportedLocation
  }, [onLastReportedLocation])
  useEffect(() => {
    firestoreLastFixRef.current = firestoreLastFix
  }, [firestoreLastFix])
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
      onLastReportedLocationRef.current?.(null, false)
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
      historyPoints: new Map(),
      livePoints: new Map(),
      startMarker: null,
      endMarker: null,
    }
    routeRef.current = route
    let cancelled = false
    let timer: number | undefined
    let apiHistoryRequested = false
    const requestController = new AbortController()
    onRouteChangeRef.current?.([])
    onStatusChangeRef.current?.('loading')

    const pollLatest = async () => {
      if (cancelled) return
      try {
        const firestorePoint = firestoreLatestRef.current
        const snapshot = firestorePoint
          ? { latest: firestorePoint, lastReported: null }
          : await getLatestGpsSnapshot(deviceId, requestController.signal)
        const latest = snapshot.latest
        const point = latest ? parsePoint(latest) : null
        route.latestApiFix = point
        route.currentFix = point && isFreshGpsTimestamp(point.timestamp) ? point : null
        route.latestHistoryMismatch = includeHistory &&
          Boolean(point && !route.historyPointKeys.has(point.key))
        if (route.currentFix && !route.livePoints.has(route.currentFix.key)) {
          route.livePoints.set(route.currentFix.key, route.currentFix)
          if (route.livePoints.size > 500) {
            const oldest = [...route.livePoints.values()].reduce((first, next) =>
              next.timestamp < first.timestamp ? next : first
            )
            route.livePoints.delete(oldest.key)
          }
          rebuildRoute(map, route, visibleRef.current)
          onRouteChangeRef.current?.(routeSegments(route))
        }
        onLastReportedLocationRef.current?.(
          route.currentFix ? null : snapshot.lastReported,
          Boolean(route.currentFix)
        )
        if (latest && point) {
          if (route.currentFix) onFreshPointRef.current(latest)
          else onLastKnownPointRef.current?.(latest)
        }
        onStatusChangeRef.current?.(getRouteStatus(route))
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

    const refreshHistory = (history: GpsLocation[]) => {
      if (cancelled) return
      const points = history
        .map(parsePoint)
        .filter((point): point is RoutePoint => point !== null)
      const uniquePoints = new Map(points.map((point) => [point.key, point]))
      const sortedPoints = [...uniquePoints.values()]
        .sort((first, second) => first.timestamp - second.timestamp)
      const corroboratedLastFix = matchLegacyGpsFixToVerifiedHistory(
        firestoreLastFixRef.current,
        history
      )
      const newestHistoryPoint = sortedPoints[sortedPoints.length - 1]
      const lastKnownPoint = corroboratedLastFix &&
        (!newestHistoryPoint || corroboratedLastFix.timestamp > newestHistoryPoint.timestamp)
        ? {
            latitude: corroboratedLastFix.latitude,
            longitude: corroboratedLastFix.longitude,
            timestamp: corroboratedLastFix.timestamp,
            accuracy: corroboratedLastFix.accuracy,
            source: corroboratedLastFix.source,
            key: corroboratedLastFix.key,
          }
        : newestHistoryPoint
      for (const point of sortedPoints) route.historyPoints.set(point.key, point)
      if (route.historyPoints.size > 500) {
        const newestHistoryPoints = [...route.historyPoints.values()]
          .sort((first, second) => second.timestamp - first.timestamp)
          .slice(0, 500)
        route.historyPoints = new Map(newestHistoryPoints.map((point) => [point.key, point]))
      }
      route.historyPointKeys = new Set(route.historyPoints.keys())
      route.historyLatestTimestamp = Math.max(
        0,
        ...[...route.historyPoints.values()].map((point) => point.timestamp)
      ) || null
      route.historyLoaded = true
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
      rebuildRoute(map, route, visibleRef.current)
      onRouteChangeRef.current?.(routeSegments(route))
      onStatusChangeRef.current?.(getRouteStatus(route))
      if (lastKnownPoint) {
        onLastKnownPointRef.current?.({
          latitude: lastKnownPoint.latitude,
          longitude: lastKnownPoint.longitude,
          recorded_at: new Date(lastKnownPoint.timestamp).toISOString(),
          accuracy_m: lastKnownPoint.accuracy,
          gps_fix: true,
          gps_valid: true,
          gps_source: lastKnownPoint.source,
          gps_status: 'GPS VALID',
        })
      }
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

    const loadApiHistory = async () => {
      if (apiHistoryRequested || cancelled) return
      apiHistoryRequested = true
      try {
        const history = await getGpsHistory(deviceId, 500, requestController.signal)
        refreshHistory(history)
      } catch (error) {
        apiHistoryRequested = false
        if (!cancelled) {
          console.warn(`Unable to load GPS history from the API for ${deviceId}.`, error)
        }
      }
    }

    const subscribeToHistory = () => subscribeToFirestoreLocationHistory(
      deviceId,
      500,
      (tripPoints) => {
        const history = tripPoints.map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          recorded_at: point.timestamp,
          timestamp: point.timestamp,
          gps_fix: true,
          gps_valid: true,
          gps_source: 'watch_tcp',
          gps_status: 'GPS VALID',
          accuracy_m: point.accuracy_m ?? null,
        }))
        refreshHistory(history)
      },
      async (error) => {
        console.warn(`Firestore GPS log subscription failed for ${deviceId}; using API history.`, error)
        void loadApiHistory()
      }
    )

    let unsubscribeHistory = () => {}
    if (includeHistory) {
      unsubscribeHistory = subscribeToHistory()
      void loadApiHistory()
    }
    void pollLatest()

    return () => {
      cancelled = true
      requestController.abort()
      if (timer !== undefined) window.clearTimeout(timer)
      unsubscribeHistory()
      route.layers.forEach((layer) => layer.remove())
      route.dots.forEach((dot) => dot.remove())
      route.startMarker?.remove()
      route.endMarker?.remove()
      if (routeRef.current === route) routeRef.current = null
    }
  }, [enabled, map, deviceId, includeHistory])
}
