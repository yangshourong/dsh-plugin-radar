/**
 * Shared helpers for dsh-plugin-radar: text hygiene, cancellation-aware timers,
 * deadline composition, install-command construction, and error descriptions.
 *
 * @module dsh-plugin-radar/util
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const GITHUB_URL = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)/i

/**
 * One-line, control-character-free model-visible text.
 *
 * @param value - arbitrary value.
 * @param maxLength - optional character cap (ellipsis included).
 * @returns cleaned text.
 */
export function cleanText(value, maxLength = Number.POSITIVE_INFINITY) {
  let text = String(value ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/gu, ' ').trim()
  if (Number.isFinite(maxLength) && text.length > maxLength) {
    text = `${text.slice(0, Math.max(0, maxLength - 1))}…`
  }
  return text
}

/**
 * Parse an `owner/repo` pair from a GitHub URL.
 *
 * @param url - candidate URL.
 * @returns the pair, or undefined when the URL is not a GitHub repository URL.
 */
export function parseRepoFromUrl(url) {
  const match = GITHUB_URL.exec(String(url ?? ''))
  if (match === null) return undefined
  return { owner: match[1], name: match[2].replace(/\.git$/iu, '') }
}

/**
 * Stable deduplication key for one plugin.
 *
 * @param owner - repository owner / organization.
 * @param name - repository / plugin name.
 * @returns lowercased `owner/name`, or whichever part exists.
 */
export function canonicalPluginId(owner, name) {
  const repoOwner = cleanText(owner, 160).toLowerCase()
  const repoName = cleanText(name, 160).toLowerCase()
  if (repoOwner.length > 0 && repoName.length > 0) return `${repoOwner}/${repoName}`
  return repoName || repoOwner
}

/**
 * Build the `dsh plugin add` command for one record, targeting the live profile
 * instead of hard-coding `web`.
 *
 * @param record - plugin record carrying owner/name or a curated install string.
 * @param profile - profile name; empty string omits the flag.
 * @returns the install command, or an empty string when it cannot be built.
 */
export function resolveInstallCommand(record, profile) {
  const owner = cleanText(record?.owner, 160)
  const name = cleanText(record?.name, 160)
  const profileName = cleanText(profile, 160)
  const profileFlag = profileName.length > 0 ? `--profile ${profileName} ` : ''
  if (owner.length > 0 && name.length > 0) {
    return `dsh plugin ${profileFlag}add github:${owner}/${name}`
  }
  return cleanText(record?.install, 400)
}

/** Resolve the DSH home directory exactly like the host does. */
export function resolveDshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (fromEnv.length > 0) return resolve(expandHome(fromEnv))
  return join(homedir(), '.dsh')
}

/**
 * Detect the profile that has this package linked in its `node_modules`.
 *
 * The Host process does not necessarily export `DSH_PROFILE` (that variable is
 * injected into shell calls), so generated install commands would otherwise fall
 * back to an unqualified `dsh plugin add`. Scanning the profile directories for
 * the package junction finds the live profile reliably in that case.
 *
 * @param dshHome - DSH home directory containing `profiles/`.
 * @param packageName - this package's name.
 * @returns the profile directory name, or an empty string when not detectable.
 */
export function detectProfileName(dshHome, packageName) {
  if (typeof dshHome !== 'string' || dshHome.length === 0) return ''
  if (typeof packageName !== 'string' || packageName.length === 0) return ''
  try {
    const profilesDir = join(dshHome, 'profiles')
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (existsSync(join(profilesDir, entry.name, 'node_modules', packageName))) return entry.name
    }
  } catch {
    // Unreadable profiles directory: nothing to detect.
  }
  return ''
}

function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

function abortReason(signal) {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error(typeof reason === 'string' && reason.length > 0 ? reason : 'operation aborted')
  error.name = 'AbortError'
  return error
}

/**
 * Cancellable sleep.
 *
 * @param ms - delay in milliseconds.
 * @param signal - optional cancellation signal.
 * @returns a promise that resolves after the delay.
 */
export function sleep(ms, signal) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted === true) {
      reject(abortReason(signal))
      return
    }
    let timer
    const onAbort = () => {
      cleanup()
      reject(abortReason(signal))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    timer = setTimeout(() => {
      cleanup()
      resolvePromise()
    }, Math.max(0, ms))
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Describe a failure through the `cause` chain, naming transport detail that
 * Node hides one level down.
 *
 * @param error - thrown value.
 * @returns a single-line description, never empty.
 */
export function describeFailure(error) {
  const parts = []
  let current = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code = typeof current.code === 'string' && current.code.length > 0 ? current.code : ''
    const label = code.length > 0 && !current.message.includes(code) ? `${current.message} (${code})` : current.message
    if (label.length > 0 && !parts.includes(label)) parts.push(label)
    current = current.cause
  }
  return cleanText(parts.length > 0 ? parts.join(' ← ') : String(error), 400)
}

/**
 * Compose a per-call deadline signal from a caller signal and a time budget.
 *
 * @param budgetMs - total budget in milliseconds.
 * @param parentSignal - caller-owned cancellation.
 * @returns the deadline signal plus `timedOut` and `dispose` helpers.
 */
export function createDeadline(budgetMs, parentSignal) {
  const controller = new AbortController()
  let timedOut = false
  const budget = Number.isFinite(budgetMs) ? Math.max(1, Math.trunc(budgetMs)) : 12000
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`time budget ${budget}ms exhausted`))
  }, budget)
  const onParentAbort = () => controller.abort(abortReason(parentSignal))
  if (parentSignal?.aborted === true) onParentAbort()
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    },
  }
}

/**
 * Combine optional abort signals into one.
 *
 * @param signals - candidate signals; undefined entries are ignored.
 * @returns the combined signal, or undefined when none was supplied.
 */
export function combineSignals(...signals) {
  const list = signals.filter((signal) => signal !== undefined && signal !== null)
  if (list.length === 0) return undefined
  if (list.length === 1) return list[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list)
  const controller = new AbortController()
  for (const signal of list) {
    if (signal.aborted === true) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/**
 * Clamp a numeric argument.
 *
 * @param value - candidate value.
 * @param min - lower bound.
 * @param max - upper bound.
 * @param fallback - value used when the candidate is not finite.
 * @returns the clamped integer.
 */
export function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}
