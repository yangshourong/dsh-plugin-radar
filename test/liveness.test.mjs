import test from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../index.js'

/** A mutable stand-in for a Loader volatile configuration box. */
function box(initial) {
  let value = initial
  return {
    get: () => value,
    set: (next) => {
      value = next
    },
  }
}

function githubItem(index) {
  return {
    full_name: `owner/repo${index}`,
    name: `repo${index}`,
    owner: { login: 'owner' },
    html_url: `https://github.com/owner/repo${index}`,
    description: `Repo ${index}`,
    stargazers_count: 100 - index,
    pushed_at: '2026-10-01T00:00:00Z',
  }
}

function jsonResponse(body, headers = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: async () => body,
  }
}

test('the tool re-reads volatile configuration on every call', async () => {
  const originalFetch = globalThis.fetch
  const seenAuthorization = []
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.github.com/search/repositories')) {
      seenAuthorization.push(init?.headers?.authorization)
      return jsonResponse(
        { items: Array.from({ length: 10 }, (_, index) => githubItem(index)) },
        { 'x-ratelimit-remaining': '9', 'x-ratelimit-limit': '10' },
      )
    }
    return jsonResponse({ plugins: [] })
  }
  try {
    const config = {
      enabled: box(true),
      liveSearch: box(true),
      curatedFallback: box(false),
      defaultLang: box('en'),
      maxResults: box(1),
      githubToken: box(''),
      requestTimeoutMs: box(1000),
      totalBudgetMs: box(3000),
    }
    let definition
    const ctx = {
      tools: {
        register(registered) {
          definition = registered
          return () => {}
        },
      },
      get() {
        return undefined
      },
    }
    apply(ctx, config)
    assert.ok(definition !== undefined, 'tool registered')

    const signal = new AbortController().signal
    const first = await definition.execute({ query: 'tui' }, { signal })
    assert.equal(first.results.length, 1)

    // A settings-page save updates the volatile box; the next call must use it.
    config.maxResults.set(3)
    const second = await definition.execute({ query: 'tui' }, { signal })
    assert.equal(second.results.length, 3)

    config.maxResults.set(2)
    config.githubToken.set('ghp_live_token')
    const third = await definition.execute({ query: 'token-check' }, { signal })
    assert.equal(third.results.length, 2)
    assert.equal(seenAuthorization.at(-1), 'Bearer ghp_live_token')
  } finally {
    globalThis.fetch = originalFetch
  }
})
