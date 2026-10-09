const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')
const Box = React.forwardRef(({ component = 'div', children, ...props }, ref) => React.createElement(component, { ...props, ref }, children))
const mui = { Box, Chip: Box, LinearProgress: Box, CircularProgress: Box, IconButton: Box, Stack: Box, Tooltip: Box, Typography: Box, useMediaQuery: () => true }
function load(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }; cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const localRequire = (request) => {
    if (request === '@mui/material') return mui
    if (request.startsWith('@mui/icons-material')) return Box
    if (!request.startsWith('.')) return require(request)
    const base = path.resolve(path.dirname(filename), request)
    const resolved = [base + '.ts', base + '.tsx'].find(fs.existsSync)
    return resolved ? load(resolved, cache) : require(base)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}
const { XDriveFilePreviewSurface } = load(path.join(__dirname, '../../ui/shared/src/mui/FilePreviewSurface.tsx'))
const rect = { left: 0, top: 0, width: 400, height: 300 }
const node = { setPointerCapture() {}, hasPointerCapture() { return true }, releasePointerCapture() {}, getBoundingClientRect() { return { ...rect } } }
const event = (pointerId, x, y, pointerType = 'touch') => ({ pointerId, clientX: x, clientY: y, pointerType, button: 0, currentTarget: node, preventDefault() {} })
const props = { target: { id: 1, revision: 1, name: 'one.jpg', kind: 'file' }, interactiveImage: true, loadPreviewURL: async () => 'https://example.invalid/one.jpg' }
const gesture = (r) => r.root.findAllByProps({ 'data-xdrive-preview-zoom': true }).find(n => n.type === 'div')
const transform = (r) => r.root.findAll(n => n.props.viewportTransform).map(n => n.props.viewportTransform)[0]
const position = (r) => /translate\(([-.\d]+)px, ([-.\d]+)px\) scale\(([-.\d]+)\)/.exec(transform(r)).slice(1).map(Number)
async function mount(width = 400, height = 300, extra = {}) {
  let r
  await act(async () => { r = create(React.createElement(XDriveFilePreviewSurface, { ...props, ...extra }), { createNodeMock: () => node }) })
  await act(async () => r.root.findByType('img').props.onLoad({ currentTarget: { naturalWidth: width, naturalHeight: height, decode: async () => {} } }))
  return r
}
async function tap(r, x, y) { await act(async () => gesture(r).props.onPointerDown(event(1, x, y))); await act(async () => gesture(r).props.onPointerUp(event(1, x, y))) }
async function wheel(r, x, y) { await act(async () => gesture(r).props.onWheel({ ...event(1, x, y, 'mouse'), deltaY: -1 })) }
async function drag(r, x, y) { await act(async () => gesture(r).props.onPointerDown(event(1, 200, 150))); await act(async () => gesture(r).props.onPointerMove(event(1, 200 + x, 150 + y))); await act(async () => gesture(r).props.onPointerUp(event(1, 200 + x, 150 + y))) }
test('double tap anchors zoom at the tap and a second double tap restores 1x', async () => {
  const r = await mount()
  try { await tap(r, 250, 150); await tap(r, 250, 150); assert.deepEqual(position(r), [-50, 0, 2]); await tap(r, 250, 150); await tap(r, 250, 150); assert.deepEqual(position(r), [0, 0, 1]) } finally { await act(async () => r.unmount()) }
})
test('mouse wheel anchors zoom at the actual cursor', async () => {
  const r = await mount()
  try { await wheel(r, 300, 150); const [x, y, scale] = position(r); assert.ok(Math.abs(x + 15) < 0.001); assert.equal(y, 0); assert.equal(scale, 1.15) } finally { await act(async () => r.unmount()) }
})
test('portrait and panorama pan limits use decoded contain-fit dimensions', async () => {
  for (const [width, height, expected] of [[100, 300, [0, 150, 2]], [1200, 100, [200, 0, 2]]]) {
    const r = await mount(width, height)
    try { await tap(r, 200, 150); await tap(r, 200, 150); await drag(r, 2000, 3000); assert.deepEqual(position(r), expected) } finally { await act(async () => r.unmount()) }
  }
})
test('pinch tracks its midpoint and never navigates when either finger releases', async () => {
  let navigation = 0
  const r = await mount(400, 300, { onSwipeNext: () => navigation++ })
  try {
    await act(async () => gesture(r).props.onPointerDown(event(1, 250, 150)))
    await act(async () => gesture(r).props.onPointerDown(event(2, 350, 150)))
    await act(async () => gesture(r).props.onPointerMove(event(2, 450, 150)))
    assert.deepEqual(position(r), [-50, 0, 2])
    await act(async () => gesture(r).props.onPointerUp(event(2, 450, 150)))
    await act(async () => gesture(r).props.onPointerUp(event(1, 100, 150)))
    assert.equal(navigation, 0)
  } finally { await act(async () => r.unmount()) }
})
test('cancel and lost capture do not turn a gesture into navigation', async () => {
  let navigation = 0
  const r = await mount(400, 300, { onSwipeNext: () => navigation++ })
  try { for (const cancel of ['onPointerCancel', 'onLostPointerCapture']) {
    await act(async () => gesture(r).props.onPointerDown(event(1, 300, 150)))
    await act(async () => gesture(r).props[cancel](event(1, 100, 150)))
    await act(async () => gesture(r).props.onPointerUp(event(1, 100, 150)))
  }; assert.equal(navigation, 0) } finally { await act(async () => r.unmount()) }
})
test('viewport resize reclamps the existing zoomed pan without requesting a new source', async () => {
  const originalObserver = global.ResizeObserver
  let resize, calls = 0
  global.ResizeObserver = class { constructor(callback) { resize = callback } observe() {} disconnect() {} }
  const r = await mount(400, 300, { loadPreviewURL: async () => { calls++; return 'https://example.invalid/one.jpg' } })
  try {
    await tap(r, 200, 150); await tap(r, 200, 150); await drag(r, 2000, 3000)
    rect.width = 800
    await act(async () => { resize?.([]) })
    assert.deepEqual(position(r), [0, 150, 2]); assert.equal(calls, 1)
  } finally { rect.width = 400; await act(async () => r.unmount()); global.ResizeObserver = originalObserver }
})
test('a pointer that pans away and back cannot complete a double tap', async () => {
  const r = await mount()
  try {
    await tap(r, 200, 150)
    await act(async () => gesture(r).props.onPointerDown(event(1, 200, 150)))
    await act(async () => gesture(r).props.onPointerMove(event(1, 240, 150)))
    await act(async () => gesture(r).props.onPointerMove(event(1, 200, 150)))
    await act(async () => gesture(r).props.onPointerUp(event(1, 200, 150)))
    assert.deepEqual(position(r), [0, 0, 1])
  } finally { await act(async () => r.unmount()) }
})
test('mouse double click zooms around its cursor and resets at the next double click', async () => {
  const r = await mount()
  try {
    await act(async () => gesture(r).props.onDoubleClick(event(1, 250, 150, 'mouse')))
    assert.deepEqual(position(r), [-50, 0, 2])
    await act(async () => gesture(r).props.onDoubleClick(event(1, 250, 150, 'mouse')))
    assert.deepEqual(position(r), [0, 0, 1])
  } finally { await act(async () => r.unmount()) }
})
test('normal pointer-capture release preserves the first completed tap for a second tap', async () => {
  const r = await mount()
  try {
    for (let i = 0; i < 2; i++) {
      await tap(r, 250, 150)
      await act(async () => gesture(r).props.onLostPointerCapture(event(1, 250, 150)))
    }
    assert.deepEqual(position(r), [-50, 0, 2])
  } finally { await act(async () => r.unmount()) }
})
