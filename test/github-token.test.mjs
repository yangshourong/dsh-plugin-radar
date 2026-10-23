import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveConfiguredToken, validateGitHubToken } from '../lib/github-token.js'

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }
}

test('validates a token and reads its search quota', async () => {
  let seen
  const result = await validateGitHubToken('ghp_test', {
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      seen = { url, headers: init.headers }
      return jsonResponse({ resources: { search: { limit: 30, remaining: 29 }, core: { limit: 5000 } } })
    },
  })
  assert.equal(result.valid, true)
  assert.equal(result.searchLimit, 30)
  assert.equal(result.searchRemaining, 29)
  assert.equal(result.coreLimit, 5000)
  assert.equal(seen.url, 'https://api.github.com/rate_limit')
  assert.equal(seen.headers.authorization, 'Bearer ghp_test')
})

test('reports an invalid token on HTTP 401', async () => {
  const result = await validateGitHubToken('bad', {
    timeoutMs: 1000,
    fetchImpl: async () => jsonResponse({ message: 'Bad credentials' }, { status: 401 }),
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'invalid')
  assert.match(result.message, /401/)
})

test('reports network failures without throwing', async () => {
  const result = await validateGitHubToken('ghp_test', {
    timeoutMs: 1000,
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'network')
  assert.match(result.message, /offline/)
})

test('rejects an empty token before any request', async () => {
  let called = false
  const result = await validateGitHubToken('   ', {
    fetchImpl: async () => {
      called = true
      return jsonResponse({})
    },
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'empty')
  assert.equal(called, false)
})

test('resolveConfiguredToken prefers the saved configuration token', async () => {
  const resolved = await resolveConfiguredToken({}, { githubToken: '  ghp_saved  ', tokenCredential: 'GITHUB_TOKEN' })
  assert.deepEqual(resolved, { token: 'ghp_saved', source: 'settings' })
})

test('resolveConfiguredToken falls back to the DSH credential', async () => {
  const ctx = {
    get(name) {
      assert.equal(name, 'credentials')
      return { resolve: async (ref) => ({ value: ref === 'GITHUB_TOKEN' ? 'ghp_credential' : undefined }) }
    },
  }
  const resolved = await resolveConfiguredToken(ctx, { githubToken: '', tokenCredential: 'GITHUB_TOKEN' })
  assert.deepEqual(resolved, { token: 'ghp_credential', source: 'credential' })
})

test('resolveConfiguredToken reports none when nothing is configured', async () => {
  const resolved = await resolveConfiguredToken({ get: () => undefined }, { githubToken: '', tokenCredential: 'GITHUB_TOKEN' })
  assert.deepEqual(resolved, { token: undefined, source: 'none' })
})
