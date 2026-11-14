import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectFirestoreGpsCandidates,
  collectLastReportedGpsCandidates,
  collectGpsLatestCandidates,
  getGpsFixRejectionReasons,
  isFreshGpsTimestamp,
  matchLegacyGpsFixToVerifiedHistory,
  mergeVerifiedGpsFixes,
  normalizeLastReportedGpsLocation,
  normalizeVerifiedGpsFix,
  parseGpsTimestamp,
  selectNewestVerifiedGpsCandidate,
  unwrapGpsLatestResponse,
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

test('accepts watch_frame as a trusted source for a strictly verified fix', () => {
  const fix = normalizeVerifiedGpsFix({
    latitude: 17.446317,
    longitude: 78.368395,
    gps_fix: true,
    gps_valid: true,
    gps_source: 'watch_frame',
    timestamp: '2026-11-12T07:09:00Z',
  }, now)
  assert.equal(fix?.source, 'watch_frame')
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
    assert.equal(normalizeVerifiedGpsFix({
      ...coordinates,
      gps_valid: true,
      device_timestamp: '2026-11-12T07:09:00Z',
    }, now), null)
    assert.equal(normalizeVerifiedGpsFix({
      ...coordinates,
      gps_locked: true,
      timestamp: '2026-11-12T07:09:00Z',
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

test('uses only an independently verified last_fix when current coordinates are null', () => {
  const data = {
    latitude: null,
    longitude: null,
    gps_valid: false,
    gps_fix: false,
    last_seen: '2026-11-12T18:44:21+05:30',
    last_fix: {
      at: '2026-11-12T17:54:06+05:30',
      lat: 17.447331,
      lon: 78.36915,
      gps_valid: true,
      gps_fix: true,
      gps_source: 'watch_tcp',
    },
  }
  const selection = selectNewestVerifiedGpsCandidate(
    collectFirestoreGpsCandidates(data),
    Date.parse('2026-11-12T13:00:00Z')
  )

  assert.equal(selection.selected?.name, 'last_fix')
  assert.equal(selection.selected?.fix.latitude, 17.447331)
  assert.equal(selection.selected?.fix.longitude, 78.36915)
  assert.equal(
    selection.selected?.fix.timestamp,
    Date.parse('2026-11-12T12:24:06Z')
  )
})

test('does not verify a last_fix from coordinates and time alone', () => {
  const selection = selectNewestVerifiedGpsCandidate(
    collectFirestoreGpsCandidates({
      latitude: null,
      longitude: null,
      last_seen: '2026-11-12T18:44:21+05:30',
      last_fix: {
        at: '2026-11-12T17:54:06+05:30',
        lat: 17.447331,
        lon: 78.36915,
      },
    }),
    Date.parse('2026-11-12T13:00:00Z')
  )

  assert.equal(selection.selected, null)
  assert.ok(selection.rejected.find((candidate) => candidate.name === 'last_fix'))
})

test('uses verified nested last-known metadata when the latest packet has no fix', () => {
  const response = {
    latitude: null,
    longitude: null,
    gps_valid: false,
    gps_fix: false,
    gps_source: 'watch_tcp',
    last_seen: '2020-11-12T07:10:00Z',
    last_known_location: {
      latitude: 17.447331,
      longitude: 78.36915,
      timestamp: '2020-11-12T07:09:00Z',
      verified: true,
      gps_source: 'watch_tcp',
      is_current: false,
    },
  }
  const candidates = collectGpsLatestCandidates(response)
  const selection = selectNewestVerifiedGpsCandidate(candidates, now)

  assert.equal(selection.selected?.name, 'latest.last_known_location')
  assert.equal(selection.selected?.fix.latitude, 17.447331)
  assert.equal(unwrapGpsLatestResponse(response)?.verified, true)
})

test('rejects last-known backend coordinates without verified provenance', () => {
  const response = {
    latitude: null,
    longitude: null,
    gps_valid: false,
    last_known_location: {
      latitude: 17.447331,
      longitude: 78.36915,
      timestamp: '2026-11-12T07:09:00Z',
      verified: false,
    },
  }
  assert.equal(
    selectNewestVerifiedGpsCandidate(
      collectGpsLatestCandidates(response),
      now
    ).selected,
    null
  )
})

test('normalizes last_fix as display-only unverified data without promoting it to a GPS fix', () => {
  const response = {
    gps_fix: false,
    gps_valid: false,
    gps_status: 'No Fix',
    latitude: null,
    longitude: null,
    last_fix: {
      lat: 17.446683,
      lon: 78.37006,
      at: '2026-11-13T07:45:40.683324Z',
    },
  }
  const candidate = collectLastReportedGpsCandidates(response)[0]
  const location = normalizeLastReportedGpsLocation(candidate?.record, Date.parse('2026-11-13T08:00:00Z'))

  assert.equal(location?.latitude, 17.446683)
  assert.equal(location?.longitude, 78.37006)
  assert.equal(location?.recordedAt, '2026-11-13T07:45:40.683Z')
  assert.equal(location?.verified, false)
  assert.equal(location?.locationType, 'last_reported_unverified')
  assert.equal(location?.isStale, true)
  assert.equal(normalizeVerifiedGpsFix(candidate?.record), null)
})

test('uses explicit root last-known coordinates despite false current-fix flags', () => {
  const response = {
    latitude: 17.446317,
    longitude: 78.368395,
    gps_fix: false,
    gps_valid: false,
    gps_status: 'Location Stale',
    gps_source: 'watch_tcp',
    coordinate_source: 'last_known',
    location_is_current: false,
    last_valid_gps_time: '2026-11-12T06:00:00Z',
  }
  const candidate = collectLastReportedGpsCandidates(response)
    .find(({ name }) => name.endsWith('root_last_reported'))
  const location = normalizeLastReportedGpsLocation(candidate?.record, now)

  assert.equal(location?.latitude, 17.446317)
  assert.equal(location?.longitude, 78.368395)
  assert.equal(location?.recordedAt, '2026-11-12T06:00:00.000Z')
  assert.equal(location?.source, 'watch_tcp')
  assert.equal(location?.verified, false)
  assert.equal(normalizeVerifiedGpsFix(candidate?.record, now), null)
})

test('rejects invalid coordinates, invalid GPS flags, and V packets from last-reported display', () => {
  const timestamp = '2026-11-12T07:09:00Z'
  assert.equal(normalizeLastReportedGpsLocation({
    lat: 91,
    lon: 78,
    at: timestamp,
  }, now), null)
  assert.equal(normalizeLastReportedGpsLocation({
    lat: 0,
    lon: 0,
    at: timestamp,
  }, now), null)
  assert.equal(normalizeLastReportedGpsLocation({
    lat: 17,
    lon: 78,
    gps_valid: false,
    at: timestamp,
  }, now), null)
  assert.equal(normalizeLastReportedGpsLocation({
    lat: 17,
    lon: 78,
    raw: '[MNYD*ID*LEN*CMD,20261112,070900,V,17,N,78,E]',
    at: timestamp,
  }, now), null)
  assert.equal(normalizeLastReportedGpsLocation({
    lat: 17,
    lon: 78,
  }, now)?.recordedAt, null)
})

test('corroborates a legacy last_fix only against an exact verified history record', () => {
  const timestamp = Date.parse('2026-11-12T07:09:00Z')
  const history = [{
    latitude: 17.447331,
    longitude: 78.36915,
    recorded_at: '2026-11-12T07:09:00Z',
    gps_valid: true,
    gps_source: 'watch_tcp',
  }]

  const matched = matchLegacyGpsFixToVerifiedHistory({
    lat: 17.447331,
    lon: 78.36915,
    at: {
      seconds: timestamp / 1000,
      nanoseconds: 0,
    },
  }, history, now)

  assert.equal(matched?.timestamp, timestamp)
  assert.equal(matched?.source, 'watch_tcp')
  assert.equal(matchLegacyGpsFixToVerifiedHistory({
    lat: 17.447332,
    lon: 78.36915,
    at: '2026-11-12T07:09:00Z',
  }, history, now), null)
  assert.equal(matchLegacyGpsFixToVerifiedHistory({
    lat: 17.447331,
    lon: 78.36915,
    received_at: '2026-11-12T07:09:00Z',
  }, history, now), null)
})

test('rejects raw watch packets with V status even when coordinates are present', () => {
  const common = {
    latitude: 17.4,
    longitude: 78.3,
    gps_source: 'watch_tcp',
    timestamp: '2026-11-12T07:09:00Z',
  }
  assert.equal(normalizeVerifiedGpsFix({
    ...common,
    raw: '[MNYD*ID*LEN*CMD,20261112,070900,V,17.4,N,78.3,E]',
  }, now), null)
  assert.equal(normalizeVerifiedGpsFix({
    ...common,
    raw: '[MNYD*ID*LEN*CMD,20261112,070900,A,17.4,N,78.3,E]',
  }, now)?.latitude, 17.4)
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
