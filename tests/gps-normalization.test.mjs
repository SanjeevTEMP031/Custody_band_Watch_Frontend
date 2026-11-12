import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isFreshGpsTimestamp,
  mergeVerifiedGpsFixes,
  normalizeVerifiedGpsFix,
} from '../src/services/gpsNormalization.ts'

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
