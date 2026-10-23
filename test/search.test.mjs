import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveOptions } from '../lib/config.js'
import { createSearcher } from '../lib/search.js'

function fakeGitHub(items, { fail } = {}) {
  return {
    async search() {
      if (fail !== undefined) throw fail
      return { items, rateLimit: { remaining: 9, limit: 10 }, cached: false }
    },
  }
}

function fakeCurated(records, { fail } = {}) {
  return {
    async load() {
      if (fail !== undefined) throw fail
      return {
        source: 'live',
        updated: '2026-10-01',
        categories: { ui: { en: 'UI Enhancements', zh: 'UI 增强' } },
        records,
      }
    },
  }
}

const baseOptions = resolveOptions({ totalBudgetMs: 5000, maxResults: 5 })

const githubItems = [
  { id: 'b/beta', name: 'beta', owner: 'b', url: 'https://github.com/b/beta', description: 'Beta live description', descriptionEn: '', descriptionZh: '', stars: 50, category: '', updated: '', install: '', source: 'github' },
  { id: 'a/alpha', name: 'alpha', owner: 'a', url: 'https://github.com/a/alpha', description: 'Alpha live description', descriptionEn: '', descriptionZh: '', stars: 100, category: '', updated: '', install: '', source: 'github' },
]

const curatedRecords = [
  {
    id: 'b/beta',
    name: 'beta',
    owner: 'b',
    url: 'https://github.com/b/beta',
    descriptionEn: 'Beta curated description',
    descriptionZh: 'Beta 精选描述',
    category: 'ui',
    categoryEn: 'UI Enhancements',
    categoryZh: 'UI 增强',
    stars: 50,
    updated: '2026-08-14',
    install: '',
    source: 'curated',
  },
  {
    id: 'c/gamma',
    name: 'gamma',
    owner: 'c',
    url: 'https://github.com/c/gamma',
    descriptionEn: 'Gamma curated description',
    descriptionZh: 'Gamma 精选描述',
    category: 'ui',
    categoryEn: 'UI Enhancements',
    categoryZh: 'UI 增强',
    stars: 0,
    updated: '2026-08-14',
    install: '',
    source: 'curated',
  },
]

test('merges live and curated rows, dedupes, enriches, and fills to the limit', async () => {
  const searcher = createSearcher({ github: fakeGitHub(githubItems), curated: fakeCurated(curatedRecords), options: baseOptions })
  const value = await searcher.search('gamma beta', { limit: 3, lang: 'zh', installProfile: 'desktop' })

  assert.equal(value.results.length, 3)
  assert.deepEqual(value.results.map((row) => row.source), ['github', 'github', 'curated'])
  assert.equal(value.results[0].id ?? value.results[0].name, 'alpha')
  assert.equal(value.results[1].description, 'Beta 精选描述', 'live row enriched by curated bilingual description')
  assert.equal(value.results[2].name, 'gamma')
  assert.ok(value.results.every((row) => row.install.startsWith('dsh plugin --profile desktop add github:')))
  assert.match(value.note, /GitHub live search: 2 result\(s\)/)
  assert.match(value.note, /Curated list: 2 entries/)
  assert.match(value.note, /Install commands target profile "desktop"/)
})

test('falls back to curated keyword matches when GitHub fails', async () => {
  const searcher = createSearcher({
    github: fakeGitHub([], { fail: new Error('GitHub search HTTP 500') }),
    curated: fakeCurated(curatedRecords),
    options: baseOptions,
  })
  const value = await searcher.search('gamma', { limit: 3, installProfile: 'desktop' })
  assert.equal(value.results.length, 1)
  assert.equal(value.results[0].name, 'gamma')
  assert.equal(value.results[0].source, 'curated')
  assert.match(value.note, /GitHub unavailable/)
  assert.match(value.note, /curated keyword matches/)
})

test('returns an explanatory note when both sources fail', async () => {
  const searcher = createSearcher({
    github: fakeGitHub([], { fail: new Error('offline') }),
    curated: fakeCurated([], { fail: new Error('registry down') }),
    options: baseOptions,
  })
  const value = await searcher.search('tui', { limit: 3 })
  assert.deepEqual(value.results, [])
  assert.match(value.note, /GitHub unavailable/)
  assert.match(value.note, /Curated list unavailable/)
})

test('honors the total budget with a hanging sender', async () => {
  const hangingGitHub = {
    search(_query, { signal }) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted by deadline')))
      })
    },
  }
  const searcher = createSearcher({
    github: hangingGitHub,
    curated: fakeCurated(curatedRecords),
    options: { ...baseOptions, totalBudgetMs: 120 },
  })
  const value = await searcher.search('gamma', { limit: 3 })
  assert.ok(value.results.length > 0)
  assert.match(value.note, /Time budget 120ms exhausted/)
})

test('reports disabled sources instead of calling them', async () => {
  const searcher = createSearcher({
    github: undefined,
    curated: undefined,
    options: { ...baseOptions, liveSearch: false, curatedFallback: false },
  })
  const value = await searcher.search('tui', { limit: 3 })
  assert.deepEqual(value.results, [])
  assert.match(value.note, /Live GitHub search is disabled/)
  assert.match(value.note, /Curated fallback is disabled/)
})
