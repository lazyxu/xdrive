'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')
const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const compile = (source, name, deps = {}) => {
  const js = ts.transpileModule(source, {
    fileName: name,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText
  const result = { exports: {} }
  new Function('exports', 'module', 'require', js)(result.exports, result, name => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name)
    if (name.startsWith('@mui/icons-material/')) return () => null
    if (Object.hasOwn(deps, name)) return deps[name]
    throw Error('Unexpected exact Quick Look dependency: ' + name)
  })
  return result.exports
}
const host = tag => React.forwardRef(({ children, ...props }, ref) =>
  React.createElement(tag, { ...props, ref }, children))
const Mui = {
  Box: host('div'), Stack: host('div'), IconButton: host('button'),
  Tooltip: host('tooltip'), Typography: host('span'),
  CircularProgress: host('span'),
}
const progress = compile(read('ui/shared/src/mui/MediaLoadProgress.tsx'),
  'MediaLoadProgress.tsx', { '@mui/material': Mui })
const receipt = compile(read('ui/shared/src/mui/useViewerDownloadReceipt.ts'),
  'useViewerDownloadReceipt.ts', {
    './MediaLoadProgress': { xDriveMediaByteProgressLabel: progress.xDriveMediaByteProgressLabel },
  })
const QuickLook = compile(read('ui/shared/src/mui/FileQuickLookDialog.tsx'),
  'FileQuickLookDialog.tsx', {
    '@mui/material': Mui,
    '../file-preview': { xDriveClassifyFilePreview: () => 'image' },
    './useViewerDownloadReceipt': receipt,
    './FilePreviewSurface': { XDriveFilePreviewSurface: host('preview-content') },
    './FileOpenPreviewDialog': {
      XDriveOpenPreviewDialog: ({ actions, children, ...props }) =>
        React.createElement('viewer-shell', props, actions, children),
    },
    './usePreviewSlideshow': {
      useXDrivePreviewPresentation: () => ({
        sourceKey: 'image', presentationState: 'loading', onPresentationStateChange() {},
      }),
      useXDrivePreviewSlideshow() {},
    },
  }).XDriveFileQuickLookDialog

function downloadPort() {
  const listeners = new Set()
  let nonceSequence = 0
  const ids = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)]
  let tasks = []
  return {
    port: {
      createRequestID: () => ids[nonceSequence++],
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      snapshot: async () => tasks,
    },
    count: () => listeners.size,
    emit(items) { tasks = items; for (const fn of listeners) fn(items) },
  }
}
function task(nonce, nodeID, done, total, state = 'running') {
  return {
    id: 'download-' + nonce, client_request_id: nonce, cloud_node_id: nodeID,
    kind: 'download', direction: 'download', state,
    bytes_done: done, bytes_total: total,
  }
}
const item = id => ({ id, revision: 1, name: 'identical.jpg', kind: 'file' })

test('mounted Desktop Files Quick Look exact nonce remains private across files, duplicate taps, Back and A→B→A', async () => {
  const agent = downloadPort(), legacy = []
  const pending = []
  const calls = []
  let props = {
    open: true,
    item: item(77),
    viewerDownloadReceipt: agent.port,
    onDownloadWithReceipt: async (value, nonce) => {
      calls.push([value.id, nonce])
      return await new Promise(resolve => pending.push(resolve))
    },
    actions: [{ id: 'download', label: '下载', onSelect: () => legacy.push('fallback') }],
    onClose() {},
  }
  let renderer
  const click = () => renderer.root.findAllByType('button')
    .find(button => button.props['aria-label'] === '下载').props.onClick()
  const label = () => renderer.root.findAll(node =>
    node.props['data-xdrive-quicklook-download-progress'] !== undefined)
    .map(node => node.findAllByType('span').map(span => span.children.join('')).join('')).at(0) ?? ''
  try {
    await act(async () => { renderer = create(React.createElement(QuickLook, props)) })
    const oldClick = renderer.root.findAllByType('button')
      .find(button => button.props['aria-label'] === '下载').props.onClick
    assert.equal(agent.count(), 0)
    await act(async () => { click(); click(); await Promise.resolve() })
    assert.equal(calls.length, 1, 'same-tick duplicate click must start only one SaveDialog')
    assert.equal(agent.count(), 1, 'only open Viewer with a claimed nonce subscribes')
    assert.equal(label(), '正在准备下载…')
    await act(async () => { agent.emit([task('b'.repeat(32), 77, 1024 ** 2, 1024 ** 2)]) })
    assert.equal(label(), '正在准备下载…', 'same filename cannot borrow another task')
    await act(async () => { agent.emit([task('a'.repeat(32), 77, 1024 ** 2, 4 * 1024 ** 2)]) })
    assert.equal(label(), '下载中 · 1.0 / 4.0 MiB')
    await act(async () => {
      props = { ...props, item: item(78) }
      renderer.update(React.createElement(QuickLook, props))
    })
    assert.equal(label(), '', 'B must not inherit A progress')
    assert.equal(agent.count(), 0, 'old A listener removed on navigation')
    await act(async () => { oldClick(); await Promise.resolve() })
    assert.equal(calls.length, 1, 'old A action cannot download after navigation')
    await act(async () => {
      props = { ...props, item: item(77) }
      renderer.update(React.createElement(QuickLook, props))
    })
    assert.equal(label(), '', 'A→B→A starts a new Owner session')
    await act(async () => { click(); await Promise.resolve() })
    assert.deepEqual(calls.at(-1), [77, 'b'.repeat(32)])
    await act(async () => { agent.emit([task('a'.repeat(32), 77, 100, 100), task('b'.repeat(32), 77, 512, 0)]) })
    assert.equal(label(), '下载中 · 512 B')
    await act(async () => { pending[1]({ saved: false }); await Promise.resolve() })
    assert.equal(label(), '', 'native SaveDialog cancel must dismiss phantom task')
    assert.equal(agent.count(), 0)
    await act(async () => {
      props = { ...props, open: false }
      renderer.update(React.createElement(QuickLook, props))
    })
    assert.equal(agent.count(), 0)
    await act(async () => { pending[0]({ saved: true }); await Promise.resolve() })
    assert.equal(label(), '', 'late old download completion cannot paint a closed Viewer')
    assert.deepEqual(legacy, [])
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
  }
})

test('older Desktop Agent keeps original Quick Look download action without claiming nonce', async () => {
  let oldClicks = 0, correlatedCalls = 0
  const agent = downloadPort()
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(QuickLook, {
        open: true, item: item(23), actions: [{
          id: 'download', label: '下载', onSelect: () => { oldClicks++ },
        }],
        // Old Agent capability absent; this cannot start correlated transports.
        onDownloadWithReceipt: async () => { correlatedCalls++ },
        onClose() {},
      }))
    })
    await act(async () => renderer.root.findAllByType('button')
      .find(node => node.props['aria-label'] === '下载').props.onClick())
    assert.equal(oldClicks, 1)
    assert.equal(correlatedCalls, 0)
    assert.equal(agent.count(), 0)
  } finally { if (renderer) await act(async () => renderer.unmount()) }
})

test('Files Quick Look integrates exact Agent download with same original storage path', () => {
  const fileExplorer = read('ui/shared/src/mui/FileExplorer.tsx')
  const desktopExplorer = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const desktopApp = read('desktop/src/renderer/App.tsx')
  const quickLook = read('ui/shared/src/mui/FileQuickLookDialog.tsx')
  assert.match(fileExplorer, /viewerDownloadReceipt=\{viewerDownloadReceipt\}/)
  assert.match(fileExplorer, /onDownloadWithReceipt=\{onQuickLookDownloadWithReceipt\}/)
  assert.match(desktopExplorer, /viewerDownloadReceipt=\{trashActive \? undefined : viewerDownloadReceipt\}/)
  assert.match(desktopExplorer, /const node = xDriveFileExplorerNodeForItem\(item, nodeByID\)/)
  assert.match(desktopExplorer, /return downloadNode\(node, clientRequestID\)/)
  assert.match(desktopExplorer, /agent\.cloudDownload\(\s*node\.id, node\.name, clientRequestID/)
  assert.match(desktopApp, /viewerDownloadReceipt: mediaGallerySource\.viewerDownloadReceipt/)
  assert.match(quickLook, /if \(action\.id === 'download'\)/)
  assert.match(quickLook, /if \(!isCurrentChromeOwner\(\)\) \{/)
  assert.match(quickLook, /aria-live=\{downloadReceipt\.announce \? 'polite' : 'off'\}/)
  assert.match(quickLook, /pointerEvents: 'none'/)
  assert.doesNotMatch(quickLook, /fetch\(|xdriveDesktop|setInterval\(/,
    'shared Viewer must never add a new fetch or privileged IPC transport')
  assert.match(read('ui/shared/src/mui/index.tsx'), /export type \{ XDriveViewerDownloadReceiptPort \}/)
})
