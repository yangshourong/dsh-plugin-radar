import test from 'node:test'
import assert from 'node:assert/strict'

import { OUTPUT_SCHEMA, PARAMETERS_SCHEMA, TOOL_DESCRIPTION, TOOL_NAME } from '../lib/contract.js'

/**
 * The enforced DSH JSON-Schema subset accepts exactly these keywords (plus the
 * annotation-only ones). When DSH widens or narrows the subset, this test is the
 * tripwire: the plugin never imports `dsh-tools`, so a contract drift would
 * otherwise only appear at runtime.
 */
const CONSTRAINT_KEYS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const'])
const ANNOTATION_KEYS = new Set(['description', 'title', 'default', 'examples', 'deprecated'])
const SCALAR_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function assertSupportedSchema(schema, path = '$') {
  assert.equal(typeof schema, 'object', `${path} must be an object`)
  assert.notEqual(schema, null, `${path} must not be null`)
  for (const key of Object.keys(schema)) {
    assert.ok(CONSTRAINT_KEYS.has(key) || ANNOTATION_KEYS.has(key), `${path}: unsupported keyword "${key}"`)
  }
  if (schema.type !== undefined) {
    if (Array.isArray(schema.type)) {
      for (const type of schema.type) assert.ok(SCALAR_TYPES.has(type), `${path}: unknown type "${type}"`)
    } else {
      assert.ok(SCALAR_TYPES.has(schema.type), `${path}: unknown type "${schema.type}"`)
    }
  }
  if (schema.items !== undefined) assertSupportedSchema(schema.items, `${path}.items`)
  if (schema.properties !== undefined) {
    for (const [key, child] of Object.entries(schema.properties)) {
      assertSupportedSchema(child, `${path}.properties.${key}`)
    }
  }
  if (schema.required !== undefined) {
    assert.ok(Array.isArray(schema.required), `${path}.required must be an array`)
    for (const key of schema.required) assert.equal(typeof key, 'string')
    if (schema.properties !== undefined) {
      for (const key of schema.required) assert.ok(key in schema.properties, `${path}: required "${key}" has no property schema`)
    }
  }
}

test('tool name and description are present', () => {
  assert.equal(TOOL_NAME, 'search_dsh_plugins')
  assert.ok(TOOL_DESCRIPTION.length > 80)
})

test('parameter schema stays within the enforced subset', () => {
  assertSupportedSchema(PARAMETERS_SCHEMA)
  assert.equal(PARAMETERS_SCHEMA.type, 'object')
  assert.deepEqual(PARAMETERS_SCHEMA.required, ['query'])
  assert.equal(PARAMETERS_SCHEMA.additionalProperties, false)
  assert.equal(PARAMETERS_SCHEMA.properties.query.type, 'string')
  assert.equal(PARAMETERS_SCHEMA.properties.limit.type, 'number')
  assert.equal(PARAMETERS_SCHEMA.properties.lang.type, 'string')
})

test('output schema stays within the enforced subset and covers every rendered field', () => {
  assertSupportedSchema(OUTPUT_SCHEMA)
  assert.equal(OUTPUT_SCHEMA.type, 'object')
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false)
  const item = OUTPUT_SCHEMA.properties.results.items
  for (const field of ['name', 'url', 'description', 'stars', 'category', 'updated', 'source', 'install']) {
    assert.ok(item.properties[field] !== undefined, `missing result field "${field}"`)
    assert.ok(item.required.includes(field), `result field "${field}" is not required`)
  }
  assert.equal(item.properties.stars.type, 'number')
  assert.deepEqual(OUTPUT_SCHEMA.required, ['results', 'note'])
})
