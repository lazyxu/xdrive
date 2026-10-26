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
  controllerGetterThrows = false, scriptGetterThrows = false } = {}) {
  const win = {
    location: { origin: 'https://drive.private.test', protocol: 'https:' },
    crypto: webcrypto, innerWidth: 390, innerHeight: 844,
  }
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
function checkNoFalseAttestation(result) {
  assert.equal(result.schema, 'xdrive-pwa-s5a2-browser-observation-v1')
  assert.equal(result.installation_from_os_icon_verified, 'NOT_VERIFIED')
  assert.equal(result.trusted_os_certificate_verified, 'NOT_VERIFIED')
  assert.equal(result.physical_device_acceptance, 'NOT_RUN')
  assert.equal(result.release_gate, 'NO_GO_PHYSICAL_INSTALL_NOT_RUN')
  assert.equal(result.origin_sha256, createHash('sha256').update('https://drive.private.test').digest('hex'))
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
