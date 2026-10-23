/**
 * Regenerate the bundled offline index (`data/registry-snapshot.json`) from the
 * live awesome-dsh-plugin registry.
 *
 * Usage: `npm run update-data` (optionally `RADAR_REGISTRY_URL=...`).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY_URL = process.env.RADAR_REGISTRY_URL ?? 'https://awesome-dsh-plugin.com/plugins.json'
const MIRROR_URL = 'https://cdn.jsdelivr.net/npm/dsh-find-plugin@0.4.0/data/registry-snapshot.json'
const OUTPUT = fileURLToPath(new URL('../data/registry-snapshot.json', import.meta.url))

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-radar-update-data' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.json()
}

const doc = await fetchJson(REGISTRY_URL).catch(async (error) => {
  console.warn(`primary registry failed (${error.message}); trying mirror`)
  return fetchJson(MIRROR_URL)
})

const sourceItems = Array.isArray(doc?.items) ? doc.items : Array.isArray(doc?.plugins) ? doc.plugins : []
const items = sourceItems
  .map((item) => ({
    name: item?.name,
    owner: item?.owner,
    url: item?.url,
    category: item?.category,
    description: item?.description,
    install: item?.install,
    stars: Number(item?.stars ?? 0) || 0,
    added: item?.added,
  }))
  .filter((item) => typeof item.name === 'string' && item.name.length > 0)

const snapshot = {
  version: 2,
  generatedAt: new Date().toISOString(),
  source: REGISTRY_URL,
  count: items.length,
  categories: doc?.categories ?? {},
  items,
}

await mkdir(dirname(OUTPUT), { recursive: true })
const json = JSON.stringify(snapshot)
await writeFile(OUTPUT, json, 'utf8')
console.log(`registry-snapshot.json: ${items.length} entries, ${(Buffer.byteLength(json) / 1024).toFixed(1)} KiB`)
