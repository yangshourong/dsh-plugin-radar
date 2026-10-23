/**
 * Best-effort per-call usage log for `search_dsh_plugins`.
 *
 * Every executed call appends one JSON object per line: the time, the session id
 * the tool ran in, the query, the result count, and the provenance note. This is
 * the plugin's own record, written only when the tool actually executed, so it
 * answers "did this conversation really use the plugin" without relying on how the
 * model worded its reply. Writing is best effort — a log failure never turns into
 * a tool failure.
 *
 * The default file lives in the plugin's runtime cache directory
 * (`~/.dsh/cache/dsh-plugin-radar-ysr/usage.log`); `usageLogFile` overrides it and
 * `usageLog` turns recording off. Records store the query text, so the settings
 * page and README say so plainly.
 *
 * @module dsh-plugin-radar/usage-log
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { cleanText, resolveDshHome } from './util.js'

/** Per-field character cap kept inside one record. */
export const MAX_LOG_FIELD_CHARS = 200

/** Number of records a reader asks for by default. */
export const DEFAULT_TAIL_LIMIT = 20

/** Package directory name used under the DSH cache folder. */
export const USAGE_LOG_DIR = 'dsh-plugin-radar-ysr'

/**
 * Default log file path, honouring a configured override.
 *
 * @param options - resolved plugin options.
 * @param dshHome - DSH home directory.
 * @returns absolute path of the JSONL log.
 */
export function usageLogPath(options, dshHome = resolveDshHome()) {
  const configured = typeof options?.usageLogFile === 'string' ? options.usageLogFile.trim() : ''
  if (configured.length > 0) return configured
  return join(dshHome, 'cache', USAGE_LOG_DIR, 'usage.log')
}

/**
 * Build a usage logger.
 *
 * @param seams - `getOptions` for live configuration, `filePath` (string or
 * function of the resolved options), `append` and `now` for tests.
 * @returns `{ record, tail }`.
 */
export function createUsageLogger({ getOptions, filePath, append, now = () => new Date() }) {
  const resolvePath = typeof filePath === 'function' ? filePath : () => filePath

  function write(line) {
    const target = resolvePath(getOptions())
    mkdirSync(dirname(target), { recursive: true })
    appendFileSync(target, line, 'utf8')
  }

  const writeLine = typeof append === 'function' ? append : write

  /**
   * Append one record.
   *
   * @param record - `{ sessionId, query, count, note }` for the call that ran.
   * @returns true when the line was written, false when logging is off or writing
   * failed; never throws.
   */
  function record({ sessionId, query, count, note }) {
    const options = getOptions()
    if (options.usageLog !== true) return false
    const line = {
      time: now().toISOString(),
      session: typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null,
      query: cleanText(query, MAX_LOG_FIELD_CHARS),
      results: Number.isFinite(count) ? Math.trunc(count) : 0,
      note: cleanText(note, MAX_LOG_FIELD_CHARS),
    }
    try {
      writeLine(`${JSON.stringify(line)}\n`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Read the most recent records, oldest first.
   *
   * @param limit - how many records to return.
   * @returns parsed records, or an empty list when the log is off, missing, or
   * unreadable.
   */
  function tail(limit = DEFAULT_TAIL_LIMIT) {
    const options = getOptions()
    if (options.usageLog !== true) return []
    try {
      const text = readFileSync(resolvePath(options), 'utf8')
      const records = []
      for (const line of text.split('\n')) {
        if (line.length === 0) continue
        try {
          records.push(JSON.parse(line))
        } catch {
          // A damaged line is skipped rather than breaking the reader.
        }
      }
      const wanted = Math.max(1, Math.trunc(limit) || DEFAULT_TAIL_LIMIT)
      return records.slice(-wanted)
    } catch {
      return []
    }
  }

  return { record, tail }
}
