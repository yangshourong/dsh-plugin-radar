import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeText, searchRecords, tokenize } from '../lib/match.js'

const records = [
  {
    id: 'a/terminal',
    name: 'dsh-terminal-ui',
    owner: 'a',
    url: 'https://github.com/a/dsh-terminal-ui',
    category: 'ui',
    categoryEn: 'UI Enhancements',
    categoryZh: 'UI 增强',
    descriptionEn: 'A terminal UI for DeepSeek Harness.',
    descriptionZh: 'DeepSeek Harness 的终端 UI。',
    stars: 120,
  },
  {
    id: 'b/wechat',
    name: 'dsh-wechat',
    owner: 'b',
    url: 'https://github.com/b/dsh-wechat',
    category: 'notify',
    categoryEn: 'Notifications & Integrations',
    categoryZh: '通知与集成',
    descriptionEn: 'Send a WeChat notification when a task finishes.',
    descriptionZh: '任务完成后发送微信通知。',
    stars: 80,
  },
  {
    id: 'c/tui',
    name: 'dsh-tui',
    owner: 'c',
    url: 'https://github.com/c/dsh-tui',
    category: 'ui',
    categoryEn: 'UI Enhancements',
    categoryZh: 'UI 增强',
    descriptionEn: 'Terminal UI.',
    descriptionZh: '终端界面。',
    stars: 300,
  },
]

test('tokenize expands CJK runs into bigrams', () => {
  const tokens = tokenize('任务完成后微信通知')
  assert.ok(tokens.includes('微信'))
  assert.ok(tokens.includes('通知'))
  assert.ok(tokens.includes('完成'))
  assert.ok(!tokens.includes('任务完成后微信通知'), 'a long CJK run is not one token')
})

test('normalizeText folds width, case, and whitespace', () => {
  assert.equal(normalizeText('  ＴＵＩ   Terminal  '), 'tui terminal')
})

test('a Chinese sentence ranks the matching curated record first', () => {
  const results = searchRecords(records, '任务完成后微信通知', { limit: 3 })
  assert.equal(results[0].id, 'b/wechat')
})

test('name weight outranks a description-only mention', () => {
  const results = searchRecords(records, 'terminal', { limit: 3 })
  assert.equal(results[0].id, 'a/terminal', 'name match ranks first')
  assert.equal(results[1].id, 'c/tui', 'description-only match ranks second')
})

test('no match yields an empty list', () => {
  assert.deepEqual(searchRecords(records, 'blockchain', { limit: 3 }), [])
})
