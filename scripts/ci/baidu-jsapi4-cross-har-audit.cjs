'use strict'

// OFFLINE evidence reconciliation only: never accepts a map resource or grants
// proxy runtime activation. Raw upstream HARs can contain secret Browser AKs;
// neither full request URLs nor values are ever included in diagnostics.
const fs = require('node:fs')
const path = require('node:path')

const PREFIX = '/_BMapService/'
const SESSION = '/api/v1/media/places/baidu-jsapi/session'
const BAIDU = 'https://api.map.baidu.com'
const MAX_HAR_BYTES = 32 * 1024 * 1024
const MAX_ENTRIES = 10000
const CLIENTS = new Set(['web', 'mobile-web', 'desktop'])
const SCENARIOS = new Set(['load', 'pan', 'zoom'])

function countedRoutes(har, kind, origin, secret, codes) {
  const routes = new Map()
  let count = 0
  const entries = har?.log?.entries
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES) {
    codes.add('INVALID_CAPTURE')
    return { routes, count }
  }
  for (const entry of entries) {
    const request = entry?.request
    if (!request || typeof request.url !== 'string' || request.url.length > 4096) {
      codes.add('INVALID_REQUEST'); continue
    }
    let url
    try { url = new URL(request.url) } catch { codes.add('INVALID_REQUEST'); continue }
    if (kind === 'browser' && url.pathname === SESSION && url.origin === origin) {
      if (request.method !== 'POST' || url.search || url.hash || url.username || url.password) {
        codes.add('INVALID_SESSION_BOOTSTRAP')
      }
      continue
    }
    if (request.method !== 'GET' || url.hash || url.username || url.password) {
      codes.add('INVALID_REQUEST'); continue
    }
    if (kind === 'browser' && (url.origin !== origin || !url.pathname.startsWith(PREFIX))) {
      codes.add('UNEXPECTED_BROWSER_REQUEST'); continue
    }
    if (kind === 'upstream' && url.origin !== BAIDU) {
      codes.add('UNEXPECTED_UPSTREAM_REQUEST'); continue
    }
    // Independent HAR auditors enforce exact canonical paths, body secrecy,
    // HTTPS and cookies. Here we reconcile actual query *values* in memory.
    const route = kind === 'browser' ? url.pathname.slice(PREFIX.length - 1) : url.pathname
    if (!route.startsWith('/') || route.startsWith('//')) {
      codes.add('INVALID_REQUEST'); continue
    }
    const params = [...url.searchParams.entries()]
    if (kind === 'upstream') {
      if (params.filter(([k, v]) => k === 'ak' && v === secret).length !== 1 ||
          params.filter(([k]) => k.toLowerCase() === 'ak').length !== 1) {
        codes.add('INVALID_SERVER_AK'); continue
      }
    } else if (params.some(([k]) => k.toLowerCase() === 'ak')) {
      codes.add('BROWSER_AK_PARAMETER'); continue
    }
    const sorted = params.filter(([k]) => k !== 'ak')
      .sort((a, b) => a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]))
    const key = JSON.stringify(['GET', route, sorted]) // Never serialize in output.
    routes.set(key, (routes.get(key) || 0) + 1)
    count++
  }
  return { routes, count }
}

function reconcileBaiduHAR(browserHar, upstreamHar, { origin, secret, client, scenario } = {}) {
  const codes = new Set()
  let parsed
  try { parsed = new URL(origin) } catch { codes.add('INVALID_ORIGIN') }
  if (!parsed || parsed.origin !== origin || parsed.protocol !== 'https:' ||
      parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    codes.add('INVALID_ORIGIN')
  }
  if (!CLIENTS.has(client)) codes.add('INVALID_CLIENT')
  if (!SCENARIOS.has(scenario)) codes.add('INVALID_SCENARIO')
  if (typeof secret !== 'string' || secret.length < 12 || secret.length > 512 || /[^\x21-\x7e]/.test(secret)) {
    codes.add('INVALID_PRIVATE_CANARY')
  }
  const browser = countedRoutes(browserHar, 'browser', origin, secret, codes)
  const upstream = countedRoutes(upstreamHar, 'upstream', origin, secret, codes)
  if (browser.count === 0 || upstream.count === 0) codes.add('INCOMPLETE_PAIR')
  if (browser.count !== upstream.count) codes.add('REQUEST_COUNT_MISMATCH')
  for (const [key, number] of browser.routes) {
    if (number !== upstream.routes.get(key)) codes.add('UPSTREAM_REQUEST_UNMATCHED')
  }
  for (const [key, number] of upstream.routes) {
    if (number !== browser.routes.get(key)) codes.add('BROWSER_REQUEST_UNMATCHED')
  }
  return Object.freeze({
    matched: codes.size === 0,
    release_authorized: false,
    client: CLIENTS.has(client) ? client : 'invalid',
    scenario: SCENARIOS.has(scenario) ? scenario : 'invalid',
    browser_resources: browser.count,
    upstream_resources: upstream.count,
    codes: [...codes].sort(),
  })
}

function auditCombinedHAR(browserHar, upstreamHar, options = {}) {
  // The separate auditors enforce browser no-store, session, raw AK leakage,
  // fixed upstream origin, MIME and response-body requirements. Neither alone
  // proves capture completeness, legal entitlement or runtime authorization.
  const { auditJSAPIHar } = require('./baidu-jsapi4-browser-har-audit.cjs')
  const { auditBaiduUpstreamHAR } = require('./baidu-jsapi4-upstream-har-audit.cjs')
  const browser = auditJSAPIHar(browserHar, options)
  const upstream = auditBaiduUpstreamHAR(upstreamHar, options)
  const paired = reconcileBaiduHAR(browserHar, upstreamHar, options)
  const codes = new Set(paired.codes)
  if (!browser.ok) codes.add('BROWSER_HAR_AUDIT_FAILED')
  if (!upstream.capture_valid) codes.add('UPSTREAM_HAR_AUDIT_FAILED')
  return Object.freeze({
    ...paired,
    capture_valid: browser.ok && upstream.capture_valid && paired.matched,
    release_authorized: false,
    codes: [...codes].sort(),
  })
}

if (require.main === module) {
  const [browserFile, upstreamFile, origin, client, scenario] = process.argv.slice(2)
  let result
  try {
    if (!browserFile || !upstreamFile || !origin || !client || !scenario ||
        !process.env.XD_BAIDU_JSAPI_AK_CANARY ||
        browserFile === upstreamFile ||
        path.extname(browserFile).toLowerCase() !== '.har' ||
        path.extname(upstreamFile).toLowerCase() !== '.har' ||
        fs.statSync(browserFile).size > MAX_HAR_BYTES ||
        fs.statSync(upstreamFile).size > MAX_HAR_BYTES) throw new Error('invalid')
    const browser = JSON.parse(fs.readFileSync(browserFile, 'utf8'))
    const upstream = JSON.parse(fs.readFileSync(upstreamFile, 'utf8'))
    result = auditCombinedHAR(browser, upstream, {
      origin, client, scenario, secret: process.env.XD_BAIDU_JSAPI_AK_CANARY,
    })
  } catch {
    result = { capture_valid: false, release_authorized: false, codes: ['INVALID_AUDIT_INPUT'] }
  }
  process.stdout.write(JSON.stringify(result) + '\n')
  if (!result.capture_valid) process.exitCode = 1
}

module.exports = { reconcileBaiduHAR, auditCombinedHAR }
