/**
 * Plugin Config schema and option resolution for dsh-plugin-radar.
 *
 * `defineConfig(z)` receives the Schemastery namespace from the entry module, so
 * this file stays free of the dependency and can be unit-tested without it.
 * Every field is marked `volatile`, which is how DSH renders plugin settings
 * forms; `resolveOptions` unwraps the resulting boxes and applies defaults.
 *
 * @module dsh-plugin-radar/config
 */

import { cleanText, detectProfileName, resolveDshHome } from './util.js'

/** Built-in defaults; also the fallback when a row supplies no config. */
export const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  defaultLang: 'en',
  maxResults: 8,
  liveSearch: true,
  curatedFallback: true,
  requestTimeoutMs: 8000,
  totalBudgetMs: 12000,
  cacheTtlMinutes: 30,
  maxDescriptionChars: 240,
  githubToken: '',
  tokenCredential: 'GITHUB_TOKEN',
  installProfile: '',
  registryUrls: Object.freeze(['https://awesome-dsh-plugin.com/plugins.json']),
  mirrorUrls: Object.freeze([
    'https://cdn.jsdelivr.net/npm/dsh-find-plugin@0.4.0/data/registry-snapshot.json',
  ]),
  resultStamp: 'via dsh-plugin-radar-ysr',
  usageLog: true,
  usageLogFile: '',
})

/**
 * Build the Schemastery Config schema for the Loader.
 *
 * @param z - the `@deepseek-ai/schemastery` default export.
 * @returns the plugin Config schema.
 */
export function defineConfig(z) {
  return z.object({
    enabled: z.boolean().default(true).volatile().description('启用插件发现工具'),
    defaultLang: z.string().default('en').volatile().description("默认描述语言：'en' 或 'zh'"),
    maxResults: z.natural().min(1).max(50).default(8).volatile().description('单次返回结果数上限（1-50）'),
    liveSearch: z.boolean().default(true).volatile().description('启用 GitHub 实时搜索（dsh-plugin 话题，按 star 排序）'),
    curatedFallback: z.boolean().default(true).volatile().description('启用精选列表与内置离线索引回退'),
    requestTimeoutMs: z.natural().min(1000).max(30000).default(8000).volatile().description('单个网络请求超时（毫秒）'),
    totalBudgetMs: z.natural().min(2000).max(60000).default(12000).volatile().description('单次工具调用的总时间预算（毫秒）'),
    cacheTtlMinutes: z.natural().min(0).max(1440).default(30).volatile().description('精选列表缓存有效期（分钟）'),
    maxDescriptionChars: z.natural().min(40).max(600).default(240).volatile().description('结果描述的最大字符数'),
    githubToken: z.string().default('').volatile().role('secret').description('可选：GitHub Personal Access Token（公开仓库只读即可）；保存后不会回显，留空表示保持原值'),
    tokenCredential: z.string().default('GITHUB_TOKEN').volatile().description('可选的 GitHub token 凭据名（提升搜索配额；留空表示不使用）'),
    installProfile: z.string().default('').volatile().description('安装命令中的 profile 名；留空则自动读取 DSH_PROFILE'),
    registryUrls: z.array(z.string()).default(['https://awesome-dsh-plugin.com/plugins.json']).volatile().description('精选列表地址，按顺序尝试'),
    mirrorUrls: z.array(z.string()).default(['https://cdn.jsdelivr.net/npm/dsh-find-plugin@0.4.0/data/registry-snapshot.json']).volatile().description('精选列表镜像地址，主地址不可用时尝试'),
    resultStamp: z.string().default('via dsh-plugin-radar-ysr').volatile().description('结果文本首行的来源标记，由插件写入；留空表示不加'),
    usageLog: z.boolean().default(true).volatile().description('每次调用追加一条使用记录（时间、会话 id、查询词、结果数、来源说明）'),
    usageLogFile: z.string().default('').volatile().description('使用记录文件路径；留空则用 ~/.dsh/cache/dsh-plugin-radar-ysr/usage.log'),
  })
}

/**
 * Normalize a description language tag.
 *
 * @param value - candidate tag.
 * @param fallback - value used when the tag is unsupported.
 * @returns `'en'` or `'zh'`.
 */
export function normalizeLang(value, fallback = 'en') {
  const tag = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (tag === 'zh' || tag === 'zh-cn' || tag === 'zh-hans') return 'zh'
  if (tag === 'en' || tag === 'en-us') return 'en'
  return fallback === 'zh' ? 'zh' : 'en'
}

function unwrap(value) {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(unwrap)
  if (typeof value === 'object') {
    if (typeof value.get === 'function') return unwrap(value.get())
    const plain = {}
    for (const [key, item] of Object.entries(value)) plain[key] = unwrap(item)
    return plain
  }
  return value
}

function coerce(key, value, fallback) {
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value)) return [...fallback]
    return value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
  }
  if (typeof fallback === 'boolean') return value === true
  if (typeof fallback === 'number') {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }
  if (typeof fallback === 'string') return typeof value === 'string' ? value : String(value ?? fallback)
  return value
}

/**
 * Resolve a Loader-validated config (possibly volatile-boxed) into plain options.
 *
 * @param config - plugin config value.
 * @returns a plain options object with every default applied.
 */
export function resolveOptions(config) {
  const raw = unwrap(config && typeof config === 'object' ? config : {})
  const options = { ...DEFAULT_OPTIONS }
  for (const [key, fallback] of Object.entries(DEFAULT_OPTIONS)) {
    if (key in raw && raw[key] !== undefined && raw[key] !== null) options[key] = coerce(key, raw[key], fallback)
  }
  options.defaultLang = normalizeLang(options.defaultLang)
  options.maxResults = Math.max(1, Math.min(50, Math.trunc(options.maxResults) || DEFAULT_OPTIONS.maxResults))
  options.totalBudgetMs = Math.max(1000, Math.trunc(options.totalBudgetMs) || DEFAULT_OPTIONS.totalBudgetMs)
  options.requestTimeoutMs = Math.max(500, Math.trunc(options.requestTimeoutMs) || DEFAULT_OPTIONS.requestTimeoutMs)
  options.maxDescriptionChars = Math.max(40, Math.trunc(options.maxDescriptionChars) || DEFAULT_OPTIONS.maxDescriptionChars)
  options.cacheTtlMinutes = Math.max(0, Math.trunc(options.cacheTtlMinutes) || 0)
  options.resultStamp = cleanText(options.resultStamp)
  options.usageLogFile = String(options.usageLogFile ?? '').trim()
  return options
}

/**
 * Resolve the profile name used in generated install commands.
 *
 * Order: explicit Config → `DSH_PROFILE` (shell-call environment) → the profile
 * whose `node_modules` links this package (the Host process often lacks the
 * environment variable).
 *
 * @param options - resolved plugin options.
 * @param seams - test seams for the DSH home directory and package name.
 * @returns the profile name, or an empty string to omit the flag.
 */
export function resolveInstallProfile(options, { dshHome = resolveDshHome(), packageName = '@yangshourong/dsh-plugin-radar-ysr' } = {}) {
  const configured = typeof options?.installProfile === 'string' ? options.installProfile.trim() : ''
  if (configured.length > 0) return configured
  const fromEnv = typeof process.env.DSH_PROFILE === 'string' ? process.env.DSH_PROFILE.trim() : ''
  if (fromEnv.length > 0) return fromEnv
  return detectProfileName(dshHome, packageName)
}
