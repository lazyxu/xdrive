'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { webcrypto, createHash } = require('node:crypto')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaDeviceEvidence.ts'), 'utf8')
const code = ts.transpileModule(source, {
  fileName: 'pwaDeviceEvidence.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture({ swGetterThrows = false, standaloneGetterThrows = false,
  controllerGetterThrows = false, scriptGetterThrows = false,
  locationGetterThrows = false, protocolGetterThrows = false,
  originGetterThrows = false, widthGetterThrows = false,
  heightGetterThrows = false } = {}) {
  const win = {
    location: { origin: 'https://drive.private.test', protocol: 'https:' },
    crypto: webcrypto, innerWidth: 390, innerHeight: 844,
  }
  if (protocolGetterThrows) Object.defineProperty(win.location, 'protocol', {
    get() { throw new Error('WebKit SecurityError: location.protocol getter blocked') },
  })
  if (originGetterThrows) Object.defineProperty(win.location, 'origin', {
    get() { throw new Error('WebKit SecurityError: location.origin getter blocked') },
  })
  if (locationGetterThrows) Object.defineProperty(win, 'location', {
    get() { throw new Error('WebKit SecurityError: location getter blocked') },
  })
  if (widthGetterThrows) Object.defineProperty(win, 'innerWidth', {
    get() { throw new Error('WebKit SecurityError: innerWidth getter blocked') },
  })
  if (heightGetterThrows) Object.defineProperty(win, 'innerHeight', {
    get() { throw new Error('WebKit SecurityError: innerHeight getter blocked') },
  })
  const navigator = { standalone: true, serviceWorker: { controller: { scriptURL: 'https://drive.private.test/sw.js' } } }
  if (swGetterThrows) Object.defineProperty(navigator, 'serviceWorker', {
    get() { throw new Error('WebKit SecurityError: serviceWorker getter blocked') },
  })
  if (standaloneGetterThrows) Object.defineProperty(navigator, 'standalone', {
    get() { throw new Error('WebKit SecurityError: standalone getter blocked') },
  })
  if (controllerGetterThrows) Object.defineProperty(navigator.serviceWorker, 'controller', {
    get() { throw new Error('WebKit SecurityError: controller getter blocked') },
  })
  if (scriptGetterThrows) Object.defineProperty(navigator.serviceWorker.controller, 'scriptURL', {
    get() { throw new Error('WebKit SecurityError: scriptURL getter blocked') },
  })
  const exports = {}
  const fakeRequire = module => {
    assert.equal(module, './pwaInstall')
    return { xDrivePwaInstallSnapshot: () => ({
      displayMode: 'browser', platformHint: 'ios', secureContext: true,
      serviceWorkerSupported: true,
    }) }
  }
  new Function('exports', 'require', 'window', 'navigator', 'TextEncoder', 'URL', code)(
    exports, fakeRequire, win, navigator, TextEncoder, URL,
  )
  return exports.collectXDrivePwaS5DeviceEvidence
}
function checkNoFalseAttestation(result, { originAvailable = true } = {}) {
  assert.equal(result.schema, 'xdrive-pwa-s5a2-browser-observation-v1')
  assert.equal(result.installation_from_os_icon_verified, 'NOT_VERIFIED')
  assert.equal(result.trusted_os_certificate_verified, 'NOT_VERIFIED')
  assert.equal(result.physical_device_acceptance, 'NOT_RUN')
  assert.equal(result.release_gate, 'NO_GO_PHYSICAL_INSTALL_NOT_RUN')
  assert.equal(result.origin_sha256, originAvailable
    ? createHash('sha256').update('https://drive.private.test').digest('hex')
    : null)
  assert.doesNotMatch(JSON.stringify(result), /drive.private.test|SecurityError|token|cookie/i)
}

test('S5 evidence: denied navigator.serviceWorker getter stays truthful and no-go', async () => {
  const report = await fixture({ swGetterThrows: true })()
  checkNoFalseAttestation(report)
  assert.equal(report.service_worker_controller_observed, false)
  assert.equal(report.service_worker_matches_public_script, false)
  assert.equal(report.navigator_standalone_observed, true)
})

test('S5 evidence: denied navigator.standalone getter produces unknown rather than crash', async () => {
  const report = await fixture({ standaloneGetterThrows: true })()
  checkNoFalseAttestation(report)
  assert.equal(report.service_worker_controller_observed, true)
  assert.equal(report.service_worker_matches_public_script, true)
  assert.equal(report.navigator_standalone_observed, null)
})

test('S5 evidence: denied SW controller getter makes controller status unknown, not a crash', async () => {
  const report = await fixture({ controllerGetterThrows: true })()
  checkNoFalseAttestation(report)
  assert.equal(report.service_worker_controller_observed, false)
  assert.equal(report.service_worker_matches_public_script, false)
})

test('S5 evidence: denied SW script getter keeps controller observed but script unverified', async () => {
  const report = await fixture({ scriptGetterThrows: true })()
  checkNoFalseAttestation(report)
  assert.equal(report.service_worker_controller_observed, true)
  assert.equal(report.service_worker_matches_public_script, false)
})

test('S5 evidence: healthy browser still observes the exact public SW without false OS attestation', async () => {
  const report = await fixture()()
  checkNoFalseAttestation(report)
  assert.equal(report.service_worker_controller_observed, true)
  assert.equal(report.service_worker_matches_public_script, true)
  assert.equal(report.navigator_standalone_observed, true)
})

test('S5 evidence: denied location object is unknown transport, never fabricated HTTPS', async () => {
  const report = await fixture({ locationGetterThrows: true })()
  checkNoFalseAttestation(report, { originAvailable: false })
  assert.equal(report.transport_observed, 'other')
  assert.equal(report.service_worker_controller_observed, true)
  assert.equal(report.service_worker_matches_public_script, false)
  assert.deepEqual(report.viewport_css_px, { width: 390, height: 844 })
})

test('S5 evidence: denied protocol getter retains independently observed origin digest', async () => {
  const report = await fixture({ protocolGetterThrows: true })()
  checkNoFalseAttestation(report)
  assert.equal(report.transport_observed, 'other')
  assert.equal(report.service_worker_matches_public_script, true)
  assert.equal(report.secure_context_observed, true)
})

test('S5 evidence: denied origin getter never exports raw origin or fake SHA-256', async () => {
  const report = await fixture({ originGetterThrows: true })()
  checkNoFalseAttestation(report, { originAvailable: false })
  assert.equal(report.transport_observed, 'https')
  assert.equal(report.service_worker_controller_observed, true)
  assert.equal(report.service_worker_matches_public_script, false)
})

test('S5 evidence: independently denied viewport getters return unknown zero, not false device dimensions', async () => {
  for (const input of [
    { widthGetterThrows: true, expected: { width: 0, height: 844 } },
    { heightGetterThrows: true, expected: { width: 390, height: 0 } },
    { widthGetterThrows: true, heightGetterThrows: true, expected: { width: 0, height: 0 } },
  ]) {
    const { expected, ...getters } = input
    const report = await fixture(getters)()
    checkNoFalseAttestation(report)
    assert.deepEqual(report.viewport_css_px, expected)
    assert.equal(report.physical_device_acceptance, 'NOT_RUN')
  }
})
