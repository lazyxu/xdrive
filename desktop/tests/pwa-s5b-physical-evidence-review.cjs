'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const verifier = require('../scripts/pwa-s5b-physical-evidence-review.cjs')

const root = path.resolve(__dirname, '../..')
const bin = path.join(root, 'desktop/scripts/pwa-s5b-physical-evidence-review.cjs')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-pwa-s5b-'))
const attachmentDir = path.join(temp, 'assets')
fs.mkdirSync(attachmentDir)
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }))
const SHA = createHash('sha256').update('https://synthetic.example.invalid').digest('hex')
const COMMIT = 'a'.repeat(40)
function envelope() {
  return { schema: 'xdrive-pwa-s5a2b1-platform-submissions-v1',
    build_commit: null, origin_sha256: null,
    cases: verifier.PLATFORMS.map(platform_id => ({
      platform_id, status: 'NOT_RUN', browser_observation: null,
      manual_checks: null, proof: null,
    })),
  }
}
function fakeHTTPS(origin = SHA, environment = 'node-trusted-https-origin') {
  return { schema: 'xdrive-pwa-s5a-live-origin-v1',
    observed_at: new Date().toISOString(),
    origin_sha256: origin, evidence_environment: environment,
    actual_https_preflight: 'pass', release_gate: 'NO_GO_PHYSICAL_INSTALL_NOT_RUN',
    physical_platforms: {
      ios27_safari_home_screen: 'not-run',
      android_chrome_installed: 'not-run',
      desktop_chrome_edge_installed: 'not-run',
    },
    checks: verifier.ORIGIN_CHECK_IDS.map(id => ({
      id, status: 'pass', reason: 'verified',
    })),
  }
}
function browser(platform, origin = SHA) {
  const installed = platform.endsWith('_installed') || platform === 'ios27_home_screen'
  const hint = platform.startsWith('ios27_') ? 'ios' :
    platform.startsWith('android_') ? 'android' : 'other'
  return {
    schema: 'xdrive-pwa-s5a2-browser-observation-v1', case_id: 'S5-02',
    captured_by: 'explicit_user_click', observed_at: new Date().toISOString(),
    origin_sha256: origin, platform_hint_only: hint,
    display_mode_observed: installed ? 'standalone' : 'browser',
    navigator_standalone_observed: platform === 'ios27_home_screen' ? true : null,
    transport_observed: 'https', secure_context_observed: true,
    service_worker_api_supported: true, service_worker_controller_observed: true,
    service_worker_matches_public_script: true,
    viewport_css_px: { width: 390, height: 844 },
    public_asset_checks: Object.fromEntries(
      ['context', 'transport', 'manifest', 'worker', 'offline', 'icon192', 'icon512']
        .map(id => [id, 'pass'])),
    installation_from_os_icon_verified: 'NOT_VERIFIED',
    trusted_os_certificate_verified: 'NOT_VERIFIED',
    physical_device_acceptance: 'NOT_RUN',
    release_gate: 'NO_GO_PHYSICAL_INSTALL_NOT_RUN',
  }
}
function manual(platform) {
  const ios = platform.startsWith('ios27_')
  const android = platform.startsWith('android_')
  const installed = platform.endsWith('_installed') || platform === 'ios27_home_screen'
  return {
    os_family: ios ? 'iOS' : android ? 'Android' : 'Windows',
    os_version: ios ? '27.0' : android ? '16.0' : '11',
    browser: ios ? 'Safari' : platform.startsWith('desktop_edge') ? 'Edge' : 'Chrome',
    launch_source: installed ? 'os_icon' : 'browser_tab',
    trusted_https_in_device_os: true, login_and_deeplinks_verified: true,
  }
}
function syntheticScreenshot(name, index) {
  // This is NOT an OS screenshot. A minimal PNG magic fixture verifies local
  // bytes are really read/hash-matched, without claiming a real device.
  const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from('synthetic-nondevice-evidence-only-unique-' + index)])
  fs.writeFileSync(path.join(attachmentDir, name), bytes)
  return { filename: name, sha256: createHash('sha256').update(bytes).digest('hex') }
}
function submit(input, platform, i) {
  input.build_commit = COMMIT
  input.origin_sha256 = SHA
  const row = input.cases.find(c => c.platform_id === platform)
  row.status = 'SUBMITTED'
  row.browser_observation = browser(platform)
  row.manual_checks = manual(platform)
  row.proof = syntheticScreenshot('s5b-synthetic-' + i + '.png', i)
  return row
}
function writeJSON(data, suffix) {
  const filename = path.join(temp, suffix)
  fs.writeFileSync(filename, JSON.stringify(data))
  return filename
}
function execute(data, { https = null, artifacts = attachmentDir, output = null,
  extra = [], filename = 'evidence-' + Math.random().toString(36).slice(2) + '.json' } = {}) {
  const input = writeJSON(data, filename)
  const args = ['--input', input]
  if (https) args.push('--https-report', writeJSON(https, 'https-report-' + Math.random().toString(36).slice(2) + '.json'))
  if (artifacts) args.push('--artifacts-dir', artifacts)
  if (output) args.push('--output', output)
  args.push(...extra)
  const run = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 18000, env: process.env })
  assert.equal(run.signal, null, 'review process must terminate')
  assert.equal(run.stderr, '')
  assert(run.stdout.length < 16000, 'do not dump evidence or raw files to logs')
  return { status: run.status, report: JSON.parse(run.stdout), printed: run.stdout }
}

test('S5b no-device template is seven NOT_RUN and always a release NO-GO', async () => {
  const src = JSON.parse(fs.readFileSync(path.join(root, 'docs/validation/pwa-s5-platforms.template.json'), 'utf8'))
  assert.deepEqual(src, envelope())
  const { status, report } = execute(src, { artifacts: null })
  assert.equal(status, 1)
  assert.equal(report.release_gate, 'NO_GO_INDEPENDENT_PHYSICAL_REVIEW_REQUIRED')
  assert.equal(report.independent_device_review_completed, false)
  assert.equal(report.https_evidence_state, 'NOT_RUN')
  assert.equal(report.platform_rows.length, 7)
  assert.equal(report.not_run, 7)
  assert.equal(report.submitted_pending_review, 0)
  assert(report.platform_rows.every(row => row.evidence_state === 'NOT_RUN'))
  assert.deepEqual(report.platform_rows.map(row => row.platform_id), verifier.PLATFORMS)
})

test('S5b one local screenshot hash and browser observation is submitted only, NEVER verified', async () => {
  const input = envelope()
  submit(input, 'ios27_home_screen', 1)
  const { report, printed, status } = execute(input, { https: fakeHTTPS() })
  assert.equal(status, 1)
  assert.equal(report.https_evidence_state, 'CLAIM_REQUIRES_INDEPENDENT_CONFIRMATION')
  assert.equal(report.submitted_pending_review, 1)
  assert.equal(report.not_run, 6)
  assert.equal(report.platform_rows.find(row => row.platform_id === 'ios27_home_screen').evidence_state,
    'SUBMITTED_REQUIRES_INDEPENDENT_REVIEW')
  assert.equal(report.independent_device_review_completed, false)
  assert.equal(report.release_gate, 'NO_GO_INDEPENDENT_PHYSICAL_REVIEW_REQUIRED')
  assert.doesNotMatch(printed, /s5b-synthetic|\/assets|example.invalid|browser_tab|os_icon|verified_bytes|synthetic-nondevice/)
})

test('S5b even seven synthetically complete platform records cannot grant release GO', async () => {
  const input = envelope()
  for (let i = 0; i < verifier.PLATFORMS.length; i++) submit(input, verifier.PLATFORMS[i], i + 2)
  const { report, status } = execute(input, { https: fakeHTTPS() })
  assert.equal(status, 1)
  assert.equal(report.submitted_pending_review, 7)
  assert.equal(report.not_run, 0)
  assert(report.platform_rows.every(row => row.evidence_state === 'SUBMITTED_REQUIRES_INDEPENDENT_REVIEW'))
  assert.equal(report.release_gate, 'NO_GO_INDEPENDENT_PHYSICAL_REVIEW_REQUIRED')
})

test('S5b test-only TLS fixture or inconsistent origin prevents a positive evidence-review state', async () => {
  const input = envelope()
  submit(input, 'android_installed', 8)
  for (const https of [null, fakeHTTPS(SHA, 'test-fixture-https'),
    fakeHTTPS('b'.repeat(64)), { ...fakeHTTPS(), actual_https_preflight: 'fail' }]) {
    const { status, report } = execute(input, { https })
    assert.equal(status, 1)
    assert.notEqual(report.https_evidence_state, 'CLAIM_REQUIRES_INDEPENDENT_CONFIRMATION')
    assert.equal(report.platform_rows.find(r => r.platform_id === 'android_installed').evidence_state,
      'INCOMPLETE_OR_UNVERIFIED')
  }
})

test('S5b refuses spoofed installed-mode, false device assertions, symlinks and hash mismatch', async () => {
  const input = envelope()
  const row = submit(input, 'ios27_home_screen', 9)
  row.browser_observation.display_mode_observed = 'browser'
  assert.equal(execute(input, { https: fakeHTTPS() }).report.submitted_pending_review, 0)
  row.browser_observation.display_mode_observed = 'standalone'
  row.browser_observation.physical_device_acceptance = 'PASS'
  assert.equal(execute(input, { https: fakeHTTPS() }).report.submitted_pending_review, 0)
  row.browser_observation.physical_device_acceptance = 'NOT_RUN'
  row.manual_checks.trusted_https_in_device_os = false
  assert.equal(execute(input, { https: fakeHTTPS() }).report.submitted_pending_review, 0)
  row.manual_checks.trusted_https_in_device_os = true
  row.proof.sha256 = '0'.repeat(64)
  assert.equal(execute(input, { https: fakeHTTPS() }).report.submitted_pending_review, 0)
  row.proof.sha256 = createHash('sha256').update(fs.readFileSync(path.join(attachmentDir, row.proof.filename))).digest('hex')
  const alias = 's5b-synthetic-alias.png'
  fs.symlinkSync(path.join(attachmentDir, row.proof.filename), path.join(attachmentDir, alias))
  row.proof.filename = alias
  assert.equal(execute(input, { https: fakeHTTPS() }).report.submitted_pending_review, 0)
  row.proof.filename = '../private.pem'
  assert.equal(execute(input, { https: fakeHTTPS() }).report.submitted_pending_review, 0)
})

test('S5b one screenshot cannot be reused as independent OS install evidence', async () => {
  const input = envelope()
  const first = submit(input, 'desktop_chrome_installed', 31)
  const other = submit(input, 'desktop_edge_installed', 32)
  other.proof = { ...first.proof }
  const { report, status } = execute(input, { https: fakeHTTPS() })
  assert.equal(status, 1)
  assert.equal(report.submitted_pending_review, 1,
    'duplicate proof bytes cannot count for multiple independently verified browsers')
  assert.equal(report.platform_rows.find(row => row.platform_id === 'desktop_edge_installed').evidence_state,
    'INCOMPLETE_OR_UNVERIFIED')
  assert.equal(report.release_gate, 'NO_GO_INDEPENDENT_PHYSICAL_REVIEW_REQUIRED')
})

test('S5b rejects forged PASS, duplicate platform rows, extra credential fields and unknown schema', () => {
  const input = envelope()
  const cases = [
    x => { x.cases[0].status = 'PASS' },
    x => { x.cases[1].platform_id = x.cases[0].platform_id },
    x => { x.cases[0].access_token = 'SECRET-DO-NOT-PRINT' },
    x => { x.api_cookie = 'COOKIE-DO-NOT-PRINT' },
    x => { x.schema = 'evil' },
    x => { x.cases[0].manual_checks = { secret: 'SENSITIVE' } },
  ]
  for (const mutate of cases) {
    const obj = JSON.parse(JSON.stringify(input))
    mutate(obj)
    const { status, report, printed } = execute(obj)
    assert.equal(status, 2)
    assert.equal(report.release_gate, 'NO_GO_INVALID_EVIDENCE')
    assert.doesNotMatch(printed, /SECRET-DO-NOT-PRINT|COOKIE-DO-NOT-PRINT|SENSITIVE/)
  }
})

test('S5b mode 0600 exclusive report and strict sandbox (no uploads, browser UA or secrets)', async () => {
  const reportPath = path.join(temp, 'redacted-output.json')
  const first = execute(envelope(), { output: reportPath })
  assert.equal(first.status, 1)
  assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), first.report)
  const second = execute(envelope(), { output: reportPath })
  assert.equal(second.status, 2, 'never overwrite earlier reviewer evidence')
  const source = fs.readFileSync(bin, 'utf8')
  assert.doesNotMatch(source, /https\.request|fetch\(|XMLHttpRequest|localStorage|Cookie:|process\.env\.TOKEN|appinstalled/)
  const docs = fs.readFileSync(path.join(root, 'docs/pwa-s5-acceptance.md'), 'utf8')
  const ledger = fs.readFileSync(path.join(root, 'docs/pwa-delivery.md'), 'utf8')
  assert(docs.includes('S5-A2b1'))
  assert(ledger.includes('PWA-S5-A2b1'))
})

// S5-A2b1a: negative-first offline input regressions. These are synthetic
// evidence records; a complete local submission NEVER attests a physical OS.
test('S5b requires ten exact, unique S5-A1 checks, no hidden claim fields', () => {
  const input = envelope()
  submit(input, 'ios27_home_screen', 61)
  const variants = [
    report => { report.checks = Array(10).fill(null).map(() => ({ ...report.checks[0] })) },
    report => { report.checks[0].id = 'other_check' },
    report => { report.checks[0].reason = 'not_independently_verified' },
    report => { report.checks[0].private_token = 'SECRET_NEVER_PRINT' },
    report => { report.physical_platforms.android_chrome_installed = 'pass' },
    report => { report.physical_platforms.cookie = 'SECRET_NEVER_PRINT' },
    report => { report.observed_at = 'not-a-real-timestamp' },
  ]
  for (const mutate of variants) {
    const fake = fakeHTTPS()
    mutate(fake)
    const { report, status, printed } = execute(input, { https: fake })
    assert.equal(status, 1)
    assert.equal(report.https_evidence_state, 'REJECTED')
    assert.equal(report.submitted_pending_review, 0)
    assert.equal(report.platform_rows.find(r => r.platform_id === 'ios27_home_screen').evidence_state,
      'INCOMPLETE_OR_UNVERIFIED')
    assert.doesNotMatch(printed, /SECRET_NEVER_PRINT/)
  }
})

test('S5b rejects spoofed display, OS version, viewport, and worker-controller claims', () => {
  const initial = envelope()
  submit(initial, 'ios27_home_screen', 62)
  const cases = [
    row => { row.browser_observation.display_mode_observed = 'pretend-installed' },
    row => { row.browser_observation.navigator_standalone_observed = 'true' },
    row => { row.browser_observation.service_worker_controller_observed = false },
    row => { row.browser_observation.viewport_css_px.width = -1 },
    row => { row.browser_observation.viewport_css_px.secret = 'SECRET_NEVER_PRINT' },
    row => { row.manual_checks.os_version = '26.9' },
  ]
  for (const mutate of cases) {
    const input = JSON.parse(JSON.stringify(initial))
    mutate(input.cases.find(row => row.platform_id === 'ios27_home_screen'))
    const { report, status, printed } = execute(input, { https: fakeHTTPS() })
    assert.equal(status, 1)
    assert.equal(report.submitted_pending_review, 0)
    assert.equal(report.platform_rows.find(r => r.platform_id === 'ios27_home_screen').evidence_state,
      'INCOMPLETE_OR_UNVERIFIED')
    assert.doesNotMatch(printed, /SECRET_NEVER_PRINT/)
  }
  const desktop = envelope()
  submit(desktop, 'desktop_edge_installed', 63)
  desktop.cases.find(row => row.platform_id === 'desktop_edge_installed')
    .manual_checks.os_family = 'Android'
  const { report, status } = execute(desktop, { https: fakeHTTPS() })
  assert.equal(status, 1)
  assert.equal(report.submitted_pending_review, 0)
  assert.equal(report.platform_rows.find(r => r.platform_id === 'desktop_edge_installed').evidence_state,
    'INCOMPLETE_OR_UNVERIFIED')
})
