const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractArrowFunction(name, dependencies = {}) {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let initializer = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      initializer = node.initializer.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(initializer, 'missing DesktopFileExplorer local action: ' + name)

  const transpiled = ts.transpileModule(
    'const ' + name + ' = ' + initializer + ';',
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    },
  ).outputText

  const names = Object.keys(dependencies)
  const values = names.map((key) => dependencies[key])
  return new Function(...names, transpiled + '\nreturn ' + name)(...values)
}


function extractActionLifecycleEffect(dependencies = {}) {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let effect = null
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('actionGenerationRef.current += 1') &&
      node.arguments[0].getText(sourceFile).includes('actionBusyRef.current = null') &&
      ts.isArrayLiteralExpression(node.arguments[1]) &&
      node.arguments[1].elements.some((element) => (
        ts.isIdentifier(element) &&
        element.text === 'navigationSessionStorageKey'
      ))
    ) {
      effect = node.arguments[0].getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(effect, 'missing DesktopFileExplorer local action lifecycle effect')

  const transpiled = ts.transpileModule(
    'const lifecycleEffect = ' + effect + ';',
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    },
  ).outputText

  const names = Object.keys(dependencies)
  const values = names.map((key) => dependencies[key])
  return new Function(...names, transpiled + '\nreturn lifecycleEffect')(...values)
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('Desktop FileExplorer same-tick file downloads are synchronously single-flight', async () => {
  let calls = 0
  const releases = []
  const busy = []
  const feedback = []
  const errors = []

  const window = {
    xdriveDesktop: {
      agent: {
        cloudDownload: () => {
          calls += 1
          return new Promise((resolve) => {
            releases.push(() => resolve({
              ok: true,
              data: { saved: true },
            }))
          })
        },
      },
    },
  }

  const actionBusyRef = { current: null }
  const actionGenerationRef = { current: 1 }
  const setActionBusy = (value) => busy.push(value)
  const beginActionBusy = extractArrowFunction('beginActionBusy', {
    useCallback: (callback) => callback,
    actionBusyRef,
    actionGenerationRef,
    setActionBusy,
  })
  const isActionBusyCurrent = extractArrowFunction('isActionBusyCurrent', {
    useCallback: (callback) => callback,
    actionBusyRef,
    actionGenerationRef,
  })
  const finishActionBusy = extractArrowFunction('finishActionBusy', {
    useCallback: (callback) => callback,
    actionBusyRef,
    isActionBusyCurrent,
    setActionBusy,
  })

  const downloadNode = extractArrowFunction('downloadNode', {
    beginActionBusy,
    finishActionBusy,
    isActionBusyCurrent,
    window,
    onError: (message) => errors.push(message),
    onFeedback: (tone, message) => feedback.push({ tone, message }),
  })

  const target = { id: 7, name: 'report.pdf' }
  const first = downloadNode(target)
  const duplicate = downloadNode(target)
  await flushAsync()

  assert.equal(
    calls,
    1,
    'same-tick duplicate download actions must not submit two Desktop Agent requests before React rerenders',
  )

  releases[0]()
  await first
  await duplicate

  assert.deepEqual(errors, [])
  assert.deepEqual(feedback, [{ tone: 'good', message: 'report.pdf 已保存。' }])
  assert.deepEqual(busy, ['download-7', ''])
})


test('Desktop FileExplorer stale download completion cannot clear a newer account action', async () => {
  const busy = []
  const feedback = []
  const errors = []
  const actionBusyRef = { current: null }
  const actionGenerationRef = { current: 1 }
  const setActionBusy = (value) => busy.push(value)
  const beginActionBusy = extractArrowFunction('beginActionBusy', {
    useCallback: (callback) => callback,
    actionBusyRef,
    actionGenerationRef,
    setActionBusy,
  })
  const isActionBusyCurrent = extractArrowFunction('isActionBusyCurrent', {
    useCallback: (callback) => callback,
    actionBusyRef,
    actionGenerationRef,
  })
  const finishActionBusy = extractArrowFunction('finishActionBusy', {
    useCallback: (callback) => callback,
    actionBusyRef,
    isActionBusyCurrent,
    setActionBusy,
  })

  const releases = []
  const window = {
    xdriveDesktop: {
      agent: {
        cloudDownload: () => new Promise((resolve) => {
          releases.push(() => resolve({
            ok: true,
            data: { saved: true },
          }))
        }),
      },
    },
  }
  const downloadNode = extractArrowFunction('downloadNode', {
    beginActionBusy,
    finishActionBusy,
    isActionBusyCurrent,
    window,
    onError: (message) => errors.push(message),
    onFeedback: (tone, message) => feedback.push({ tone, message }),
  })

  const pendingA = downloadNode({ id: 7, name: 'A.pdf' })
  await flushAsync()

  actionGenerationRef.current += 1
  actionBusyRef.current = null
  setActionBusy('')

  const pendingB = downloadNode({ id: 7, name: 'B.pdf' })
  await flushAsync()
  assert.equal(releases.length, 2)

  releases[0]()
  await pendingA
  assert.equal(
    actionBusyRef.current?.key,
    'download-7',
    'old account completion must not release the newer account action token',
  )
  assert.deepEqual(feedback, [])

  releases[1]()
  await pendingB

  assert.equal(actionBusyRef.current, null)
  assert.deepEqual(feedback, [{ tone: 'good', message: 'B.pdf 已保存。' }])
  assert.deepEqual(errors, [])
})


test('Desktop FileExplorer unmount invalidates pending local action completion', async () => {
  const busy = []
  const feedback = []
  const errors = []
  const actionBusyRef = { current: null }
  const actionGenerationRef = { current: 1 }
  const setActionBusy = (value) => busy.push(value)

  const lifecycleEffect = extractActionLifecycleEffect({
    actionBusyRef,
    actionGenerationRef,
    setActionBusy,
  })
  const cleanup = lifecycleEffect()

  const beginActionBusy = extractArrowFunction('beginActionBusy', {
    useCallback: (callback) => callback,
    actionBusyRef,
    actionGenerationRef,
    setActionBusy,
  })
  const isActionBusyCurrent = extractArrowFunction('isActionBusyCurrent', {
    useCallback: (callback) => callback,
    actionBusyRef,
    actionGenerationRef,
  })
  const finishActionBusy = extractArrowFunction('finishActionBusy', {
    useCallback: (callback) => callback,
    actionBusyRef,
    isActionBusyCurrent,
    setActionBusy,
  })

  let release
  const window = {
    xdriveDesktop: {
      agent: {
        cloudDownload: () => new Promise((resolve) => {
          release = () => resolve({
            ok: true,
            data: { saved: true },
          })
        }),
      },
    },
  }
  const downloadNode = extractArrowFunction('downloadNode', {
    beginActionBusy,
    finishActionBusy,
    isActionBusyCurrent,
    window,
    onError: (message) => errors.push(message),
    onFeedback: (tone, message) => feedback.push({ tone, message }),
  })

  const pending = downloadNode({ id: 9, name: 'leaving.pdf' })
  await flushAsync()
  assert.equal(typeof release, 'function')

  if (typeof cleanup === 'function') cleanup()

  release()
  await pending

  assert.deepEqual(
    feedback,
    [],
    'a local action that completes after FileExplorer unmount must not publish stale feedback',
  )
  assert.deepEqual(errors, [])
  assert.equal(actionBusyRef.current, null)
})
