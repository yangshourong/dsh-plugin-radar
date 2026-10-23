/**
 * Curated-list source for dsh-plugin-radar.
 *
 * Loads the awesome-dsh-plugin registry through a deterministic fallback chain
 * (primary URL → configured mirrors → disk cache → bundled snapshot), normalizes
 * both the upstream registry shape (`plugins[]`) and this project's compact
 * snapshot shape (`items[]`) into one record model, and revalidates with
 * ETag/Last-Modified conditional requests.
 *
 * @module dsh-plugin-radar/sources/curated
 */

import { readFileSync } from 'node:fs'
import { createMemoryCache, readJsonFile, writeJsonFileAtomic } from '../cache.js'
import { cleanText, combineSignals, describeFailure, parseRepoFromUrl } from '../util.js'

/** Cache/snapshot payload version; bump when the record model changes. */
export const CACHE_VERSION = 2

/** Default registry cache lifetime (30 minutes). */
const DEFAULT_TTL_MS = 30 * 60 * 1000

function abortError(signal) {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('operation aborted')
  error.name = 'AbortError'
  return error
}

function normalizeDescription(description) {
  if (typeof description === 'string') return { en: cleanText(description, 600), zh: '' }
  if (description !== null && typeof description === 'object') {
    return { en: cleanText(description.en, 600), zh: cleanText(description.zh, 600) }
  }
  return { en: '', zh: '' }
}

function normalizeCategories(categories) {
  const result = {}
  if (categories === null || typeof categories !== 'object') return result
  for (const [slug, label] of Object.entries(categories)) {
    if (typeof label === 'string') {
      result[slug] = { en: cleanText(label, 120), zh: '' }
    } else if (label !== null && typeof label === 'object') {
      result[slug] = { en: cleanText(label.en, 120), zh: cleanText(label.zh, 120) }
    }
  }
  return result
}

function normalizeRecord(item, index, categories) {
  const rawName = cleanText(item?.name, 200)
  const url = cleanText(item?.url, 500)
  const repo = url.length > 0 ? parseRepoFromUrl(url) : undefined
  const owner = cleanText(item?.owner, 200) || repo?.owner || ''
  const name = repo?.name || rawName
  const descriptions = normalizeDescription(item?.description)
  const category = cleanText(item?.category, 80)
  const label = categories[category]
  const id = (owner.length > 0 && name.length > 0 ? `${owner}/${name}` : name).toLowerCase()
  return {
    id: id.length > 0 ? id : `entry-${index}`,
    name,
    owner,
    url,
    description: descriptions.en || descriptions.zh,
    descriptionEn: descriptions.en,
    descriptionZh: descriptions.zh,
    stars: Number(item?.stars ?? 0) || 0,
    category,
    categoryEn: cleanText(label?.en, 120) || category,
    categoryZh: cleanText(label?.zh, 120) || category,
    updated: cleanText(item?.added, 40) || cleanText(item?.updated, 40),
    install: cleanText(item?.install, 400),
    source: 'curated',
  }
}

/**
 * Normalize one registry document into the internal record model.
 *
 * @param doc - upstream (`plugins[]`) or snapshot (`items[]`) document.
 * @param meta - provenance: source tag and fetch timestamp.
 * @returns a registry payload ready to cache and search.
 */
export function normalizeRegistryDocument(doc, { source, fetchedAt }) {
  const categories = normalizeCategories(doc?.categories)
  const rawRecords = Array.isArray(doc?.items) ? doc.items : Array.isArray(doc?.plugins) ? doc.plugins : []
  const byId = new Map()
  rawRecords.forEach((item, index) => {
    const record = normalizeRecord(item, index, categories)
    const existing = byId.get(record.id)
    if (existing === undefined) {
      byId.set(record.id, record)
      return
    }
    if (existing.descriptionEn.length === 0) existing.descriptionEn = record.descriptionEn
    if (existing.descriptionZh.length === 0) existing.descriptionZh = record.descriptionZh
    if (existing.description.length === 0) existing.description = record.descriptionEn || record.descriptionZh
    if (existing.category.length === 0) existing.category = record.category
    if (existing.updated.length === 0) existing.updated = record.updated
    if (existing.install.length === 0) existing.install = record.install
    if (existing.stars === 0) existing.stars = record.stars
  })
  return {
    version: CACHE_VERSION,
    updated: cleanText(doc?.updated, 40) || cleanText(doc?.generatedAt, 40) || fetchedAt,
    fetchedAt,
    source,
    categories,
    records: [...byId.values()],
  }
}

/** Whether a parsed disk-cache value is a usable registry payload. */
export function isRegistryPayload(value) {
  return value !== null && typeof value === 'object' && value.version === CACHE_VERSION && Array.isArray(value.records) && value.records.length > 0
}

/**
 * Create the curated-list source.
 *
 * @param options - network, cache, and snapshot seams.
 * @returns an object with `load({ signal })` and `warmUp(signal)`.
 */
export function createCuratedSource({
  fetchImpl = globalThis.fetch,
  cachePath,
  snapshotPath,
  registryUrls = [],
  mirrorUrls = [],
  timeoutMs = 8000,
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  const memory = createMemoryCache(ttlMs)
  let snapshotCache
  let inflight

  function readSnapshot() {
    if (snapshotCache !== undefined) return snapshotCache
    if (typeof snapshotPath !== 'string' || snapshotPath.length === 0) {
      snapshotCache = null
      return null
    }
    try {
      const doc = JSON.parse(readFileSync(snapshotPath, 'utf8'))
      const registry = normalizeRegistryDocument(doc, {
        source: 'snapshot',
        fetchedAt: cleanText(doc?.generatedAt, 40) || '',
      })
      snapshotCache = registry.records.length > 0 ? registry : null
    } catch {
      snapshotCache = null
    }
    return snapshotCache
  }

  function remember(registry) {
    memory.set('registry', registry)
    return registry
  }

  function fetchDocument(url, { signal, headers }) {
    return fetchImpl(url, {
      headers,
      signal: combineSignals(signal, AbortSignal.timeout(Math.max(500, timeoutMs))),
    })
  }

  async function loadFresh({ signal } = {}) {
    const disk = await readJsonFile(cachePath)
    const usableDisk = isRegistryPayload(disk) ? disk : undefined
    const headers = { accept: 'application/json', 'user-agent': 'dsh-plugin-radar' }
    if (typeof usableDisk?.etag === 'string' && usableDisk.etag.length > 0) headers['if-none-match'] = usableDisk.etag
    if (typeof usableDisk?.lastModified === 'string' && usableDisk.lastModified.length > 0) headers['if-modified-since'] = usableDisk.lastModified
    const failures = []

    for (const url of registryUrls) {
      if (signal?.aborted === true) throw abortError(signal)
      try {
        const response = await fetchDocument(url, { signal, headers })
        if (response.status === 304 && usableDisk !== undefined) return remember({ ...usableDisk, source: 'cache' })
        if (!response.ok) {
          failures.push(`${url}: HTTP ${response.status}`)
          continue
        }
        const doc = await response.json()
        const registry = normalizeRegistryDocument(doc, { source: 'live', fetchedAt: new Date().toISOString() })
        if (registry.records.length === 0) {
          failures.push(`${url}: empty registry`)
          continue
        }
        remember(registry)
        await writeJsonFileAtomic(cachePath, {
          ...registry,
          etag: response.headers?.get?.('etag') ?? undefined,
          lastModified: response.headers?.get?.('last-modified') ?? undefined,
        }).catch(() => {})
        return registry
      } catch (error) {
        if (signal?.aborted === true) throw error
        failures.push(`${url}: ${describeFailure(error)}`)
      }
    }

    for (const url of mirrorUrls) {
      if (signal?.aborted === true) throw abortError(signal)
      try {
        const response = await fetchDocument(url, {
          signal,
          headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-radar' },
        })
        if (!response.ok) {
          failures.push(`${url}: HTTP ${response.status}`)
          continue
        }
        const doc = await response.json()
        const registry = normalizeRegistryDocument(doc, { source: 'mirror', fetchedAt: new Date().toISOString() })
        if (registry.records.length === 0) {
          failures.push(`${url}: empty registry`)
          continue
        }
        return remember(registry)
      } catch (error) {
        if (signal?.aborted === true) throw error
        failures.push(`${url}: ${describeFailure(error)}`)
      }
    }

    if (usableDisk !== undefined) return remember({ ...usableDisk, source: 'disk' })
    const snapshot = readSnapshot()
    if (snapshot !== null) return remember(snapshot)
    throw new Error(`curated registry unavailable (${failures.join('; ')})`)
  }

  function waitForInflight(promise, signal) {
    if (signal === undefined || signal === null) return promise
    if (signal.aborted === true) return Promise.reject(abortError(signal))
    return new Promise((resolvePromise, reject) => {
      const onAbort = () => reject(abortError(signal))
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          resolvePromise(value)
        },
        (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      )
    })
  }

  /**
   * Load the registry, sharing one in-flight request across concurrent callers
   * (the background warm-up and a tool call often overlap). A joining caller
   * that aborts stops waiting without cancelling the shared load.
   */
  async function load({ signal } = {}) {
    const cached = memory.get('registry')
    if (cached !== undefined) return cached
    if (inflight === undefined) {
      inflight = loadFresh({ signal }).finally(() => {
        inflight = undefined
      })
    }
    return waitForInflight(inflight, signal)
  }

  return {
    load,
    async warmUp(signal) {
      try {
        await load({ signal })
      } catch {
        // Warm-up is best effort; the first tool call retries through the chain.
      }
    },
  }
}
