/**
 * GitHub source for dsh-plugin-radar.
 *
 * A new implementation (not a port) of the live community tier: GitHub's search
 * API scoped to the public `dsh-plugin` topic, requested with an explicit
 * `sort=stars&order=desc` so the returned slice is a real star ranking rather
 * than a local reorder of relevance hits.
 *
 * Failure policy:
 *  - network/timeouts retry once with jitter, then surface a cause-chained error;
 *  - 403/429 carry GitHub's rate-limit headers: `remaining=0` fails fast (no
 *    pointless retry), otherwise one `retry-after`-aware retry;
 *  - caller cancellation is never retried;
 *  - successes cache 5 minutes, failures 60 seconds, keyed by query + limit.
 *
 * The `fetchImpl` and clock seams are injectable for tests.
 *
 * @module dsh-plugin-radar/sources/github
 */

import { createMemoryCache } from '../cache.js'
import { cleanText, combineSignals, describeFailure, sleep } from '../util.js'

/** Successful-result cache lifetime. */
const SUCCESS_TTL_MS = 5 * 60 * 1000
/** Failure cache lifetime, so retry loops cannot keep burning quota. */
const FAILURE_TTL_MS = 60 * 1000
/** Upper bound on one rate-limit retry delay. */
const MAX_RETRY_DELAY_MS = 3000

/** Thrown when GitHub reports rate limiting, with the parsed header info. */
export class GitHubRateLimited extends Error {
  constructor(message, info) {
    super(message)
    this.name = 'GitHubRateLimited'
    this.info = info
  }
}

function readNumberHeader(response, key) {
  const raw = typeof response?.headers?.get === 'function' ? response.headers.get(key) : undefined
  if (raw === null || raw === undefined || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function rateLimitInfo(response) {
  const reset = readNumberHeader(response, 'x-ratelimit-reset')
  return {
    status: Number(response?.status ?? 0),
    limit: readNumberHeader(response, 'x-ratelimit-limit'),
    remaining: readNumberHeader(response, 'x-ratelimit-remaining'),
    resetAt: reset === undefined ? undefined : new Date(reset * 1000).toISOString(),
    retryAfter: readNumberHeader(response, 'retry-after'),
  }
}

/** Map one GitHub repository item into a plugin record. */
function mapItem(item) {
  const fullName = String(item?.full_name ?? '')
  const [fullOwner = '', fullRepo = ''] = fullName.split('/')
  const owner = String(item?.owner?.login ?? fullOwner)
  const name = String(item?.name ?? fullRepo)
  return {
    id: `${owner}/${name}`.toLowerCase(),
    name,
    owner,
    url: String(item?.html_url ?? ''),
    description: String(item?.description ?? ''),
    descriptionEn: '',
    descriptionZh: '',
    stars: Number(item?.stargazers_count ?? 0) || 0,
    category: '',
    categoryLabel: '',
    updated: String(item?.pushed_at ?? ''),
    install: '',
    source: 'github',
  }
}

/**
 * Create the GitHub search source.
 *
 * @param options - optional overrides: `fetchImpl`, `timeoutMs`, `now`.
 * @returns an object with `search(query, { limit, signal, token })`.
 */
export function createGitHubSource({ fetchImpl = globalThis.fetch, timeoutMs = 8000, now = Date.now } = {}) {
  const successes = createMemoryCache(SUCCESS_TTL_MS)
  const failures = createMemoryCache(FAILURE_TTL_MS)

  async function request(query, limit, signal, token, requestTimeoutMs) {
    const perPage = Math.min(Math.max(limit * 5, 20), 100)
    const params = new URLSearchParams({
      q: `${query} topic:dsh-plugin`,
      sort: 'stars',
      order: 'desc',
      per_page: String(perPage),
    })
    const url = `https://api.github.com/search/repositories?${params.toString()}`
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-plugin-radar' }
    if (typeof token === 'string' && token.length > 0) headers.authorization = `Bearer ${token}`

    let attempt = 0
    const budget = Number.isFinite(requestTimeoutMs) ? Math.max(500, requestTimeoutMs) : timeoutMs
    for (;;) {
      const attemptSignal = combineSignals(signal, AbortSignal.timeout(budget))
      let response
      try {
        response = await fetchImpl(url, { headers, signal: attemptSignal })
      } catch (error) {
        if (signal?.aborted === true) throw error
        if (attempt === 0) {
          attempt += 1
          await sleep(150 + Math.floor(Math.random() * 300), signal)
          continue
        }
        throw new Error(`GitHub search failed: ${describeFailure(error)}`)
      }

      if (response.ok) {
        const body = await response.json()
        const items = Array.isArray(body?.items) ? body.items.map(mapItem) : []
        return { items, rateLimit: rateLimitInfo(response), authenticated: Boolean(token), fetchedAt: now() }
      }

      const info = rateLimitInfo(response)
      const limited = response.status === 403 || response.status === 429
      if (limited && attempt === 0 && info.remaining !== 0) {
        attempt += 1
        const delay = Math.min((info.retryAfter ?? 1) * 1000, MAX_RETRY_DELAY_MS)
        await sleep(delay, signal)
        continue
      }
      if (limited) {
        const detail = [
          `remaining=${info.remaining ?? '?'}`,
          info.resetAt === undefined ? undefined : `resetAt=${info.resetAt}`,
          token === undefined ? 'token=none' : 'token=set',
        ].filter((part) => part !== undefined).join(' ')
        throw new GitHubRateLimited(
          `GitHub search rate limited (HTTP ${response.status}; ${detail}). Anonymous search allows 10 req/min per ` +
            'public IP; configure the GitHub token credential to raise the quota.',
          info,
        )
      }
      throw new Error(`GitHub search HTTP ${response.status}${info.remaining === undefined ? '' : ` (remaining=${info.remaining})`}`)
    }
  }

  return {
    /**
     * Search GitHub for repositories carrying the `dsh-plugin` topic.
     *
     * @param query - keyword query.
     * @param options - result cap, caller signal, optional token.
     * @returns `{ items, rateLimit, authenticated, fetchedAt, cached }`.
     */
    async search(query, { limit = 8, signal, token, timeoutMs } = {}) {
      const key = `${cleanText(query, 200).toLowerCase()}|${limit}`
      const cached = successes.get(key)
      if (cached !== undefined) return { ...cached, cached: true }
      const failed = failures.get(key)
      if (failed !== undefined) throw failed
      try {
        const result = await request(query, limit, signal, token, timeoutMs)
        successes.set(key, result)
        return { ...result, cached: false }
      } catch (error) {
        failures.set(key, error)
        throw error
      }
    },
  }
}
