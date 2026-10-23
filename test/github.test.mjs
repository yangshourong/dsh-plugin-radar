import test from 'node:test'
import assert from 'node:assert/strict'

import { createGitHubSource, GitHubRateLimited } from '../lib/sources/github.js'

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  }
}

const oneItem = {
  items: [
    {
      full_name: 'ccch1mneyyy/dsh-TUI',
      name: 'dsh-TUI',
      owner: { login: 'ccch1mneyyy' },
      html_url: 'https://github.com/ccch1mneyyy/dsh-TUI',
      description: 'Terminal UI',
      stargazers_count: 5262,
      pushed_at: '2026-10-01T00:00:00Z',
    },
  ],
}

test('requests a global star-desc search scoped to the dsh-plugin topic', async () => {
  const calls = []
  const source = createGitHubSource({
    timeoutMs: 1000,
    fetchImpl: async (url) => {
      calls.push(String(url))
      const parsed = new URL(url)
      assert.equal(parsed.searchParams.get('sort'), 'stars')
      assert.equal(parsed.searchParams.get('order'), 'desc')
      assert.match(parsed.searchParams.get('q') ?? '', /topic:dsh-plugin/)
      assert.equal(parsed.searchParams.get('per_page'), '40')
      return jsonResponse(oneItem, { headers: { 'x-ratelimit-remaining': '9', 'x-ratelimit-limit': '10' } })
    },
  })
  const result = await source.search('tui', { limit: 8 })
  assert.equal(calls.length, 1)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].stars, 5262)
  assert.equal(result.items[0].id, 'ccch1mneyyy/dsh-tui')
  assert.equal(result.rateLimit.remaining, 9)
})

test('caches a successful query instead of hitting GitHub again', async () => {
  let calls = 0
  const source = createGitHubSource({
    timeoutMs: 1000,
    fetchImpl: async () => {
      calls += 1
      return jsonResponse(oneItem)
    },
  })
  await source.search('tui', { limit: 8 })
  const second = await source.search('tui', { limit: 8 })
  assert.equal(calls, 1)
  assert.equal(second.cached, true)
})

test('remaining=0 fails fast with a rate-limit error', async () => {
  let calls = 0
  const source = createGitHubSource({
    timeoutMs: 1000,
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({ message: 'rate limited' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
    },
  })
  await assert.rejects(
    () => source.search('tui', { limit: 8 }),
    (error) => error instanceof GitHubRateLimited && /rate limited/.test(error.message),
  )
  assert.equal(calls, 1)
})

test('a network failure retries once and then succeeds', async () => {
  let calls = 0
  const source = createGitHubSource({
    timeoutMs: 1000,
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) throw new Error('socket hang up')
      return jsonResponse({ items: [] })
    },
  })
  const result = await source.search('retry-me', { limit: 8 })
  assert.equal(result.items.length, 0)
  assert.equal(calls, 2)
})

test('cancellation is not retried', async () => {
  let calls = 0
  const controller = new AbortController()
  const source = createGitHubSource({
    timeoutMs: 1000,
    fetchImpl: async () => {
      calls += 1
      controller.abort()
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    },
  })
  await assert.rejects(() => source.search('cancel-me', { limit: 8, signal: controller.signal }))
  assert.equal(calls, 1)
})
