/**
 * Caching primitives for dsh-plugin-radar.
 *
 * A tiny TTL memory cache plus JSON disk helpers. Disk writes are atomic
 * (temp file + rename) so a crash never leaves a half-written cache.
 *
 * @module dsh-plugin-radar/cache
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Create a TTL memory cache.
 *
 * @param ttlMs - entry lifetime in milliseconds.
 * @returns get/set/clear helpers.
 */
export function createMemoryCache(ttlMs) {
  const entries = new Map()
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (Date.now() - entry.at > ttlMs) {
        entries.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key, value) {
      entries.set(key, { at: Date.now(), value })
      return value
    },
    clear() {
      entries.clear()
    },
  }
}

/**
 * Read and parse a JSON file.
 *
 * @param path - file path.
 * @returns parsed value, or undefined when the file is missing or invalid.
 */
export async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Write JSON atomically: a temp sibling is written, then renamed over the target.
 *
 * @param path - target path.
 * @param value - JSON-serializable value.
 */
export async function writeJsonFileAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, JSON.stringify(value), 'utf8')
  await rename(temp, path)
}
