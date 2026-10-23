import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_OPTIONS, resolveOptions } from '../lib/config.js'
import { renderText, UNTRUSTED_NOTICE } from '../lib/render.js'

test('renders numbered rows with stars, source, install command, and the untrusted notice', () => {
  const text = renderText({
    results: [
      {
        name: 'dsh-TUI',
        url: 'https://github.com/ccch1mneyyy/dsh-TUI',
        description: 'Terminal UI.',
        stars: 5262,
        category: 'UI 增强',
        updated: '2026-10-01',
        source: 'github',
        install: 'dsh plugin --profile desktop add github:ccch1mneyyy/dsh-TUI',
      },
    ],
    note: 'GitHub live search: 1 result(s).',
  })
  assert.ok(text.startsWith(UNTRUSTED_NOTICE))
  assert.match(text, /1\. dsh-TUI ★5262 — Terminal UI\./)
  assert.match(text, /source=github/)
  assert.match(text, /install: dsh plugin --profile desktop add github:ccch1mneyyy\/dsh-TUI/)
  assert.match(text, /GitHub live search: 1 result\(s\)\./)
})

test('renders an empty result list together with the provenance note', () => {
  const text = renderText({ results: [], note: 'GitHub unavailable (offline). Curated list: 3 entries.' })
  assert.match(text, /No matching plugins found/)
  assert.match(text, /awesome-dsh-plugin\.com/)
  assert.match(text, /GitHub unavailable/)
})

test('renders curated rows with their own source label', () => {
  const text = renderText({
    results: [
      {
        name: 'gamma',
        url: 'https://github.com/c/gamma',
        description: 'Gamma curated.',
        stars: 0,
        category: '',
        updated: '',
        source: 'curated',
        install: 'dsh plugin add github:c/gamma',
      },
    ],
    note: '',
  })
  assert.match(text, /source=curated/)
  assert.doesNotMatch(text, /★/)
})

test('the stamp leads the block when the caller passes resolved options', () => {
  const options = resolveOptions({})
  const text = renderText({
    results: [
      {
        name: 'alpha',
        url: 'https://github.com/c/alpha',
        description: '',
        stars: 0,
        category: '',
        updated: '',
        source: 'curated',
        install: 'dsh plugin add github:c/alpha',
      },
    ],
    note: '',
  }, options)
  const parts = text.split('\n\n')
  assert.equal(parts[0], DEFAULT_OPTIONS.resultStamp)
  assert.equal(parts[1], UNTRUSTED_NOTICE)
})

test('renderText called without options keeps the untrusted notice at the top', () => {
  const text = renderText({
    results: [
      {
        name: 'alpha',
        url: 'https://github.com/c/alpha',
        description: '',
        stars: 0,
        category: '',
        updated: '',
        source: 'curated',
        install: 'dsh plugin add github:c/alpha',
      },
    ],
    note: '',
  })
  assert.ok(text.startsWith(UNTRUSTED_NOTICE))
})

test('a blank stamp emits no stamp line', () => {
  const text = renderText({
    results: [
      {
        name: 'alpha',
        url: 'https://github.com/c/alpha',
        description: '',
        stars: 0,
        category: '',
        updated: '',
        source: 'curated',
        install: 'dsh plugin add github:c/alpha',
      },
    ],
    note: '',
  }, resolveOptions({ resultStamp: '   ' }))
  assert.ok(text.startsWith(UNTRUSTED_NOTICE))
  assert.doesNotMatch(text, /via dsh-plugin-radar-ysr/)
})
