import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CACHE_VERSION, createCuratedSource, normalizeRegistryDocument } from '../lib/sources/curated.js'

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  }
}

const upstreamDoc = {
  updated: '2026-10-01',
  categories: { ui: { en: 'UI Enhancements', zh: 'UI 增强' } },
  plugins: [
    {
      name: 'dsh-tui',
      owner: 'c',
      url: 'https://github.com/c/dsh-tui',
      category: 'ui',
      description: { en: 'Terminal UI.', zh: '终端 UI。' },
      install: 'dsh plugin --profile web add github:c/dsh-tui',
    },
  ],
}

const snapshotDoc = {
  version: 2,
  generatedAt: '2026-10-01T00:00:00.000Z',
  categories: { ui: { en: 'UI Enhancements', zh: 'UI 增强' } },
  items: [
    {
      name: 'offline-entry',
      owner: 'off',
      url: 'https://github.com/off/offline-entry',
      category: 'ui',
      description: { en: 'Bundled offline entry.', zh: '内置离线条目。' },
      install: 'dsh plugin add github:off/offline-entry',
    },
  ],
}

async function makeTempFiles() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-radar-'))
  const snapshotPath = join(dir, 'snapshot.json')
  await writeFile(snapshotPath, JSON.stringify(snapshotDoc), 'utf8')
  return { dir, cachePath: join(dir, 'cache.json'), snapshotPath }
}

test('normalizes the upstream registry shape into bilingual records', () => {
  const registry = normalizeRegistryDocument(upstreamDoc, { source: 'live', fetchedAt: '2026-10-02T00:00:00.000Z' })
  assert.equal(registry.version, CACHE_VERSION)
  assert.equal(registry.records.length, 1)
  const record = registry.records[0]
  assert.equal(record.id, 'c/dsh-tui')
  assert.equal(record.descriptionZh, '终端 UI。')
  assert.equal(record.categoryEn, 'UI Enhancements')
  assert.equal(record.categoryZh, 'UI 增强')
})

test('live fetch is normalized and written to the disk cache', async () => {
  const { cachePath, snapshotPath } = await makeTempFiles()
  let calls = 0
  const source = createCuratedSource({
    fetchImpl: async (url) => {
      calls += 1
      assert.equal(url, 'https://registry.test/plugins.json')
      return jsonResponse(upstreamDoc)
    },
    cachePath,
    snapshotPath,
    registryUrls: ['https://registry.test/plugins.json'],
    mirrorUrls: [],
  })
  const registry = await source.load()
  assert.equal(registry.source, 'live')
  assert.equal(registry.records[0].id, 'c/dsh-tui')
  const persisted = JSON.parse(await readFile(cachePath, 'utf8'))
  assert.equal(persisted.records[0].id, 'c/dsh-tui')
  await source.load()
  assert.equal(calls, 1, 'the second load is served from memory')
})

test('falls back to the configured mirror when the primary URL fails', async () => {
  const { cachePath, snapshotPath } = await makeTempFiles()
  const source = createCuratedSource({
    fetchImpl: async (url) => {
      if (url.includes('primary')) throw new Error('connect ECONNREFUSED')
      return jsonResponse(upstreamDoc)
    },
    cachePath,
    snapshotPath,
    registryUrls: ['https://primary.test/plugins.json'],
    mirrorUrls: ['https://mirror.test/plugins.json'],
  })
  const registry = await source.load()
  assert.equal(registry.source, 'mirror')
  assert.equal(registry.records[0].id, 'c/dsh-tui')
})

test('falls back to the bundled snapshot when every network source fails', async () => {
  const { cachePath, snapshotPath } = await makeTempFiles()
  const source = createCuratedSource({
    fetchImpl: async () => {
      throw new Error('network down')
    },
    cachePath,
    snapshotPath,
    registryUrls: ['https://registry.test/plugins.json'],
    mirrorUrls: ['https://mirror.test/plugins.json'],
  })
  const registry = await source.load()
  assert.equal(registry.source, 'snapshot')
  assert.equal(registry.records[0].id, 'off/offline-entry')
  assert.equal(registry.records[0].descriptionZh, '内置离线条目。')
})

test('concurrent loads share one network request', async () => {
  const { cachePath, snapshotPath } = await makeTempFiles()
  let calls = 0
  let release
  const gate = new Promise((resolvePromise) => {
    release = resolvePromise
  })
  const source = createCuratedSource({
    fetchImpl: async () => {
      calls += 1
      await gate
      return jsonResponse(upstreamDoc)
    },
    cachePath,
    snapshotPath,
    registryUrls: ['https://registry.test/plugins.json'],
    mirrorUrls: [],
  })
  const first = source.load()
  const second = source.load()
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(calls, 1, 'the warm-up and the tool call share one request')
  assert.equal(a.records[0].id, 'c/dsh-tui')
  assert.equal(b.records[0].id, 'c/dsh-tui')
})

test('304 revalidation serves the disk cache', async () => {
  const { cachePath, snapshotPath } = await makeTempFiles()
  const cached = {
    version: CACHE_VERSION,
    updated: '2026-10-01',
    fetchedAt: '2026-10-01T00:00:00.000Z',
    source: 'live',
    categories: {},
    records: [
      {
        id: 'd/cached',
        name: 'cached',
        owner: 'd',
        url: 'https://github.com/d/cached',
        description: 'Cached entry.',
        descriptionEn: 'Cached entry.',
        descriptionZh: '缓存条目。',
        stars: 3,
        category: '',
        categoryEn: '',
        categoryZh: '',
        updated: '',
        install: '',
        source: 'curated',
      },
    ],
    etag: 'etag-123',
    lastModified: 'Wed, 01 Oct 2026 00:00:00 GMT',
  }
  await writeFile(cachePath, JSON.stringify(cached), 'utf8')
  const source = createCuratedSource({
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers['if-none-match'], 'etag-123')
      return { ok: false, status: 304, headers: new Headers(), json: async () => undefined }
    },
    cachePath,
    snapshotPath,
    registryUrls: ['https://registry.test/plugins.json'],
    mirrorUrls: [],
  })
  const registry = await source.load()
  assert.equal(registry.source, 'cache')
  assert.equal(registry.records[0].id, 'd/cached')
})
