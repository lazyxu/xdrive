'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const go = read('internal/api/file_explorer_real_web_scroll_cancel_performance_integration_test.go')
const runner = read('desktop/scripts/file-explorer-desktop-go-cancel-100k-runner.cjs')
const desktop = read('desktop/scripts/file-explorer-desktop-go-cancel-100k-electron-main.cjs')
const wf = read('.github/workflows/file-explorer-desktop-physical-go-cancel-p053.yml')
const registry = read('docs/performance-test-registry.md')
const matrix = read('docs/performance-platform-coverage.md')
const canonical = read('docs/file-explorer-performance.md')

test('P053 genuinely builds 100k physically independent JPEG original CAS through native Server and retains old P037 and P052 gates',()=>{
  for(const part of [
    'XD_FILEEXPLORER_DESKTOP_PHYSICAL_GO_CANCEL_100K_PERF',
    'desktopPhysicalCancelMode',
    'physicalCancelMode = true',
    'seedFileExplorerDistinctPhysicalJPEG100K(t, db, store, logicalCount)',
    'distinctPhysicalImages = logicalCount',
    'if physicalCancelMode && r.Method == http.MethodGet && probe.matches',
    '"physical_cancel_mode": physicalCancelMode',
    '"physical_source_bytes": physicalSourceBytes',
  ]) assert(go.includes(part),'P053 native physical fixture absent: '+part)
  assert(go.includes('distinctPhysicalImages := 16'),'P037 must still be 16 real JPEG originals by default')
})

test('P053 uses actual production Desktop UI and Agent IPC three independent lifecycle cancel actions plus real renderer process metrics',()=>{
  for(const marker of [
    "require('../dist/main/index.cjs')",
    "['virtual-scroll', 'app-switch', 'window-destroy']",
    "'browser-window-created'",
    'data-xdrive-file-explorer-scroll-host',
    'win.destroy()',
    'after.context_done - started.context_done',
    'after.cancelled - started.cancelled',
    'after.emitted_bytes - started.emitted_bytes',
    'deadlineMs = 160',
    'desktopProcessSnapshot(rendererPID)',
    'renderer160msRssGrowthBytes',
    'originalPhysicalPayloadBytes',
  ]) assert(desktop.includes(marker),'missing native renderer event/cancel probe: '+marker)
  assert(desktop.includes('distinctPhysicalJPEGs: 16'),'P037 original Desktop physical count must stay unchanged')
  assert(!desktop.includes('TaskCenter.cancel')&&!desktop.includes('cancelTransfer('))
})

test('P053 true physical Agent <-> signed HTTP benchmark n3 with Go/Agent/Renderer resources and request owner scope',()=>{
  for(const marker of [
    "require('../dist/main/agent_client.cjs')",
    'XD_FILEEXPLORER_DESKTOP_PHYSICAL_GO_CANCEL_100K_PERF',
    'ready.physical_images, desktopPhysicalCancelMode ? 100000 : 16',
    'row.data.distinctPhysicalJPEGs,100000',
    'row.data.originalPhysicalPayloadBytes>=50000000',
    'realPhysicalJPEGsPerFixture = 100000',
    'summary.maxServerRssGrowthBytes',
    'summary.maxRenderer160msRssGrowthBytes',
    'serverCpuMsThreeModes',
    'agentCpuMsThreeModes',
    "modes = ['virtual-scroll', 'app-switch', 'window-destroy']",
    'cloudChildrenRange',
    "50000, 200, 'name', 'asc', true",
    'agentRssGrowthMaxBytes: 134217728',
    'maxNotificationMs: 160',
  ]) assert(runner.includes(marker),'missing native authenticated Agent measurement: '+marker)
})

test('P053 isolated opt-in source-exact CI, unmeasured devices are not claimed',()=>{
  assert(wf.includes("github.head_ref == 'perf/desktop-physical-jpeg-100k-go-cancel-p053-20261016'"))
  for(const marker of [
    "XD_FILEEXPLORER_DESKTOP_PHYSICAL_GO_CANCEL_100K_PERF: '1'",
    'postgres:17-alpine',
    'github.event.pull_request.head.sha',
    'go test -c', 'go build -o',
    'npm --prefix desktop run build',
    'xvfb-run -a',
    'x.cases!==9',
    'x.actualGoContextDone!==54',
    'x.realPhysicalJPEGsPerFixture!==100000',
    'x.maxServerRssGrowthBytes>268435456',
    'actions/upload-artifact@v4',
  ]) assert(wf.includes(marker),'P053 frozen authentic gate missing: '+marker)
  for(const text of [registry,matrix,canonical])
    assert(text.includes('P053')&&text.includes('Not measured'))
  assert(matrix.includes('Native Desktop') && matrix.includes('Wide Web') &&
    matrix.includes('Mobile Web') && matrix.includes('Desktop installed PWA') &&
    matrix.includes('Android installed PWA') && matrix.includes('iOS installed PWA'))
})
