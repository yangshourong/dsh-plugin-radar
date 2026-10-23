/**
 * dsh-plugin-radar — plugin discovery for DeepSeek Harness.
 *
 * A new implementation, not a fork: it registers one Host tool,
 * `search_dsh_plugins`, that merges a star-ranked live GitHub search over the
 * public `dsh-plugin` topic with the awesome-dsh-plugin curated list, dedupes
 * the rows, enriches bilingual descriptions, and falls back to a bundled
 * offline index with a Chinese-aware keyword engine when the network fails.
 *
 * Compatibility approach: the tool is registered through the plain 0.2.x
 * ToolDefinition contract (raw JSON Schemas, no `@deepseek-ai/dsh-tools`
 * import), so DSH peer-version gating cannot block it. The only dependency is
 * `@deepseek-ai/schemastery`, used solely to declare the plugin Config.
 *
 * @module dsh-plugin-radar
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

import { defineConfig, resolveInstallProfile, resolveOptions } from './lib/config.js'
import { OUTPUT_SCHEMA, PARAMETERS_SCHEMA, TOOL_DESCRIPTION, TOOL_NAME } from './lib/contract.js'
import { renderText } from './lib/render.js'
import { createSearcher } from './lib/search.js'
import { createCuratedSource } from './lib/sources/curated.js'
import { createGitHubSource } from './lib/sources/github.js'
import { clampNumber, resolveDshHome } from './lib/util.js'

/** Plugin name; must match package.json `name` and the patch row. */
export const name = 'dsh-plugin-radar'

/** `ctx.tools` is the one required service. */
export const inject = ['tools']

/** Plugin Config schema (Schemastery), rendered by DSH settings forms. */
export const Config = defineConfig(z)

const SNAPSHOT_PATH = fileURLToPath(new URL('./data/registry-snapshot.json', import.meta.url))
const CACHE_PATH = join(resolveDshHome(), 'cache', 'dsh-plugin-radar', 'registry-cache.json')

/**
 * Resolve the optional GitHub token credential. The credentials service is an
 * optional dependency, so it is read with `ctx.get()` instead of `inject`.
 */
async function resolveToken(ctx, options) {
  const credentialName = typeof options.tokenCredential === 'string' ? options.tokenCredential.trim() : ''
  if (credentialName.length === 0) return undefined
  try {
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    if (credentials === undefined || typeof credentials.resolve !== 'function') return undefined
    const resolved = await credentials.resolve(credentialName)
    const value = resolved?.value
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Register the discovery tool.
 *
 * @param ctx - plugin context providing `ctx.tools`.
 * @param config - Loader-validated plugin config.
 * @returns cleanup: aborts the background warm-up and unregisters the tool.
 */
export function apply(ctx, config) {
  const options = resolveOptions(config)
  if (!options.enabled) return

  const github = createGitHubSource({ timeoutMs: options.requestTimeoutMs })
  const curated = createCuratedSource({
    cachePath: CACHE_PATH,
    snapshotPath: SNAPSHOT_PATH,
    registryUrls: options.registryUrls,
    mirrorUrls: options.mirrorUrls,
    timeoutMs: options.requestTimeoutMs,
    ttlMs: options.cacheTtlMinutes * 60 * 1000,
  })
  const searcher = createSearcher({ github, curated, options })

  // Warm the curated cache in the background so the first tool call does not
  // pay the download. Best effort; failures surface through the normal chain.
  const warmUp = new AbortController()
  void curated.warmUp(warmUp.signal).catch(() => {})

  const disposeTool = ctx.tools.register({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: PARAMETERS_SCHEMA,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderText(value) }],
    },
    timeoutMs: options.totalBudgetMs + 5000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query = typeof args?.query === 'string' ? args.query : ''
      if (query.trim().length === 0) throw new Error('query must be a non-empty string')
      const limit = clampNumber(args?.limit, 1, options.maxResults, options.maxResults)
      const installProfile = resolveInstallProfile(options)
      const token = await resolveToken(ctx, options)
      return searcher.search(query, {
        limit,
        lang: typeof args?.lang === 'string' ? args.lang : options.defaultLang,
        signal: exec?.signal,
        token,
        installProfile,
      })
    },
  })

  return () => {
    warmUp.abort()
    disposeTool()
  }
}
