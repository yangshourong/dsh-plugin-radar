/**
 * dsh-plugin-radar — plugin discovery for DeepSeek Harness.
 *
 * A new implementation, not a fork: it registers one Host tool,
 * `search_dsh_plugins`, that merges a star-ranked live GitHub search over the
 * public `dsh-plugin` topic with the awesome-dsh-plugin curated list, dedupes
 * the rows, enriches bilingual descriptions, and falls back to a bundled
 * offline index with a Chinese-aware keyword engine when the network fails.
 *
 * Configuration is read on every tool call and HTTP request (`getOptions`), so
 * settings saved on the plugin's page apply to the next call without reloading
 * the plugin. The optional loopback route serves the configuration page's token
 * status/quota checks and never returns a secret.
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

import { createRadarHandler, ROUTE_PREFIX } from './lib/api.js'
import { defineConfig, resolveInstallProfile, resolveOptions } from './lib/config.js'
import { OUTPUT_SCHEMA, PARAMETERS_SCHEMA, TOOL_DESCRIPTION, TOOL_NAME } from './lib/contract.js'
import { resolveConfiguredToken } from './lib/github-token.js'
import { renderText } from './lib/render.js'
import { createSearcher } from './lib/search.js'
import { createCuratedSource } from './lib/sources/curated.js'
import { createGitHubSource } from './lib/sources/github.js'
import { clampNumber, resolveDshHome } from './lib/util.js'

/** Plugin name; must match package.json `name` and the patch row. */
export const name = '@yangshourong/dsh-plugin-radar-ysr'

/** `ctx.tools` is the one required service. */
export const inject = ['tools']

/** Plugin Config schema (Schemastery), rendered by DSH settings forms. */
export const Config = defineConfig(z)

const SNAPSHOT_PATH = fileURLToPath(new URL('./data/registry-snapshot.json', import.meta.url))
const CACHE_PATH = join(resolveDshHome(), 'cache', 'dsh-plugin-radar-ysr', 'registry-cache.json')

/**
 * Register the discovery tool and the loopback status route.
 *
 * @param ctx - plugin context providing `ctx.tools` (and optionally `webServer`).
 * @param config - Loader-validated plugin config; volatile fields stay live.
 * @returns cleanup: aborts the background warm-up and disposes registrations.
 */
export function apply(ctx, config) {
  const initial = resolveOptions(config)
  if (!initial.enabled) return () => {}

  // Live configuration: the tool and the HTTP route re-read these boxes per call.
  const getOptions = () => resolveOptions(config)

  const github = createGitHubSource({ timeoutMs: initial.requestTimeoutMs })
  const curated = createCuratedSource({
    cachePath: CACHE_PATH,
    snapshotPath: SNAPSHOT_PATH,
    registryUrls: initial.registryUrls,
    mirrorUrls: initial.mirrorUrls,
    timeoutMs: initial.requestTimeoutMs,
    ttlMs: Math.max(0, initial.cacheTtlMinutes) * 60 * 1000,
  })
  const searcher = createSearcher({ github, curated, getOptions })

  // Warm the curated cache in the background so the first tool call does not
  // pay the download. Best effort; failures surface through the normal chain.
  const warmUp = new AbortController()
  if (initial.curatedFallback === true) void curated.warmUp(warmUp.signal).catch(() => {})

  const disposers = []

  disposers.push(ctx.tools.register({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: PARAMETERS_SCHEMA,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderText(value) }],
    },
    timeoutMs: initial.totalBudgetMs + 5000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const options = getOptions()
      const query = typeof args?.query === 'string' ? args.query : ''
      if (query.trim().length === 0) throw new Error('query must be a non-empty string')
      const limit = clampNumber(args?.limit, 1, options.maxResults, options.maxResults)
      const installProfile = resolveInstallProfile(options)
      const token = (await resolveConfiguredToken(ctx, options)).token
      return searcher.search(query, {
        limit,
        lang: typeof args?.lang === 'string' ? args.lang : options.defaultLang,
        signal: exec?.signal,
        token,
        installProfile,
      })
    },
  }))

  // The configuration page lives in the Web GUI; without a web server this
  // plugin still exposes its tool, only the page's status helpers are absent.
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (webServer !== undefined && typeof webServer.register === 'function') {
    const installRoute = () => {
      let unregister
      try {
        unregister = webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: createRadarHandler({ ctx, getOptions }),
        })
      } catch (error) {
        ctx.logger?.warn?.('[dsh-plugin-radar] HTTP route registration failed:', error)
      }
      return () => {
        try {
          unregister?.()
        } catch {
          // Already disposed.
        }
      }
    }
    disposers.push(typeof ctx.effect === 'function' ? ctx.effect(installRoute, 'dsh-plugin-radar: http routes') : installRoute())
  }

  return () => {
    warmUp.abort()
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // Keep disposing the rest.
      }
    }
  }
}
