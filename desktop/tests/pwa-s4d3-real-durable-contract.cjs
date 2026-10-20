'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

const fixture = read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const worker = read('internal/api/pwa_s4d3_durable_fixture_test.go')
const browser = read('desktop/scripts/pwa-s4d3-real-durable-browser.cjs')
const workflow = read('.github/workflows/pwa-s4d3-real-durable-browser.yml')
const doc = read('docs/pwa-delivery.md')

test('S4D3 invokes genuine authenticated file-operation API and independent Server worker', () => {
  for (const value of [
    'XD_PWA_S4D3_DURABLE', 'pwaS4D3Prepare(',
    'durableFixture.startWorker(w, request, srv)',
    'durableFixture.verify(t, srv, db, router, ownerToken, foreignToken)',
    'durableFixture.mutations.Add(1)', 'pwa_s4d3_durable', 'durable_task_id',
  ]) assert(fixture.includes(value), value)
  for (const value of [
    '"/api/v1/file-operations"', 'http.StatusAccepted',
    'meta.FileOperationStatusQueued', 'srv.StartFileOperationWorker(ctx)',
    'f.startCalls.CompareAndSwap(0, 1)',
    'node.DeletedAt == nil', 'meta.FileOperationStatusCompleted',
    'readPage(ownerToken, false)', 'readPage(foreignToken, false)',
    'ownerRead := request(t, router, http.MethodGet',
    'ownerOperation.Status != meta.FileOperationStatusCompleted',
    'f.mutations.Load() != 0',
  ]) assert(worker.includes(value), value)
  assert(!worker.includes('db.Model(&meta.FileOperation{}).Update('),
    'the fixture may not fake a terminal operation state')
  assert(!worker.includes('Update("status"'),
    'a worker must perform the real state transition')
})

test('S4D3 kills an OS Chrome process and restores Server authority after fresh login', () => {
  for (const value of [
    "ready.url + '/#/app/tasks'", "waitForOperationState(page, operationId, '等待执行'",
    'data-xdrive-file-operation-id', 'operationId = ready.durable_task_id.slice',
    "oldProcess.kill('SIGKILL')", "signal === 'SIGKILL'",
    'summary.originalChromeTerminated = true',
    "'/__test/pwa-s4d3/start-worker'", 'summary.independentWorkerStarted = true',
    'restarted = await puppeteer.launch(', 'assert.notEqual(restarted.process()?.pid',
    'await authenticate(recoveredPage)', 'summary.recoveredFreshBrowserLogin = true',
    "waitForOperationState(recoveredPage, operationId, '已完成'",
    "'/api/v1/background-tasks/active-summary'",
    "'/api/v1/background-tasks/page'",
    'summary.serverSummaryRead = true', 'summary.serverTaskPageRead = true',
    'summary.serverFileOperationsRead = true', "new URL(r.url()).pathname === '/api/v1/file-operations'",
    'summary.coldReloadConsistent = true',
    'assert.deepEqual(mutations, []', "assertXDrivePublicShellCache(cached)",
  ]) assert(browser.includes(value), value)
  assert(browser.includes("for (const button of await p.$$('button'))"),
    'real login must iterate all buttons using Puppeteer $$ selector')
  assert(!browser.includes("for (const button of await p.$('button'))"),
    'single ElementHandle cannot be used as an iterable')
  assert(!browser.includes('data-xdrive-background-task-id'),
    'owner file operation must not be looked up in the separate background-task domain')
  assert(!browser.includes('page.route('), 'no API mocks')
  assert(!browser.includes('route.fulfill('), 'no fabricated task response')
  assert(!browser.includes('dispatchEvent('), 'no fabricated lifecycle event')
  assert(!browser.includes('skipWaiting'), 'never force a Service Worker update')
})

test('S4D3 exact-head branch CI enforces real Gin/PostgreSQL, two browser modes and safe artifacts', () => {
  for (const value of [
    "github.head_ref == 'test/pwa-s4d3-real-server-worker-process-restart-20261015'",
    'XD_PWA_S4D3_DURABLE=1', 'npm --prefix web run build',
    'go test -c -o', 'puppeteer-core@24.24.1', 'xvfb-run -a',
    "for MODE in desktop mobile; do",
    'desktop/tests/pwa-s4d3-real-durable-contract.cjs',
    'test "$(git rev-parse HEAD)" = "$XD_PR_HEAD"',
    'summary-*.json', 'originalChromeTerminated', 'serverTaskPageRead',
  ]) assert(workflow.includes(value), value)
  assert(!workflow.includes('cat "$RUNNER_TEMP/pwa-s4d3-private-gin-'),
    'never emit authenticated Gin logs')
  assert(!/^\s*path:\s*desktop\/pwa-s4d3-results\/\s*$/m.test(workflow),
    'archive only sanitized summary JSON')
  assert(doc.includes('PWA-S4D3'))
  assert(doc.includes('iOS 27') && doc.includes('Android'))
})
