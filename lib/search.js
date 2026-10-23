/**
 * Search orchestration for dsh-plugin-radar.
 *
 * Runs the live GitHub tier and the curated/offline tier in parallel under one
 * ordinary (non-throwing) deadline, then merges:
 *
 *  - live results first, sorted by stars (the query is already requested with
 *    `sort=stars`);
 *  - curated keyword matches fill the remaining slots, and enrich live rows
 *    that also exist on the curated list with hand-written bilingual text;
 *  - rows are deduplicated by normalized `owner/repo`;
 *  - every row names its `source`, and the note explains which sources were
 *    used, what failed, and whether the budget was exhausted.
 *
 * A disabled or failing source never fails the call: the tool degrades and
 * says so in the note.
 *
 * @module dsh-plugin-radar/search
 */

import { normalizeLang } from './config.js'
import { searchRecords } from './match.js'
import { clampNumber, cleanText, createDeadline, describeFailure, resolveInstallCommand } from './util.js'

function pickDescriptions(record, curated, lang) {
  const candidates = lang === 'zh'
    ? [curated?.descriptionZh, curated?.descriptionEn, record.description, curated?.description]
    : [curated?.descriptionEn, curated?.descriptionZh, record.description, curated?.description]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return ''
}

function toResult(record, source, { curatedById, registry, lang, maxDescriptionChars, installProfile }) {
  const curated = curatedById.get(record.id)
  const categorySlug = cleanText(record.category || curated?.category, 80)
  const label = categorySlug.length > 0 ? registry?.categories?.[categorySlug] : undefined
  const category = lang === 'zh'
    ? cleanText(label?.zh || label?.en || categorySlug, 80)
    : cleanText(label?.en || label?.zh || categorySlug, 80)
  return {
    name: cleanText(record.name, 120),
    url: cleanText(record.url, 500),
    description: cleanText(pickDescriptions(record, curated, lang), maxDescriptionChars),
    stars: Number.isFinite(Number(record.stars)) ? Math.max(0, Number(record.stars)) : 0,
    category,
    updated: cleanText(record.updated, 40),
    source,
    install: resolveInstallCommand(record, installProfile),
  }
}

/**
 * Create the searcher used by the tool definition.
 *
 * `getOptions` is called once per search, so configuration changed through the
 * plugin's settings page takes effect on the next call without reloading the
 * plugin.
 *
 * @param options - `github` source, `curated` source, and the live options provider.
 * @returns an object with `search(query, callOptions)`.
 */
export function createSearcher({ github, curated, getOptions }) {
  return {
    /**
     * Search both tiers and return a canonical `{ results, note }` value.
     *
     * @param query - user query.
     * @param callOptions - `limit`, `lang`, caller `signal`, optional token, install profile.
     * @returns canonical tool output.
     */
    async search(query, { limit, lang, signal, token, installProfile } = {}) {
      const options = getOptions()
      const cleanQuery = cleanText(query, 300)
      if (cleanQuery.length === 0) throw new Error('query must be a non-empty string')
      const effectiveLimit = clampNumber(limit ?? options.maxResults, 1, options.maxResults, options.maxResults)
      const language = normalizeLang(lang, options.defaultLang)
      const profile = typeof installProfile === 'string' ? installProfile : ''
      const deadline = createDeadline(options.totalBudgetMs, signal)

      let githubOutcome
      let curatedOutcome
      const tasks = []

      if (options.liveSearch === true && github !== undefined) {
        tasks.push(
          Promise.resolve()
            .then(() => github.search(cleanQuery, {
              limit: Math.min(effectiveLimit * 2, 50),
              signal: deadline.signal,
              token,
              timeoutMs: options.requestTimeoutMs,
            }))
            .then((value) => {
              githubOutcome = { ok: true, value }
            })
            .catch((error) => {
              githubOutcome = { ok: false, error }
            }),
        )
      }
      if (options.curatedFallback === true && curated !== undefined) {
        tasks.push(
          Promise.resolve()
            .then(() => curated.load({ signal: deadline.signal }))
            .then((value) => {
              curatedOutcome = { ok: true, value }
            })
            .catch((error) => {
              curatedOutcome = { ok: false, error }
            }),
        )
      }

      await Promise.all(tasks)
      const timedOut = deadline.timedOut()
      deadline.dispose()

      const githubItems = githubOutcome?.ok === true
        ? [...githubOutcome.value.items].sort((a, b) => b.stars - a.stars)
        : []
      const registry = curatedOutcome?.ok === true ? curatedOutcome.value : undefined
      const curatedById = new Map((registry?.records ?? []).map((record) => [record.id, record]))

      let curatedMatches = []
      if (registry !== undefined) {
        curatedMatches = searchRecords(registry.records, cleanQuery, { limit: Math.min(effectiveLimit * 3, 100) })
      }

      const results = []
      const seen = new Set()
      const push = (record, source) => {
        if (results.length >= effectiveLimit) return
        const id = cleanText(record.id, 240)
        if (id.length === 0 || seen.has(id)) return
        seen.add(id)
        results.push(toResult(record, source, {
          curatedById,
          registry,
          lang: language,
          maxDescriptionChars: options.maxDescriptionChars,
          installProfile: profile,
        }))
      }
      for (const item of githubItems) push(item, 'github')
      for (const record of curatedMatches) push(record, 'curated')

      const note = []
      if (options.liveSearch !== true) {
        note.push('Live GitHub search is disabled by config.')
      } else if (githubOutcome?.ok === true) {
        const count = githubOutcome.value.items.length
        note.push(
          count > 0
            ? `GitHub live search: ${count} result(s)${githubOutcome.value.cached === true ? ' (cached)' : ''}, ranked by stars.`
            : 'GitHub live search returned no results.',
        )
        const rateLimit = githubOutcome.value.rateLimit
        if (rateLimit?.remaining !== undefined) {
          const limitText = rateLimit.limit === undefined ? '' : `/${rateLimit.limit}`
          note.push(`GitHub rate limit remaining: ${rateLimit.remaining}${limitText}${rateLimit.resetAt ? `, reset at ${rateLimit.resetAt}` : ''}.`)
        }
      }
      if (githubOutcome !== undefined && githubOutcome.ok !== true) {
        note.push(`GitHub unavailable (${describeFailure(githubOutcome.error)}).`)
      }

      if (options.curatedFallback !== true) {
        note.push('Curated fallback is disabled by config.')
      } else if (curatedOutcome?.ok === true) {
        note.push(
          `Curated list: ${registry.records.length} entries (source=${registry.source}` +
            `${registry.updated ? `, updated=${registry.updated}` : ''}).`,
        )
      } else if (curatedOutcome !== undefined && curatedOutcome.ok !== true) {
        note.push(`Curated list unavailable (${describeFailure(curatedOutcome.error)}).`)
      }

      if (timedOut) note.push(`Time budget ${options.totalBudgetMs}ms exhausted; results may be partial.`)
      if (results.length > 0 && githubItems.length === 0 && curatedMatches.length > 0) {
        note.push('Results come from curated keyword matches, not a live star-ranked GitHub search.')
      }
      note.push(`Install commands target profile "${profile || 'current'}".`)

      return { results, note: note.join(' ') }
    },
  }
}
