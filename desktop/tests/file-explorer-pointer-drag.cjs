const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')
const repo = path.resolve(__dirname, '../..')
const projectRequire = createRequire(path.join(repo, 'desktop/package.json'))
const React = projectRequire('react')
const Renderer = projectRequire('react-test-renderer')
const { buildSync } = projectRequire('esbuild')
const sourcePath = process.env.XDRIVE_POINTER_DRAG_SOURCE || path.join(repo, 'ui/shared/src/mui/usePointerDrag.ts')
const output = buildSync({ entryPoints: [sourcePath], bundle: true,
  packages: 'external', platform: 'node', format: 'cjs', write: false, logLevel: 'silent' }).outputFiles[0].text
const compiled = { exports: {} }
new Function('module', 'exports', 'require', output)(compiled, compiled.exports, projectRequire)
const { useXDrivePointerDrag } = compiled.exports

class Surface extends EventTarget {
  constructor() { super(); this.listeners = new Map() }
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options)
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }
  removeEventListener(type, listener, options) {
    // Node EventTarget requires the object form to remove capture listeners.
    super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options)
    this.listeners.get(type)?.delete(listener)
  }
  get count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0) }
}
function event(type, values = {}) {
  const value = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(value, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
    clientX: 100, clientY: 100, detail: type === 'click' ? 1 : 0 }, values)
  return value
}
async function mount(extra = {}) {
  const document = new Surface()
  const view = new Surface()
  view.innerWidth = 1000; view.innerHeight = 800
  const frames = new Map(); const timers = new Map(); let serial = 0
  view.requestAnimationFrame = fn => { const id = ++serial; frames.set(id, fn); return id }
  view.cancelAnimationFrame = id => frames.delete(id)
  view.setTimeout = fn => { const id = ++serial; timers.set(id, fn); return id }
  view.clearTimeout = id => timers.delete(id)
  document.defaultView = view
  const capture = new Set()
  const owner = new Surface()
  owner.ownerDocument = document
  owner.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 300 })
  owner.setPointerCapture = id => capture.add(id)
  owner.hasPointerCapture = id => capture.has(id)
  owner.releasePointerCapture = id => capture.delete(id)
  const host = { getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 200 }), value: 0,
    get scrollTop() { return this.value }, set scrollTop(value) { this.value = Math.max(0, Math.min(600, value)) } }
  const moves = []; const drops = []; const cancellations = []
  let api; let renderer
  let props = { ownerRef: { current: owner }, scrollHostRef: { current: host }, enabled: true, scopeKey: 'A',
    autoScrollDelta: (y, top, bottom) => y > bottom - 20 ? 12 : y < top + 20 ? -12 : 0,
    onMove: (source, point) => moves.push({ source, point, scrollTop: host.scrollTop }),
    onDrop: (source, point) => drops.push({ source, point, captured: capture.size, frames: frames.size }),
    onCancel: source => cancellations.push(source), ...extra }
  function Harness(options) { api = useXDrivePointerDrag(options); return null }
  await Renderer.act(async () => { renderer = Renderer.create(React.createElement(Harness, props)) })
  return {
    document, view, owner, host, frames, timers, capture, moves, drops, cancellations,
    get active() { return api.active },
    async begin(source = Object.freeze({ ids: [101, 202] }), values = {}) {
      const input = event('pointerdown', values)
      Object.defineProperty(input, 'currentTarget', { value: owner })
      let accepted
      await Renderer.act(async () => { accepted = api.begin(input, source) })
      return { accepted, input, source }
    },
    async emit(type, values = {}, target = document) {
      const input = event(type, values)
      await Renderer.act(async () => { target.dispatchEvent(input) })
      return input
    },
    async frame() { const callbacks = [...frames.values()]; frames.clear(); await Renderer.act(async () => callbacks.forEach(fn => fn(16))) },
    async flushTimers() { const callbacks = [...timers.values()]; timers.clear(); await Renderer.act(async () => callbacks.forEach(fn => fn())) },
    async cancel() { await Renderer.act(async () => api.cancel()) },
    async update(next) { props = { ...props, ...next }; await Renderer.act(async () => renderer.update(React.createElement(Harness, props))) },
    async dispose() { await Renderer.act(async () => renderer.unmount()) },
  }
}

test('a pending handle tap keeps its normal click and never submits a drag', async () => {
  const h = await mount()
  try {
    const { accepted, input } = await h.begin()
    assert.equal(accepted, true); assert.equal(input.defaultPrevented, false)
    await h.emit('pointermove', { clientX: 103 })
    assert.equal(h.active, false); assert.equal(h.capture.size, 0)
    await h.emit('pointerup', { clientX: 103 })
    assert.equal((await h.emit('click', { clientX: 103 })).defaultPrevented, false)
    assert.equal(h.drops.length, 0); assert.equal(h.document.count, 0)
  } finally { await h.dispose() }
})

test('non-finite pointer motion cannot activate or replace the last valid drag point', async () => {
  const h = await mount()
  try {
    await h.begin()
    await h.emit('pointermove', { clientX: Number.NaN })
    assert.equal(h.active, false); assert.equal(h.capture.size, 0)
    assert.equal(h.moves.length, 0)
    await h.emit('pointermove', { clientX: 120 })
    assert.equal(h.active, true)
    const lastMove = h.moves.at(-1)
    await h.emit('pointermove', { clientY: Number.POSITIVE_INFINITY })
    assert.equal(h.moves.at(-1), lastMove)
    await h.emit('pointercancel')
    assert.equal(h.drops.length, 0); assert.equal(h.document.count, 0)
  } finally { await h.dispose() }
})

test('document visibility loss cancels and releases the contact, while a visible notification preserves it', async () => {
  const h = await mount()
  try {
    h.document.hidden = false
    await h.begin(); await h.emit('pointermove', { clientY: 198 })
    await h.emit('visibilitychange')
    assert.equal(h.active, true)
    h.document.hidden = true
    await h.emit('visibilitychange')
    assert.equal(h.active, false); assert.equal(h.capture.size, 0); assert.equal(h.frames.size, 0)
    assert.equal(h.cancellations.length, 1)
    assert.equal(h.document.count, 0); assert.equal(h.view.count, 0)
    await h.emit('pointerup', { clientY: 198 })
    assert.equal(h.drops.length, 0)
    h.document.hidden = false
    const next = await h.begin(undefined, { pointerId: 2 })
    assert.equal(next.accepted, true)
    await h.emit('pointercancel', { pointerId: 2 })
    assert.equal(h.document.count, 0)
  } finally { await h.dispose() }
})

test('an active release cleans capture and frames before one drop, consuming only its compatibility click', async () => {
  const h = await mount()
  try {
    const { source } = await h.begin()
    await h.emit('pointermove', { clientX: 120 })
    assert.equal(h.active, true); assert.equal(h.capture.size, 1)
    await h.emit('pointerup', { clientX: 125, clientY: 110 })
    assert.deepEqual(h.drops, [{ source, point: { clientX: 125, clientY: 110 }, captured: 0, frames: 0 }])
    assert.equal(h.active, false)
    assert.equal((await h.emit('click', { clientX: 125, clientY: 110 })).defaultPrevented, true)
    await h.flushTimers()
    assert.equal((await h.emit('click', { pointerId: 2, clientX: 125, clientY: 110 })).defaultPrevented, false)
    assert.equal(h.document.count, 0)
  } finally { await h.dispose() }
})

for (const reason of ['escape', 'button', 'second-pointer', 'scope', 'disabled', 'lost-capture']) {
  test(`${reason} cancels the active gesture without a drop or a later release activation`, async () => {
    const h = await mount()
    try {
      await h.begin(); await h.emit('pointermove', { clientY: 198 })
      if (reason === 'escape') await h.emit('keydown', { key: 'Escape' })
      if (reason === 'button') await h.cancel()
      if (reason === 'second-pointer') await h.emit('pointerdown', { pointerId: 2, isPrimary: false })
      if (reason === 'scope') await h.update({ scopeKey: 'B' })
      if (reason === 'disabled') await h.update({ enabled: false })
      if (reason === 'lost-capture') await h.emit('lostpointercapture', {}, h.owner)
      assert.equal(h.active, false); assert.equal(h.capture.size, 0); assert.equal(h.frames.size, 0)
      assert.equal(h.cancellations.length, 1)
      await h.emit('pointerup', { clientY: 198 })
      assert.equal(h.drops.length, 0)
      assert.equal((await h.emit('click', { clientY: 198 })).defaultPrevented, true)
      await h.flushTimers(); assert.equal(h.document.count, 0)
    } finally { await h.dispose() }
  })
}

test('pointercancel and unmount remove gesture listeners and scheduled work', async () => {
  const h = await mount()
  await h.begin(); await h.emit('pointermove', { clientY: 198 }); await h.emit('pointercancel')
  assert.equal(h.capture.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.document.count, 0)
  assert.equal(h.cancellations.length, 1); assert.equal(h.drops.length, 0)
  await h.begin(); await h.emit('pointermove', { clientY: 198 }); await h.dispose()
  assert.equal(h.capture.size, 0); assert.equal(h.frames.size, 0)
  await h.emit('pointerup', { clientY: 198 })
  assert.equal((await h.emit('click', { clientY: 198 })).defaultPrevented, true)
  assert.equal(h.document.count, 0)
  assert.equal(h.view.count, 0)
})

test('a threshold-crossing touch may click at its original down coordinate', async () => {
  const h = await mount()
  try {
    await h.begin(undefined, { clientX: 70, clientY: 42 })
    await h.emit('pointermove', { clientX: 79, clientY: 42 })
    await h.emit('pointerup', { clientX: 79, clientY: 42 })
    assert.equal(h.drops.length, 1)
    assert.equal((await h.emit('click', { clientX: 70, clientY: 42 })).defaultPrevented, true)
  } finally { await h.dispose() }
})

test('pending cancel retains only the matching release across tasks and permits the next intentional gesture', async () => {
  const h = await mount()
  try {
    await h.begin(); await h.cancel(); await h.emit('pointerup'); await h.flushTimers()
    assert.equal((await h.emit('click')).defaultPrevented, true)
    assert.equal(h.drops.length, 0); assert.equal(h.cancellations.length, 1)
    await h.emit('pointerdown', { pointerId: 2 })
    assert.equal((await h.emit('click', { pointerId: 2 })).defaultPrevented, false)
    assert.equal(h.document.count, 0)
  } finally { await h.dispose() }
})

test('pending owner unmount consumes its release on replacement chrome without retaining the gesture', async () => {
  const h = await mount()
  await h.begin(); await h.dispose()
  assert.equal(h.capture.size, 0); assert.equal(h.frames.size, 0)
  assert.equal(h.document.listeners.get('pointermove')?.size || 0, 0)
  await h.emit('pointerup'); await h.flushTimers()
  assert.equal((await h.emit('click')).defaultPrevented, true)
  assert.equal(h.drops.length, 0); assert.equal(h.document.count, 0); assert.equal(h.view.count, 0)
})

test('edge scrolling uses the same host, updates hit testing after scroll and stops outside or at the center', async () => {
  const h = await mount()
  try {
    await h.begin(); await h.emit('pointermove', { clientY: 198 }); await h.frame()
    assert.equal(h.host.scrollTop, 12)
    assert.equal(h.moves.at(-1).scrollTop, 12)
    await h.emit('pointermove', { clientX: 400, clientY: 198 }); await h.frame()
    assert.equal(h.host.scrollTop, 12); assert.equal(h.frames.size, 0)
    await h.emit('pointermove', { clientY: 198 }); await h.frame()
    assert.equal(h.host.scrollTop, 24)
    await h.emit('pointermove', { clientY: 100 }); await h.frame()
    assert.equal(h.host.scrollTop, 24); assert.equal(h.frames.size, 0)
  } finally { await h.dispose() }
})
