'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const originalGallery = read('ui/shared/src/mui/MediaGallery.tsx')
const ast = ts.createSourceFile('MediaGallery.tsx', originalGallery, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function declaration(name) {
  const found = []
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found.push(node)
    ts.forEachChild(node, walk)
  }
  walk(ast)
  assert.equal(found.length, 1, 'expected one original ' + name)
  return found[0].getText(ast)
}
function actualCallbacks(env) {
  // Original production callback declarations, not hand-written replacements.
  const factory = 'function instantiate() { const ' +
    declaration('openTrashFromCollections') + '; const ' +
    declaration('openCompactPhotoSection') + '; const ' +
    declaration('selectSection') +
    '; return { openTrashFromCollections, selectSection }; }'
  const js = ts.transpileModule(factory, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(env), js + '\nreturn instantiate();')(...Object.values(env))
}
function originalNavigation() {
  const relative = 'ui/shared/src/mui/MediaGalleryNavigation.tsx'
  const filename = path.join(root, relative)
  const js = ts.transpileModule(read(relative), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
  const deps = {
    '@mui/material': { Button: 'button', Stack: 'stack', Tooltip: 'tooltip' },
    'react/jsx-runtime': require('react/jsx-runtime'),
  }
  mod.require = key => {
    if (!Object.hasOwn(deps, key)) throw Error('Unexpected dependency: ' + key)
    return deps[key]
  }
  mod._compile(js, filename)
  return mod.exports.XDriveMediaGalleryNavigation
}
const Navigation = originalNavigation()

function owner(compact) {
  const mutations = []
  const requests = []
  const record = key => value => { mutations.push({ key, value }) }
  let generation = 0
  let publishSection = () => {}
  const env = {
    // A3h Cell isolation: no Cell request is active in this legacy fixture.
    nativeCellOpenAbort: { current: null },
    useCallback: fn => fn,
    mobileGalleryViewport: compact,
    placesReturnPageRef: { current: null },
    placeOpenedFromCollectionsRef: { current: false },
    placesCameraRef: { current: null },
    placePageRequestID: { current: 0 },
    syncFolderRequestID: { current: 0 },
    placesExpandedRef: { current: false },
    routeSectionAppliedRef: { current: null },
    emptyMediaGalleryFilterDraft: {},
    setLastOpenedPlaceID: record('place'),
    setPlacesPagePending: record('place-pending'),
    setPlacesPageError: record('place-error'),
    setCurrentFolderView: record('folder'),
    setCurrentPet: record('pet'),
    setCurrentMemory: record('memory'),
    setCurrentCleanupReview: record('review'),
    setSection: value => { record('section')(value); publishSection(value) },
    setActiveMediaType: record('media-type'),
    setDraftFilters: record('draft'),
    setQuery: record('query'),
    setMobileCollectionsOverview: record('collections'),
    onSectionRouteChange: record('route'),
    mediaGallerySectionDraft: section => ({ section }),
    mediaGalleryQueryFromDraft: draft => ({ ...draft }),
    loadMemories: () => {},
    loadCleanup: () => {},
    // An independently verified compact Cleanup callback is not invoked here.
    openCleanupFromCollections: () => {},
    loadSyncFolders: () => {},
    loadFirstPage: (...args) => {
      const ticket = ++generation
      requests.push({
        args,
        accept: () => { if (ticket === generation) args[8]?.() },
        fail: () => {},
      })
      return Promise.resolve()
    },
  }
  return {
    mutations, requests, callbacks: actualCallbacks(env),
    setPublisher: callback => { publishSection = callback },
  }
}
const count = (mutations, key, value) => mutations.filter(
  entry => entry.key === key && (value === undefined || entry.value === value),
).length

test('P96 original mounted Gallery navigation holds previous section for held, failed, stale Trash reads', async () => {
  const state = owner(true)
  let view
  function Page() {
    const [section, setSection] = React.useState('albums')
    state.setPublisher(setSection)
    return React.createElement(Navigation, {
      value: section, onChange: state.callbacks.selectSection, layout: 'drawer',
    })
  }
  const button = section => view.root.findAll(
    n => n.props?.['data-xdrive-gallery-section'] === section,
  )[0]
  try {
    await act(async () => { view = Renderer.create(React.createElement(Page)) })
    assert.equal(button('albums').props['aria-current'], 'page')
    await act(async () => { button('trash').props.onClick() })
    assert.equal(state.requests.length, 1)
    assert.equal(state.requests[0].args[4], 'trash')
    assert.equal(typeof state.requests[0].args[8], 'function',
      'compact navigation must await the original committed first Range')
    assert.equal(count(state.mutations, 'section'), 0)
    assert.equal(count(state.mutations, 'route'), 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 365)) })
    assert.equal(button('albums').props['aria-current'], 'page')
    assert.equal(count(state.mutations, 'section'), 0)
    await act(async () => { state.requests[0].fail() })
    assert.equal(button('albums').props['aria-current'], 'page')
    await act(async () => { button('trash').props.onClick() })
    assert.equal(state.requests.length, 2)
    await act(async () => { state.requests[0].accept() })
    assert.equal(button('albums').props['aria-current'], 'page')
    await act(async () => { state.requests[1].accept() })
    assert.equal(button('trash').props['aria-current'], 'page')
    assert.equal(count(state.mutations, 'section', 'trash'), 1)
    assert.equal(count(state.mutations, 'route', 'trash'), 1)
    assert.equal(count(state.mutations, 'collections', false), 1)
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('P96 newer ordinary Gallery intent invalidates obsolete compact Trash first Range', () => {
  const state = owner(true)
  state.callbacks.selectSection('trash')
  assert.equal(state.requests.length, 1)
  state.callbacks.selectSection('library')
  assert.equal(state.requests.length, 2)
  assert.equal(count(state.mutations, 'section'), 0,
    'new Library intent must not reveal an unverified intermediary')
  state.requests[0].accept()
  assert.equal(count(state.mutations, 'section', 'trash'), 0)
  assert.equal(count(state.mutations, 'route', 'trash'), 0)
  assert.equal(count(state.mutations, 'section', 'library'), 0,
    'stale Trash cannot commit and Library still awaits its own Range')
  state.requests[1].accept()
  assert.equal(count(state.mutations, 'section', 'library'), 1)
  assert.equal(count(state.mutations, 'route', 'library'), 1)
})

test('P96 wide Web/Desktop Trash section navigation remains immediate', () => {
  const state = owner(false)
  state.callbacks.selectSection('trash')
  assert.equal(count(state.mutations, 'section', 'trash'), 1)
  assert.equal(count(state.mutations, 'route', 'trash'), 1)
  assert.equal(state.requests.length, 1)
  assert.equal(state.requests[0].args[4], 'trash')
  assert.equal(state.requests[0].args[8], undefined)
})

test('P96 original first-Range acceptance and permanent AGENTS rule', () => {
  const start = originalGallery.indexOf('  const loadFirstPage = useCallback')
  const end = originalGallery.indexOf('\n\n  const loadMemories =', start)
  assert.ok(start > 0 && end > start)
  const loader = originalGallery.slice(start, end)
  assert.match(loader, /const stagedNavigation = Boolean\(onCommitted\)/)
  assert.match(loader, /if \(!stagedNavigation\) commitTarget\(\)/)
  assert.equal((loader.match(/const range = await rangePromise/g) || []).length, 2)
  assert.equal((loader.match(/virtualCollection\.primePage\(\{/g) || []).length, 2)
  assert.equal((loader.match(/onCommitted\?\.\(\)/g) || []).length, 2)
  const selected = declaration('selectSection')
  assert.match(selected, /mobileGalleryViewport && nextSection === 'trash'/)
  assert.match(selected, /openTrashFromCollections\(\)/)
  assert.doesNotMatch(selected, /setTimeout|CircularProgress/)
  const agents = read('AGENTS.md')
  assert.equal(agents.split('P96 Mobile Gallery Trash-tab atomic navigation (mandatory)').length, 2)
})
