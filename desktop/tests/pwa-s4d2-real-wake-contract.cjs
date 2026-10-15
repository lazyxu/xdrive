'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const fixture = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const seed = read('internal/api/pwa_s4d2_wake_fixture_test.go')
const browser = read('desktop/scripts/pwa-s4d2-real-wake-browser.cjs')
const workflow = read('.github/workflows/pwa-s4d2-real-browser-wake.yml')
const doc = read('docs/pwa-delivery.md')

test('S4D2 opt-in real Gin/PostgreSQL source run transition is owner fenced', () => {
  for (const code of [
    'XD_PWA_S4D2_WAKE', 'wakeMode && (nativeDownloadMode || resumeMode',
    'pwaS4D2Prepare(t, db, owner.ID, foreign.ID)',
    'wakeFixture.advance(w, request, db)', 'wakeFixture.mutations.Add(1)',
    'wakeFixture.verify(t, db, router, ownerToken, foreignToken)',
  ]) assert(fixture.includes(code), code)
  for (const code of [
    'meta.SyncRunStatusRunning', 'meta.SyncRunStatusCompleted',
    'X-PWA-Synthetic-Advance', 'advanceCalls.CompareAndSwap(0, 1)',
    'db.Model(&meta.SyncRun{})', 'f.mutations.Load() != 0',
    'readSummary(ownerToken, 0)', 'readSummary(foreignToken, 1)',
    'readPage(ownerToken, f.ownerRunID', 'readPage(foreignToken, f.foreignRunID',
  ]) assert(seed.includes(code), code)
})

test('S4D2 production Web genuine Chrome foreground event causes read-only Server refresh', () => {
  for (const code of [
    "page.goto(ready.url + '/#/app/tasks'",
    "page.waitForFunction(() => document.visibilityState === 'hidden'",
    'puppeteer.launch({', 'headless: false', 'polling: 100, timeout: 15000',
    "assert.equal(await other.evaluate(() => document.visibilityState), 'visible')",
    'await other.bringToFront()', "await page.bringToFront()",
    "new URL(r.url()).pathname === '/api/v1/background-tasks/active-summary'",
    "new URL(r.url()).pathname === '/api/v1/background-tasks/page'",
    'summary.foregroundSummaryRead = true',
    'summary.foregroundTaskPageRead = true',
    "waitForTaskState(page, ready.wake_task_id, '已完成')",
    'summary.coldReloadConsistent = true',
    'assert.deepEqual(mutations, []',
    "cached.every(x => x === '/offline.html')",
  ]) assert(browser.includes(code), code)
  assert(!browser.includes('page.route('), 'no API mocks permitted')
  assert(!browser.includes('route.fulfill('), 'no fabricated Server result')
  assert(!browser.includes('skipWaiting'), 'no forced Service Worker activation')
  assert(!browser.includes('dispatchEvent('),
    'do not fake browser visibilitychange in test code')
  assert(!browser.includes('setWebLifecycleState'),
    'do not force a synthetic Chrome lifecycle state')
})

test('S4D2 exact-head CI is isolated and sanitizes real Chrome observations', () => {
  for (const code of [
    "github.head_ref == 'test/pwa-s4d2-browser-wake-server-task-20261015'",
    'XD_PWA_S4D2_WAKE=1', 'npm --prefix web run build',
    'go test -c -o', 'puppeteer-core@24.24.1', 'xvfb-run -a',
    "for MODE in desktop mobile; do",
    'desktop/tests/pwa-s4d2-real-wake-contract.cjs',
    'test "$(git rev-parse HEAD)" = "$XD_PR_HEAD"',
    'summary-*.json', 'foregroundTaskPageRead', 'coldReloadConsistent',
  ]) assert(workflow.includes(code), code)
  assert(!workflow.includes('cat "$RUNNER_TEMP/pwa-s4d2-private-gin-'),
    'never print unredacted authenticated Gin logs')
  assert(!/^\s*path:\s*desktop\/pwa-s4d2-results\/\s*$/m.test(workflow),
    'archive only sanitized summary JSON, not profiles or files')
  assert(doc.includes('PWA-S4D2'))
  assert(doc.includes('iOS 27') && doc.includes('Android'))
})
