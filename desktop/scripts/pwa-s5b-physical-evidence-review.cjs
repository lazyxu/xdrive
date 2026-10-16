#!/usr/bin/env node
'use strict'
// S5-A2b1: OFFLINE, fail-closed seven-platform evidence inventory.
// Self-reported browser data + file hashes NEVER constitute OS installation
// attestation, an independent physical-device review, or a release permit.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { constants } = require('node:fs')
const { createHash } = require('node:crypto')

const PLATFORMS = Object.freeze([
  'desktop_chrome_browser', 'desktop_chrome_installed',
  'desktop_edge_installed', 'ios27_safari', 'ios27_home_screen',
  'android_chrome', 'android_installed',
])
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const PLATFORM_SET = new Set(PLATFORMS)
const SCRIPT_SCHEMA = 'xdrive-pwa-s5a2b1-evidence-review-v1'
const INPUT_SCHEMA = 'xdrive-pwa-s5a2b1-platform-submissions-v1'

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key)) &&
    keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}
function validHash(value) { return typeof value === 'string' && SHA256.test(value) }
function validCommit(value) { return typeof value === 'string' && COMMIT.test(value) }
function parseArgs(args) {
  const options = { input: '', httpsReport: '', artifactsDir: '', output: '' }
  for (let i = 0; i < args.length; i++) {
    const key = {
      '--input': 'input', '--https-report': 'httpsReport',
      '--artifacts-dir': 'artifactsDir', '--output': 'output',
    }[args[i]]
    if (!key || !args[i + 1] || options[key]) throw Error('INVALID_ARGUMENTS')
    options[key] = args[++i]
  }
  if (!options.input) throw Error('MISSING_INPUT')
  return options
}
function loadJSON(file, maximum = 131072) {
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximum) {
      throw Error('INVALID_EVIDENCE_FILE')
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw Error('INVALID_EVIDENCE_FILE')
  }
}
function validateEnvelope(input) {
  if (!exactKeys(input, ['schema', 'build_commit', 'origin_sha256', 'cases']) ||
      input.schema !== INPUT_SCHEMA ||
      (input.build_commit !== null && !validCommit(input.build_commit)) ||
      (input.origin_sha256 !== null && !validHash(input.origin_sha256)) ||
      !Array.isArray(input.cases) || input.cases.length !== PLATFORMS.length) {
    throw Error('INVALID_EVIDENCE_SCHEMA')
  }
  const seen = new Set()
  for (const entry of input.cases) {
    if (!exactKeys(entry, ['platform_id', 'status', 'browser_observation', 'manual_checks', 'proof']) ||
        !PLATFORM_SET.has(entry.platform_id) || seen.has(entry.platform_id) ||
        !['NOT_RUN', 'SUBMITTED'].includes(entry.status)) {
      throw Error('INVALID_PLATFORM_ENTRY')
    }
    seen.add(entry.platform_id)
    if (entry.status === 'NOT_RUN' &&
        (entry.browser_observation !== null || entry.manual_checks !== null || entry.proof !== null)) {
      throw Error('NOT_RUN_CANNOT_CLAIM_EVIDENCE')
    }
    if (entry.status === 'SUBMITTED' && (!validCommit(input.build_commit) || !validHash(input.origin_sha256))) {
      throw Error('SUBMITTED_REQUIRES_IDENTITY')
    }
  }
  if (seen.size !== PLATFORMS.length) throw Error('INCOMPLETE_PLATFORM_MATRIX')
}
function originReportStatus(raw, expected) {
  if (raw === null) return 'NOT_RUN'
  if (!exactKeys(raw, ['schema', 'observed_at', 'origin_sha256', 'evidence_environment',
    'actual_https_preflight', 'release_gate', 'physical_platforms', 'checks']) ||
    raw.schema !== 'xdrive-pwa-s5a-live-origin-v1' || !validHash(raw.origin_sha256) ||
    raw.origin_sha256 !== expected || !Array.isArray(raw.checks)) {
    return 'REJECTED'
  }
  if (raw.evidence_environment === 'test-fixture-https') return 'REJECTED_TEST_FIXTURE'
  if (raw.evidence_environment !== 'node-trusted-https-origin' ||
      raw.actual_https_preflight !== 'pass' || raw.release_gate !== 'NO_GO_PHYSICAL_INSTALL_NOT_RUN' ||
      raw.checks.length !== 10 || raw.checks.some(c => c?.status !== 'pass')) {
    return 'REJECTED'
  }
  // This is a local JSON CLAIM, not an independently validated certificate.
  return 'CLAIM_REQUIRES_INDEPENDENT_CONFIRMATION'
}
function validBrowserObservation(record, origin, platform) {
  const keys = [
    'schema', 'case_id', 'captured_by', 'observed_at', 'origin_sha256',
    'platform_hint_only', 'display_mode_observed', 'navigator_standalone_observed',
    'transport_observed', 'secure_context_observed',
    'service_worker_api_supported', 'service_worker_controller_observed',
    'service_worker_matches_public_script', 'viewport_css_px', 'public_asset_checks',
    'installation_from_os_icon_verified', 'trusted_os_certificate_verified',
    'physical_device_acceptance', 'release_gate',
  ]
  if (!exactKeys(record, keys) ||
      record.schema !== 'xdrive-pwa-s5a2-browser-observation-v1' ||
      record.case_id !== 'S5-02' || record.captured_by !== 'explicit_user_click' ||
      record.origin_sha256 !== origin ||
      record.transport_observed !== 'https' || record.secure_context_observed !== true ||
      record.service_worker_api_supported !== true ||
      record.service_worker_matches_public_script !== true ||
      record.installation_from_os_icon_verified !== 'NOT_VERIFIED' ||
      record.trusted_os_certificate_verified !== 'NOT_VERIFIED' ||
      record.physical_device_acceptance !== 'NOT_RUN' ||
      record.release_gate !== 'NO_GO_PHYSICAL_INSTALL_NOT_RUN') return false
  const hint = platform.startsWith('ios27_') ? 'ios' :
    platform.startsWith('android_') ? 'android' : 'other'
  if (record.platform_hint_only !== hint ||
      typeof record.observed_at !== 'string' || !Number.isFinite(Date.parse(record.observed_at))) return false
  const installed = platform.endsWith('_installed') || platform === 'ios27_home_screen'
  if (installed ? record.display_mode_observed === 'browser' :
      record.display_mode_observed !== 'browser') return false
  if (!record.viewport_css_px || !Number.isInteger(record.viewport_css_px.width) ||
      !Number.isInteger(record.viewport_css_px.height)) return false
  const expected = ['context', 'transport', 'manifest', 'worker', 'offline', 'icon192', 'icon512']
  if (!exactKeys(record.public_asset_checks, expected) ||
      expected.some(id => record.public_asset_checks[id] !== 'pass')) return false
  return true
}
function validManualChecks(value, platform) {
  if (!exactKeys(value, ['os_family', 'os_version', 'browser', 'launch_source',
    'trusted_https_in_device_os', 'login_and_deeplinks_verified'])) return false
  const family = platform.startsWith('ios27_') ? 'iOS' :
    platform.startsWith('android_') ? 'Android' : null
  const browser = platform.startsWith('ios27_') ? 'Safari' :
    platform.startsWith('android_') ? 'Chrome' :
      platform.startsWith('desktop_edge') ? 'Edge' : 'Chrome'
  if (!['Windows', 'Linux', 'macOS', 'iOS', 'Android'].includes(value.os_family) ||
      (family && value.os_family !== family) || value.browser !== browser ||
      typeof value.os_version !== 'string' || !/^[a-zA-Z0-9._ -]{2,40}$/.test(value.os_version) ||
      value.trusted_https_in_device_os !== true || value.login_and_deeplinks_verified !== true) return false
  const installed = platform.endsWith('_installed') || platform === 'ios27_home_screen'
  return value.launch_source === (installed ? 'os_icon' : 'browser_tab')
}
async function verifyProof(proof, directory) {
  if (!exactKeys(proof, ['filename', 'sha256']) || !validHash(proof.sha256) ||
      typeof proof.filename !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,110}\.(png|jpg|jpeg|webp)$/i.test(proof.filename) ||
      proof.filename.includes('..') || !directory) return false
  let handle
  try {
    const filename = path.join(directory, proof.filename)
    const beforeOpen = await fsp.lstat(filename)
    if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink()) return false
    // O_NOFOLLOW provides the race-safe Linux protection; lstat also
    // protects the common Windows case where O_NOFOLLOW is unavailable.
    handle = await fsp.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 32 || stat.size > 20000000) return false
    const magic = Buffer.alloc(12)
    const first = await handle.read(magic, 0, 12, 0)
    const ext = path.extname(proof.filename).toLowerCase()
    if (first.bytesRead !== 12) return false
    const validMagic = ext === '.png' ? magic.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) :
      ext === '.jpg' || ext === '.jpeg' ? magic.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) :
        magic.subarray(0, 4).toString('ascii') === 'RIFF' &&
        magic.subarray(8, 12).toString('ascii') === 'WEBP'
    if (!validMagic) return false
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
      hash.update(chunk)
    }
    return hash.digest('hex') === proof.sha256
  } catch {
    return false
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}
async function review(input, httpsReport, directory) {
  validateEnvelope(input)
  const httpsState = originReportStatus(httpsReport, input.origin_sha256)
  const rows = []
  const usedProofHashes = new Set()
  for (const platform of PLATFORMS) {
    const evidence = input.cases.find(row => row.platform_id === platform)
    if (evidence.status === 'NOT_RUN') {
      rows.push({ platform_id: platform, evidence_state: 'NOT_RUN' })
      continue
    }
    const validBrowser = validBrowserObservation(evidence.browser_observation, input.origin_sha256, platform)
    const validManual = validManualChecks(evidence.manual_checks, platform)
    const validFile = await verifyProof(evidence.proof, directory)
    // One screenshot cannot be re-used to claim independent OS/platform runs.
    const reusedProof = validFile && usedProofHashes.has(evidence.proof.sha256)
    if (validFile) usedProofHashes.add(evidence.proof.sha256)
    rows.push({ platform_id: platform, evidence_state:
      validBrowser && validManual && validFile && !reusedProof &&
        httpsState === 'CLAIM_REQUIRES_INDEPENDENT_CONFIRMATION'
        ? 'SUBMITTED_REQUIRES_INDEPENDENT_REVIEW' : 'INCOMPLETE_OR_UNVERIFIED' })
  }
  const submitted = rows.filter(row => row.evidence_state === 'SUBMITTED_REQUIRES_INDEPENDENT_REVIEW').length
  const waiting = rows.filter(row => row.evidence_state === 'NOT_RUN').length
  return {
    schema: SCRIPT_SCHEMA, reviewed_at: new Date().toISOString(),
    build_commit: input.build_commit, origin_sha256: input.origin_sha256,
    https_evidence_state: httpsState,
    platform_rows: rows,
    submitted_pending_review: submitted, not_run: waiting,
    independent_device_review_completed: false,
    // This preparatory tool has NO authority to grant a production release.
    release_gate: 'NO_GO_INDEPENDENT_PHYSICAL_REVIEW_REQUIRED',
  }
}
async function main(args = process.argv.slice(2)) {
  let options
  try {
    options = parseArgs(args)
    const input = loadJSON(options.input)
    const tls = options.httpsReport ? loadJSON(options.httpsReport, 32768) : null
    const report = await review(input, tls, options.artifactsDir)
    const result = JSON.stringify(report, null, 2) + '\n'
    if (options.output) fs.writeFileSync(options.output, result, { mode: 0o600, flag: 'wx' })
    process.stdout.write(result)
    process.exitCode = 1 // NO-GO even if seven synthetic/real reports were submitted.
  } catch (error) {
    // Never echo private inputs, raw file paths, URLs, screenshots or stack.
    const allowed = new Set(['INVALID_ARGUMENTS', 'MISSING_INPUT', 'INVALID_EVIDENCE_FILE',
      'INVALID_EVIDENCE_SCHEMA', 'INVALID_PLATFORM_ENTRY',
      'NOT_RUN_CANNOT_CLAIM_EVIDENCE', 'SUBMITTED_REQUIRES_IDENTITY',
      'INCOMPLETE_PLATFORM_MATRIX'])
    const code = allowed.has(error?.message) ? error.message : 'INVALID_OR_UNWRITABLE_EVIDENCE'
    process.stdout.write(JSON.stringify({ schema: SCRIPT_SCHEMA, release_gate: 'NO_GO_INVALID_EVIDENCE', reason: code }) + '\n')
    process.exitCode = 2
  }
}
if (require.main === module) void main()
module.exports = { PLATFORMS, parseArgs, validateEnvelope, originReportStatus,
  validBrowserObservation, validManualChecks, verifyProof, review, main }
