/**
 * GitHub token helpers: resolve the configured token and validate it against
 * GitHub's rate-limit endpoint.
 *
 * Validation happens on the Host (Node fetch), so the browser never needs to
 * call GitHub directly and the token never appears in a response.
 *
 * @module dsh-plugin-radar/github-token
 */

/**
 * Resolve the token the plugin should use, and where it came from.
 *
 * Order: the token saved on the configuration page, then the DSH credential
 * named by `tokenCredential`.
 *
 * @param ctx - plugin context (optional credentials service is read with `ctx.get`).
 * @param options - resolved plugin options.
 * @returns `{ token, source }`; `source` is `'settings'`, `'credential'`, or `'none'`.
 */
export async function resolveConfiguredToken(ctx, options) {
  const saved = typeof options?.githubToken === 'string' ? options.githubToken.trim() : ''
  if (saved.length > 0) return { token: saved, source: 'settings' }

  const credentialName = typeof options?.tokenCredential === 'string' ? options.tokenCredential.trim() : ''
  if (credentialName.length === 0) return { token: undefined, source: 'none' }
  try {
    const credentials = typeof ctx?.get === 'function' ? ctx.get('credentials') : undefined
    if (credentials === undefined || typeof credentials.resolve !== 'function') return { token: undefined, source: 'none' }
    const resolved = await credentials.resolve(credentialName)
    const value = resolved?.value
    if (typeof value === 'string' && value.length > 0) return { token: value, source: 'credential' }
    return { token: undefined, source: 'none' }
  } catch {
    return { token: undefined, source: 'none' }
  }
}

/**
 * Validate one GitHub token by reading its rate-limit quota.
 *
 * @param token - candidate PAT.
 * @param options - fetch seam and timeout.
 * @returns a structured verdict; never includes the token.
 */
export async function validateGitHubToken(token, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const value = typeof token === 'string' ? token.trim() : ''
  if (value.length === 0) return { valid: false, reason: 'empty', message: 'Token 为空' }
  if (typeof fetchImpl !== 'function') return { valid: false, reason: 'network', message: '当前环境没有可用的 fetch' }

  let response
  try {
    response = await fetchImpl('https://api.github.com/rate_limit', {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'dsh-plugin-radar',
        authorization: `Bearer ${value}`,
      },
      signal: AbortSignal.timeout(Math.max(500, timeoutMs)),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { valid: false, reason: 'network', message: `网络请求失败：${message}` }
  }

  if (response.status === 401) {
    return { valid: false, status: 401, reason: 'invalid', message: 'Token 无效或已过期（HTTP 401）' }
  }
  if (!response.ok) {
    return { valid: false, status: response.status, reason: 'http', message: `GitHub 返回 HTTP ${response.status}` }
  }
  let body
  try {
    body = await response.json()
  } catch {
    return { valid: false, status: response.status, reason: 'invalid-body', message: '无法解析 GitHub 的响应' }
  }
  const search = body?.resources?.search ?? {}
  const core = body?.resources?.core ?? {}
  const number = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const searchLimit = number(search.limit)
  const searchRemaining = number(search.remaining)
  const coreLimit = number(core.limit)
  return {
    valid: true,
    status: response.status,
    searchLimit,
    searchRemaining,
    coreLimit,
    message: searchLimit === undefined ? 'Token 有效' : `Token 有效，搜索额度 ${searchLimit} 次/分`,
  }
}
