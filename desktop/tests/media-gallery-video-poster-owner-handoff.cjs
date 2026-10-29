'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')
const sourcePath = path.join(__dirname, '../../ui/shared/src/mui/MediaGalleryPreviewMedia.tsx')
const real = fs.readFileSync(sourcePath, 'utf8')
const start = real.indexOf('const mediaPosterConcurrency = 3')
const end = real.indexOf('\nexport function xDriveMediaFallback', start)
assert.ok(start > 0 && end > start, 'shared production Gallery video poster source required')
// Extract the real bounded poster queue + React component; provide only the
// external transport as a deterministic stub, never replace the Owner gate.
const selected = [
  "import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'",
  "import { Box, XDriveMediaLoadingProgress } from './fixture'",
  "type ReactNode = any; type MediaThumbnailLoader = any",
  "type MediaPreviewURLLoader = any; type MediaVideoPosterSaver = any",
  "type XDriveMediaLoadStage = any; type XDriveByteProgressHandler = any",
  "const XDriveBackgroundMediaThumbnailSuspended = createContext(false)",
  "const xDriveCaptureVideoPosterBlob = async () => null",
  "const xDriveResolveMediaVideoPoster = async ({nodeID, revision, loadCached, signal, onStage}: any) => {",
  "  onStage?.('poster_lookup'); return await loadCached(nodeID, signal, revision)",
  "}",
  "function revokeIfBlob(url: string) { if (url.startsWith('blob:')) URL.revokeObjectURL(url) }",
  real.slice(start, end),
].join('\n')
const output = ts.transpileModule(selected, {
  fileName: 'XDriveRealGalleryVideoPoster.tsx', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
})
assert.deepEqual((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const Box = React.forwardRef(({ component = 'div', children, ...props }, ref) =>
  React.createElement(component, {...props, ref}, children))
const moduleRef = { exports: {} }
new Function('module','exports','require',output.outputText)(moduleRef,moduleRef.exports,name => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return require(name)
  if (name === './fixture') return { Box, XDriveMediaLoadingProgress:
    ({stage}) => React.createElement('progress', {'data-stage': stage}) }
  throw Error('Unexpected real video poster dependency: '+name)
})
const Poster = moduleRef.exports.XDriveMediaAsyncVideoPoster
const fallback = React.createElement('span', {'data-fallback': true}, 'No cached poster')
const pic = tree => tree.root.findAllByType('img')[0]
const progress = tree => tree.root.findAllByType('progress').length
const flush = async () => { await Promise.resolve(); await new Promise(r => setImmediate(r)) }
const noPreview = async () => null
const fixture = (loadThumbnail, extra = {}) => React.createElement(Poster, {
  nodeID: 881, revision: 7, alt:'same-node.mp4',
  // Keep *every* other Host callback unchanged across the switch. Only
  // loadThumbnail is a distinct authenticated source A -> B.
  loadThumbnail, loadPreviewURL: noPreview,
  fallback, ...extra,
})
const mount = node => create(node,{createNodeMock: element => element.type === 'div' ? {} : null})
test('same Node/revision video poster cannot show a former Owner on loader handoff', async () => {
  const originalRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = url => { revoked.push(url) }
  const a = async () => 'blob:owner-a-video-poster'
  let resolveB
  const b = () => new Promise(resolve => { resolveB = resolve })
  let tree
  try {
    await act(async () => { tree=mount(fixture(a)); await flush() })
    assert.equal(pic(tree)?.props.src, 'blob:owner-a-video-poster')
    const staleError = pic(tree).props.onError
    assert.match(real, /poster\?\.identity === posterIdentity && poster\.owner === posterOwner/,
      'the image is gated during render, not only in a later effect')
    await act(async () => { tree.update(fixture(b)); await flush() })
    assert.equal(pic(tree), undefined, 'new Owner waiting cannot render old decoded image')
    assert.ok(progress(tree) >= 1, 'new Owner is pending rather than old failed state')
    assert.ok(revoked.includes('blob:owner-a-video-poster'), 'retired Owner Blob is released')
    await act(async () => { staleError(); await flush() })
    assert.equal(pic(tree), undefined, 'old DOM onError cannot affect new Owner')
    await act(async () => { resolveB('blob:owner-b-video-poster'); await flush() })
    assert.equal(pic(tree)?.props.src, 'blob:owner-b-video-poster')
  } finally {
    if (tree) await act(async () => tree.unmount())
    URL.revokeObjectURL = originalRevoke
  }
})
test('failed old Owner video poster does not mask same-identity new source', async () => {
  const a = async () => null
  let resolveB
  const b = () => new Promise(resolve => { resolveB=resolve })
  let tree
  try {
    await act(async () => { tree=mount(fixture(a)); await flush() })
    assert.equal(pic(tree), undefined)
    assert.equal(progress(tree), 0, 'denied A has terminal fallback')
    assert.match(real,/failedIdentity\?\.identity === posterIdentity && failedIdentity\.owner === posterOwner/)
    await act(async () => { tree.update(fixture(b)); await flush() })
    assert.equal(pic(tree), undefined)
    assert.ok(progress(tree) >= 1, 'B waiting cannot inherit A terminal failure')
    await act(async () => { resolveB('https://example.invalid/b-poster.jpg'); await flush() })
    assert.equal(pic(tree)?.props.src, 'https://example.invalid/b-poster.jpg')
  } finally { if (tree) await act(async () => tree.unmount()) }
})
test('late video-poster image error and geometry changes are Owner scoped', () => {
  assert.match(real, /currentPosterIdentityRef\.current\.owner === posterOwner/)
  assert.match(real, /loadPreviewURL, loadThumbnail, saveVideoPoster,\s*rotationDegrees, sourceWidth, sourceHeight/)
  assert.match(real, /scheduled\.cancel\(\)/, 'existing poster cancel lifecycle retained')
  assert.doesNotMatch(real,/setFailedIdentity\(posterIdentity\)/)
})
