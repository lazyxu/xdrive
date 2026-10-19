'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

function realDeferredHook() {
  const transpiled = ts.transpileModule(read('ui/shared/src/mui/useDeferredLoading.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', transpiled)(mod, mod.exports, name => {
    if (name === 'react') return React
    throw Error('Unexpected deferred-hook dependency ' + name)
  })
  return mod.exports.useXDriveDeferredLoading
}

test('P89 original delayed hook never reuses a visual spinner across same-ID retries, changed delays or generations', async () => {
  const useDeferred = realDeferredHook()
  const paints = []
  function Probe({ pending, generation, delay }) {
    const visible = useDeferred(pending, generation, delay)
    paints.push({ pending, generation, delay, visible })
    return React.createElement('output', {}, visible ? 'shown' : 'quiet')
  }
  let renderer
  const first = { pending: true, generation: 7, delay: 5 }
  const updateQuiet = async (next, why) => {
    paints.length = 0
    await act(async () => { renderer.update(React.createElement(Probe, next)) })
    assert.ok(paints.length, why + ': render must be recorded')
    assert.ok(paints.every(paint => !paint.visible), why + ': no stale paint')
    assert.equal(renderer.root.findByType('output').children[0], 'quiet')
  }
  try {
    await act(async () => {
      renderer = Renderer.create(React.createElement(Probe, first))
    })
    assert.equal(renderer.root.findByType('output').children[0], 'quiet')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    assert.equal(renderer.root.findByType('output').children[0], 'shown')
    await updateQuiet({ pending: false, generation: 7, delay: 5 }, 'completed read')
    await updateQuiet({ pending: true, generation: 7, delay: 5 }, 'same-ID retry')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    assert.equal(renderer.root.findByType('output').children[0], 'shown')
    await updateQuiet({ pending: true, generation: 7, delay: 5000 }, 'same-ID changed delay')
    await updateQuiet({ pending: true, generation: 8, delay: 5000 }, 'changed request generation')
    await updateQuiet({ pending: true, generation: 8, delay: 5 }, 'shorter delay after switch')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    assert.equal(renderer.root.findByType('output').children[0], 'shown')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('P89 permanent no-jitter source contract forbids Promise-only Mobile folder commits', () => {
  const mobile = read('web/src/MobileFiles.tsx')
  const handler = mobile.slice(mobile.indexOf('  const onOpenEntry ='), mobile.indexOf('  const changeSection ='))
  assert.ok(handler.includes('pendingRowDirectoryRef.current = {'))
  assert.equal(handler.includes('beginBrowse('), false)
  assert.ok(mobile.includes('const rowDirectoryCommit = Boolean(pendingRow'))
  assert.ok(mobile.includes('props.virtualCollection.interactionKey !== pendingRow.previousRangeKey'))
  assert.ok(mobile.includes('pendingRow.intent === navigationIntentRef.current'))
  assert.ok(read('AGENTS.md').includes('P89 bound row commits / reused-generation quiet-first-read'))
  assert.ok(read('docs/mobile-navigation-stability.md').includes('P89 · Row acknowledgements'))
})
