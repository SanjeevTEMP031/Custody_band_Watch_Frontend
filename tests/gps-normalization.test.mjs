import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectFirestoreGpsCandidates,
  collectLastReportedGpsCandidates,
  collectGpsLatestCandidates,
  getGpsFixRejectionReasons,
  isFreshGpsTimestamp,
  isNewerGpsTimestamp,
  matchLegacyGpsFixToVerifiedHistory,
  mergeVerifiedGpsFixes,
  normalizeFirestoreGpsLog,
  normalizeLatestGpsReportMetadata,
  normalizeLastReportedGpsLocation,
  normalizeVerifiedHistoryGpsLocation,
  normalizeVerifiedGpsFix,
  parseGpsTimestamp,
  selectPreferredLastReportedGpsLocation,
  selectNewestVerifiedGpsCandidate,
  unwrapGpsLatestResponse,
} from '../src/services/gpsNormalization.ts'
import {
  appendGpsTrailPoint,
  buildGpsTrailSegments,
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

test('accepts watch_udp as a trusted source used by the backend', () => {
  const fix = normalizeVerifiedGpsFix({
    latitude: 17.446317,
    longitude: 78.368395,
    gps_fix: true,
    gps_valid: true,
    gps_source: 'watch_udp',
    timestamp: '2026-11-12T07:09:00Z',
  }, now)
  assert.equal(fix?.source, 'watch_udp')
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

test('accepts verified TCP latest and history points without gps_source', () => {
  const record = {
    gps_fix: true,
    lat: 17.446317,
    lon: 78.368395,
    gps_time: '2026-11-12T07:09:00Z',
  }
  const latest = selectNewestVerifiedGpsCandidate(
    collectGpsLatestCandidates({ latest: record }),
    now
  )
  const history = mergeVerifiedGpsFixes([record], null, now).history

  assert.equal(latest.selected?.fix.source, 'watch_tcp')
  assert.equal(history.length, 1)
  assert.equal(history[0].source, 'watch_tcp')
  assert.equal(selectNewestVerifiedGpsCandidate(
    collectGpsLatestCandidates({ latest: { ...record, gps_fix: false } }),
    now
  ).selected, null)
})

test('accepts TCP-ingest device locations without gps_source using gps_time', () => {
  const document = {
    last_seen: '2026-11-12T07:09:30Z',
    battery_percent: 87,
    steps: 1234,
    latitude: 17.446316,
    longitude: 78.368394,
    lat: 17.446316,
    lon: 78.368394,
    gps_fix: true,
    speed_kmh: 4.1,
    location_time: '2026-11-12T07:08:59Z',
    last_fix: {
      lat: 17.446316,
      lon: 78.368394,
      at: '2026-11-12T07:08:59Z',
    },
    latest: {
      location: {
        gps_fix: true,
        lat: 17.446317,
        lon: 78.368395,
        gps_time: '2026-11-12T07:09:00Z',
        received_at: '2026-11-12T07:09:01Z',
        speed_kmh: 4.2,
      },
      status: { battery_percent: 87, steps: 1234 },
      heart_rate: { heart_rate_bpm: 72 },
      temperature: { temperature_c: 36.7 },
      blood_pressure: { systolic: 120, diastolic: 80 },
      blood_oxygen: { spo2_percent: 98 },
      sleep: { awake_min: 10, light_min: 200, deep_min: 90, date: '2026-11-11' },
    },
  }
  const selection = selectNewestVerifiedGpsCandidate(
    collectFirestoreGpsCandidates(document),
    now
  )

  assert.equal(selection.selected?.name, 'latest.location')
  assert.equal(selection.selected?.fix.source, 'watch_tcp')
  assert.equal(selection.selected?.fix.timestamp, Date.parse('2026-11-12T07:09:00Z'))

  const rootFix = selectNewestVerifiedGpsCandidate(collectFirestoreGpsCandidates({
    latitude: 17.446318,
    longitude: 78.368396,
    lat: 17.446318,
    lon: 78.368396,
    gps_fix: true,
    location_time: '2026-11-12T07:08:00Z',
  }), now)
  assert.equal(rootFix.selected?.fix.timestamp, Date.parse('2026-11-12T07:08:00Z'))

  const missingFlag = selectNewestVerifiedGpsCandidate(collectFirestoreGpsCandidates({
    latitude: 17.446318,
    longitude: 78.368396,
    gps_status: 'A',
    location_time: '2026-11-12T07:08:00Z',
  }), now)
  assert.equal(missingFlag.selected, null)
})

test('accepts TCP-ingest log history without gps_source and rejects invalid logs', () => {
  const valid = normalizeFirestoreGpsLog({
    device_id: '863758061830955',
    type: 'location_on_demand',
    gps_fix: true,
    lat: 17.446317,
    lon: 78.368395,
    gps_time: '2026-11-12T07:09:00Z',
    received_at: '2026-11-12T07:09:01Z',
    raw: 'MNYD packet',
  }, now)
  assert.equal(valid?.source, 'watch_tcp')
  assert.equal(valid?.timestamp, Date.parse('2026-11-12T07:09:00Z'))

  const receivedAtFallback = normalizeFirestoreGpsLog({
    type: 'location',
    gps_fix: true,
    lat: 17.446317,
    lon: 78.368395,
    received_at: '2026-11-12T07:09:00Z',
  }, now)
  assert.equal(receivedAtFallback?.timestamp, Date.parse('2026-11-12T07:09:00Z'))

  assert.equal(normalizeFirestoreGpsLog({
    type: 'location',
    gps_status: 'A',
    lat: 17.446317,
    lon: 78.368395,
    gps_time: '2026-11-12T07:09:00Z',
  }, now), null)
  assert.equal(normalizeFirestoreGpsLog({
    type: 'location',
    gps_fix: false,
    lat: 17.446317,
    lon: 78.368395,
    gps_time: '2026-11-12T07:09:00Z',
  }, now), null)
  assert.equal(normalizeFirestoreGpsLog({
    type: 'sos_alarm',
    gps_fix: true,
    gps_status: 'V',
    lat: 17.446317,
    lon: 78.368395,
    received_at: '2026-11-12T07:09:00Z',
  }, now), null)
})

test('reads wrapped device and recent_positions API responses without promoting no-fix data', () => {
  const response = {
    device: {
      device_id: '863758061830955',
      latitude: 17.446317,
      longitude: 78.368395,
      gps_fix: false,
      gps_valid: false,
      last_fix: {
        lat: 17.441927,
        lon: 78.384297,
        at: '2026-11-16T04:25:50Z',
      },
      latest: {
        location_on_demand: {
          lat: null,
          lon: null,
          gps_fix: false,
          gps_time: '2026-11-16T04:43:23Z',
        },
      },
    },
    recent_positions: [{
      timestamp: '2026-11-06T08:49:17.664141Z',
      gps_valid: 1,
      latitude: 17.444978,
      longitude: 78.365,
      gps_source: 'watch_tcp',
    }],
  }
  const latest = selectNewestVerifiedGpsCandidate(
    collectGpsLatestCandidates(response),
    Date.parse('2026-11-16T04:59:00Z')
  )
  const lastFixCandidate = collectLastReportedGpsCandidates(response)
    .find(({ name }) => name.endsWith('.last_fix'))
  const history = mergeVerifiedGpsFixes(response, null, Date.parse('2026-11-16T04:59:00Z'))

  assert.equal(latest.selected, null)
  assert.equal(
    normalizeLastReportedGpsLocation(lastFixCandidate?.record)?.latitude,
    17.441927
  )
  assert.equal(history.history.length, 1)
  assert.equal(history.history[0].source, 'watch_tcp')
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
    ...valid,
    latitude: 17,
    longitude: 78,
    gps_fix: false,
    gps_valid: true,
  }, now), null)
  assert.equal(normalizeVerifiedGpsFix({
    latitude: 17,
    longitude: 78,
    gps_valid: true,
    gps_source: 'watch_tcp',
  }, now), null)
  assert.equal(normalizeVerifiedGpsFix({
    latitude: 17,
    longitude: 78,
    gps_status: 'A',
    gps_source: 'watch_tcp',
    timestamp: '2026-11-12T07:09:00Z',
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

test('marks the newest verified history location as stale fallback and rejects no-fix data', () => {
  const fallback = normalizeVerifiedHistoryGpsLocation({
    latitude: 17.444978,
    longitude: 78.365,
    timestamp: '2026-11-12T06:00:00Z',
    gps_valid: true,
    gps_fix: true,
    gps_source: 'watch_tcp',
  }, now)

  assert.equal(fallback?.verified, true)
  assert.equal(fallback?.locationType, 'last_verified_history')
  assert.equal(fallback?.isStale, true)
  assert.equal(fallback?.latitude, 17.444978)
  assert.equal(normalizeVerifiedHistoryGpsLocation({
    latitude: 17.444978,
    longitude: 78.365,
    timestamp: '2026-11-12T07:09:00Z',
    gps_valid: false,
    gps_source: 'watch_tcp',
  }, now), null)
})

test('accepts backend stale-labeled verified history without treating it as current', () => {
  const record = {
    latitude: 17.4,
    longitude: 78.3,
    timestamp: '2026-11-06T08:49:17.664141Z',
    gps_fix: true,
    gps_valid: true,
    gps_source: 'watch_tcp',
    gps_status: 'Location Stale',
  }

  assert.ok(normalizeVerifiedGpsFix(record, now))
  const merged = mergeVerifiedGpsFixes([record], null, now)
  assert.equal(merged.history.length, 1)
  assert.equal(merged.current, null)
})

test('uses the backend 15-minute window to determine GPS freshness', () => {
  assert.equal(isFreshGpsTimestamp(Date.parse('2026-11-12T06:55:01Z'), now), true)
  assert.equal(isFreshGpsTimestamp(Date.parse('2026-11-12T06:54:59Z'), now), false)
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

test('keeps latest packet time separate from the last verified GPS fix', () => {
  const metadata = normalizeLatestGpsReportMetadata({
    gps_fix: false,
    gps_valid: false,
    coordinate_source: 'last_known',
    last_seen: '2026-11-14T07:47:39.181920+00:00',
    last_valid_gps_time: '2026-11-06T08:49:17.664141+00:00',
    last_known_location: {
      latitude: 17.446317,
      longitude: 78.368395,
      received_at: '2026-11-14T07:47:39.181920+00:00',
    },
  })

  assert.deepEqual(metadata, {
    receivedAt: Date.parse('2026-11-14T07:47:39.181920Z'),
    noFixReported: true,
  })
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
      at: '2026-11-13T07:30:40.683324Z',
    },
  }
  const candidate = collectLastReportedGpsCandidates(response)[0]
  const location = normalizeLastReportedGpsLocation(candidate?.record, Date.parse('2026-11-13T08:00:00Z'))

  assert.equal(location?.latitude, 17.446683)
  assert.equal(location?.longitude, 78.37006)
  assert.equal(location?.recordedAt, '2026-11-13T07:30:40.683Z')
  assert.equal(location?.verified, false)
  assert.equal(location?.locationType, 'last_reported_unverified')
  assert.equal(location?.isStale, true)
  assert.equal(normalizeVerifiedGpsFix(candidate?.record), null)
})

test('uses explicit root last-known coordinates despite false current-fix flags', () => {
  const response = {
    latitude: 17.446317,
    longitude: 78.368395,
    timestamp: '2026-11-12T07:00:00Z',
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
  assert.equal(location?.coordinateSource, 'last_known')
  assert.equal(location?.isStale, true)
  assert.equal(location?.source, 'watch_tcp')
  assert.equal(location?.verified, false)
  assert.equal(normalizeVerifiedGpsFix(candidate?.record, now), null)
})

test('rejects last-known coordinates as a verified live fix even when flags claim validity', () => {
  const candidate = {
    latitude: 17.446317,
    longitude: 78.368395,
    gps_fix: true,
    gps_valid: true,
    gps_source: 'watch_tcp',
    coordinate_source: 'last_known',
    timestamp: '2026-11-12T07:09:00Z',
  }

  assert.equal(normalizeVerifiedGpsFix(candidate, now), null)
  assert.ok(getGpsFixRejectionReasons(candidate, now).includes('cached-location-not-a-live-fix'))
})

test('uses last-valid GPS time instead of a later no-fix packet time for cached coordinates', () => {
  const response = {
    latitude: 17.446317,
    longitude: 78.368395,
    coordinate_source: 'last_known',
    location_is_current: false,
    timestamp: '2026-11-16T04:48:29Z',
    received_at: '2026-11-16T04:48:43Z',
    last_valid_gps_time: '2026-11-06T08:49:17Z',
    last_known_location: {
      latitude: 17.446317,
      longitude: 78.368395,
      timestamp: '2026-11-16T04:48:29Z',
    },
  }
  const candidate = collectLastReportedGpsCandidates(response)
    .find(({ name }) => name.endsWith('.last_known_location'))
  const location = normalizeLastReportedGpsLocation(
    candidate?.record,
    Date.parse('2026-11-17T00:00:00Z')
  )

  assert.equal(location?.coordinateSource, 'last_known')
  assert.equal(location?.recordedAt, '2026-11-06T08:49:17.000Z')
  assert.equal(location?.isStale, true)
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

test('only accepts strictly newer GPS fix timestamps for marker updates', () => {
  assert.equal(isNewerGpsTimestamp(200, 100), true)
  assert.equal(isNewerGpsTimestamp(100, 100), false)
  assert.equal(isNewerGpsTimestamp(99, 100), false)
  assert.equal(isNewerGpsTimestamp(null, 100), false)
  assert.equal(isNewerGpsTimestamp(100, null), true)
})

test('prefers the latest API-reported position over a newer-timestamped Firestore fallback', () => {
  const apiLocation = {
    latitude: 17.446317,
    longitude: 78.368395,
    timestamp: Date.parse('2026-11-12T06:00:00Z'),
  }
  const firestoreLastFix = {
    lat: 17.444978,
    lon: 78.365,
    at: '2026-11-12T07:00:00Z',
  }

  const location = selectPreferredLastReportedGpsLocation(
    apiLocation,
    [firestoreLastFix],
    now
  )

  assert.equal(location?.latitude, apiLocation.latitude)
  assert.equal(location?.longitude, apiLocation.longitude)
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
  }, now), null)
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

test('does not let reported GPS accuracy hide visible route movement', () => {
  const route = makeRoute()
  const start = Date.parse('2026-11-12T07:00:00Z')
  assert.equal(appendGpsTrailPoint(route, makePoint(17.4, start, 'start', 25)), true)
  assert.equal(appendGpsTrailPoint(route, makePoint(17.4001, start + 5_000, 'move', 25)), true)
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

test('collapses an idle session to its latest location point', () => {
  const start = Date.parse('2026-11-12T07:00:00Z')
  const segments = buildGpsTrailSegments([
    makePoint(17.4, start, 'first'),
    makePoint(17.4, start + 5 * 60_000, 'idle'),
  ])

  assert.deepEqual(segments.map((segment) => segment.map((point) => point.key)), [
    ['idle'],
  ])
})

test('keeps moving GPS fixes as a line and breaks the line after a long gap', () => {
  const start = Date.parse('2026-11-12T07:00:00Z')
  const segments = buildGpsTrailSegments([
    makePoint(17.4, start, 'start'),
    makePoint(17.4001, start + 60_000, 'move'),
    makePoint(17.401, start + 2 * DEFAULT_GPS_TRAIL_FILTERS.maxGapMs, 'after-idle'),
  ])

  assert.deepEqual(segments.map((segment) => segment.map((point) => point.key)), [
    ['start', 'move'],
    ['after-idle'],
  ])
})
