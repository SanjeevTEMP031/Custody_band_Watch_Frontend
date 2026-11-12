export interface GpsTrailPoint {
  latitude: number
  longitude: number
  timestamp: number
  accuracy: number | null
  key: string
}

export interface GpsTrailState<T extends GpsTrailPoint> {
  segments: T[][]
  keys: Set<string>
  latest: T | null
  lastMovementPoint: T | null
}

export interface GpsTrailFilters {
  minMovementMeters: number
  maxGapMs: number
  maxPlausibleSpeedKmh: number
}

export const DEFAULT_GPS_TRAIL_FILTERS: GpsTrailFilters = {
  minMovementMeters: 5,
  maxGapMs: 5 * 60_000,
  maxPlausibleSpeedKmh: 180,
}

function distanceMeters(first: GpsTrailPoint, second: GpsTrailPoint): number {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latDelta = radians(second.latitude - first.latitude)
  const lonDelta = radians(second.longitude - first.longitude)
  const firstLat = radians(first.latitude)
  const secondLat = radians(second.latitude)
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lonDelta / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(
    Math.sqrt(haversine),
    Math.sqrt(Math.max(0, 1 - haversine))
  )
}

export function appendGpsTrailPoint<T extends GpsTrailPoint>(
  route: GpsTrailState<T>,
  point: T,
  filters: GpsTrailFilters = DEFAULT_GPS_TRAIL_FILTERS
): boolean {
  if (
    !Number.isFinite(point.timestamp) ||
    point.timestamp <= 0 ||
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    point.longitude < -180 ||
    point.longitude > 180 ||
    (point.latitude === 0 && point.longitude === 0)
  ) return false

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
  if (elapsed > filters.maxGapMs) {
    route.segments.push([point])
    route.latest = point
    route.keys.add(point.key)
    route.lastMovementPoint = point
    return true
  }
  const distance = distanceMeters(previous, point)
  if (distance / (elapsed / 3_600_000) / 1000 > filters.maxPlausibleSpeedKmh) return false

  route.latest = point
  const movementDistance = distanceMeters(movementAnchor, point)
  const reportedAccuracy = Math.max(movementAnchor.accuracy ?? 0, point.accuracy ?? 0)
  const jitterThreshold = Math.max(
    filters.minMovementMeters,
    Math.min(30, reportedAccuracy || filters.minMovementMeters)
  )
  if (movementDistance < jitterThreshold) return false

  const currentSegment = route.segments[route.segments.length - 1]
  if (!currentSegment || currentSegment.length < 1) route.segments.push([movementAnchor, point])
  else currentSegment.push(point)
  route.keys.add(point.key)
  route.lastMovementPoint = point
  return true
}
