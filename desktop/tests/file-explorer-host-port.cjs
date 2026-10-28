'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = p => fs.readFileSync(path.join(repo, p), 'utf8')
const bridge = read('desktop/src/renderer/DesktopFileExplorerHostPort.ts')
const explorer = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const app = read('desktop/src/renderer/App.tsx')
const dsm = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')

test('native FileExplorer calls are supplied through one explicit, typed Desktop Host', () => {
  const declarations = [...bridge.matchAll(/^  '([A-Za-z]\w*)',$/gm)].map(m => m[1]).sort()
  const mappings = [...bridge.matchAll(/^    ([A-Za-z]\w*): agent\.([A-Za-z]\w*),$/gm)]
    .map(m => { assert.equal(m[1], m[2]); return m[1] }).sort()
  const invocations = [...new Set([
    ...[...explorer.matchAll(/\bhostPort\.(?:browse|media|write)\.([A-Za-z]\w*)\s*\(/g)].map(m => m[1]),
    ...[...explorer.matchAll(/\bagent\.([A-Za-z]\w*)\s*\(/g)].map(m => m[1]),
  ])].sort()
  assert.equal(declarations.length, 58, 'all original owning Agent API methods must remain explicitly listed')
  assert.deepEqual(mappings, declarations, 'no declared capability may silently disappear or become a generic proxy')
  assert.deepEqual(invocations, declarations, 'the visible controller cannot bypass or invoke undeclared Agent methods')
  assert.ok(bridge.includes("satisfies readonly (keyof Window['xdriveDesktop']['agent'])[]"))
  assert.ok(bridge.includes("} satisfies DesktopFileExplorerAgentPort"))
  assert.ok(bridge.includes('native: Object.freeze({'))
  assert.equal(/\bProxy\b|\.\[method\]|\bfetch\(/.test(bridge), false,
    'the Host port must not implement a generic IPC/HTTP forwarding surface')
  assert.equal(explorer.includes('window.xdriveDesktop'), false,
    'shared-bound controller can no longer reach Electron global directly')
  assert.ok(explorer.includes('const agent = hostPort.media'))
  assert.equal(explorer.includes('hostPort.agent'), false)
  assert.equal(bridge.includes('readonly agent: DesktopFileExplorerAgentPort'), false)
  assert.ok(explorer.includes('const nativePort = hostPort.native'))
  assert.ok(app.includes('useMemo(createDesktopFileExplorerHostPort, [])'))
  assert.ok(app.includes('hostPort: fileExplorerHostPort'))
})

test('DSM retains a distinct Owner-authorized read-only bridge', () => {
  assert.ok(dsm.includes('client.ownerFilesRoot(') &&
    dsm.includes('client.ownerFilesPage('), 'DSM must use genuine scoped Owner reads')
  assert.equal(dsm.includes('window.xdriveDesktop'), false)
  assert.equal(dsm.includes('createDesktopFileExplorerHostPort'), false)
  assert.ok(dsm.includes('searchEnabled') && dsm.includes('unavailableActions={unavailableActions}') && dsm.includes('groupingEnabled={false}'))
  assert.equal(dsm.includes('onUpload='), false, 'Desktop owning upload capability must not leak to DSM')
})

test('viewport abort and private localhost media tickets belong to the Host, not the common-bound controller', () => {
  const cleanup = read('desktop/src/renderer/desktopPreviewURLLease.ts')
  const cancellation = read('desktop/src/renderer/abortableViewportRequest.ts')
  assert.match(bridge, /requestViewport: xDriveDesktopViewportRequest/)
  assert.match(bridge, /leasePreviewURL: xDriveLeaseDesktopPreviewURL/)
  assert.match(bridge, /releaseDiscardedPreviewURL: xDriveReleaseDiscardedDesktopPreviewURL/)
  assert.equal(/xDriveDesktopViewportRequest|xDriveLeaseDesktopPreviewURL|xDriveReleaseDiscardedDesktopPreviewURL/.test(explorer), false)
  assert.match(explorer, /hostPort.requestViewport\(/)
  assert.match(explorer, /hostPort.leasePreviewURL\(/)
  assert.match(explorer, /hostPort.releaseDiscardedPreviewURL\(/)
  assert.match(cancellation, /cancelViewportRequest\(requestID\)/)
  assert.match(cancellation, /onAbortedResult\?\.\(result\)/)
  assert.match(cleanup, /isDesktopPreviewTicket\(/)
  assert.match(cleanup, /url\.hostname === '127\.0\.0\.1'/)
  assert.match(cleanup, /\^\\\/preview\\\/\[0-9a-f\]\{64\}\$/)
})

test('Owner browse, media/Viewer and write/task interfaces are disjoint exact allowlists', () => {
  const allowed = [...bridge.matchAll(/^  '([A-Za-z]\w*)',$/gm)].map(x => x[1]).sort()
  const group = name => {
    const start = bridge.indexOf('export const XDRIVE_DESKTOP_FILES_' + name + '_METHODS = [')
    assert.ok(start >= 0, name + ' domain contract is missing')
    const end = bridge.indexOf('] as const satisfies', start)
    assert.ok(end > start)
    const members = bridge.slice(start, end)
    return [...members.matchAll(/^    '([A-Za-z]\w*)',$/gm)].map(x => x[1])
  }
  const browse = group('BROWSE'), media = group('MEDIA'), write = group('WRITE')
  const calls = [...explorer.matchAll(/\bhostPort\.(browse|media|write)\.([A-Za-z]\w*)\s*\(/g)]
  const boundMethods = { browse, media, write }
  for (const [, scope, method] of calls) {
    assert.ok(boundMethods[scope].includes(method),
      'Unapproved Host method/scope pair: ' + scope + '.' + method)
  }
  const capturedMediaCalls = [...explorer.matchAll(/\bagent\.([A-Za-z]\w*)\s*\(/g)]
  assert.ok(capturedMediaCalls.every(m => media.includes(m[1])),
    'Late preview/LivePhoto cleanup must stay on originally bound media session')
  assert.equal(browse.length, 13)
  assert.equal(media.length, 14)
  assert.equal(write.length, 31)
  const joined = [...browse, ...media, ...write]
  assert.equal(new Set(joined).size, 58, 'no API can silently cross Owner/read vs write classifications')
  assert.deepEqual(joined.sort(), allowed)
  for (const name of ['browse', 'media', 'write']) {
    assert.ok(bridge.includes(name + ': Object.freeze({'), name + ' Host implementation must be real')
  }
  assert.equal(dsm.includes('DesktopFilesWritePort'), false)
  assert.equal(dsm.includes('window.xdriveDesktop'), false)
})

test('Viewer download preserves correlation, save acknowledgment, and redacted native IPC errors', () => {
  // Native Host Port is a transport boundary, not a reason to drop the
  // already-accepted Viewer download identity and caller-visible result.
  assert.match(explorer, /const downloadNode = async \(\s*node: AgentCloudNode, clientRequestID\?: string,/)
  assert.match(explorer, /Promise<\{ saved: boolean \}>/)
  assert.match(explorer, /hostPort\.write\.cloudDownload\(\s*node\.id,\s*node\.name,\s*clientRequestID,/)
  assert.match(explorer, /return \{ saved: result\.data\.saved \}/)
  assert.match(explorer, /if \(!isActionBusyCurrent\(busyToken\)\) return \{ saved: false \}/)
  assert.ok(explorer.includes("onError('下载失败，请在任务中心查看或重试。')"),
    'thrown IPC errors may include native paths and must stay redacted')
  assert.ok(bridge.includes("'cloudDownload'"),
    'only the explicit authenticated owning Desktop write port can save files')
  assert.equal(explorer.includes('window.xdriveDesktop.agent.cloudDownload'), false)
})
