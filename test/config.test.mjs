import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_OPTIONS, normalizeLang, resolveInstallProfile, resolveOptions } from '../lib/config.js'
import { detectProfileName } from '../lib/util.js'

test('defaults apply when no config is provided', () => {
  const options = resolveOptions(undefined)
  assert.equal(options.enabled, true)
  assert.equal(options.maxResults, 8)
  assert.equal(options.defaultLang, 'en')
  assert.equal(options.liveSearch, true)
  assert.equal(options.curatedFallback, true)
  assert.deepEqual(options.registryUrls, [...DEFAULT_OPTIONS.registryUrls])
  assert.deepEqual(options.mirrorUrls, [...DEFAULT_OPTIONS.mirrorUrls])
})

test('volatile boxes are unwrapped recursively', () => {
  const box = (value) => ({ get: () => value })
  const options = resolveOptions({
    enabled: box(true),
    maxResults: box(12),
    defaultLang: box('zh'),
    installProfile: box('desktop'),
    registryUrls: box(['https://a.test/plugins.json', '  ', 'https://b.test/plugins.json']),
    liveSearch: box(false),
  })
  assert.equal(options.maxResults, 12)
  assert.equal(options.defaultLang, 'zh')
  assert.equal(options.installProfile, 'desktop')
  assert.deepEqual(options.registryUrls, ['https://a.test/plugins.json', 'https://b.test/plugins.json'])
  assert.equal(options.liveSearch, false)
})

test('out-of-range numbers clamp and invalid types fall back', () => {
  const options = resolveOptions({ maxResults: 999, totalBudgetMs: 'nope', maxDescriptionChars: 5 })
  assert.equal(options.maxResults, 50)
  assert.equal(options.totalBudgetMs, DEFAULT_OPTIONS.totalBudgetMs)
  assert.equal(options.maxDescriptionChars, 40)
})

test('normalizeLang accepts zh variants and falls back', () => {
  assert.equal(normalizeLang('zh'), 'zh')
  assert.equal(normalizeLang('zh-CN'), 'zh')
  assert.equal(normalizeLang('zh-Hans'), 'zh')
  assert.equal(normalizeLang('en-US'), 'en')
  assert.equal(normalizeLang('fr'), 'en')
  assert.equal(normalizeLang(undefined, 'zh'), 'zh')
})

test('install profile prefers explicit config over DSH_PROFILE', () => {
  const previous = process.env.DSH_PROFILE
  process.env.DSH_PROFILE = 'desktop'
  try {
    assert.equal(resolveInstallProfile(resolveOptions({})), 'desktop')
    assert.equal(resolveInstallProfile(resolveOptions({ installProfile: 'custom' })), 'custom')
    assert.equal(resolveInstallProfile({ installProfile: '' }), 'desktop')
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE
    else process.env.DSH_PROFILE = previous
  }
})

test('detectProfileName finds the profile that links this package', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-radar-home-'))
  await mkdir(join(home, 'profiles', 'desktop', 'node_modules', 'dsh-plugin-radar-ysr', 'lib'), { recursive: true })
  await mkdir(join(home, 'profiles', 'other', 'node_modules'), { recursive: true })
  assert.equal(detectProfileName(home, 'dsh-plugin-radar-ysr'), 'desktop')
  assert.equal(detectProfileName(home, 'not-installed'), '')
  assert.equal(detectProfileName('', 'dsh-plugin-radar-ysr'), '')
})

test('install profile falls back to the linked profile directory without DSH_PROFILE', async () => {
  const previous = process.env.DSH_PROFILE
  delete process.env.DSH_PROFILE
  try {
    const home = await mkdtemp(join(tmpdir(), 'dsh-radar-home-'))
    await mkdir(join(home, 'profiles', 'demo', 'node_modules', 'dsh-plugin-radar-ysr'), { recursive: true })
    assert.equal(resolveInstallProfile({ installProfile: '' }, { dshHome: home }), 'demo')
    assert.equal(resolveInstallProfile({ installProfile: 'explicit' }, { dshHome: home }), 'explicit')
    assert.equal(resolveInstallProfile({ installProfile: '' }, { dshHome: join(home, 'missing') }), '')
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE
    else process.env.DSH_PROFILE = previous
  }
})
