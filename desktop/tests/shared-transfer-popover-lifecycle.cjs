const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const mui = require('@mui/material')

// Exercise our open-state effects and the props they pass to the real MUI
// boundary. This does not model DOM focus or placement; browser QA covers those.
function hooks() {
  let slots = []
  let cursor = 0
  let pending = []
  let changed = false
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])))
  const react = {
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, (next) => {
        const value = typeof next === 'function' ? next(slots[index].value) : next
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; changed = true }
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: { current: initial } }
      return slots[index].value
    },
    useId() { return react.useRef('transfer-popup-test').current },
    useMemo(factory, deps) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].deps, deps)) pending.push({ index, effect, deps })
    },
  }
  return {
    react,
    reset() { for (const slot of slots) slot?.cleanup?.(); slots = [] },
    render(factory) {
      let element
      let passes = 0
      do {
        assert.ok(passes++ < 10, 'transfer open state did not settle')
        cursor = 0
        pending = []
        changed = false
        element = factory()
        for (const { index, effect, deps } of pending) {
          slots[index]?.cleanup?.()
          slots[index] = { deps, cleanup: effect() }
        }
      } while (changed)
      return element
    },
  }
}

function loadPopover(react) {
  const cache = new Map()
  const element = (type, props, key) => ({ type, props: props ?? {}, ref: props?.ref, key })
  const jsxRuntime = { jsx: element, jsxs: element, Fragment: Symbol('Fragment') }
  const load = (filename) => {
    if (cache.has(filename)) return cache.get(filename).exports
    const loaded = { exports: {} }
    cache.set(filename, loaded)
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText
    const localRequire = (name) => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return jsxRuntime
      if (!name.startsWith('.')) return require(name)
      const base = path.resolve(path.dirname(filename), name)
      const resolved = [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(fs.existsSync)
      assert.ok(resolved, `Unresolved module ${name}`)
      return load(resolved)
    }
    new Function('exports', 'require', 'module', output)(loaded.exports, localRequire, loaded)
    return loaded.exports
  }
  return load(path.join(__dirname, '..', '..', 'ui', 'shared', 'src', 'mui', 'TransferPopover.tsx')).XDriveTransferPopover
}

function find(element, type) {
  if (!element || typeof element !== 'object') return undefined
  if (Array.isArray(element)) return element.map((child) => find(child, type)).find(Boolean)
  if (element.type === type) return element
  return find(element.props?.children, type)
}

function sessionComponent(runtime) {
  const Popover = loadPopover(runtime.react)
  const Session = runtime.render(() => Popover({ transfers: [] })).type
  runtime.reset()
  return Session
}

function anchor() {
  return {
    nodeType: 1,
    tagName: 'BUTTON',
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }),
  }
}

test('disabling a clicked popup closes its state so re-enabling cannot reopen it', (t) => {
  const runtime = hooks()
  t.after(() => runtime.reset())
  const Session = sessionComponent(runtime)
  const requests = []
  let props = { transfers: [], onOpenChange: (open) => requests.push(open) }
  let element = runtime.render(() => Session(props))
  find(element, mui.ButtonBase).ref(anchor())
  element = runtime.render(() => Session(props))
  find(element, mui.ButtonBase).props.onClick()
  element = runtime.render(() => Session(props))
  assert.equal(find(element, mui.Popover).props.open, true)

  props = { ...props, disabled: true }
  element = runtime.render(() => Session(props))
  assert.equal(find(element, mui.Popover).props.open, false)
  props = { ...props, disabled: false }
  element = runtime.render(() => Session(props))
  assert.equal(find(element, mui.Popover).props.open, false)
  assert.deepEqual(requests, [true, false])
})

test('a disabled controlled popup asks its owner to close before the viewer is dismissed', (t) => {
  const runtime = hooks()
  t.after(() => runtime.reset())
  const Session = sessionComponent(runtime)
  const requests = []
  let props = { transfers: [], open: true, onOpenChange: (open) => { requests.push(open); props = { ...props, open } } }
  let element = runtime.render(() => Session(props))
  find(element, mui.ButtonBase).ref(anchor())
  element = runtime.render(() => Session(props))
  assert.equal(find(element, mui.Popover).props.open, true)
  assert.deepEqual(requests, [], 'an intentional initial open must survive mounting')

  props = { ...props, disabled: true }
  element = runtime.render(() => Session(props))
  assert.equal(find(element, mui.Popover).props.open, false)
  props = { ...props, disabled: false }
  element = runtime.render(() => Session(props))
  assert.equal(find(element, mui.Popover).props.open, false)
  assert.deepEqual(requests, [false])
})

test('changing accounts closes a controlled request without cancelling its initial mount', (t) => {
  const runtime = hooks()
  t.after(() => runtime.reset())
  const Popover = loadPopover(runtime.react)
  const requests = []
  const props = { transfers: [], open: true, sessionKey: 'account-a', onOpenChange: (open) => requests.push(open) }
  let element = runtime.render(() => Popover(props))
  assert.equal(element.props.open, true)
  assert.deepEqual(requests, [])

  element = runtime.render(() => Popover({ ...props, sessionKey: 'account-b' }))
  assert.equal(element.props.open, false)
  assert.deepEqual(requests, [false])
})
