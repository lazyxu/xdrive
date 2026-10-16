'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const source = read('desktop/scripts/pwa-s5s4-real-update.cjs')
const workflow = read('.github/workflows/pwa-s5s4-real-update.yml')
const worker = read('assets/icon/web/sw.js')
const ledger = read('docs/pwa-delivery.md')
const acceptance = read('docs/pwa-s5-acceptance.md')
test('S5-04A must use built Web and genuine controlled Chromium, not DOM update mocks', () => {
  for (const token of [
    "path.join(root, 'web/dist')", "chromium.launch(", "serviceWorkers: 'allow'",
    "await page.evaluate(() => navigator.serviceWorker.ready)",
    "await reg.update()", "v.active === 1 && v.waiting === 2 && v.controller === 1",
    "await peer.close()", "await page.close()", "v.active === 2 && v.controller === 2",
    "Android-UA-touch-390px-simulation", "mode: label, physicalDevice: false",
  ]) assert.ok(source.includes(token), token)
  assert.doesNotMatch(source, /context\.route\(|route\.fulfill\(/)
})
test('S5-04A no forced activation, long synthetic POST is held while update waits', () => {
  assert.ok(source.includes("pendingSyntheticResponses.push(res)"))
  assert.ok(source.includes("window.__s5FakeTransferFinished = response.ok"))
  assert.ok(source.includes("assert.equal(state.syntheticPOSTFinished, false)"))
  assert.ok(source.includes("assert.equal(state.controllerChanges, 0)"))
  assert.ok(source.includes("await page.waitForFunction(() => window.__s5FakeTransferFinished === true)"))
  assert.ok(source.includes("privateResponse, 401"))
  assert.ok(source.includes("cachesBefore.paths, ['/offline.html']"))
  assert.doesNotMatch(worker, /self\.skipWaiting\s*\(/)
  assert.doesNotMatch(source, /self\.skipWaiting\s*\(|clients\.claim\s*\(|navigator\.serviceWorker\.controller\.postMessage\(\s*\{\s*type:\s*'SKIP_WAITING'/)
})
test('S5-04A is an explicit non-deployable worker fixture, never an OS-installed claim', () => {
  assert.ok(source.includes('return originalWorker +'))
  assert.ok(source.includes('s5-fixture-worker-version'))
  assert.ok(source.includes('physicalDevice: false, release_gate:'))
  assert.ok(source.includes("'NO_GO_PHYSICAL_INSTALL_NOT_RUN'"))
  assert.ok(source.includes("startedSyntheticPOSTs, 2"))
  assert.ok(ledger.includes('PWA-S5-04A'))
  assert.ok(acceptance.includes('S5-04A'))
})
test('S5-04A exact-HEAD production build, real Chrome and summary-only artifact CI', () => {
  for (const token of [
    'npm --prefix web ci', 'npm --prefix web run build',
    'playwright-core@1.56.1', 'node desktop/scripts/pwa-s5s4-real-update.cjs',
    'node --test desktop/tests/pwa-s5s4-real-update-contract.cjs',
    'github.event.pull_request.head.sha', 'desktop/pwa-s5s4-results/summary.json',
  ]) assert.ok(workflow.includes(token), token)
  assert.ok(workflow.includes("github.head_ref == 'test/pwa-s5s4-real-sw-upgrade-20261016'"))
  assert.ok(workflow.includes('NO_GO_PHYSICAL_INSTALL_NOT_RUN'))
  assert.ok(!workflow.includes('desktop/pwa-s5s4-results/\\n'))
})
