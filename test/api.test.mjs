import test from 'node:test'
import assert from 'node:assert/strict'

import { createRadarHandler, ROUTE_PREFIX } from '../lib/api.js'

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value
    },
    end(text) {
      this.body = text === undefined ? undefined : JSON.parse(text)
    },
  }
}

function fakeRequest({ method = 'GET', url = `${ROUTE_PREFIX}/status`, host = '127.0.0.1', remote = '127.0.0.1', body } = {}) {
  const listeners = new Map()
  const req = {
    method,
    url,
    headers: { host },
    socket: { remoteAddress: remote },
    on(event, listener) {
      listeners.set(event, listener)
      return req
    },
    destroy() {},
  }
  if (body !== undefined) {
    queueMicrotask(() => {
      listeners.get('data')?.(Buffer.from(JSON.stringify(body)))
      listeners.get('end')?.()
    })
  }
  return req
}

const baseOptions = {
  tokenCredential: 'GITHUB_TOKEN',
  githubToken: '',
  defaultLang: 'zh',
  maxResults: 10,
  liveSearch: true,
  curatedFallback: false,
  requestTimeoutMs: 1000,
}

function makeHandler({ options = baseOptions, ctx = { get: () => undefined }, validateToken } = {}) {
  return createRadarHandler({
    ctx,
    getOptions: () => options,
    ...(validateToken === undefined ? {} : { validateToken }),
  })
}

test('status reports a configured token without leaking it', async () => {
  const handler = makeHandler({ options: { ...baseOptions, githubToken: 'ghp_secret_value' } })
  const res = fakeResponse()
  await handler(fakeRequest(), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.token.configured, true)
  assert.equal(res.body.token.source, 'settings')
  assert.equal(JSON.stringify(res.body).includes('ghp_secret_value'), false)
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('status reports no token when nothing is configured', async () => {
  const handler = makeHandler()
  const res = fakeResponse()
  await handler(fakeRequest(), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.token.configured, false)
  assert.equal(res.body.token.source, 'none')
})

test('status reports the credential source when the token comes from DSH credentials', async () => {
  const ctx = {
    get(name) {
      assert.equal(name, 'credentials')
      return { resolve: async () => ({ value: 'ghp_from_credential' }) }
    },
  }
  const handler = makeHandler({ ctx })
  const res = fakeResponse()
  await handler(fakeRequest(), res)
  assert.equal(res.body.token.configured, true)
  assert.equal(res.body.token.source, 'credential')
  assert.equal(JSON.stringify(res.body).includes('ghp_from_credential'), false)
})

test('status?check=1 includes the validated quota', async () => {
  const handler = makeHandler({
    options: { ...baseOptions, githubToken: 'ghp_x' },
    validateToken: async (token) => ({
      valid: token === 'ghp_x',
      searchLimit: 30,
      searchRemaining: 30,
      message: 'Token 有效',
    }),
  })
  const res = fakeResponse()
  await handler(fakeRequest({ url: `${ROUTE_PREFIX}/status?check=1` }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.quota.valid, true)
  assert.equal(res.body.quota.searchLimit, 30)
})

test('the validate endpoint checks a posted token', async () => {
  const handler = makeHandler({
    validateToken: async (token) => ({ valid: token === 'good', message: token === 'good' ? 'Token 有效' : 'Token 无效' }),
  })
  const res = fakeResponse()
  await handler(fakeRequest({ method: 'POST', url: `${ROUTE_PREFIX}/token/validate`, body: { token: 'good' } }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.valid, true)

  const bad = fakeResponse()
  await handler(fakeRequest({ method: 'POST', url: `${ROUTE_PREFIX}/token/validate`, body: { token: 'bad' } }), bad)
  assert.equal(bad.statusCode, 200)
  assert.equal(bad.body.valid, false)
})

test('non-loopback callers are rejected', async () => {
  const handler = makeHandler()
  const res = fakeResponse()
  await handler(fakeRequest({ remote: '10.0.0.9', host: 'example.com' }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.ok, false)
})

test('unknown paths and unsupported methods are rejected', async () => {
  const handler = makeHandler()
  const missing = fakeResponse()
  await handler(fakeRequest({ url: `${ROUTE_PREFIX}/nope` }), missing)
  assert.equal(missing.statusCode, 404)

  const method = fakeResponse()
  await handler(fakeRequest({ method: 'PUT' }), method)
  assert.equal(method.statusCode, 405)
})
