'use strict'

// PRIVATE offline evidence coverage for Baidu JSAPI 4.0. Never uploads HAR,
// authorizes an upstream path, signs a release, or enables the map runtime.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { auditCombinedHAR } = require('./baidu-jsapi4-cross-har-audit.cjs')

const CLIENTS = Object.freeze(['web', 'mobile-web', 'desktop'])
const SCENARIOS = Object.freeze(['load', 'pan', 'zoom'])
const REQUIRED_PAIRS = CLIENTS.length * SCENARIOS.length
const MAX_MANIFEST_BYTES = 32 * 1024
const MAX_BROWSER_BYTES = 20 * 1024 * 1024
const MAX_UPSTREAM_BYTES = 32 * 1024 * 1024
const BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.har$/

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
}

function exactKeys(obj, names) {
  return isPlainRecord(obj) && Object.keys(obj).length === names.length &&
    names.every(name => Object.hasOwn(obj, name))
}

function privateHAR(root, name, maxBytes) {
  // Only files next to the operator's private manifest, no relative paths,
  // symlinks or directory traversal. A file descriptor plus O_NOFOLLOW
  // closes the usual check-then-open symlink race on supported platforms.
  if (typeof name !== 'string' || !BASENAME.test(name) || name.includes('..')) {
    throw new Error('invalid capture name')
  }
  const filename = path.join(root, name)
  const before = fs.lstatSync(filename)
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maxBytes) {
    throw new Error('invalid capture file')
  }
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const after = fs.fstatSync(fd)
    if (!after.isFile() || after.size < 1 || after.size > maxBytes ||
        after.ino !== before.ino || after.dev !== before.dev) throw new Error('changed capture')
    const data = fs.readFileSync(fd)
    if (data.length < 1 || data.length > maxBytes) throw new Error('oversized capture')
    return { digest: createHash('sha256').update(data).digest('hex'), har: JSON.parse(data.toString('utf8')) }
  } finally {
    fs.closeSync(fd)
  }
}

function auditEvidenceMatrix(manifest, { root, origin, secret, auditPair = auditCombinedHAR } = {}) {
  const codes = new Set()
  let checked = 0
  let rejected = 0
  const cases = new Set()
  const filenames = new Set()
  const digests = new Set()
  let trustedOrigin
  try { trustedOrigin = new URL(origin) } catch { codes.add('INVALID_ORIGIN') }
  if (!trustedOrigin || trustedOrigin.protocol !== 'https:' || trustedOrigin.origin !== origin ||
      trustedOrigin.pathname !== '/' || trustedOrigin.username || trustedOrigin.password ||
      trustedOrigin.search || trustedOrigin.hash) codes.add('INVALID_ORIGIN')
  if (typeof root !== 'string' || !path.isAbsolute(root)) codes.add('INVALID_PRIVATE_ROOT')
  if (typeof secret !== 'string' || secret.length < 12 || secret.length > 512 || /[^\x21-\x7e]/.test(secret)) {
    codes.add('INVALID_PRIVATE_CANARY')
  }
  if (!exactKeys(manifest, ['version', 'captures']) || manifest.version !== 1 ||
      !Array.isArray(manifest.captures) || manifest.captures.length !== REQUIRED_PAIRS) {
    codes.add('INVALID_MATRIX_SHAPE')
  }
  const captures = Array.isArray(manifest?.captures) ? manifest.captures.slice(0, REQUIRED_PAIRS + 1) : []
  for (const entry of captures) {
    if (!exactKeys(entry, ['client', 'scenario', 'browser', 'upstream']) ||
        !CLIENTS.includes(entry.client) || !SCENARIOS.includes(entry.scenario)) {
      codes.add('INVALID_MATRIX_ENTRY')
      rejected++
      continue
    }
    const identity = entry.client + '/' + entry.scenario
    if (cases.has(identity)) codes.add('DUPLICATE_MATRIX_CASE')
    cases.add(identity)
    if (typeof entry.browser !== 'string' || typeof entry.upstream !== 'string' ||
        !BASENAME.test(entry.browser) || !BASENAME.test(entry.upstream) ||
        entry.browser.includes('..') || entry.upstream.includes('..')) {
      codes.add('INVALID_CAPTURE_NAME')
      rejected++
      continue
    }
    if (filenames.has(entry.browser) || filenames.has(entry.upstream) || entry.browser === entry.upstream) {
      codes.add('REUSED_CAPTURE_FILE')
      rejected++
      continue
    }
    filenames.add(entry.browser)
    filenames.add(entry.upstream)
    if (codes.has('INVALID_PRIVATE_ROOT') || codes.has('INVALID_ORIGIN') || codes.has('INVALID_PRIVATE_CANARY')) {
      rejected++
      continue
    }
    let browser, upstream
    try {
      browser = privateHAR(root, entry.browser, MAX_BROWSER_BYTES)
      upstream = privateHAR(root, entry.upstream, MAX_UPSTREAM_BYTES)
    } catch {
      codes.add('INVALID_PRIVATE_CAPTURE')
      rejected++
      continue
    }
    if (digests.has(browser.digest) || digests.has(upstream.digest) || browser.digest === upstream.digest) {
      codes.add('REUSED_CAPTURE_BYTES')
      rejected++
      continue
    }
    digests.add(browser.digest)
    digests.add(upstream.digest)
    checked++
    try {
      const result = auditPair(browser.har, upstream.har, {
        origin, secret, client: entry.client, scenario: entry.scenario,
      })
      if (!result || result.capture_valid !== true || result.release_authorized !== false ||
          result.client !== entry.client || result.scenario !== entry.scenario ||
          !Array.isArray(result.codes) || result.codes.length !== 0) {
        codes.add('PAIR_AUDIT_REJECTED')
        rejected++
      }
    } catch {
      codes.add('PAIR_AUDIT_ERROR')
      rejected++
    }
  }
  for (const client of CLIENTS) for (const scenario of SCENARIOS) {
    if (!cases.has(client + '/' + scenario)) codes.add('MISSING_MATRIX_CASE')
  }
  return Object.freeze({
    capture_valid: codes.size === 0 && checked === REQUIRED_PAIRS && rejected === 0,
    release_authorized: false,
    required_pairs: REQUIRED_PAIRS,
    inspected_pairs: checked,
    rejected_pairs: rejected,
    codes: [...codes].sort(),
  })
}

if (require.main === module) {
  const [manifestFile, origin] = process.argv.slice(2)
  let result
  try {
    if (!manifestFile || !origin || !process.env.XD_BAIDU_JSAPI_AK_CANARY ||
        path.extname(manifestFile) !== '.json') throw new Error('invalid invocation')
    const stat = fs.lstatSync(manifestFile)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_MANIFEST_BYTES) {
      throw new Error('invalid manifest')
    }
    const content = fs.readFileSync(manifestFile)
    if (content.length > MAX_MANIFEST_BYTES) throw new Error('oversized manifest')
    result = auditEvidenceMatrix(JSON.parse(content.toString('utf8')), {
      root: path.dirname(path.resolve(manifestFile)), origin,
      secret: process.env.XD_BAIDU_JSAPI_AK_CANARY,
    })
  } catch {
    result = { capture_valid: false, release_authorized: false, codes: ['INVALID_AUDIT_INPUT'] }
  }
  process.stdout.write(JSON.stringify(result) + '\n')
  if (!result.capture_valid) process.exitCode = 1
}

module.exports = { auditEvidenceMatrix }
