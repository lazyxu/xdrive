'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const hookPath = 'ui/shared/src/mui/useViewerDownloadReceipt.ts'
const progressPath = 'ui/shared/src/mui/MediaLoadProgress.tsx'
const hookSource = read(hookPath)
const formatterSource = read(progressPath)
const sharedViewer = read('ui/shared/src/mui/MediaGalleryViewer.tsx')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const adapter = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
const desktop = read('desktop/src/renderer/mediaGalleryAdapter.ts')
const desktopApp = read('desktop/src/renderer/App.tsx')
const agentHello = read('cmd/xdrive-agent/desktop_ipc.go')
function compile(source, filename, dependencies = {}) {
  const code = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const result = { exports: {} }
  new Function('exports', 'module', 'require', code)(result.exports, result,
    name => name === 'react' || name === 'react/jsx-runtime'
      ? require(name) : Object.hasOwn(dependencies, name) ? dependencies[name]
        : name === '@mui/material' ? { Box: 'div', CircularProgress: 'span', Typography: 'span' }
        : require(name))
  return result.exports
}
const mediaProgress = compile(formatterSource, progressPath)
const hook = compile(hookSource, hookPath, {
  './MediaLoadProgress': {
    xDriveMediaByteProgressLabel: mediaProgress.xDriveMediaByteProgressLabel,
  },
})
const { useXDriveViewerDownloadReceipt, xDriveViewerAgentTransferLabel } = hook
const mk = (nonce, node, done, total, state = 'running') => ({
  id: 'agent-task-' + nonce,
  client_request_id: nonce,
  cloud_node_id: node,
  kind: 'download',
  direction: 'download',
  state,
  bytes_done: done,
  bytes_total: total,
})

test('real mounted shared Viewer receipt fences Owner, exact nonce and concurrent same-name tasks', async () => {
  const nonceA = 'a'.repeat(32), nonceB = 'b'.repeat(32)
  let seq = 0, latest = []
  const listeners = new Set()
  const port = {
    createRequestID: () => [nonceA, nonceB][seq++],
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    snapshot: async () => latest,
  }
  const emit = tasks => { latest = tasks; for (const listener of listeners) listener(tasks) }
  const ownerA = {}, ownerB = {}, ownerAReturn = {}
  let result, mounted
  const Harness = ({ owner, nodeID }) => {
    result = useXDriveViewerDownloadReceipt(port, owner, nodeID)
    return null
  }
  await act(async () => { mounted = create(React.createElement(Harness, { owner: ownerA, nodeID: 42 })) })
  assert.equal(listeners.size, 0, 'no transfer subscription before Viewer action is claimed')
  let id
  await act(async () => { id = result.claim(); await Promise.resolve() })
  assert.equal(id, nonceA)
  assert.equal(listeners.size, 1, 'only the mounted active Viewer observes transfer events')
  assert.equal(result.text, '正在准备下载…')
  assert.equal(result.announce, false)
  await act(async () => {
    emit([mk(nonceB, 42, 999, 1000), mk(nonceA, 99, 900, 1000)])
  })
  assert.equal(result.text, '正在准备下载…', 'same filename and wrong Node/nonce cannot leak')
  await act(async () => { emit([mk(nonceB, 42, 999, 1000), mk(nonceA, 42, 1024 ** 2, 4 * 1024 ** 2)]) })
  assert.equal(result.text, '下载中 · 1.0 / 4.0 MiB')
  assert.equal(result.announce, false)
  await act(async () => { emit([mk(nonceA, 42, 4 * 1024 ** 2, 4 * 1024 ** 2, 'completed')]) })
  assert.equal(result.text, '下载已保存 · 4.0 / 4.0 MiB')
  assert.equal(result.announce, true)
  // Late active Snapshot cannot rewind terminal success.
  await act(async () => { emit([mk(nonceA, 42, 1, 4 * 1024 ** 2)]) })
  assert.equal(result.text, '下载已保存 · 4.0 / 4.0 MiB')

  await act(async () => {
    mounted.update(React.createElement(Harness, { owner: ownerB, nodeID: 42 }))
  })
  assert.equal(result.text, '', 'Owner replacement makes old receipt invisible synchronously')
  assert.equal(listeners.size, 0, 'old subscription removed on Owner switch')
  await act(async () => {
    mounted.update(React.createElement(Harness, { owner: ownerAReturn, nodeID: 42 }))
  })
  assert.equal(result.text, '', 'A→B→A must not reuse the previous Owner object')
  await act(async () => { id = result.claim(); await Promise.resolve() })
  assert.equal(id, nonceB)
  await act(async () => { emit([mk(nonceA, 42, 100, 100), mk(nonceB, 42, 80, 0)]) })
  assert.equal(result.text, '下载中 · 80 B', 'unknown total must never invent a percent')
  await act(async () => { result.dismiss(nonceA) })
  assert.match(result.text, /80 B/, 'stale action cannot dismiss a new download')
  await act(async () => { result.dismiss(nonceB) })
  assert.equal(result.text, '')
  assert.equal(listeners.size, 0, 'dismissed/SaveDialog-cancelled intent releases subscriptions')
  await act(async () => { mounted.unmount() })
  assert.equal(listeners.size, 0)
})

test('transfer stage label is based on actual Agent Task, never filename, local path or invented bytes', () => {
  assert.equal(xDriveViewerAgentTransferLabel(mk('z', 1, 0, 0)), '正在等待下载…')
  assert.equal(xDriveViewerAgentTransferLabel(mk('z', 1, 1024, 0)), '下载中 · 1.0 KiB')
  assert.equal(xDriveViewerAgentTransferLabel(mk('z', 1, 0, 0, 'queued')), '正在准备下载…')
  assert.equal(xDriveViewerAgentTransferLabel(mk('z', 1, 1024, 0, 'failed')), '下载失败，请在任务中心查看')
  assert.equal(xDriveViewerAgentTransferLabel(mk('z', 1, 0, 0, 'cancelled')), '下载已取消')
  assert.equal(xDriveViewerAgentTransferLabel(mk('z', 1, 0, 0, 'handed_off')),
    '下载已交给系统，请确认保存结果')
})

test('Desktop Viewer reuses exact Agent download channel and shared Gallery action lifecycle', () => {
  assert.match(desktop, /globalThis\.crypto\.getRandomValues\(new Uint8Array\(16\)\)/)
  // Old Agent without advertised correlation still downloads normally,
  // but the Viewer doesn't construct a fake receipt or send opt-in IDs.
  assert.match(desktop, /downloadCorrelationSupported = false/)
  // An Agent capability without a secure Renderer CSPRNG must not create
  // a fake receipt or prevent the ordinary native SaveDialog download.
  assert.match(desktop, /downloadCorrelationSupported && typeof globalThis\.crypto\?\.getRandomValues === 'function'/)
  assert.match(desktop, /\? \{ viewerDownloadReceipt:/)
  assert.match(desktopApp, /capabilities\.includes\('transfer-download-correlation'\)/)
  assert.match(desktopApp, /window\.xdriveDesktop\.agent, mediaSelectionJobsSupported,\s*viewerDownloadCorrelationSupported/)
  assert.match(agentHello, /capabilities = append\(capabilities, "transfer-download-correlation"\)/)
  assert.match(desktop, /downloadItems: \(items, clientRequestID\)/)
  assert.match(desktop, /agent\.cloudDownload\(items\[0\]\.node\.id, items\[0\]\.node\.name, clientRequestID\)/)
  assert.match(desktop, /subscribe: listener => agent\.onTransfers\(snapshot => listener\(snapshot\.transfers\)\)/)
  // Desktop preload public API is getTransfers(): Promise<AgentTransfers>.
  assert.match(desktop, /const snapshot = await agent\.getTransfers\(\)/)
  assert.match(desktop, /return snapshot\.transfers/)
  assert.doesNotMatch(desktop, /agent\.transfers\(\)/)
  assert.match(adapter, /viewerDownloadReceipt: port\.viewerDownloadReceipt/)
  assert.match(adapter, /resolveXDriveTransport\(port\.downloadItems!\(items, clientRequestID\)\)/)
  assert.match(gallery, /onDownloadItems\(\[item\], clientRequestID\)/)
  assert.match(gallery, /viewerDownloadReceipt=\{viewerDownloadReceipt\}/)
  assert.match(sharedViewer, /useXDriveViewerDownloadReceipt\(/)
  assert.match(sharedViewer, /run\('download', async \(\) =>/)
  assert.match(sharedViewer, /outcome && outcome\.saved === false/)
  assert.equal((sharedViewer.match(/downloadCurrent\(\)/g) || []).length, 2,
    'both wide and narrow Gallery download controls must share one download action')
  assert.match(sharedViewer, /data-xdrive-viewer-agent-download-progress/)
  assert.match(sharedViewer, /position: 'absolute'/)
  assert.match(sharedViewer, /pointerEvents: 'none'/)
  assert.match(sharedViewer, /aria-live=\{downloadReceipt\.announce \? 'polite' : 'off'\}/)
  assert.doesNotMatch(sharedViewer, /transfers\.find\([^]*file_name ===/,
    'never infer exact Task Center ownership by displayed file name')
})


test('no WebCrypto correlation port keeps Viewer action in legacy download mode', async () => {
  const owner = {}
  let result
  const Harness = () => {
    result = useXDriveViewerDownloadReceipt(undefined, owner, 42)
    return null
  }
  let mounted
  try {
    await act(async () => { mounted = create(React.createElement(Harness)) })
    assert.equal(result.claim(), undefined,
      'without a secure correlation port, never invent a weak nonce')
    assert.equal(result.text, '', 'do not show unverified progress')
    assert.equal(result.announce, false)
    // Gallery's original onDownload(item, undefined) and Quick Look's
    // action.onSelect remain the unchanged native Agent SaveDialog path.
    assert.match(gallery, /onDownloadItems\(\[item\], clientRequestID\)/)
    assert.match(desktop, /agent\.cloudDownload\(items\[0\]\.node\.id, items\[0\]\.node\.name, clientRequestID\)/)
  } finally { if (mounted) await act(async () => { mounted.unmount() }) }
})
