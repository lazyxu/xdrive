'use strict'

// Private, OFFLINE server-upstream capture audit. Never upload real HARs.
// Results contain only fixed codes, counts and non-authorizing path fingerprints.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_ENTRIES = 10000
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024
const UPSTREAM = 'https://api.map.baidu.com'
const CLIENTS = new Set(['web', 'mobile-web', 'desktop'])
const SCENARIOS = new Set(['load', 'pan', 'zoom'])
const MIMES = new Set([
  'application/javascript', 'text/javascript', 'application/x-javascript',
  'text/css', 'application/json', 'application/wasm', 'image/png',
  'image/jpeg', 'image/webp', 'image/svg+xml', 'font/woff2',
])

function headerValues(headers, name) {
  if (!Array.isArray(headers)) return []
  return headers.filter(h => typeof h?.name === 'string' && h.name.toLowerCase() === name)
    .map(h => typeof h.value === 'string' ? h.value : '')
}

function secretIn(value, secret) {
  if (typeof value !== 'string' || !secret) return false
  return [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]
    .some(pattern => pattern && value.includes(pattern))
}

function fingerprint(method, url) {
  const keys = [...url.searchParams.keys()].filter(key => key.toLowerCase() !== 'ak').sort()
  const canonical = [method, url.origin, url.pathname, ...keys].join('\x00')
  return createHash('sha256').update(canonical).digest('hex').slice(0, 20)
}

function capturedBody(content, codes) {
  if (typeof content?.text !== 'string') {
    codes.add('MISSING_RAW_RESPONSE_BYTES')
    return null
  }
  if (content.encoding === undefined || content.encoding === '') {
    return Buffer.from(content.text, 'utf8')
  }
  if (content.encoding !== 'base64' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.text)) {
    codes.add('INVALID_BODY_ENCODING')
    return null
  }
  return Buffer.from(content.text, 'base64')
}

function auditBaiduUpstreamHAR(har, { origin, client, scenario, secret } = {}) {
  const codes = new Set()
  const candidates = new Set()
  let trusted
  try { trusted = new URL(origin) } catch { codes.add('INVALID_TRUSTED_ORIGIN') }
  if (!trusted || trusted.protocol !== 'https:' || trusted.origin !== origin ||
      trusted.pathname !== '/' || trusted.search || trusted.hash ||
      trusted.username || trusted.password) codes.add('INVALID_TRUSTED_ORIGIN')
  if (!CLIENTS.has(client)) codes.add('INVALID_CLIENT')
  if (!SCENARIOS.has(scenario)) codes.add('INVALID_SCENARIO')
  if (typeof secret !== 'string' || secret.length < 12 || secret.length > 512 || /[^\x21-\x7e]/.test(secret)) {
    codes.add('INVALID_PRIVATE_AK_CANARY')
  }
  if (!Array.isArray(har?.log?.entries) || har.log.entries.length < 1 || har.log.entries.length > MAX_ENTRIES) {
    codes.add('INVALID_HAR')
  }
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries.slice(0, MAX_ENTRIES) : []
  let loader = 0
  let child = 0
  for (const entry of entries) {
    const request = entry?.request || {}
    const response = entry?.response || {}
    if (typeof request.url !== 'string' || request.url.length > 4096) {
      codes.add('INVALID_UPSTREAM_URL')
      continue
    }
    let url
    try { url = new URL(request.url) } catch { codes.add('INVALID_UPSTREAM_URL'); continue }
    if (url.origin !== UPSTREAM || url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) {
      codes.add('UNREVIEWED_UPSTREAM_ORIGIN')
    }
    // Reject ambiguous input before WHATWG URL normalization can remove dot-segments.
    const beforeQuery = request.url.split(/[?#]/, 1)[0]
    if (request.url !== url.href || /%|\\/.test(beforeQuery) ||
        /(?:^|\/)\.{1,2}(?:\/|$)/.test(beforeQuery) || url.pathname.startsWith('//')) {
      codes.add('NONCANONICAL_UPSTREAM_PATH')
    }
    if (request.method !== 'GET') codes.add('UNREVIEWED_UPSTREAM_METHOD')
    const keys = [...url.searchParams.keys()]
    if (keys.filter(key => key === 'ak').length !== 1 || url.searchParams.get('ak') !== secret ||
        keys.some(key => key.toLowerCase() === 'ak' && key !== 'ak')) {
      codes.add('INVALID_UPSTREAM_AK_INJECTION')
    }
    for (const name of ['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'x-forwarded-authorization']) {
      if (headerValues(request.headers, name).length) codes.add('FORWARDED_CLIENT_CREDENTIAL')
    }
    const proxies = headerValues(request.headers, 'bmap_proxy_url')
    if (proxies.length !== 1 || proxies[0] !== origin + '/_BMapService/') {
      codes.add('INVALID_PROXY_IDENTITY')
    }
    const isLoader = url.pathname === '/api'
    if (isLoader) {
      loader++
      if (keys.length !== 2 || url.searchParams.get('v') !== '4.0' ||
          keys.filter(key => key === 'v').length !== 1) codes.add('INVALID_LOADER_UPSTREAM_QUERY')
    } else {
      child++
      // Hashes assist private reviewer comparison; NEVER authorize a child path.
      candidates.add(fingerprint(request.method, url))
    }
    if (response.status !== 200 || response.redirectURL ||
        headerValues(response.headers, 'location').length) codes.add('UNSAFE_UPSTREAM_STATUS')
    if (headerValues(response.headers, 'set-cookie').length) codes.add('UPSTREAM_SET_COOKIE')
    const mimeHeaders = headerValues(response.headers, 'content-type')
    const mime = (mimeHeaders[0] || response.content?.mimeType || '').split(';', 1)[0].trim().toLowerCase()
    if (mimeHeaders.length > 1 || !MIMES.has(mime) ||
        (isLoader && !['application/javascript', 'text/javascript', 'application/x-javascript'].includes(mime))) {
      codes.add('UNREVIEWED_UPSTREAM_MIME')
    }
    const body = capturedBody(response.content, codes)
    if (body) {
      if (body.length === 0 || body.length > MAX_RESOURCE_BYTES) codes.add('UNBOUNDED_UPSTREAM_BYTES')
      if (secret && (body.includes(Buffer.from(secret)) ||
          secretIn(body.toString('utf8'), secret))) codes.add('UPSTREAM_RESPONSE_AK_LEAK')
    }
    const metadata = JSON.stringify([response.headers || [], response.redirectURL || '', response.content?.mimeType || ''])
    if (secretIn(metadata, secret)) codes.add('UPSTREAM_RESPONSE_AK_LEAK')
  }
  if ((scenario === 'load' && (loader !== 1 || child < 1)) ||
      ((scenario === 'pan' || scenario === 'zoom') && child < 1)) {
    codes.add('INCOMPLETE_UPSTREAM_SCENARIO')
  }
  return Object.freeze({
    capture_valid: codes.size === 0,
    release_authorized: false,
    client: CLIENTS.has(client) ? client : 'invalid',
    scenario: SCENARIOS.has(scenario) ? scenario : 'invalid',
    inspected_entries: entries.length,
    loader_entries: loader,
    child_entries: child,
    candidate_fingerprints: [...candidates].sort(),
    codes: [...codes].sort(),
  })
}

if (require.main === module) {
  const [file, origin, client, scenario] = process.argv.slice(2)
  let result
  try {
    if (!file || !origin || !client || !scenario ||
        !process.env.XD_BAIDU_JSAPI_AK_CANARY ||
        path.extname(file).toLowerCase() !== '.har' ||
        fs.statSync(file).size > MAX_FILE_BYTES) throw new Error('invalid')
    const har = JSON.parse(fs.readFileSync(file, 'utf8'))
    result = auditBaiduUpstreamHAR(har, { origin, client, scenario, secret: process.env.XD_BAIDU_JSAPI_AK_CANARY })
  } catch {
    result = { capture_valid: false, release_authorized: false, codes: ['INVALID_AUDIT_INPUT'] }
  }
  process.stdout.write(JSON.stringify(result) + '\n')
  if (!result.capture_valid) process.exitCode = 1
}

module.exports = { auditBaiduUpstreamHAR }
