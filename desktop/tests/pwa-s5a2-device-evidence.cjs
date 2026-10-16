'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { webcrypto, createHash } = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const { createRequire } = require('node:module')
let ts
try {
  // Full PR CI desktop-tests installs only Desktop node_modules.
  ts = createRequire(path.join(root, 'desktop/package.json'))('typescript')
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error
  // Dedicated S5-A2a browser CI installs only Web node_modules.
  ts = createRequire(path.join(root, 'web/package.json'))('typescript')
}
const source = fs.readFileSync(path.join(root, 'web/src/pwaDeviceEvidence.ts'), 'utf8')
const code = ts.transpileModule(source, {
  fileName: 'pwaDeviceEvidence.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture({
  origin = 'https://example.private.test',
  protocol = 'https:',
  platformHint = 'ios',
  mode = 'standalone',
  sw = true,
  scriptURL,
  standalone,
  width = 390, height = 844,
  secure = true,
  subtle = true,
} = {}) {
  const exports = {}
  const window = {
    location: { origin, protocol, pathname: '/not-for-export', hash: '#/app/gallery?secret=fixture' },
    isSecureContext: secure,
    innerWidth: width, innerHeight: height,
    crypto: subtle ? webcrypto : undefined,
  }
  const navigator = {
    userAgent: 'SHOULD NEVER APPEAR IN EVIDENCE',
    serviceWorker: sw ? { controller: { scriptURL: scriptURL ?? origin + '/sw.js' } } : undefined,
    standalone,
  }
  const snapshot = {
    displayMode: mode, platformHint, secureContext: secure,
    serviceWorkerSupported: sw, promptAvailable: false,
    installedEventObserved: true, lastPromptOutcome: 'accepted',
  }
  const fakeRequire = module => {
    assert.equal(module, './pwaInstall', 'module must import the existing shared install observation')
    return { xDrivePwaInstallSnapshot: () => snapshot }
  }
  new Function('exports', 'require', 'window', 'navigator', 'TextEncoder', 'URL', code)(
    exports, fakeRequire, window, navigator, TextEncoder, URL)
  return { mod: exports, window, navigator }
}

test('S5-A2a iOS standalone observation remains NO-GO and omits raw origin/UA/private paths', async () => {
  const origin = 'https://example.private.test'
  const h = fixture({ origin, standalone: true })
  const checks = [
    { id: 'worker', state: 'pass', label: 'name', detail: 'SECRET-COOKIE-NO-EXPORT' },
    { id: 'context', state: 'pass', detail: 'secret-token-cannot-escape' },
  ]
  const result = await h.mod.collectXDrivePwaS5DeviceEvidence(checks)
  assert.equal(result.schema, 'xdrive-pwa-s5a2-browser-observation-v1')
  assert.equal(result.case_id, 'S5-02')
  assert.equal(result.captured_by, 'explicit_user_click')
  assert.equal(result.display_mode_observed, 'standalone')
  assert.equal(result.navigator_standalone_observed, true)
  assert.equal(result.transport_observed, 'https')
  assert.equal(result.secure_context_observed, true)
  assert.equal(result.service_worker_controller_observed, true)
  assert.equal(result.service_worker_matches_public_script, true)
  assert.equal(result.origin_sha256, createHash('sha256').update(origin).digest('hex'))
  assert.deepEqual(result.viewport_css_px, { width: 390, height: 844 })
  assert.equal(result.public_asset_checks.worker, 'pass')
  assert.equal(result.public_asset_checks.context, 'pass')
  assert.equal(result.public_asset_checks.manifest, 'not_run')
  assert.equal(result.installation_from_os_icon_verified, 'NOT_VERIFIED')
  assert.equal(result.trusted_os_certificate_verified, 'NOT_VERIFIED')
  assert.equal(result.physical_device_acceptance, 'NOT_RUN')
  assert.equal(result.release_gate, 'NO_GO_PHYSICAL_INSTALL_NOT_RUN')
  const json = JSON.stringify(result)
  assert.doesNotMatch(json, /example.private.test|SECRET-COOKIE|secret-token|SHOULD NEVER|\/app\/gallery|#\/app|private.*path/)
  assert.deepEqual(Object.keys(result.public_asset_checks),
    ['context', 'transport', 'manifest', 'worker', 'offline', 'icon192', 'icon512'])
  assert.match(result.observed_at, /^\d{4}-\d\d-\d\dT/)
})

test('S5-A2a Android browser never pretends to be installed or to have a trusted certificate', async () => {
  const h = fixture({ origin: 'http://localhost:5173', protocol: 'http:',
    platformHint: 'android', mode: 'browser', sw: false, standalone: undefined,
    width: 375, height: 720, secure: true, subtle: false })
  const result = await h.mod.collectXDrivePwaS5DeviceEvidence()
  assert.equal(result.platform_hint_only, 'android')
  assert.equal(result.display_mode_observed, 'browser')
  assert.equal(result.navigator_standalone_observed, null)
  assert.equal(result.service_worker_api_supported, false)
  assert.equal(result.service_worker_controller_observed, false)
  assert.equal(result.service_worker_matches_public_script, false)
  assert.equal(result.transport_observed, 'http')
  assert.equal(result.origin_sha256, null)
  assert.ok(Object.values(result.public_asset_checks).every(x => x === 'not_run'))
  assert.equal(result.physical_device_acceptance, 'NOT_RUN')
  assert.equal(result.release_gate, 'NO_GO_PHYSICAL_INSTALL_NOT_RUN')
})

test('S5-A2a unexpected SW scope and hostile detail strings cannot leak', async () => {
  const h = fixture({ scriptURL: 'https://evil.example.org/sw.js?ticket=secret',
    platformHint: 'other', mode: 'window-controls-overlay', width: NaN, height: -10 })
  const result = await h.mod.collectXDrivePwaS5DeviceEvidence([
    { id: 'worker', state: 'warn', detail: 'PRIVATE-ACCESS-TOKEN' },
    { id: 'icon512', state: 'fail', detail: 'SECRET-MEDIA-URL' },
    { id: 'manifest', state: 'completed', detail: 'MALFORMED' },
    { id: 'not-a-public-asset', state: 'pass', detail: 'FOREIGN-ID' },
  ])
  assert.equal(result.display_mode_observed, 'window-controls-overlay')
  assert.equal(result.service_worker_controller_observed, true)
  assert.equal(result.service_worker_matches_public_script, false)
  assert.deepEqual(result.viewport_css_px, { width: 0, height: 0 })
  assert.equal(result.public_asset_checks.worker, 'warn')
  assert.equal(result.public_asset_checks.icon512, 'fail')
  assert.equal(result.public_asset_checks.manifest, 'not_run')
  assert.equal(Object.hasOwn(result.public_asset_checks, 'not-a-public-asset'), false)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-ACCESS|SECRET-MEDIA|FOREIGN-ID|evil\.example/)
})

test('S5-A2a production UI explicitly exports read-only evidence from the shared installation dialog', () => {
  const dialog = fs.readFileSync(path.join(root, 'web/src/PwaInstallDialog.tsx'), 'utf8')
  const shared = fs.readFileSync(path.join(root, 'web/src/pwaInstall.ts'), 'utf8')
  const browserRunner = fs.readFileSync(path.join(root, 'desktop/scripts/pwa-browser-install-offline.cjs'), 'utf8')
  const delivery = fs.readFileSync(path.join(root, 'docs/pwa-delivery.md'), 'utf8')
  const gate = fs.readFileSync(path.join(root, 'docs/pwa-s5-acceptance.md'), 'utf8')
  for (const marker of [
    'data-xdrive-pwa-s5-evidence-create',
    'data-xdrive-pwa-s5-evidence-output',
    'collectXDrivePwaS5DeviceEvidence(checks)',
    'slotProps={{ input: { readOnly: true } }}',
    '不会自动上传、存储或标记真机验收通过',
    'setDeviceEvidence(null)',
  ]) assert(dialog.includes(marker), 'missing shared UI: ' + marker)
  assert(shared.includes('xDrivePwaInstallSnapshot'))
  assert(browserRunner.includes('textarea:not([aria-hidden="true"])'),
    'real MUI textarea must exclude the extra aria-hidden sizing control')
  assert(delivery.includes('PWA-S5-A2a'))
  assert(gate.includes('S5-A2a'))
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|indexedDB|Authorization|\/api\/v1|navigator\.userAgent/)
  assert.doesNotMatch(dialog, /navigator\.clipboard\.writeText|location\.reload\(/)
})

test('S5-A2a TypeScript harness resolves installed Desktop or Web workspace dependencies', () => {
  const desktopManifest = JSON.parse(fs.readFileSync(path.join(root, 'desktop/package.json'), 'utf8'))
  const webManifest = JSON.parse(fs.readFileSync(path.join(root, 'web/package.json'), 'utf8'))
  assert.ok(desktopManifest.devDependencies.typescript)
  assert.ok(webManifest.devDependencies.typescript)
  assert.equal(typeof ts.transpileModule, 'function')
  const source = fs.readFileSync(__filename, 'utf8')
  assert.ok(source.includes("createRequire(path.join(root, 'desktop/package.json'))('typescript')"))
  assert.ok(source.includes("createRequire(path.join(root, 'web/package.json'))('typescript')"))
})
