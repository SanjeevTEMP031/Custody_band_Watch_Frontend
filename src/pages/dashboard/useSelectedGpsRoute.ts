import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { getGpsHistory, getLatestGpsLocation, type GpsLocation } from '../../services/api'

interface RoutePoint {
  latitude: number
  longitude: number
  timestamp: number
  accuracy: number | null
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
  lastMovementPoint: RoutePoint | null
  historyLatestTimestamp: number | null
  historyLoaded: boolean
  firestoreHistoryMismatch: boolean
}

export const SELECTED_GPS_POLL_INTERVAL_MS = 3_000
export const GPS_TRAIL_CONFIG = {
  dotColor: '#2563EB',
  lineColor: '#2563EB',
  dotRadius: 3,
  lineWidth: 3,
  minMovementMeters: 5,
} as const

export type SelectedGpsRouteStatus = 'loading' | 'available' | 'unavailable' | 'history-mismatch'
export type SelectedGpsRouteSegment = Array<{
  latitude: number
  longitude: number
  timestamp: number
}>

const MAX_FIX_GAP_MS = 5 * 60_000
const MAX_PLAUSIBLE_SPEED_KMH = 180
const GPS_FRESHNESS_MS = 5 * 60_000

function timestampMs(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: unknown; toDate?: () => Date }
    if (typeof timestamp.toDate === 'function') {
      const time = timestamp.toDate().getTime()
      return Number.isFinite(time) ? time : null
    }
    if (typeof timestamp.seconds === 'number') return timestamp.seconds * 1000
  }
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  }
  const text = String(value).trim()
  const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`
  const parsed = Date.parse(withTimezone)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePoint(value: unknown): RoutePoint | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const rawData =
    typeof record.raw === 'object' && record.raw !== null
      ? record.raw as Record<string, unknown>
      : null
  const status = String(
    record.gps_status ??
      record.status ??
      record.validity ??
      rawData?.gps_status ??
      rawData?.status ??
      rawData?.validity ??
      ''
  ).trim().toUpperCase()
  const isValidFixFlag = (flag: unknown) =>
    flag !== false &&
    flag !== 0 &&
    String(flag).trim().toLowerCase() !== 'false' &&
    String(flag).trim() !== '0' &&
    String(flag).trim().toUpperCase() !== 'V'
  if (
    status === 'V' ||
    ![record.gps_fix, record.gps_valid, rawData?.gps_fix, rawData?.gps_valid].every(isValidFixFlag)
  ) return null

  const rawPacket = [
    record.raw,
    record.raw_packet,
    record.gps_packet,
    rawData?.raw,
    rawData?.raw_packet,
    rawData?.gps_packet,
  ].find((candidate): candidate is string => typeof candidate === 'string')
  if (rawPacket) {
    const rawStatus = rawPacket.replace(/^\[+|\]+$/g, '').split(',')[3]?.trim().toUpperCase()
    if (rawStatus === 'V') return null
  }

  const rawLatitude = record.latitude ?? record.lat ?? record.last_latitude ??
    rawData?.latitude ?? rawData?.lat ?? rawData?.last_latitude
  const rawLongitude = record.longitude ?? record.lon ?? record.lng ?? record.last_longitude ??
    rawData?.longitude ?? rawData?.lon ?? rawData?.lng ?? rawData?.last_longitude
  if (
    rawLatitude == null ||
    rawLongitude == null ||
    String(rawLatitude).trim() === '' ||
    String(rawLongitude).trim() === ''
  ) return null
  const latitude = Number(rawLatitude)
  const longitude = Number(rawLongitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  if (latitude === 0 && longitude === 0) return null
  const timestamp = timestampMs(
    record.recorded_at ?? record.received_at ?? record.device_timestamp ?? record.timestamp ?? record.gps_time ??
      rawData?.recorded_at ?? rawData?.received_at ?? rawData?.device_timestamp ?? rawData?.timestamp ?? rawData?.gps_time
  )
  if (timestamp === null || timestamp > Date.now() + 60_000) return null

  const accuracyValue = Number(record.accuracy_m ?? record.accuracy)
  const accuracy = Number.isFinite(accuracyValue) && accuracyValue > 0 ? accuracyValue : null
  return {
    latitude,
    longitude,
    timestamp,
    accuracy,
    key: `${timestamp}|${latitude.toFixed(6)},${longitude.toFixed(6)}`,
  }
}

function distanceMeters(first: RoutePoint, second: RoutePoint): number {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latDelta = radians(second.latitude - first.latitude)
  const lonDelta = radians(second.longitude - first.longitude)
  const firstLat = radians(first.latitude)
  const secondLat = radians(second.latitude)
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lonDelta / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function addPoint(route: RouteState, point: RoutePoint): boolean {
  const previous = route.latest
  if (!previous) {
    route.latest = point
    route.segments.push([point])
    route.keys.add(point.key)
    route.lastMovementPoint = point
    return true
  }
  if (point.timestamp <= previous.timestamp || route.keys.has(point.key)) return false

  const movementAnchor = route.lastMovementPoint ?? previous
  const elapsed = point.timestamp - previous.timestamp
  if (elapsed > MAX_FIX_GAP_MS) {
    route.segments.push([point])
    route.latest = point
    route.keys.add(point.key)
    route.lastMovementPoint = point
    return true
  }
  const distance = distanceMeters(previous, point)
  if (distance / (elapsed / 3_600_000) > MAX_PLAUSIBLE_SPEED_KMH) return false

  route.latest = point
  const movementDistance = distanceMeters(movementAnchor, point)
  const reportedAccuracy = Math.max(movementAnchor.accuracy ?? 0, point.accuracy ?? 0)
  const jitterThreshold = Math.max(
    GPS_TRAIL_CONFIG.minMovementMeters,
    Math.min(30, reportedAccuracy || GPS_TRAIL_CONFIG.minMovementMeters)
  )
  if (movementDistance < jitterThreshold) return false

  const currentSegment = route.segments[route.segments.length - 1]
  if (!currentSegment || currentSegment.length < 1) route.segments.push([movementAnchor, point])
  else currentSegment.push(point)
  route.keys.add(point.key)
  route.lastMovementPoint = point
  return true
}

function routeSegments(route: RouteState): SelectedGpsRouteSegment[] {
  return route.segments.map((segment) => segment.map(({ latitude, longitude, timestamp }) => ({
    latitude,
    longitude,
    timestamp,
  })))
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
    onStatusChangeRef.current?.(
      route.firestoreHistoryMismatch
        ? 'history-mismatch'
        : route.latest && Date.now() - route.latest.timestamp <= GPS_FRESHNESS_MS
          ? 'available'
          : 'unavailable'
    )
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
      lastMovementPoint: null,
      historyLatestTimestamp: null,
      historyLoaded: false,
      firestoreHistoryMismatch: false,
    }
    routeRef.current = route
    let cancelled = false
    let timer: number | undefined
    const requestController = new AbortController()
    onRouteChangeRef.current?.([])
    onStatusChangeRef.current?.('loading')

    const pollLatest = async () => {
      if (cancelled) return
      try {
        const latest = await getLatestGpsLocation(deviceId, requestController.signal)
        const point = latest ? parsePoint(latest) : null
        if (latest && point && Date.now() - point.timestamp <= GPS_FRESHNESS_MS) {
          if (!route.firestoreHistoryMismatch) onStatusChangeRef.current?.('available')
          if (addPoint(route, point)) {
            syncLayers(map, route, visibleRef.current)
            onRouteChangeRef.current?.(routeSegments(route))
          }
          if (
            route.latest === point ||
            (route.latest?.timestamp === point.timestamp &&
              route.latest.latitude === point.latitude &&
              route.latest.longitude === point.longitude)
          ) onFreshPointRef.current(latest)
        } else {
          onStatusChangeRef.current?.(
            route.firestoreHistoryMismatch
              ? 'history-mismatch'
              : route.latest && Date.now() - route.latest.timestamp <= GPS_FRESHNESS_MS
              ? 'available'
              : 'unavailable'
          )
        }
      } catch (error) {
        if (!cancelled) {
          onStatusChangeRef.current?.(
            route.firestoreHistoryMismatch
              ? 'history-mismatch'
              : route.latest && Date.now() - route.latest.timestamp <= GPS_FRESHNESS_MS
              ? 'available'
              : 'unavailable'
          )
          console.warn(`Unable to refresh GPS route for device ${deviceId}.`, error)
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(pollLatest, SELECTED_GPS_POLL_INTERVAL_MS)
      }
    }

    const loadHistory = async () => {
      try {
        const history = await getGpsHistory(deviceId, 500, requestController.signal)
        if (cancelled) return
        const points = history
          .map(parsePoint)
          .filter((point): point is RoutePoint => point !== null)
          .sort((first, second) => first.timestamp - second.timestamp)
        route.historyPointKeys = new Set(points.map((point) => point.key))
        route.historyLatestTimestamp = points.length > 0
          ? points[points.length - 1].timestamp
          : null
        route.historyLoaded = true
        for (const point of points) {
          if (addPoint(route, point)) syncLayers(map, route, visibleRef.current)
        }
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
        if (route.firestoreHistoryMismatch) onStatusChangeRef.current?.('history-mismatch')
        if (route.latest && Date.now() - route.latest.timestamp <= GPS_FRESHNESS_MS) {
          if (!route.firestoreHistoryMismatch) onStatusChangeRef.current?.('available')
          onFreshPointRef.current({
            latitude: route.latest.latitude,
            longitude: route.latest.longitude,
            recorded_at: new Date(route.latest.timestamp).toISOString(),
            accuracy_m: route.latest.accuracy,
            gps_fix: true,
          })
        }
      } catch (error) {
        if (!cancelled) console.warn(`Unable to load GPS history for device ${deviceId}.`, error)
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
