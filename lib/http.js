/**
 * Minimal HTTP helpers for the plugin's loopback status/validation route.
 *
 * The route only serves the local DSH Web page: callers from another host are
 * rejected, responses are JSON with `no-store`, and request bodies are size
 * capped. Nothing here exposes configuration secrets.
 *
 * @module dsh-plugin-radar/http
 */

/**
 * Write one JSON response.
 *
 * @param res - Node HTTP response.
 * @param statusCode - HTTP status code.
 * @param payload - JSON-serializable payload.
 */
export function respond(res, statusCode, payload) {
  try {
    res.statusCode = statusCode
    if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
    }
    res.end(JSON.stringify(payload))
  } catch {
    // The socket may already be closed; nothing useful to do.
  }
}

/**
 * Whether the request comes from this machine (the DSH Web page).
 *
 * @param req - Node HTTP request.
 * @returns true for a loopback caller.
 */
export function isTrustedCaller(req) {
  const remote = String(req?.socket?.remoteAddress ?? req?.connection?.remoteAddress ?? '').toLowerCase()
  if (remote === '::1' || remote === '127.0.0.1' || remote.startsWith('127.') || remote.startsWith('::ffff:127.')) return true
  const host = String(req?.headers?.host ?? '').split(':')[0].toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/**
 * Read and parse a small JSON request body.
 *
 * @param req - Node HTTP request.
 * @param maxBytes - maximum accepted body size.
 * @returns the parsed JSON value.
 * @throws when the body is too large, not JSON, or the stream fails.
 */
export function readJsonBody(req, maxBytes = 8192) {
  return new Promise((resolvePromise, reject) => {
    if (typeof req?.on !== 'function') {
      reject(new Error('request stream unavailable'))
      return
    }
    let received = 0
    const chunks = []
    req.on('data', (chunk) => {
      received += chunk.length
      if (received > maxBytes) {
        reject(new Error('request body too large'))
        try {
          req.destroy()
        } catch {
          // Already torn down.
        }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolvePromise(text.trim().length === 0 ? {} : JSON.parse(text))
      } catch {
        reject(new Error('invalid json body'))
      }
    })
    req.on('error', (error) => reject(error))
  })
}
