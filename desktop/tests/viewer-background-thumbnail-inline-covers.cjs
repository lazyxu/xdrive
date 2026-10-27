'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/MediaGalleryCoverThumbnail.tsx')
const source = fs.readFileSync(filename, 'utf8')
const gallerySource = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
const recordedPools = []

class InstrumentedCoverPool {
  constructor(loader) {
    this.loader = loader
    this.pauses = []
    this.disposed = false
    recordedPools.push(this)
  }
  setSuspended(paused) { this.pauses.push(paused) }
  dispose() { this.disposed = true }
}

function realCoverModule() {
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const mod = { exports: {} }
  const requireLocal = name => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name)
    if (name === '@mui/material') return { Box: 'div', Skeleton: 'div' }
    if (name === './MediaGalleryCoverThumbnailPool') {
      return { XDriveMediaGalleryCoverThumbnailPool: InstrumentedCoverPool }
    }
    if (name === './MediaGalleryPreviewMedia') {
      return {
        XDriveBackgroundMediaThumbnailSuspended: React.createContext(false),
        XDriveMediaAsyncThumbnail: () => null,
      }
    }
    throw Error('Unexpected CoverProvider dependency: ' + name)
  }
  new Function('exports', 'module', 'require', compiled)(mod.exports, mod, requireLocal)
  return mod.exports
}

test('inline Gallery Viewer pauses the real ancestor CoverProvider without a route flag', async () => {
  const { XDriveMediaGalleryCoverProvider, useXDriveGalleryCoverPauseForInlineViewer } = realCoverModule()
  const loadA = async () => null
  const loadB = async () => null
  const Inline = ({ open }) => {
    useXDriveGalleryCoverPauseForInlineViewer(open)
    return null
  }
  const view = (routed, inline, loader = loadA) => React.createElement(
    XDriveMediaGalleryCoverProvider,
    { loadThumbnail: loader, suspended: routed },
    React.createElement(Inline, { open: inline }),
  )
  let tree
  await act(async () => { tree = create(view(false, false)) })
  let pool = recordedPools.at(-1)
  assert.equal(pool.pauses.at(-1), false)

  await act(async () => { tree.update(view(false, true)) })
  assert.equal(pool.pauses.at(-1), true, 'inline Desktop Viewer must preempt parent cover requests')

  await act(async () => { tree.update(view(true, true)) })
  await act(async () => { tree.update(view(true, false)) })
  assert.equal(pool.pauses.at(-1), true, 'route Viewer pause dominates inline close')

  await act(async () => { tree.update(view(false, false)) })
  assert.equal(pool.pauses.at(-1), false, 'returning to Gallery resumes covers')

  await act(async () => { tree.update(view(false, true, loadB)) })
  assert.equal(pool.disposed, true, 'old Owner/loader cover pool disposed')
  pool = recordedPools.at(-1)
  assert.notEqual(pool.loader, loadA)
  assert.equal(pool.pauses.at(-1), true, 'replacement pool remains suspended for active Viewer')

  await act(async () => { tree.unmount() })
  assert.equal(pool.disposed, true)
})

test('inline cover preemption is wired into the exact shared Gallery Viewer pause', () => {
  assert.match(gallerySource, /thumbnailBackgroundSuspended = suspendBackgroundThumbnails \|\| previewItem !== null/)
  assert.match(gallerySource, /useXDriveGalleryCoverPauseForInlineViewer\(thumbnailBackgroundSuspended\)/)
  assert.match(source, /coverPaused = suspended \|\| inlineViewerPaused/)
  assert.match(source, /pool\?\.setSuspended\(coverPaused\)/)
  assert.match(source, /<InlineViewerCoverPauseContext\.Provider value=\{setInlineViewerPaused\}>/)
})
