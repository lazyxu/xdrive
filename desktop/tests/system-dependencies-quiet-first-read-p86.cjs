'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { buildSync } = require('esbuild')
const React = require('react')
const { act, create } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/ServiceDependenciesPage.tsx')
const sourceText = fs.readFileSync(filename, 'utf8')
const requireDesktop = createRequire(path.join(root, 'desktop/package.json'))
function loadOriginalPage() {
  const bundle = buildSync({
    entryPoints: [filename], bundle: true, write: false, platform: 'node',
    format: 'cjs', packages: 'external', jsx: 'automatic', logLevel: 'silent',
  }).outputFiles[0].text
  const module = { exports: {} }
  const load = name => name.startsWith('@mui/icons-material/')
    ? requireDesktop(name).default : requireDesktop(name)
  new Function('module', 'exports', 'require', bundle)(module, module.exports, load)
  return module.exports.XDriveServiceDependenciesPage
}
const Page = loadOriginalPage()
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(source) {
  // Original React page, MUI default theme, no fabricated browser head.
  return React.createElement(Page, { source })
}
function host(renderer, key) {
  return renderer.root.findAll(entry => typeof entry.type === 'string' &&
    entry.props[key] !== undefined)
}
const quietSlot = renderer => host(renderer, 'data-xdrive-system-dependencies-cold-slot')
const realOverview = renderer => host(renderer, 'data-xdrive-system-dependencies-overview')
const statusText = renderer => host(renderer, 'data-xdrive-system-dependencies-quiet-status')

test('P86 source: real health GET stays immediate, but no navigation-only intermediate loading frame', () => {
  assert.ok(sourceText.includes('void source.load().then((next) => {'))
  assert.ok(sourceText.includes('setSnapshot(next)'))
  assert.ok(sourceText.includes('const snapshot = snapshotSourceRef.current === source ? snapshotState : null'))
  assert.ok(sourceText.includes('const visibleError = snapshotSourceRef.current === source ? error :'))
  assert.ok(sourceText.includes('sx={{ minHeight: 180, display: \'grid\', placeItems: \'center\' }}'))
  assert.ok(sourceText.includes('aria-busy={coldReadPending || undefined}'))
  assert.ok(sourceText.includes('sx={{ minWidth: 112 }}'))
  assert.ok(sourceText.includes('aria-busy={refreshing || undefined}'))
  for (const forbidden of ['正在检查服务…', '正在加载服务状态',
    'CircularProgress', "{refreshing ? '正在刷新…' : '刷新状态'}"]) {
    assert.equal(sourceText.includes(forbidden), false, 'decorative refresh/first-read UI: ' + forbidden)
  }
})

test('P86 original mounted shared page: cold first GET is silently busy past 365ms, then renders verified service overview', async () => {
  const oldWindow = global.window, oldDocument = global.document
  global.window = { addEventListener() {}, removeEventListener() {},
    setTimeout, clearTimeout }
  global.document = { addEventListener() {}, removeEventListener() {},
    getElementById() { return null }, querySelector() { return null }, visibilityState: 'visible' }
  const held = deferred()
  const source = { load: () => held.promise }
  let renderer
  try {
    await act(async () => { renderer = create(fixture(source)) })
    assert.equal(quietSlot(renderer).length, 1)
    const firstSlot = quietSlot(renderer)[0]
    assert.equal(firstSlot.props['aria-busy'], true)
    assert.equal(realOverview(renderer).length, 0, 'unknown is not an authenticated zero')
    assert.equal(statusText(renderer).length, 1)
    assert.equal(host(renderer, 'aria-label').filter(x =>
      x.props['aria-label'] === '正在加载服务状态').length, 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 370)) })
    assert.equal(quietSlot(renderer)[0], firstSlot)
    assert.equal(firstSlot.props['aria-busy'], true)
    await act(async () => {
      held.resolve({ services: [], checked_at: '2026-10-19T00:00:00Z' })
      await held.promise
    })
    assert.equal(quietSlot(renderer).length, 0, 'authorized status replaces the quiet surface once')
    assert.equal(realOverview(renderer).length, 1, 'only accepted snapshot opens capability overview')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.window = oldWindow
    global.document = oldDocument
  }
})

test('P86 owner API change never displays previous account status in pending frame', async () => {
  const oldWindow = global.window, oldDocument = global.document
  global.window = { addEventListener() {}, removeEventListener() {},
    setTimeout, clearTimeout }
  global.document = { addEventListener() {}, removeEventListener() {},
    getElementById() { return null }, querySelector() { return null }, visibilityState: 'visible' }
  const held = deferred()
  const sourceA = { load: async () => ({ services: [], checked_at: '2026-10-19T00:00:00Z' }) }
  const sourceB = { load: () => held.promise }
  let renderer
  try {
    await act(async () => { renderer = create(fixture(sourceA)) })
    assert.equal(realOverview(renderer).length, 1)
    await act(async () => { renderer.update(fixture(sourceB)) })
    assert.equal(realOverview(renderer).length, 0, 'cross-account inventory is not visible')
    assert.equal(quietSlot(renderer).length, 1)
    assert.equal(quietSlot(renderer)[0].props['aria-busy'], true)
    await act(async () => {
      held.reject(new Error('服务器无法访问'))
      await held.promise.catch(() => undefined)
    })
    assert.equal(quietSlot(renderer).length, 1, 'terminal error keeps the 180px floor')
    assert.equal(quietSlot(renderer)[0].props['aria-busy'], undefined)
    assert.ok(renderer.root.findAll(x => x.props.role === 'alert').length > 0,
      'real read failure remains accessible')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    global.window = oldWindow
    global.document = oldDocument
  }
})
