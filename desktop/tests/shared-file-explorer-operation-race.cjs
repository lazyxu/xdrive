const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function createHookRuntime() {
  const slots = []
  let cursor = 0
  const react = {
    useState(initialValue) {
      const index = cursor++
      if (!slots[index]) {
        slots[index] = {
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
      if (!slots[index]) slots[index] = { value: { current: initialValue } }
      return slots[index].value
    },
  }
  return {
    react,
    render(factory) {
      cursor = 0
      return factory()
    },
  }
}

function loadOperationController(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerOperationController.ts',
  )
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
    if (request === '../file-explorer-controller') {
      return {
        xDriveFileExplorerDropItemsPlan: () => null,
        xDriveFileExplorerDropItemsToParentPlan: () => null,
        xDriveFileExplorerRunQueuedOperation: async ({
          submit,
          onQueued,
          onFeedback,
          onComplete,
          onError,
        }) => {
          try {
            const queued = await submit()
            onQueued(queued)
            onFeedback('good', 'queued')
            onComplete()
            return true
          } catch (error) {
            onError(error)
            return false
          }
        },
      }
    }
    return require(request)
  }

  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerOperationController
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('same-tick paste submissions cannot queue duplicate durable file operations', async () => {
  const runtime = createHookRuntime()
  const useOperationController = loadOperationController(runtime.react)
  const resolvers = []
  let submitCalls = 0

  const plan = {
    operation: 'copy',
    items: [{ id: 1, revision: 1 }],
    target_parent_id: 9,
    clearClipboard: false,
    message: 'queued',
  }

  const render = () => runtime.render(() => useOperationController({
    nodeByID: new Map(),
    currentID: 9,
    planPaste: () => plan,
    completePaste: () => {},
    canPaste: () => true,
    clearSearch: () => {},
    submitOperation: () => {
      submitCalls += 1
      return new Promise((resolve) => {
        resolvers.push(resolve)
      })
    },
    onQueued: () => {},
    onFeedback: () => {},
    onError: (error) => { throw error },
  }))

  const controller = render()
  const first = controller.pasteClipboard()
  const duplicate = controller.pasteClipboard()
  await flushAsync()

  assert.equal(
    submitCalls,
    1,
    'React busy state must not be the only lock; same-tick paste must not submit twice',
  )

  for (const resolve of resolvers) resolve({ id: 'queued' })
  await Promise.all([first, duplicate])
})
