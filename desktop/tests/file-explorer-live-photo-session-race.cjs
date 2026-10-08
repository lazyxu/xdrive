const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractLoadLivePhotoMotion() {
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
      node.name.text === 'loadLivePhotoMotion' &&
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

  assert.ok(callback, 'missing Desktop FileExplorer loadLivePhotoMotion callback')
  return { filename, callback }
}

function compileCallback(filename, callback, dependencies) {
  const output = ts.transpileModule(
    'const loadLivePhotoMotion = ' + callback + ';',
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
  return new Function(...names, output + '\nreturn loadLivePhotoMotion')(...values)
}

test('Desktop FileExplorer stale Live Photo dispose cannot release through the new account Agent', async () => {
  const { filename, callback } = extractLoadLivePhotoMotion()

  const releasesA = []
  const releasesB = []
  const agentA = {
    getMediaLivePhotoMotion: async () => ({
      ok: true,
      data: 'motion://account-a/7',
    }),
    releaseMediaLivePhotoMotion: async (value) => {
      releasesA.push(value)
      return { ok: true, data: null }
    },
  }
  const agentB = {
    getMediaLivePhotoMotion: async () => ({
      ok: true,
      data: 'motion://account-b/7',
    }),
    releaseMediaLivePhotoMotion: async (value) => {
      releasesB.push(value)
      return { ok: true, data: null }
    },
  }

  const window = {
    xdriveDesktop: {
      agent: agentA,
    },
  }
  const actionGenerationRef = { current: 1 }

  const loadLivePhotoMotion = compileCallback(filename, callback, {
    window,
    actionGenerationRef,
  })

  const source = await loadLivePhotoMotion({
    id: 7,
    name: 'photo.livp',
    kind: 'file',
    revision: 3,
  })

  assert.ok(source)

  // The FileExplorer account/Server lifecycle changes before Preview cleanup runs.
  actionGenerationRef.current += 1
  window.xdriveDesktop.agent = agentB
  source.dispose()

  await Promise.resolve()

  assert.deepEqual(releasesA, [])
  assert.deepEqual(
    releasesB,
    [],
    'cleanup for an account-A Live Photo source must never release through account B',
  )
})


test('Desktop FileExplorer Live Photo load finishing after account switch is discarded', async () => {
  const { filename, callback } = extractLoadLivePhotoMotion()

  let resolveMotion
  const releasesB = []
  const agentA = {
    getMediaLivePhotoMotion: () => new Promise((resolve) => {
      resolveMotion = () => resolve({
        ok: true,
        data: 'motion://account-a/late',
      })
    }),
    releaseMediaLivePhotoMotion: async () => ({ ok: true, data: null }),
  }
  const agentB = {
    getMediaLivePhotoMotion: async () => ({
      ok: true,
      data: 'motion://account-b/late',
    }),
    releaseMediaLivePhotoMotion: async (value) => {
      releasesB.push(value)
      return { ok: true, data: null }
    },
  }
  const window = {
    xdriveDesktop: {
      agent: agentA,
    },
  }
  const actionGenerationRef = { current: 4 }

  const loadLivePhotoMotion = compileCallback(filename, callback, {
    window,
    actionGenerationRef,
  })

  const pending = loadLivePhotoMotion({
    id: 9,
    name: 'late.livp',
    kind: 'file',
    revision: 1,
  })

  await Promise.resolve()
  assert.equal(typeof resolveMotion, 'function')

  actionGenerationRef.current += 1
  window.xdriveDesktop.agent = agentB
  resolveMotion()

  const source = await pending

  assert.equal(
    source,
    null,
    'an account-A Live Photo request that finishes after switching to B must be discarded',
  )
  assert.deepEqual(releasesB, [])
})
