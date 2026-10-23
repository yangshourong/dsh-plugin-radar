import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveOptions } from '../lib/config.js'
import { createUsageLogger, MAX_LOG_FIELD_CHARS } from '../lib/usage-log.js'

function makeLogger(overrides = {}, seams = {}) {
  return createUsageLogger({
    getOptions: () => resolveOptions(overrides),
    filePath: seams.filePath,
    append: seams.append,
    now: () => new Date('2026-10-23T12:00:00.000Z'),
  })
}

test('records one JSONL line per call, keyed by the session id the tool was invoked in', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-radar-usage-'))
  const filePath = join(home, 'usage.log')
  const logger = makeLogger({}, { filePath })

  assert.equal(logger.record({ sessionId: 'session-abc', query: 'terminal TUI', count: 2, note: 'GitHub live search: 2 result(s).' }), true)

  const line = JSON.parse(readFileSync(filePath, 'utf8').trim())
  assert.equal(line.time, '2026-10-23T12:00:00.000Z')
  assert.equal(line.session, 'session-abc')
  assert.equal(line.query, 'terminal TUI')
  assert.equal(line.results, 2)
  assert.equal(line.note, 'GitHub live search: 2 result(s).')
})

test('records append in call order', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-radar-usage-'))
  const filePath = join(home, 'usage.log')
  const logger = makeLogger({}, { filePath })
  logger.record({ sessionId: 's1', query: 'first', count: 1, note: '' })
  logger.record({ sessionId: 's2', query: 'second', count: 3, note: 'Curated list: 3 entries.' })

  const lines = readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines.length, 2)
  assert.deepEqual(lines.map((line) => line.query), ['first', 'second'])
  assert.deepEqual(logger.tail(1), lines.slice(1))
})

test('the log directory is created on the first write', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-radar-usage-'))
  const filePath = join(home, 'nested', 'deeper', 'usage.log')
  makeLogger({}, { filePath }).record({ sessionId: 's1', query: 'tui', count: 0, note: '' })
  assert.ok(existsSync(filePath), 'log file written under a missing directory')
})

test('logging off writes nothing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-radar-usage-'))
  const filePath = join(home, 'usage.log')
  const logger = makeLogger({ usageLog: false }, { filePath })
  assert.equal(logger.record({ sessionId: 's1', query: 'tui', count: 1, note: '' }), false)
  assert.equal(existsSync(filePath), false)
  assert.deepEqual(logger.tail(5), [])
})

test('a failing append is best effort and never breaks the tool call', () => {
  const logger = makeLogger({}, { append: () => { throw new Error('EBUSY: resource busy') } })
  assert.equal(logger.record({ sessionId: 's1', query: 'tui', count: 1, note: '' }), false)
})

test('fields are cleaned and capped so the log stays one JSON object per line', () => {
  const captured = []
  const spy = createUsageLogger({
    getOptions: () => resolveOptions({}),
    append: (line) => { captured.push(line) },
    now: () => new Date('2026-10-23T12:00:00.000Z'),
  })

  spy.record({ query: `a\nb\tc${'x'.repeat(500)}`, count: 1, note: `note ${'y'.repeat(500)}` })

  assert.equal(captured.length, 1)
  assert.ok(captured[0].endsWith('\n'))
  assert.equal(JSON.stringify(JSON.parse(captured[0])).length, captured[0].length - 1)

  const line = JSON.parse(captured[0])
  assert.equal(line.query.length, MAX_LOG_FIELD_CHARS)
  assert.ok(line.query.startsWith('a b c'))
  assert.ok(line.query.endsWith('…'))
  assert.ok(line.note.endsWith('…'))
  assert.equal(line.session, null)
  assert.equal(line.results, 1)
})
