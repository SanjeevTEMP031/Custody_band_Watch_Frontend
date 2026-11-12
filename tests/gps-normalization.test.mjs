import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectFirestoreGpsCandidates,
  getGpsFixRejectionReasons,
  isFreshGpsTimestamp,
  mergeVerifiedGpsFixes,
  normalizeVerifiedGpsFix,
  parseGpsTimestamp,
  selectNewestVerifiedGpsCandidate,
} from '../src/services/gpsNormalization.ts'
import {
  appendGpsTrailPoint,
  DEFAULT_GPS_TRAIL_FILTERS,
} from '../src/services/gpsTrail.ts'

const now = Date.parse('2026-11-12T07:10:00.000Z')

test('accepts a source-tagged valid latest fix and timezone-aware GPS timestamp', () => {
  const fix = normalizeVerifiedGpsFix({
    latitude: 17.446317,
    longitude: 78.368395,
    gps_status: 'GPS Locked',
    gps_valid: true,
    gps_fix: true,
    gps_source: 'watch_tcp',
    last_valid_gps_time: '2026-11-12T12:39:00+05:30',
  }, now)

  assert.equal(fix?.source, 'watch_tcp')
  assert.equal(fix?.timestamp, Date.parse('2026-11-12T07:09:00.000Z'))
})

test('rejects a fix with missing source metadata', () => {
  assert.equal(normalizeVerifiedGpsFix({
    latitude: 17.446317,
    longitude: 78.368395,
    gps_status: 'GPS Locked',
    gps_valid: true,
    timestamp: '2026-11-12T07:09:00Z',
  }, now), null)
})

  test('does not treat online heartbeats or last-seen times as GPS fixes', () => {
    const coordinates = {
      latitude: 17.446317,
      longitude: 78.368395,
      gps_source: 'watch_tcp',
    }
    assert.equal(normalizeVerifiedGpsFix({
      ...coordinates,
      status: 'ONLINE',
      last_seen: '2026-11-12T07:09:00Z',
    }, now), null)
    assert.equal(normalizeVerifiedGpsFix({
      ...coordinates,
      gps_valid: true,
      last_seen: '2026-11-12T07:09:00Z',
    }, now), null)
  })

test('rejects invalid coordinates and unverified status', () => {
  const valid = {
    gps_valid: true,
    gps_source: 'gps_ingest_api',
    timestamp: '2026-11-12T07:09:00Z',
  }
  assert.equal(normalizeVerifiedGpsFix({ ...valid, latitude: 91, longitude: 10 }, now), null)
  assert.equal(normalizeVerifiedGpsFix({
    ...valid,
    latitude: 17,
    longitude: 78,
    gps_valid: false,
  }, now), null)
  assert.equal(normalizeVerifiedGpsFix({
    latitude: 17,
    longitude: 78,
    gps_valid: true,
    gps_source: 'watch_tcp',
  }, now), null)
})

test('marks old timestamps stale without removing them from verified history', () => {
  const staleTimestamp = Date.parse('2026-11-12T06:00:00Z')
  assert.equal(isFreshGpsTimestamp(staleTimestamp, now), false)
  const merged = mergeVerifiedGpsFixes([{
    latitude: 17.4,
    longitude: 78.3,
    gps_valid: 1,
    gps_source: 'watch_tcp',
    timestamp: staleTimestamp,
  }], null, now)
  assert.equal(merged.history.length, 1)
  assert.equal(merged.current, null)
})

test('sorts and deduplicates history while keeping a latest-only fix out of history', () => {
  const older = {
    latitude: 17.444978,
    longitude: 78.365,
    gps_valid: 1,
    gps_source: 'watch_tcp',
    timestamp: '2026-11-12T07:08:00Z',
  }
  const latest = {
    latitude: 17.446064,
    longitude: 78.369154,
    gps_valid: 1,
    gps_source: 'gps_ingest_api',
    timestamp: '2026-11-12T07:09:00Z',
  }
  const merged = mergeVerifiedGpsFixes([latest, older, older], latest, now)

  assert.deepEqual(merged.history.map((fix) => fix.timestamp), [
    Date.parse(older.timestamp),
    Date.parse(latest.timestamp),
  ])
  assert.equal(merged.current?.key, merged.history[1].key)
  assert.equal(merged.latestMissingFromHistory, false)

  const currentOnly = mergeVerifiedGpsFixes([older], latest, now)
  assert.equal(currentOnly.history.length, 1)
  assert.equal(currentOnly.current?.key, latest && normalizeVerifiedGpsFix(latest, now)?.key)
  assert.equal(currentOnly.latestMissingFromHistory, true)
})

test('returns no current fix when history is empty and latest is stale', () => {
  const merged = mergeVerifiedGpsFixes([], {
    latitude: 17.446317,
    longitude: 78.368395,
    gps_valid: true,
    gps_source: 'watch_tcp',
    last_valid_gps_time: '2026-11-12T06:00:00Z',
  }, now)

  assert.deepEqual(merged.history, [])
  assert.equal(merged.current, null)
  assert.equal(merged.latestMissingFromHistory, true)
})

test('prefers a newer verified nested fix over older verified root coordinates', () => {
  const data = {
    last_latitude: 17.444978,
    last_longitude: 78.365,
    gps_valid: true,
    gps_source: 'watch_tcp',
    recorded_at: '2026-11-12T07:08:00Z',
    latest: {
      location: {
        lat: 17.446213,
        lon: 78.369204,
        gps_valid: true,
        gps_source: 'watch_tcp',
        recorded_at: '2026-11-12T07:09:00Z',
      },
    },
  }
  const selection = selectNewestVerifiedGpsCandidate(
    collectFirestoreGpsCandidates(data),
    now
  )

  assert.equal(selection.selected?.name, 'latest.location')
  assert.equal(selection.selected?.fix.latitude, 17.446213)
})

test('keeps older verified root coordinates over a newer unverified last_fix', () => {
  const data = {
    last_latitude: 17.444978,
    last_longitude: 78.365,
    gps_valid: true,
    gps_source: 'gps_ingest_api',
    recorded_at: '2026-11-12T07:08:00Z',
    last_fix: {
      lat: 17.446213,
      lon: 78.369204,
      at: '2026-11-12T07:09:00Z',
    },
  }
  const selection = selectNewestVerifiedGpsCandidate(
    collectFirestoreGpsCandidates(data),
    now
  )

  assert.equal(selection.selected?.name, 'root')
  assert.equal(selection.selected?.fix.latitude, 17.444978)
  assert.ok(selection.rejected.find((candidate) => candidate.name === 'last_fix'))
})

test('rejects invalid coordinates, malformed or missing timestamps, and future fixes', () => {
  const valid = {
    latitude: 17.4,
    longitude: 78.3,
    gps_valid: true,
    gps_source: 'watch_tcp',
    timestamp: '2026-11-12T07:09:00Z',
  }
  assert.equal(normalizeVerifiedGpsFix({ ...valid, latitude: 91 }, now), null)
  assert.equal(normalizeVerifiedGpsFix({ ...valid, gps_valid: false }, now), null)
  assert.equal(normalizeVerifiedGpsFix({
    ...valid,
    gps_status: 'GPS_VALID',
    gps_valid: undefined,
  }, now)?.status, 'GPS VALID')
  assert.equal(normalizeVerifiedGpsFix({ ...valid, timestamp: 'not-a-time' }, now), null)
  assert.equal(normalizeVerifiedGpsFix({ ...valid, timestamp: undefined }, now), null)
  assert.equal(
    normalizeVerifiedGpsFix({ ...valid, timestamp: '2026-11-12T07:11:00Z' }, now),
    null
  )
})

test('uses the timestamp belonging to the fix instead of last_valid_gps_time', () => {
  const fix = normalizeVerifiedGpsFix({
    latitude: 17.4,
    longitude: 78.3,
    gps_valid: true,
    gps_source: 'watch_tcp',
    recorded_at: '2026-11-12T07:09:00Z',
    last_valid_gps_time: '2026-11-10T13:29:27Z',
  }, now)

  assert.equal(fix?.timestamp, Date.parse('2026-11-12T07:09:00Z'))
})

test('parses Firestore Timestamp instances without replacing their fix time', () => {
  const timestamp = {
    seconds: Date.parse('2026-11-12T07:09:00Z') / 1000,
    nanoseconds: 123_000_000,
    toDate: () => new Date(Date.parse('2026-11-12T07:09:00Z') + 123),
  }
  assert.equal(parseGpsTimestamp(timestamp), Date.parse('2026-11-12T07:09:00.123Z'))
  const fix = normalizeVerifiedGpsFix({
    latitude: 17.4,
    longitude: 78.3,
    gps_valid: true,
    gps_source: 'watch_tcp',
    recorded_at: timestamp,
  }, now)
  assert.equal(fix?.timestamp, Date.parse('2026-11-12T07:09:00.123Z'))
})

test('reports missing trusted source metadata without accepting the record', () => {
  const reasons = getGpsFixRejectionReasons({
    latitude: 17.4,
    longitude: 78.3,
    gps_valid: true,
    timestamp: '2026-11-12T07:09:00Z',
  }, now)

  assert.ok(reasons.includes('missing-source'))
  assert.equal(normalizeVerifiedGpsFix({
    latitude: 17.4,
    longitude: 78.3,
    gps_valid: true,
    timestamp: '2026-11-12T07:09:00Z',
  }, now), null)
})

test('unwraps nested history wrappers before sorting and deduplicating fixes', () => {
  const fix = {
    latitude: 17.4,
    longitude: 78.3,
    gps_valid: true,
    gps_source: 'watch_tcp',
    timestamp: '2026-11-12T07:09:00Z',
  }
  const merged = mergeVerifiedGpsFixes({ data: { history: [fix, fix] } }, null, now)

  assert.equal(merged.history.length, 1)
  assert.equal(merged.history[0].timestamp, Date.parse(fix.timestamp))
})

test('keeps stale and empty history without treating either as a current fix', () => {
  const stale = {
    latitude: 17.4,
    longitude: 78.3,
    gps_valid: true,
    gps_source: 'watch_tcp',
    timestamp: '2026-11-12T06:00:00Z',
  }
  const staleHistory = mergeVerifiedGpsFixes([stale], null, now)
  const emptyHistory = mergeVerifiedGpsFixes([], null, now)

  assert.equal(staleHistory.history.length, 1)
  assert.equal(staleHistory.current, null)
  assert.equal(isFreshGpsTimestamp(staleHistory.history[0].timestamp, now), false)
  assert.deepEqual(emptyHistory.history, [])
  assert.equal(emptyHistory.current, null)
})

function makeRoute() {
  return {
    segments: [],
    keys: new Set(),
    latest: null,
    lastMovementPoint: null,
  }
}

function makePoint(latitude, timestamp, key, accuracy = null) {
  return { latitude, longitude: 78.3, timestamp, accuracy, key }
}

test('filters stationary GPS jitter, deduplicates fixes, and retains accepted movement', () => {
  const route = makeRoute()
  const start = Date.parse('2026-11-12T07:00:00Z')
  assert.equal(appendGpsTrailPoint(route, makePoint(91, start, 'invalid')), false)
  assert.equal(appendGpsTrailPoint(route, makePoint(17.4, start, 'start')), true)
  assert.equal(appendGpsTrailPoint(route, makePoint(17.40001, start + 60_000, 'jitter')), false)
  assert.equal(appendGpsTrailPoint(route, makePoint(17.4001, start + 120_000, 'move')), true)
  assert.equal(appendGpsTrailPoint(route, makePoint(17.4001, start + 120_000, 'move')), false)
  assert.deepEqual(route.segments.map((segment) => segment.map((point) => point.key)), [
    ['start', 'move'],
  ])
})

test('starts a new trail segment after a long GPS gap', () => {
  const route = makeRoute()
  const start = Date.parse('2026-11-12T07:00:00Z')
  appendGpsTrailPoint(route, makePoint(17.4, start, 'before-gap'))
  appendGpsTrailPoint(
    route,
    makePoint(17.401, start + DEFAULT_GPS_TRAIL_FILTERS.maxGapMs + 1, 'after-gap')
  )

  assert.deepEqual(route.segments.map((segment) => segment.length), [1, 1])
})
