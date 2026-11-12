import assert from 'node:assert/strict'
import test from 'node:test'
import { getJsonContentTypeError } from '../src/services/apiResponse.ts'

test('accepts JSON content types with charset parameters', () => {
  assert.equal(
    getJsonContentTypeError('application/json; charset=utf-8', 'https://api.example.test/api/v1'),
    null
  )
})

test('explains when a successful API request returned the SPA HTML fallback', () => {
  const message = getJsonContentTypeError('text/html; charset=utf-8', '/api/v1')

  assert.match(message, /index\.html fallback/)
  assert.match(message, /VITE_API_BASE_URL/)
  assert.match(message, /server-side proxy/)
})

test('explains when the response has no JSON content type', () => {
  const message = getJsonContentTypeError(null, '/api/v1')

  assert.match(message, /Content-Type is missing/)
  assert.match(message, /application\/json/)
})
