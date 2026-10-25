'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const filename = path.resolve(__dirname, '../../ui/shared/src/mui/FileQuickLookDialog.tsx')
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText

const Button = React.forwardRef(({ children, ...props }, ref) =>
  React.createElement('button', { ...props, ref }, children))
const simpleHost = tag => React.forwardRef(({ children, ...props }, ref) =>
  React.createElement(tag, { ...props, ref }, children))
const moduleResult = { exports: {} }
const previewLifecycle = []
const resolve = name => {
  if (name === 'react' || name === 'react/jsx-runtime') return require(name)
  if (name.startsWith('@mui/icons-material/')) return () => null
  if (name === '@mui/material') return {
    IconButton: Button, Stack: simpleHost('div'),
    Tooltip: simpleHost('tooltip'), Typography: simpleHost('span'),
  }
  if (name === '../file-preview') return { xDriveClassifyFilePreview: () => 'image' }
  if (name === './FilePreviewSurface') return {
    XDriveFilePreviewSurface: function PreviewSurface(props) {
      React.useEffect(() => {
        previewLifecycle.push('mount:' + props.target?.id)
        return () => previewLifecycle.push('dispose:' + props.target?.id)
      }, [])
      return React.createElement('preview-content', props)
    },
  }
  if (name === './FileOpenPreviewDialog') return {
    XDriveOpenPreviewDialog: ({ actions, children, ...props }) =>
      React.createElement('viewer-shell', props, actions, children),
  }
  if (name === './usePreviewSlideshow') return {
    useXDrivePreviewPresentation: () => ({
      sourceKey: 'still', presentationState: 'loading',
      onPresentationStateChange() {},
    }),
    useXDrivePreviewSlideshow() {},
  }
  throw new Error('unexpected Quick Look module: ' + name)
}
new Function('exports', 'module', 'require', output)(
  moduleResult.exports, moduleResult, resolve)
const { XDriveFileQuickLookDialog: QuickLook } = moduleResult.exports

async function mounted(run) {
  previewLifecycle.length = 0
  const calls = []
  let props = {
    open: true,
    item: { id: 7, revision: 1, name: 'photo.jpg', kind: 'file' },
    canPrevious: true, canNext: true,
    onPrevious: () => calls.push('previous'),
    onNext: () => calls.push('next'),
    onClose: () => calls.push('close'),
    actions: [{
      id: 'download', label: '下载',
      onSelect: () => calls.push('download'),
    }],
  }
  let tree
  try {
    await act(async () => {
      tree = create(React.createElement(QuickLook, props))
    })
    const shell = () => tree.root.findByType('viewer-shell').props
    const download = () => tree.root.findAllByType('button')
      .find(node => node.props['aria-label'] === '下载').props.onClick
    const update = async (patch) => {
      props = { ...props, ...patch }
      await act(async () => tree.update(React.createElement(QuickLook, props)))
    }
    const unmount = async () => {
      await act(async () => tree.unmount())
      tree = null
    }
    const preview = () => tree.root.findByType('preview-content').props
    await run({ calls, shell, preview, download, update, unmount })
  } finally {
    if (tree) await act(async () => tree.unmount())
  }
}

test('old Quick Look actions and arrows cannot control a later A-B-A visit', async () => {
  await mounted(async ({ calls, shell, download, update }) => {
    const oldAction = download()
    const oldNext = shell().onNext
    const oldPrevious = shell().onPrevious
    const oldClose = shell().onClose
    const oldFullscreen = shell().onFullScreenChange
    const initialSession = shell().chromeSessionKey
    await update({ item: { id: 8, revision: 1, name: 'another.jpg', kind: 'file' } })
    await update({ item: { id: 7, revision: 1, name: 'photo.jpg', kind: 'file' } })
    assert.notEqual(shell().chromeSessionKey, initialSession)
    await act(async () => {
      oldAction(); oldNext(); oldPrevious(); oldClose(); oldFullscreen(true)
    })
    assert.deepEqual(calls, [], 'revisited A must reject events captured by the original A')
    assert.equal(shell().fullScreen, false, 'old Fullscreen action must not change the new Viewer')
    await act(async () => {
      download()()
      shell().onNext()
      shell().onPrevious()
      shell().onClose()
    })
    assert.deepEqual(calls, ['download', 'next', 'previous', 'close'])
  })
})

test('closing and reopening the same Node retires queued Quick Look actions', async () => {
  await mounted(async ({ calls, shell, download, update }) => {
    const oldAction = download()
    const oldNext = shell().onNext
    const oldClose = shell().onClose
    const oldSession = shell().chromeSessionKey
    await update({ open: false })
    await update({ open: true })
    assert.notEqual(shell().chromeSessionKey, oldSession,
      'same Node/revision still needs a new action session after a close')
    await act(async () => { oldAction(); oldNext(); oldClose() })
    assert.deepEqual(calls, [])
    await act(async () => { download()(); shell().onNext() })
    assert.deepEqual(calls, ['download', 'next'])
  })
})

test('rebound Owner/Agent loader retires old events without disabling new ones', async () => {
  await mounted(async ({ calls, shell, download, update }) => {
    const oldAction = download()
    const oldNext = shell().onNext
    const oldSession = shell().chromeSessionKey
    await update({ loadPreviewURL: async () => null })
    assert.notEqual(shell().chromeSessionKey, oldSession)
    await act(async () => { oldAction(); oldNext() })
    assert.deepEqual(calls, [], 'previous Owner cannot trigger actions on the new source')
    await act(async () => { download()(); shell().onNext() })
    assert.deepEqual(calls, ['download', 'next'])
    await update({ actions: [{
      id: 'download', label: '下载', disabled: true,
      onSelect: () => calls.push('disabled'),
    }] })
    await act(async () => download()())
    assert.deepEqual(calls, ['download', 'next'], 'disabled action must not dispatch')
  })
})

test('unmounted Quick Look cannot dispatch queued actions or navigation', async () => {
  await mounted(async ({ calls, shell, download, unmount }) => {
    const oldAction = download()
    const oldNext = shell().onNext
    const oldClose = shell().onClose
    await unmount()
    await act(async () => { oldAction(); oldNext(); oldClose() })
    assert.deepEqual(calls, [], 'retired component actions must be inert after unmount')
  })
})

test('current disabled action and missing neighbor fence earlier queued callbacks', async () => {
  await mounted(async ({ calls, shell, download, update }) => {
    const staleAction = download()
    const staleNext = shell().onNext
    const enabled = () => calls.push('enabled')
    await update({ actions: [{ id: 'download', label: '下载', disabled: true,
      onSelect: enabled }], canNext: false })
    await act(async () => { staleAction(); staleNext() })
    assert.deepEqual(calls, [], 'capabilities revoked without Node change still block old callbacks')
    await update({ actions: [{ id: 'download', label: '下载', onSelect: enabled }],
      canNext: true, onNext: () => calls.push('current-next') })
    await act(async () => { staleNext(); download()(); shell().onNext() })
    assert.deepEqual(calls, ['enabled', 'current-next'],
      'stale navigation is fenced; current authorized controls remain functional')
  })
})

test('same-Node Owner/Agent loader replacement releases the old preview lease', async () => {
  await mounted(async ({ shell, update }) => {
    assert.deepEqual(previewLifecycle, ['mount:7'])
    const session = shell().chromeSessionKey
    await update({ actions: [{ id: 'download', label: '下载',
      onSelect() {} }] })
    assert.equal(shell().chromeSessionKey, session,
      'unrelated toolbar rerender preserves the active decoded preview')
    assert.deepEqual(previewLifecycle, ['mount:7'],
      'unrelated UI rerender must not remount the Preview Engine')
    await update({ loadPreviewURL: async () => null })
    assert.notEqual(shell().chromeSessionKey, session)
    assert.deepEqual(previewLifecycle, ['mount:7', 'dispose:7', 'mount:7'],
      'old source must unmount and release preview tickets/requests before new source')
  })
})

test('Quick Look touch swipes reject old A-B-A, revoked neighbor and rebind callbacks', async () => {
  await mounted(async ({ calls, preview, update }) => {
    const originalSwipeNext = preview().onSwipeNext
    const originalSwipePrevious = preview().onSwipePrevious
    assert.equal(typeof originalSwipeNext, 'function')
    assert.equal(typeof originalSwipePrevious, 'function')
    await update({ item: { id: 8, revision: 1, name: 'other.jpg', kind: 'file' } })
    await update({ item: { id: 7, revision: 1, name: 'photo.jpg', kind: 'file' } })
    await act(async () => { originalSwipeNext(); originalSwipePrevious() })
    assert.deepEqual(calls, [], 'old A swipe cannot navigate a revisited A')
    const activeNext = preview().onSwipeNext
    await update({ canNext: false })
    await act(async () => activeNext())
    assert.deepEqual(calls, [], 'current neighbor revocation must invalidate queued swipe')
    await update({ canNext: true })
    const priorSourceSwipe = preview().onSwipeNext
    await update({ loadPreviewURL: async () => null })
    await act(async () => priorSourceSwipe())
    assert.deepEqual(calls, [], 'previous Agent/Owner source may not navigate by swipe')
    await act(async () => { preview().onSwipeNext(); preview().onSwipePrevious() })
    assert.deepEqual(calls, ['next', 'previous'])
  })
})

test('Quick Look touch swipes are inert after the Viewer is unmounted', async () => {
  await mounted(async ({ calls, preview, unmount }) => {
    const formerSwipe = preview().onSwipeNext
    await unmount()
    await act(async () => formerSwipe())
    assert.deepEqual(calls, [])
  })
})
