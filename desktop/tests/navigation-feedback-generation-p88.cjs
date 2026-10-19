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
const source = p => fs.readFileSync(path.join(root, p), 'utf8')
const hookSource = source('ui/shared/src/mui/useDeferredLoading.ts')
const mobile = source('web/src/MobileFiles.tsx')

function loadRealHook() {
  const code = ts.transpileModule(hookSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(
    mod, mod.exports, name => {
      if (name === 'react') return React
      throw Error('Unexpected dependency ' + name)
    })
  return mod.exports.useXDriveDeferredPendingLoading
}

test('P88 actual React hook has zero stale visible paints on changed delay and repeated pending', async () => {
  const usePending = loadRealHook()
  const paints = []
  function Probe({ pending, delay }) {
    const visible = usePending(pending, delay)
    paints.push({ pending, delay, visible })
    return React.createElement('output', {}, visible ? 'shown' : 'quiet')
  }
  let renderer
  try {
    await act(async () => {
      renderer = Renderer.create(React.createElement(Probe, { pending: true, delay: 5 }))
    })
    assert.equal(renderer.root.findByType('output').children[0], 'quiet')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
    assert.equal(renderer.root.findByType('output').children[0], 'shown')
    paints.length = 0
    await act(async () => {
      renderer.update(React.createElement(Probe, { pending: true, delay: 5000 }))
    })
    assert.ok(paints.length)
    assert.ok(paints.every(paint => paint.visible === false),
      'old Boolean spinner must not appear in even the FIRST new render')
    assert.equal(renderer.root.findByType('output').children[0], 'quiet')
    await act(async () => {
      renderer.update(React.createElement(Probe, { pending: false, delay: 5000 }))
    })
    paints.length = 0
    await act(async () => {
      renderer.update(React.createElement(Probe, { pending: true, delay: 5 }))
    })
    assert.ok(paints.every(paint => !paint.visible),
      'next same-component request must begin visually quiet')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
    assert.equal(renderer.root.findByType('output').children[0], 'shown')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('P88 Mobile Files Search and populated Trash fence their real feedback per pending cycle', () => {
  const begin = mobile.indexOf('  const showRangeLoading =')
  const end = mobile.indexOf('  const trashReadState =', begin)
  assert.ok(begin >= 0 && end > begin)
  const feedback = mobile.slice(begin, end)
  for (const needle of [
    '(props.searchActive || (props.trashActive && totalCount > 0))',
    'loadFeedbackCycleRef.current.pending !== showRangeLoading',
    'loadFeedbackCycleRef.current.scope !== loadFeedbackScope',
    'generation: loadFeedbackCycleRef.current.generation + 1',
    'delayedLoadGeneration === loadFeedbackGeneration',
    'window.clearTimeout(timer)',
  ]) assert.ok(feedback.includes(needle), needle)
  assert.equal(feedback.includes('setDelayedLoadScope'), false)
  assert.ok(mobile.includes('data-mobile-files-cold-read-slot={coldUnconfirmedBrowse || undefined}'))
  assert.ok(mobile.includes('const authorizedCommit = routedCommit || pathCommit || homeRootCommit || externalDirectoryCommit'))
  assert.ok(mobile.includes('XDriveFileExplorerThumbnail'))
})

test('P88 extends canonical P78 policy, does not duplicate it or suppress real media progress', () => {
  const agents = source('AGENTS.md')
  assert.equal(agents.split('Permanent no-jitter contract / P78').length, 2)
  for (const token of [
    'Permanent visual-generation fence / P88',
    'AFTER paint', 'same-key repeated requests', 'NOT RUN',
    'desktop/tests/navigation-feedback-generation-p88.cjs',
  ]) assert.ok(agents.includes(token), token)
  assert.ok(hookSource.includes('cycleRef.current.generation + 1'))
  assert.ok(hookSource.includes('visibleGeneration === generation'))
  assert.ok(hookSource.includes('return pending && visible'))
})
