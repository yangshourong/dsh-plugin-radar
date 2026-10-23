/**
 * Text normalization and keyword scoring for dsh-plugin-radar.
 *
 * The offline/curated search is intentionally self-contained: Unicode NFKC
 * normalization, whitespace/punctuation collapsing, CJK bigram expansion (so a
 * natural Chinese sentence still matches multi-character terms), and field
 * weighted scoring. No tokenizer dependency.
 *
 * @module dsh-plugin-radar/match
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/gu
const SEPARATORS = /[^\p{L}\p{N}]+/u

/** Field weights used by the offline scorer. */
const FIELD_WEIGHTS = Object.freeze({
  name: 6,
  owner: 3,
  category: 3,
  url: 2,
  description: 2,
})

/**
 * Normalize any text for case- and width-insensitive matching.
 *
 * @param value - arbitrary value.
 * @returns NFKC-normalized, lowercased, whitespace-collapsed text.
 */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function addSegment(segment, tokens) {
  if (segment.length === 0) return
  if (!CJK.test(segment)) {
    tokens.add(segment)
    return
  }
  let lastIndex = 0
  CJK_RUN.lastIndex = 0
  let match
  while ((match = CJK_RUN.exec(segment)) !== null) {
    const before = segment.slice(lastIndex, match.index)
    if (before.length > 0) tokens.add(before)
    const run = match[0]
    if (run.length <= 2) {
      tokens.add(run)
    } else {
      for (let index = 0; index + 2 <= run.length; index += 1) tokens.add(run.slice(index, index + 2))
    }
    lastIndex = match.index + run.length
  }
  const tail = segment.slice(lastIndex)
  if (tail.length > 0) tokens.add(tail)
}

/**
 * Tokenize a query into Latin words plus CJK unigrams/bigrams.
 *
 * @param query - user query.
 * @returns deduplicated tokens, in first-seen order.
 */
export function tokenize(query) {
  const tokens = new Set()
  for (const segment of normalizeText(query).split(SEPARATORS)) addSegment(segment, tokens)
  return [...tokens]
}

/**
 * Score one curated record against a tokenized query.
 *
 * @param record - normalized plugin record.
 * @param tokens - tokens from {@link tokenize}.
 * @param wholeQuery - normalized full query, used for an exact-phrase bonus.
 * @returns accumulated score and the number of distinct query terms matched.
 */
export function scoreRecord(record, tokens, wholeQuery) {
  const description = normalizeText(
    [record.descriptionEn, record.descriptionZh, record.description].filter((value) => typeof value === 'string' && value.length > 0).join(' '),
  )
  const fields = {
    name: normalizeText(record.name),
    owner: normalizeText(record.owner),
    category: normalizeText(`${record.category ?? ''} ${record.categoryEn ?? ''} ${record.categoryZh ?? ''}`),
    url: normalizeText(record.url),
    description,
  }
  let score = 0
  let matched = 0
  for (const token of tokens) {
    let hit = false
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const haystack = fields[field]
      if (haystack.length === 0) continue
      if (haystack.includes(token)) {
        score += weight + Math.min(token.length, 8)
        hit = true
      }
    }
    if (hit) matched += 1
  }
  if (wholeQuery.length > 1) {
    const phraseHit = Object.values(fields).some((value) => value.length > 0 && value.includes(wholeQuery))
    if (phraseHit) {
      score += 6
      matched += 1
    }
  }
  return { score, matched }
}

/**
 * Rank curated records for a query.
 *
 * Ordering: number of distinct query terms matched, then weighted score, then
 * stars, then id — deterministic for tests.
 *
 * @param records - normalized plugin records.
 * @param query - user query.
 * @param options - result cap.
 * @returns the best records, highest relevance first.
 */
export function searchRecords(records, query, { limit = 8 } = {}) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const whole = normalizeText(query)
  const scored = []
  for (const record of records) {
    const { score, matched } = scoreRecord(record, tokens, whole)
    if (score > 0 && matched > 0) scored.push({ record, score, matched })
  }
  scored.sort(
    (a, b) =>
      b.matched - a.matched ||
      b.score - a.score ||
      Number(b.record.stars ?? 0) - Number(a.record.stars ?? 0) ||
      String(a.record.id).localeCompare(String(b.record.id)),
  )
  return scored.slice(0, limit).map((entry) => entry.record)
}
