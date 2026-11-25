export interface GpsTrailPoint {
  latitude: number
  longitude: number
  timestamp: number
  accuracy: number | null
  key: string
  gps_fix?: boolean
  gps_valid?: boolean | number | string
  location_is_current?: boolean
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

// maxGapMs breaks rendered route lines; it is not a journey-end condition.
export const DEFAULT_GPS_TRAIL_FILTERS: GpsTrailFilters = {
  minMovementMeters: 5,
  maxGapMs: 5 * 60_000,
  maxPlausibleSpeedKmh: 180,
}

// Fallback history grouping is only for records without a persisted journey_id.
// Group by gaps between fixes, not total journey duration.
export const DEFAULT_GPS_JOURNEY_INACTIVITY_MS = 30 * 60_000

export interface GpsTrailAnalysis<T extends GpsTrailPoint> {
  segments: T[][]
  acceptedPoints: T[]
  distanceMeters: number
  gapCount: number
  rejectedOutlierCount: number
  duplicateCount: number
  filteredJitterCount: number
  invalidPointCount: number
}

export function groupGpsPointsByInactivity<T extends GpsTrailPoint>(
  points: T[],
  inactivityMs = DEFAULT_GPS_JOURNEY_INACTIVITY_MS
): T[][] {
  const groups: T[][] = []
  const sortedPoints = [...points]
    .filter(isValidTrailPoint)
    .sort((first, second) => first.timestamp - second.timestamp)

  for (const point of sortedPoints) {
    const currentGroup = groups[groups.length - 1]
    const previous = currentGroup?.[currentGroup.length - 1]
    if (!previous || point.timestamp - previous.timestamp > inactivityMs) {
      groups.push([point])
    } else if (point.key !== previous.key) {
      currentGroup.push(point)
    }
  }
  return groups
}

export function buildGpsTrailSegments<T extends GpsTrailPoint>(
  points: T[],
  filters: GpsTrailFilters = DEFAULT_GPS_TRAIL_FILTERS
): T[][] {
  return analyzeGpsTrail(points, filters).segments
}

export function analyzeGpsTrail<T extends GpsTrailPoint>(
  points: T[],
  filters: GpsTrailFilters = DEFAULT_GPS_TRAIL_FILTERS
): GpsTrailAnalysis<T> {
  const route: GpsTrailState<T> = {
    segments: [],
    keys: new Set(),
    latest: null,
    lastMovementPoint: null,
  }
  const analysis: GpsTrailAnalysis<T> = {
    segments: [],
    acceptedPoints: [],
    distanceMeters: 0,
    gapCount: 0,
    rejectedOutlierCount: 0,
    duplicateCount: 0,
    filteredJitterCount: 0,
    invalidPointCount: 0,
  }
  const sortedPoints = [...points].sort((first, second) => first.timestamp - second.timestamp)
  sortedPoints.forEach((point) => {
    const result = appendGpsTrailPointWithReason(route, point, filters)
    if (result === 'gap') analysis.gapCount += 1
    else if (result === 'outlier') analysis.rejectedOutlierCount += 1
    else if (result === 'duplicate') analysis.duplicateCount += 1
    else if (result === 'jitter') analysis.filteredJitterCount += 1
    else if (result === 'invalid') analysis.invalidPointCount += 1
  })

  const segments = route.segments.map((segment) => [...segment])
  const lastSegment = segments[segments.length - 1]
  if (lastSegment?.length === 1 && route.latest) {
    segments[segments.length - 1] = [route.latest]
  }
  analysis.segments = segments
  analysis.acceptedPoints = segments.flat()
  for (const segment of segments) {
    for (let index = 1; index < segment.length; index += 1) {
      analysis.distanceMeters += distanceMeters(segment[index - 1], segment[index])
    }
  }
  return analysis
}

function isValidTrailPoint(point: GpsTrailPoint): boolean {
  const gpsStatus = String(
    (point as any).gps_status ?? (point as any).gps_fix_status ?? (point as any).fix_status ?? (point as any).status ?? ''
  ).trim().toLowerCase()
  const gpsValid = String(point.gps_valid ?? '').trim().toLowerCase()

  if (
    gpsStatus === 'v' ||
    gpsStatus === 'no fix' ||
    gpsStatus === 'invalid' ||
    ['false', '0', 'v', 'invalid', 'no_fix'].includes(gpsValid) ||
    point.gps_valid === false ||
    point.gps_valid === 0 ||
    point.gps_fix === false
  ) {
    return false
  }

  return (
    Number.isFinite(point.timestamp) &&
    point.timestamp > 0 &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180 &&
    !(point.latitude === 0 && point.longitude === 0)
  )
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
  const result = appendGpsTrailPointWithReason(route, point, filters)
  return result === 'accepted' || result === 'gap'
}

function appendGpsTrailPointWithReason<T extends GpsTrailPoint>(
  route: GpsTrailState<T>,
  point: T,
  filters: GpsTrailFilters
): 'accepted' | 'gap' | 'invalid' | 'duplicate' | 'outlier' | 'jitter' {
  if (!isValidTrailPoint(point)) return 'invalid'

  const previous = route.latest
  if (!previous) {
    route.latest = point
    route.segments.push([point])
    route.keys.add(point.key)
    route.lastMovementPoint = point
    return 'accepted'
  }
  if (point.timestamp <= previous.timestamp || route.keys.has(point.key)) return 'duplicate'

  const movementAnchor = route.lastMovementPoint ?? previous
  const elapsed = point.timestamp - previous.timestamp
  if (elapsed > filters.maxGapMs) {
    route.segments.push([point])
    route.latest = point
    route.keys.add(point.key)
    route.lastMovementPoint = point
    return 'gap'
  }
  const distance = distanceMeters(previous, point)
  if (distance / (elapsed / 3_600_000) / 1000 > filters.maxPlausibleSpeedKmh) return 'outlier'

  route.latest = point
  const movementDistance = distanceMeters(movementAnchor, point)
  const jitterThreshold = filters.minMovementMeters
  if (movementDistance < jitterThreshold) return 'jitter'

  const currentSegment = route.segments[route.segments.length - 1]
  if (!currentSegment || currentSegment.length < 1) route.segments.push([movementAnchor, point])
  else currentSegment.push(point)
  route.keys.add(point.key)
  route.lastMovementPoint = point
  return 'accepted'
}
