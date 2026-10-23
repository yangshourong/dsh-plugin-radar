/**
 * Loopback JSON routes used by the plugin's configuration page.
 *
 * The browser page cannot read secret configuration values (the Host redacts
 * them), so it asks this Host-side route instead:
 *
 *   GET  /dsh-plugin-radar/status           → whether a token is configured,
 *                                             from which source, and the live
 *                                             page settings (never the token)
 *   GET  /dsh-plugin-radar/status?check=1   → additionally validates the
 *                                             configured token against GitHub
 *                                             and returns its quota
 *   POST /dsh-plugin-radar/token/validate   → validates a token typed into the
 *                                             page before it is saved
 *
 * Only loopback callers are accepted; request bodies are size-capped; no
 * response ever contains the token itself.
 *
 * @module dsh-plugin-radar/api
 */

import { resolveConfiguredToken, validateGitHubToken } from './github-token.js'
import { isTrustedCaller, readJsonBody, respond } from './http.js'

/** Prefix registered on the DSH web server. */
export const ROUTE_PREFIX = '/dsh-plugin-radar'

function pathOf(url, suffix) {
  return url.pathname === `${ROUTE_PREFIX}${suffix}` || url.pathname === `${ROUTE_PREFIX}${suffix}/`
}

/**
 * Build the HTTP request handler for the plugin's loopback route.
 *
 * @param options - seams: `ctx`, `getOptions`, and an optional token validator.
 * @returns the Node HTTP handler.
 */
export function createRadarHandler({ ctx, getOptions, validateToken = validateGitHubToken } = {}) {
  async function statusPayload(checkQuota) {
    const options = getOptions()
    const resolved = await resolveConfiguredToken(ctx, options)
    const configured = resolved.token !== undefined
    const credentialName = typeof options.tokenCredential === 'string' ? options.tokenCredential.trim() : ''
    const payload = {
      ok: true,
      version: 1,
      token: {
        configured,
        source: resolved.source,
        credentialName: credentialName.length > 0 ? credentialName : null,
      },
      settings: {
        defaultLang: options.defaultLang,
        maxResults: options.maxResults,
        liveSearch: options.liveSearch,
        curatedFallback: options.curatedFallback,
      },
    }
    if (checkQuota && configured) {
      payload.quota = await validateToken(resolved.token, { timeoutMs: options.requestTimeoutMs })
    }
    return payload
  }

  return async function radarHandler(req, res) {
    try {
      if (!isTrustedCaller(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      const url = new URL(String(req.url ?? ROUTE_PREFIX), 'http://localhost')
      const method = String(req.method ?? 'GET').toUpperCase()

      if (method === 'GET' || method === 'HEAD') {
        if (pathOf(url, '/status')) {
          respond(res, 200, await statusPayload(url.searchParams.get('check') === '1'))
          return
        }
        respond(res, 404, { ok: false, error: 'not found' })
        return
      }

      if (method === 'POST') {
        if (pathOf(url, '/token/validate')) {
          const body = await readJsonBody(req)
          const token = typeof body?.token === 'string' ? body.token : ''
          const options = getOptions()
          const result = await validateToken(token, { timeoutMs: options.requestTimeoutMs })
          respond(res, 200, { ok: true, ...result })
          return
        }
        respond(res, 404, { ok: false, error: 'not found' })
        return
      }

      respond(res, 405, { ok: false, error: 'method not allowed' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'bad request'
      respond(res, 400, { ok: false, error: message })
    }
  }
}
