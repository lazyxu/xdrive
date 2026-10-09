const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const repo = path.resolve(__dirname, '../..')
const host = React.forwardRef(({ children, ...props }, ref) => React.createElement('div', { ...props, ref }, children))
const shell = ({ actions, children, ...props }) => React.createElement('viewer-shell', props, actions, children)
const preview = (props) => React.createElement('preview-content', props)
function load(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const localRequire = (name) => {
    if (name === '@mui/material') return { IconButton: host, Stack: host, Tooltip: host, Typography: host }
    if (name.startsWith('@mui/icons-material/')) return () => null
    if (name === './FileOpenPreviewDialog') return { XDriveOpenPreviewDialog: shell }
    if (name === './FilePreviewSurface') return { XDriveFilePreviewSurface: preview }
    if (!name.startsWith('.')) return require(name)
    const base = path.resolve(path.dirname(filename), name)
    return load([base + '.ts', base + '.tsx'].find(fs.existsSync), cache)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}
const { XDriveFileQuickLookDialog } = load(path.join(repo, 'ui/shared/src/mui/FileQuickLookDialog.tsx'))

async function scenario(run) {
  let now = 1000
  let timerID = 0
  let nextCalls = 0
  const timers = new Map()
  const oldWindow = global.window
  const oldDocument = global.document
  const oldNow = Date.now
  global.window = {
    setTimeout(callback, delay) { timers.set(++timerID, { callback, at: now + delay }); return timerID },
    clearTimeout(id) { timers.delete(id) },
  }
  global.document = new EventTarget()
  document.visibilityState = 'visible'
  Date.now = () => now
  let renderer
  let props = { open: true, item: { id: 1, revision: 1, name: 'same.jpg', kind: 'file' }, canNext: true, onNext: () => { nextCalls++ }, onClose() {} }
  const advance = async (ms) => {
    const end = now + ms
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at
      timers.delete(due[0])
      await act(async () => due[1].callback())
    }
    now = end
  }
  try {
    await act(async () => { renderer = create(React.createElement(XDriveFileQuickLookDialog, props)) })
    await act(async () => renderer.root.findByType('viewer-shell').props.onFullScreenChange(true))
    const start = renderer.root.findAllByProps({ 'aria-label': '开始幻灯片' }).find((entry) => entry.type === host)
    await act(async () => start.props.onClick())
    await run({
      renderer, advance, calls: () => nextCalls,
      report: () => renderer.root.findByType('preview-content').props.onPresentationStateChange,
      ready: async (state = 'ready') => act(async () => renderer.root.findByType('preview-content').props.onPresentationStateChange(state)),
      update: async (patch) => {
        props = { ...props, ...patch }
        await act(async () => renderer.update(React.createElement(XDriveFileQuickLookDialog, props)))
      },
      visibility: async (value) => act(async () => {
        document.visibilityState = value
        document.dispatchEvent(new Event('visibilitychange'))
      }),
    })
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    Date.now = oldNow
    global.window = oldWindow
    global.document = oldDocument
  }
}

test('Quick Look gives the first usable frame a full dwell after loading', async () => scenario(async ({ advance, calls, ready }) => {
  await advance(15000)
  assert.equal(calls(), 0, 'loading must not consume slideshow dwell')
  await ready()
  await advance(4999)
  assert.equal(calls(), 0)
  await advance(1)
  assert.equal(calls(), 1)
}))

test('slideshow pauses buffering and resumes only the remaining ready time', async () => scenario(async ({ advance, calls, ready }) => {
  await ready()
  await advance(2000)
  await ready('loading')
  await advance(10000)
  assert.equal(calls(), 0)
  await ready()
  await advance(2999)
  assert.equal(calls(), 0)
  await advance(1)
  assert.equal(calls(), 1)
}))

test('hidden tabs do not consume slideshow dwell', async () => scenario(async ({ advance, calls, ready, visibility }) => {
  await ready()
  await advance(2000)
  await visibility('hidden')
  await advance(20000)
  assert.equal(calls(), 0)
  await visibility('visible')
  await advance(3000)
  assert.equal(calls(), 1)
}))

test('completed dwell cannot advance twice while navigation is still resolving', async () => scenario(async ({ advance, calls, ready, visibility, update }) => {
  await ready()
  await advance(5000)
  assert.equal(calls(), 1)
  await visibility('hidden')
  await advance(200)
  await visibility('visible')
  await advance(0)
  assert.equal(calls(), 1, 'visibility must not repeat an already requested navigation')
  await ready('loading')
  await ready()
  await advance(10000)
  assert.equal(calls(), 1, 'buffering must not repeat an already requested navigation')
  await update({ item: { id: 2, revision: 1, name: 'next.jpg', kind: 'file' } })
  await ready()
  await advance(5000)
  assert.equal(calls(), 2, 'the next source receives its own dwell')
}))

test('same-name items and late readiness do not inherit the previous dwell', async () => scenario(async ({ advance, calls, ready, report, update }) => {
  await ready()
  const oldReport = report()
  await advance(2000)
  await update({ item: { id: 2, revision: 1, name: 'same.jpg', kind: 'file' } })
  await act(async () => oldReport('ready'))
  await advance(10000)
  assert.equal(calls(), 0)
  await ready()
  await advance(5000)
  assert.equal(calls(), 1)
}))

test('callback replacement does not restart dwell and uses the latest callback', async () => scenario(async ({ advance, calls, ready, update }) => {
  let latest = 0
  await ready()
  await advance(2000)
  await update({ onNext: () => latest++ })
  await advance(3000)
  assert.equal(calls(), 0)
  assert.equal(latest, 1)
}))

test('a failed presentation stops the slideshow without silently skipping it', async () => scenario(async ({ renderer, advance, calls, ready }) => {
  await ready('failed')
  await advance(10000)
  assert.equal(calls(), 0)
  assert.ok(renderer.root.findAllByProps({ 'aria-label': '开始幻灯片' }).length)
}))
