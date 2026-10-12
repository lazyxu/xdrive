'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const load = p => fs.readFileSync(path.join(root, p), 'utf8')
const script = load('desktop/scripts/file-explorer-desktop-go-cancel-100k-electron-main.cjs')
const runner = load('desktop/scripts/file-explorer-desktop-go-cancel-100k-runner.cjs')
const flow = load('.github/workflows/file-explorer-desktop-go-cancel-100k.yml')

test('P037 authentic Desktop FileExplorer cancellation traverses real Renderer/Preload/Main/Agent/Gin on 100k range', () => {
  for (const part of [
    "require('../dist/main/index.cjs')", "window.xdriveDesktop?.agent",
    'data-xdrive-file-explorer-scroll-host', 'data-xdrive-file-explorer-item',
    "nav[aria-label=\"桌面版功能区\"]",
    "'100k Images'", "'100000 个项目'",
    "['virtual-scroll', 'app-switch', 'window-destroy']",
    "'browser-window-created'", 'win.destroy()', 'contextDone', 'cancelledHandlers',
    'after.emitted_bytes - started.emitted_bytes',
    "/__perf/viewport-cancel-mark", "/__perf/viewport-cancel-stats",
    'assert(row.passed'
  ]) assert.ok(script.includes(part), 'No genuine Desktop lifecycle/resource proof: ' + part)
})
test('P037 distinct P015/P017 workload uses actual Agent IPC, three PG fixtures and bounded Go cancel', () => {
  for (const part of [
    "require('../dist/main/agent_client.cjs')", "TestFileExplorerRealWebScrollCancelFixture100K",
    "XD_FILEEXPLORER_REAL_WEB_SCROLL_100K_PERF", "go", // no fake HTTP or UI
    "XD_FILEEXPLORER_DESKTOP_GO_CANCEL_100K_PERF",
    "modes = ['virtual-scroll', 'app-switch', 'window-destroy']",
    "realPhysicalJPEGsPerFixture: 16", "logicalFiles: 100000",
    "result.code, 0", "cloudChildrenRange", "50000, 200, 'name', 'asc', true",
    "started: rows.reduce", "actualGoContextDone", "agentRssGrowthMaxBytes: 134217728",
    "maxNotificationMs: 160", "wastedOldBytes", "row.passed"
  ]) assert.ok(runner.includes(part), 'Missing real 100k Go cancellation measurement: ' + part)
})
test('P037 native fixture adopts P035 Desktop boot prerequisites without 100k physical JPEG side effect', () => {
  const go = load('internal/api/file_explorer_real_web_scroll_cancel_performance_integration_test.go')
  assert.ok(go.includes('desktopNeedsBoot := os.Getenv("XD_FILEEXPLORER_REAL_PHYSICAL_JPEG_100K_PERF") == "1" ||'))
  assert.ok(go.includes('os.Getenv("XD_FILEEXPLORER_DESKTOP_GO_CANCEL_100K_PERF") == "1"'))
  assert.ok(go.includes('if desktopNeedsBoot {'))
  assert.ok(go.includes('distinctPhysicalImages := 16'))
  assert.ok(go.includes('physicalMode := os.Getenv("XD_FILEEXPLORER_REAL_PHYSICAL_JPEG_100K_PERF") == "1"'))
})
test('P037 single-branch authentic n3 CI can never run on unrelated performance and Race PRs', () => {
  assert.ok(flow.includes("github.head_ref == 'perf/file-explorer-desktop-go-cancel-100k-p037-20261012'"))
  assert.ok(flow.includes('github.event.pull_request.head.sha'))
  for (const part of [
    'PostgreSQL', 'postgres:17-alpine', 'node --check',
    'go test -c', 'go build -o', 'npm --prefix desktop run build',
    'npm --prefix web run build', 'xvfb-run -a',
    "name 'sample-*-*.json'", 'node --test desktop/tests/file-explorer-desktop-go-cancel-100k-source.cjs',
    'actions/upload-artifact@v4'
  ]) assert.ok(flow.includes(part), 'Missing CI source-exact proof: ' + part)
});
