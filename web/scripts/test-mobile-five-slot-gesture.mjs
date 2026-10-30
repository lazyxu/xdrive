import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Mount the actual TSX navigation component with lightweight React/MUI mocks.
// This tests genuine event callbacks and timer ownership, not source strings.
const here = dirname(fileURLToPath(import.meta.url))
const gesturePath = resolve(here, '../../ui/shared/src/mobile-item-gesture.ts')
const gestureSource = readFileSync(gesturePath, 'utf8')
const gestureJS = ts.transpileModule(gestureSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(gestureJS.diagnostics?.length ?? 0, 0)
const gesture = { exports: {} }
new Function('module', 'exports', gestureJS.outputText)(gesture, gesture.exports)

const source = readFileSync(resolve(here, '../src/MobileFiveSlotNavigation.tsx'), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'MobileFiveSlotNavigation.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0)
const timers = new Map()
let nextTimer = 0
const schedule = (callback, delay) => {
  assert.equal(delay, gesture.exports.XDRIVE_MOBILE_ITEM_HOLD_MS)
  const id = ++nextTimer
  timers.set(id, callback)
  return id
}
const clear = (id) => { timers.delete(id) }
const fireTimers = () => {
  for (const [id, callback] of [...timers]) {
    timers.delete(id)
    callback()
  }
}
const hooks = []
const cleanups = []
let cursor = 0
const react = {
  useRef(initial) {
    const index = cursor++
    if (!hooks[index]) hooks[index] = { current: initial }
    return hooks[index]
  },
  useEffect(effect) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  },
  useState(initial) {
    const index = cursor++
    if (!hooks[index]) hooks[index] = { current: typeof initial === 'function' ? initial() : initial }
    return [hooks[index].current, (next) => {
      hooks[index].current = typeof next === 'function' ? next(hooks[index].current) : next
    }]
  },
}
const jsx = (type, props) => ({ type, props: props ?? {} })
const material = new Proxy({}, { get: (_target, name) => String(name) })
const module = { exports: {} }
const fakeRequire = (id) => {
  if (id === 'react') return react
  if (id === 'react/jsx-runtime') return { Fragment: 'Fragment', jsx, jsxs: jsx }
  if (id === '@mui/material') return material
  if (id.startsWith('@mui/icons-material/')) return { __esModule: true, default: () => null }
  if (id === '../../ui/shared/src/mobile-item-gesture') return gesture.exports
  if (id === './webApps') return { XDRIVE_WEB_APPS: {} }
  throw Error('Unexpected production import: ' + id)
}
new Function('module', 'exports', 'require', 'setTimeout', 'clearTimeout',
  compiled.outputText)(module, module.exports, fakeRequire, schedule, clear)

const navigations = []
const recentUpdates = []
cursor = 0
const tree = module.exports.XDriveMobileFiveSlotNavigation({
  selected: 'all', dynamicLabel: '任务', recent: [], recentOpen: false,
  onRecentOpenChange: value => recentUpdates.push(value),
  onSelect: slot => navigations.push(slot),
  onPickRecent: () => assert.fail('Unexpected recent selection'),
})
const locate = (node, match) => {
  if (node == null) return null
  if (Array.isArray(node)) return node.map(child => locate(child, match)).find(Boolean) ?? null
  if (match(node)) return node
  return locate(node.props?.children, match)
}
const dynamic = locate(tree, node => node.type === 'BottomNavigationAction' && node.props.value === 'dynamic')
assert.ok(dynamic, 'Actual dynamic tab must be mounted')
assert.match(dynamic.props['aria-label'], /长按查看最近功能/)
assert.equal(dynamic.props['aria-haspopup'], 'dialog')
assert.equal(dynamic.props['aria-expanded'], false)
const pointer = (id, extra = {}) => ({
  pointerId: id, pointerType: 'touch', button: 0, isPrimary: true,
  clientX: 10, clientY: 10, prevented: false, stopped: false,
  preventDefault() { this.prevented = true },
  stopPropagation() { this.stopped = true },
  ...extra,
})
const click = (detail = 1) => pointer(0, { detail })

// Ordinary tap selects the last dynamic feature, without opening the picker.
dynamic.props.onPointerDown(pointer(1))
assert.equal(timers.size, 1)
dynamic.props.onPointerUp(pointer(1))
assert.equal(timers.size, 0)
dynamic.props.onClick(click())
assert.deepEqual(navigations, ['dynamic'])
assert.deepEqual(recentUpdates, [])

// Movement beyond the shared Files/Gallery threshold cancels pending hold.
dynamic.props.onPointerDown(pointer(2))
dynamic.props.onPointerMove(pointer(2, { clientY: 21 }))
assert.equal(timers.size, 0)
fireTimers()
dynamic.props.onPointerUp(pointer(2))
assert.deepEqual(recentUpdates, [])
assert.deepEqual(navigations, ['dynamic'])

// A still hold opens the picker, and its compatibility release click cannot navigate.
dynamic.props.onPointerDown(pointer(3))
fireTimers()
assert.deepEqual(recentUpdates, [true])
const release = pointer(3)
dynamic.props.onPointerUp(release)
assert.equal(release.prevented, true)
const compatibilityClick = click()
dynamic.props.onClick(compatibilityClick)
assert.equal(compatibilityClick.prevented, true)
assert.equal(compatibilityClick.stopped, true)
assert.deepEqual(navigations, ['dynamic'])

// No compatibility click at all: a NEW tap must not be swallowed.
dynamic.props.onPointerDown(pointer(4))
dynamic.props.onPointerUp(pointer(4))
dynamic.props.onClick(click())
assert.deepEqual(navigations, ['dynamic', 'dynamic'])

// Press cancellation, pointer leave, and secondary pointers never open the picker.
dynamic.props.onPointerDown(pointer(5))
dynamic.props.onPointerCancel(pointer(5))
dynamic.props.onPointerDown(pointer(6))
dynamic.props.onPointerLeave(pointer(6))
dynamic.props.onPointerDown(pointer(7, { isPrimary: false }))
assert.equal(timers.size, 0)
fireTimers()
assert.deepEqual(recentUpdates, [true])

// Mouse context menu opens the picker without routing. The next left click works.
dynamic.props.onPointerDown(pointer(8, { pointerType: 'mouse', button: 2 }))
const context = pointer(8)
dynamic.props.onContextMenu(context)
assert.equal(context.prevented, true)
assert.deepEqual(recentUpdates, [true, true])
dynamic.props.onClick(click())
assert.equal(navigations.length, 2)
dynamic.props.onPointerDown(pointer(9, { pointerType: 'mouse', button: 0 }))
dynamic.props.onPointerUp(pointer(9, { pointerType: 'mouse', button: 0 }))
dynamic.props.onClick(click())
assert.equal(navigations.length, 3)

// Keyboard/assistive click has detail=0 and never inherits a stale touch suppression.
dynamic.props.onPointerDown(pointer(10))
fireTimers()
dynamic.props.onPointerUp(pointer(10))
dynamic.props.onClick(click(0))
assert.equal(navigations.length, 4)

// Unmount clears a pending long-press timer without changing route state.
dynamic.props.onPointerDown(pointer(11))
assert.equal(timers.size, 1)
for (const cleanup of cleanups) cleanup()
assert.equal(timers.size, 0)
fireTimers()
assert.equal(navigations.length, 4)
console.log('Mobile five-slot genuine events: tap, pan, hold, release, mouse, keyboard and unmount passed')
