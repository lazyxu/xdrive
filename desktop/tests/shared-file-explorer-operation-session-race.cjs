const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function createHookRuntime() {
  const slots = []
  let cursor = 0
  let pendingEffects = []

  const react = {
    useState(initialValue) {
      const index = cursor++
      if (!slots[index]) {
        slots[index] = {
          kind: 'state',
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        }
      }
      const setValue = (nextValue) => {
        const current = slots[index].value
        slots[index].value = typeof nextValue === 'function'
          ? nextValue(current)
          : nextValue
      }
      return [slots[index].value, setValue]
    },
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { kind: 'ref', value: { current: initialValue } }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        pendingEffects.push({ index, effect, deps: deps ? [...deps] : undefined })
      }
    },
  }

  return {
    react,
    render(factory) {
      cursor = 0
      pendingEffects = []
      const result = factory()
      for (const pending of pendingEffects) {
        const previous = slots[pending.index]
        if (typeof previous?.cleanup === 'function') previous.cleanup()
        const cleanup = pending.effect()
        slots[pending.index] = {
          kind: 'effect',
          deps: pending.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      return result
    },
  }
}

function loadTypeScript(relativePath, react, extraModules = {}) {
  const filename = path.join(repo, ...relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (Object.prototype.hasOwnProperty.call(extraModules, request)) {
      return extraModules[request]
    }
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

function loadOperationHook(react) {
  const controller = loadTypeScript(
    ['ui', 'shared', 'src', 'file-explorer-controller.ts'],
    null,
  )
  return loadTypeScript(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerOperationController.ts'],
    react,
    { '../file-explorer-controller': controller },
  ).useXDriveFileExplorerOperationController
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('FileExplorer queued operation completion cannot cross session identity lifecycles', async () => {
  const runtime = createHookRuntime()
  const useOperation = loadOperationHook(runtime.react)

  const nodeA = { id: 1, revision: 1, name: 'A.txt', type: 'file' }
  const nodeB = { id: 2, revision: 1, name: 'B.txt', type: 'file' }
  let lifecycleKey = 'server-a:user-a'
  let identity = 'a'
  let releaseA
  let releaseB
  const queued = []
  const feedback = []
  const completed = []
  let clearSearchCalls = 0
  const errors = []

  const planPaste = () => ({
    operation: 'copy',
    items: [{
      id: identity === 'a' ? nodeA.id : nodeB.id,
      revision: 1,
    }],
    parentID: identity === 'a' ? 10 : 20,
    count: 1,
    clearClipboard: true,
    clipboardGeneration: identity === 'a' ? 1 : 2,
  })

  const submitOperation = (plan) => new Promise((resolve) => {
    if (plan.items[0].id === nodeA.id) {
      releaseA = () => resolve({ id: 'op-a' })
      return
    }
    if (plan.items[0].id === nodeB.id) {
      releaseB = () => resolve({ id: 'op-b' })
      return
    }
    throw new Error('unexpected operation item')
  })

  const render = () => runtime.render(() => useOperation({
    lifecycleKey,
    nodeByID: new Map([[nodeA.id, nodeA], [nodeB.id, nodeB]]),
    currentID: identity === 'a' ? 10 : 20,
    planPaste,
    completePaste: (plan) => completed.push(plan.clipboardGeneration),
    canPaste: () => true,
    clearSearch: () => { clearSearchCalls += 1 },
    submitOperation,
    onQueued: (operation) => queued.push(operation.id),
    onFeedback: (_tone, message) => feedback.push(message),
    onError: (error) => errors.push(error),
  }))

  let controller = render()
  const pendingA = controller.pasteClipboard()
  await flushAsync()
  controller = render()
  assert.equal(controller.busy, true)
  assert.equal(typeof releaseA, 'function')

  identity = 'b'
  lifecycleKey = 'server-b:user-b'
  render()
  await flushAsync()
  controller = render()

  assert.equal(
    controller.busy,
    false,
    'session identity change must release the previous account operation busy ownership',
  )

  const pendingB = controller.pasteClipboard()
  await flushAsync()
  controller = render()
  assert.equal(controller.busy, true)
  assert.equal(typeof releaseB, 'function')

  releaseA()
  await pendingA
  await flushAsync()
  controller = render()

  assert.equal(
    controller.busy,
    true,
    'stale A completion must not clear B operation busy ownership',
  )
  assert.deepEqual(queued, [])
  assert.deepEqual(feedback, [])
  assert.deepEqual(completed, [])
  assert.equal(clearSearchCalls, 0)
  assert.deepEqual(errors, [])

  releaseB()
  await pendingB
  await flushAsync()
  controller = render()

  assert.equal(controller.busy, false)
  assert.deepEqual(queued, ['op-b'])
  assert.equal(feedback.length, 1)
  assert.deepEqual(completed, [2])
  assert.equal(clearSearchCalls, 1)
  assert.deepEqual(errors, [])
})
