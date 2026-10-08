const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractLoadThumbnail() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let callback = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'loadThumbnail' &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sourceFile) === 'useCallback'
    ) {
      callback = node.initializer.arguments[0].getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing Desktop FileExplorer loadThumbnail callback')
  return { filename, callback }
}

function compileCallback(filename, callback, dependencies) {
  const output = ts.transpileModule(
    'const loadThumbnail = ' + callback + ';',
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
  const values = names.map((name) => dependencies[name])
  return new Function(...names, output + '\nreturn loadThumbnail')(...values)
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('Desktop FileExplorer stale video poster decode cannot backfill the new account cache', async () => {
  const { filename, callback } = extractLoadThumbnail()

  const posterDecode = deferred()
  const putCallsA = []
  const putCallsB = []
  let objectURLCount = 0

  const agentA = {
    getMediaThumbnail: async () => ({ ok: false, error: { message: 'miss' } }),
    cloudFilePreviewURL: async () => ({ ok: true, data: 'preview://account-a/7' }),
    putMediaVideoPoster: async (...args) => {
      putCallsA.push(args)
      return { ok: true, data: null }
    },
  }
  const agentB = {
    getMediaThumbnail: async () => ({ ok: false, error: { message: 'miss' } }),
    cloudFilePreviewURL: async () => ({ ok: true, data: 'preview://account-b/7' }),
    putMediaVideoPoster: async (...args) => {
      putCallsB.push(args)
      return { ok: true, data: null }
    },
  }
  const window = {
    xdriveDesktop: {
      agent: agentA,
    },
  }

  const poster = {
    arrayBuffer: async () => new ArrayBuffer(4),
  }

  const actionGenerationRef = { current: 1 }
  const loadThumbnail = compileCallback(filename, callback, {
    window,
    Blob: class Blob {},
    URL: {
      createObjectURL: () => 'blob:poster-' + (++objectURLCount),
    },
    actionGenerationRef,
    previewStreamSupported: true,
    xDriveFileKind: () => 'video',
    xDriveCaptureVideoPosterBlob: () => posterDecode.promise,
  })

  const pendingA = loadThumbnail({
    id: 7,
    name: 'movie.mp4',
    kind: 'file',
    revision: 3,
  })

  await flushAsync()

  // Account/Server lifecycle switches while the old video poster is still decoding.
  actionGenerationRef.current += 1
  window.xdriveDesktop.agent = agentB
  posterDecode.resolve(poster)
  await pendingA

  assert.deepEqual(putCallsA, [])
  assert.deepEqual(
    putCallsB,
    [],
    'a poster decoded for account A must never be written through account B after a lifecycle switch',
  )
})
