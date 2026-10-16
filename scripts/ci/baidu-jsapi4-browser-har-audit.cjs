'use strict'

// Offline, fail-closed browser HAR admission audit for the not-yet-enabled
// Baidu JSAPI 4.0 proxy. Never upload real HARs: they contain private network
// metadata. Output consists exclusively of fixed codes and aggregate counts.
const fs = require('node:fs')
const path = require('node:path')

const MAX_HAR_BYTES = 20 * 1024 * 1024
const MAX_ENTRIES = 10000
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const SESSION_NAME = 'XD_BMAP_SESSION'
const ALLOWED_CLIENTS = new Set(['web', 'mobile-web', 'desktop'])
const TEXTUAL = /(?:javascript|\bjson\b|text\/|\bcss\b|\bxml\b|\bhtml\b)/i

function headerValue(headers, name) {
  if (!Array.isArray(headers)) return ''
  return headers.filter(h => String(h?.name || '').toLowerCase() === name)
    .map(h => String(h?.value || '')).join('\n')
}

function containsSecret(value, secret) {
  if (typeof value !== 'string' || typeof secret !== 'string' || !secret) return false
  const canaries = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]
  return canaries.some(x => x && value.includes(x))
}

function hasAKParameter(value) {
  if (typeof value !== 'string') return false
  return /(?:[?&]|%3[fF]|%26)(?:ak|browser_ak)(?:=|%3[dD])/i.test(value) ||
    /\b(?:ak|browser_ak)\s*[:=]\s*['"][A-Za-z0-9]/i.test(value)
}

/** HAR body encoding is untrusted evidence. Node silently tolerates junk,
 * noncanonical Base64 and whitespace: reject these rather than certify them. */
function decodedCapturedText(content, issues) {
  const raw = content?.text
  if (typeof raw !== 'string') return null
  const encoding = content.encoding
  if (encoding === undefined || encoding === '') {
    if (Buffer.byteLength(raw, 'utf8') > MAX_TEXT_BYTES) {
      issues.add('OVERSIZED_TEXT_BODY')
      return null
    }
    return raw
  }
  if (encoding !== 'base64') {
    issues.add('INVALID_BODY_ENCODING')
    return null
  }
  if (raw.length > Math.ceil(MAX_TEXT_BYTES / 3) * 4) {
    issues.add('OVERSIZED_TEXT_BODY')
    return null
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) {
    issues.add('INVALID_BODY_ENCODING')
    return null
  }
  const bytes = Buffer.from(raw, 'base64')
  if (bytes.length > MAX_TEXT_BYTES) {
    issues.add('OVERSIZED_TEXT_BODY')
    return null
  }
  if (bytes.toString('base64') !== raw) {
    issues.add('INVALID_BODY_ENCODING')
    return null
  }
  return bytes.toString('utf8')
}

function auditJSAPIHar(har, { origin, client, secret, proxyPrefix = '/_BMapService/' } = {}) {
  const issues = new Set()
  let base
  try { base = new URL(origin) } catch { issues.add('INVALID_ORIGIN') }
  if (!base || base.protocol !== 'https:' || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) issues.add('INVALID_ORIGIN')
  if (!ALLOWED_CLIENTS.has(client)) issues.add('INVALID_CLIENT')
  if (typeof secret !== 'string' || secret.length < 8) issues.add('MISSING_PRIVATE_CANARY')
  if (proxyPrefix !== '/_BMapService/') issues.add('INVALID_PROXY_PREFIX')
  if (!har || !har.log || !Array.isArray(har.log.entries) ||
      har.log.entries.length === 0 || har.log.entries.length > MAX_ENTRIES) {
    issues.add('INVALID_HAR')
  }
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries.slice(0, MAX_ENTRIES) : []
  let mapCount = 0
  let loaderCount = 0
  let childCount = 0
  let sessionIssued = false
  let sessionSent = false
  for (const entry of entries) {
    const request = entry?.request || {}
    const response = entry?.response || {}
    let u
    try { u = new URL(request.url) } catch { issues.add('INVALID_REQUEST_URL'); continue }
    if (!base || u.origin !== base.origin || u.protocol !== 'https:' || u.username || u.password) {
      issues.add('EXTERNAL_BROWSER_REQUEST')
    }
    const isMap = u.pathname.startsWith(proxyPrefix)
    const isSession = u.pathname === '/api/v1/media/places/baidu-jsapi/session'
    const requestHeaderText = JSON.stringify(request.headers || [])
    const responseHeaderText = JSON.stringify(response.headers || [])
    const cookieText = JSON.stringify([request.cookies || [], response.cookies || []])
    const postText = typeof request.postData?.text === 'string' ? request.postData.text : ''
    const metadata = [request.url, requestHeaderText, responseHeaderText, cookieText, postText,
      response.redirectURL || '']
    if (metadata.some(text => containsSecret(text, secret))) issues.add('BROWSER_SECRET_LEAK')
    if (metadata.some(hasAKParameter) || u.searchParams.has('ak') || u.searchParams.has('browser_ak')) {
      issues.add('BROWSER_AK_PARAMETER')
    }
    if (response.redirectURL || response.status >= 300 && response.status < 400) {
      issues.add('BROWSER_REDIRECT')
    }
    if (entry?._fromServiceWorker || entry?._fromCache || entry?.cache?._fromServiceWorker) {
      issues.add('BROWSER_CACHED_RESOURCE')
    }
    const mime = response.content?.mimeType || headerValue(response.headers, 'content-type')
    const body = response.content?.text
    if (typeof body === 'string') {
      // Scan the HAR's original field AND canonically decoded bytes: a false
      // "base64" label cannot conceal a literal Browser AK in the source.
      if (containsSecret(body, secret)) issues.add('BROWSER_SECRET_LEAK')
      if (hasAKParameter(body)) issues.add('BROWSER_AK_PARAMETER')
      const decoded = decodedCapturedText(response.content, issues)
      if (decoded !== null) {
        if (containsSecret(decoded, secret)) issues.add('BROWSER_SECRET_LEAK')
        if (hasAKParameter(decoded)) issues.add('BROWSER_AK_PARAMETER')
        if ((isMap || isSession) && TEXTUAL.test(mime) && decoded.length === 0) {
          issues.add('UNCAPTURED_TEXT_BODY')
        }
      }
    } else if ((isMap || isSession) && TEXTUAL.test(mime)) {
      issues.add('UNCAPTURED_TEXT_BODY')
    }
    if (!isMap && !isSession) continue
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      issues.add('NON_SUCCESS_MAP_RESOURCE')
    }
    if (!/\bno-store\b/i.test(headerValue(response.headers, 'cache-control'))) {
      issues.add('MISSING_NO_STORE')
    }
    if (isSession) {
      const sets = headerValue(response.headers, 'set-cookie').split('\n')
      const validSession = sets.some(cookie => {
        if (!cookie.startsWith(SESSION_NAME + '=') || !/;\s*HttpOnly\b/i.test(cookie) ||
            !/;\s*Secure\b/i.test(cookie) || !/;\s*SameSite=(?:Strict|Lax)\b/i.test(cookie) ||
            !/;\s*Path=\/_BMapService\/?(?:;|$)/i.test(cookie)) return false
        const match = cookie.match(/;\s*Max-Age=(\d+)(?:;|$)/i)
        return Boolean(match && Number(match[1]) > 0 && Number(match[1]) <= 300)
      })
      if (validSession) sessionIssued = true
      else issues.add('INVALID_MAP_SESSION_COOKIE')
      continue
    }
    mapCount++
    if (request.method !== 'GET') issues.add('INVALID_PROXY_METHOD')
    if (headerValue(request.headers, 'authorization')) issues.add('PROXY_BEARER_EXPOSED')
    const hasMapCookie = (request.cookies || []).some(c => c?.name === SESSION_NAME) ||
      new RegExp('(?:^|[;\\s])' + SESSION_NAME + '=').test(headerValue(request.headers, 'cookie'))
    if (!hasMapCookie) issues.add('MISSING_MAP_SESSION_COOKIE')
    else sessionSent = true
    if (!/\bnosniff\b/i.test(headerValue(response.headers, 'x-content-type-options'))) {
      issues.add('MISSING_NOSNIFF')
    }
    if (headerValue(response.headers, 'referrer-policy') !== 'no-referrer') {
      issues.add('MISSING_NO_REFERRER')
    }
    if (u.pathname === proxyPrefix + 'api') {
      if (u.searchParams.get('v') !== '4.0' || [...u.searchParams.keys()].some(k => k !== 'v')) {
        issues.add('INVALID_LOADER_QUERY')
      }
      loaderCount++
    } else {
      childCount++
    }
  }
  if (!sessionIssued || !sessionSent) issues.add('INCOMPLETE_SESSION_EVIDENCE')
  if (loaderCount !== 1 || mapCount < 2 || childCount < 1) issues.add('INCOMPLETE_JSAPI_RESOURCE_EVIDENCE')
  return Object.freeze({
    ok: issues.size === 0,
    client: ALLOWED_CLIENTS.has(client) ? client : 'invalid',
    inspected_entries: entries.length,
    proxied_entries: mapCount,
    loader_entries: loaderCount,
    child_entries: childCount,
    codes: [...issues].sort(),
  })
}

if (require.main === module) {
  const [filename, origin, client] = process.argv.slice(2)
  let result
  try {
    if (!filename || !origin || !client || !process.env.XD_BAIDU_JSAPI_AK_CANARY ||
        fs.statSync(filename).size > MAX_HAR_BYTES ||
        path.extname(filename).toLowerCase() !== '.har') throw new Error('input')
    const har = JSON.parse(fs.readFileSync(filename, 'utf8'))
    result = auditJSAPIHar(har, { origin, client, secret: process.env.XD_BAIDU_JSAPI_AK_CANARY })
  } catch {
    result = { ok: false, codes: ['INVALID_AUDIT_INPUT'] }
  }
  process.stdout.write(JSON.stringify(result) + '\n')
  if (!result.ok) process.exitCode = 1
}

module.exports = { auditJSAPIHar }
