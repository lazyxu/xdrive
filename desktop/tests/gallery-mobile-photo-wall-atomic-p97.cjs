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
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const source = read('ui/shared/src/mui/MediaGallery.tsx')
const ast = ts.createSourceFile('MediaGallery.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function declaration(name) {
  const found = []
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found.push(node)
    ts.forEachChild(node, walk)
  }
  walk(ast)
  assert.equal(found.length, 1, 'must execute the one ORIGINAL ' + name)
  return found[0].getText(ast)
}
function actualCallbacks(env) {
  const factory = 'function instantiate() { const ' +
    declaration('openTrashFromCollections') + '; const ' +
    declaration('openCompactPhotoSection') + '; const ' +
    declaration('selectSection') +
    '; return { openCompactPhotoSection, selectSection }; }'
  const js = ts.transpileModule(factory, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(env), js + '\nreturn instantiate();')(...Object.values(env))
}
function originalNavigation() {
  const rel = 'ui/shared/src/mui/MediaGalleryNavigation.tsx'
  const name = path.join(root, rel)
  const js = ts.transpileModule(read(rel), {
    fileName: name, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText
  const mod = new Module(name, module)
  mod.filename = name
  mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
  const deps = {
    '@mui/material': { Button: 'button', Stack: 'stack', Tooltip: 'tooltip' },
    'react/jsx-runtime': require('react/jsx-runtime'),
  }
  mod.require = key => {
    if (!Object.hasOwn(deps, key)) throw Error('Unexpected original Nav dependency: ' + key)
    return deps[key]
  }
  mod._compile(js, name)
  return mod.exports.XDriveMediaGalleryNavigation
}
const Navigation = originalNavigation()

function owner(mobile) {
  const updates = []
  const requests = []
  const remember = key => value => updates.push({ key, value })
  let generation = 0
  let setShown = () => {}
  const routeSectionAppliedRef = { current: 'albums' }
  const env = {
    // A3h Cell isolation: no Cell request is active in this legacy fixture.
    nativeCellOpenAbort: { current: null },
    useCallback: fn => fn,
    mobileGalleryViewport: mobile,
    placesReturnPageRef: { current: null },
    placeOpenedFromCollectionsRef: { current: false },
    placesCameraRef: { current: null },
    placePageRequestID: { current: 0 },
    syncFolderRequestID: { current: 0 },
    placesExpandedRef: { current: false },
    routeSectionAppliedRef,
    emptyMediaGalleryFilterDraft: {},
    setLastOpenedPlaceID: remember('place'),
    setPlacesPagePending: remember('placesPending'),
    setPlacesPageError: remember('placesError'),
    setCurrentFolderView: remember('folder'),
    setCurrentPet: remember('pet'),
    setCurrentMemory: remember('memory'),
    setCurrentCleanupReview: remember('review'),
    setSection: section => { remember('section')(section); setShown(section) },
    setActiveMediaType: remember('mediaType'),
    setDraftFilters: remember('draft'),
    setQuery: remember('query'),
    setMobileCollectionsOverview: remember('collections'),
    onSectionRouteChange: remember('route'),
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
  return { updates, requests, env, routeSectionAppliedRef,
    callbacks: actualCallbacks(env), setPublisher: setter => { setShown = setter } }
}
const count = (list, key, value) => list.filter(
  record => record.key === key && (value === undefined || record.value === value),
).length

test('P97 original mounted Gallery Favorites/Library tabs hold accepted page under held, failed and superseded Range0', async () => {
  const state = owner(true)
  let view
  function Page() {
    const [section, setSection] = React.useState('albums')
    state.setPublisher(setSection)
    return React.createElement(Navigation, {
      value: section, onChange: state.callbacks.selectSection, layout: 'drawer',
    })
  }
  const button = id => view.root.findAll(n => n.props?.['data-xdrive-gallery-section'] === id)[0]
  try {
    await act(async () => { view = Renderer.create(React.createElement(Page)) })
    await act(async () => { button('favorites').props.onClick() })
    assert.equal(state.requests.length, 1)
    assert.equal(state.requests[0].args[1].section, 'favorites')
    assert.equal(typeof state.requests[0].args[8], 'function')
    assert.equal(button('albums').props['aria-current'], 'page')
    assert.equal(count(state.updates, 'section'), 0)
    assert.equal(count(state.updates, 'route'), 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 365)) })
    assert.equal(button('albums').props['aria-current'], 'page',
      'no 300ms decorative blank or switch')
    assert.equal(view.root.findAll(n => n.type === 'circularprogress').length, 0)
    await act(async () => { state.requests[0].fail() })
    assert.equal(count(state.updates, 'section'), 0)
    await act(async () => { button('favorites').props.onClick() })
    await act(async () => { button('library').props.onClick() })
    assert.equal(state.requests.length, 3)
    assert.equal(state.requests[2].args[1].section, 'library')
    await act(async () => { state.requests[1].accept() })
    assert.equal(count(state.updates, 'section'), 0, 'stale Favorites must not commit')
    await act(async () => { state.requests[2].accept() })
    assert.equal(button('library').props['aria-current'], 'page')
    assert.equal(count(state.updates, 'section', 'library'), 1)
    assert.equal(count(state.updates, 'route', 'library'), 1)
    assert.equal(count(state.updates, 'collections', false), 1)
    assert.equal(state.routeSectionAppliedRef.current, 'library',
      'own route echo must not trigger a second first Range')
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('P97 compact Favorites verified-zero commits once, reverse Library waits for its own first Range', () => {
  const state = owner(true)
  state.callbacks.selectSection('favorites')
  assert.equal(count(state.updates, 'section'), 0)
  state.requests[0].accept()
  assert.equal(count(state.updates, 'section', 'favorites'), 1)
  assert.equal(count(state.updates, 'route', 'favorites'), 1)
  assert.equal(state.routeSectionAppliedRef.current, 'favorites')
  state.callbacks.selectSection('library')
  assert.equal(count(state.updates, 'section', 'library'), 0)
  state.requests[1].fail()
  assert.equal(count(state.updates, 'section', 'library'), 0)
  state.callbacks.selectSection('library')
  state.requests[2].accept()
  assert.equal(count(state.updates, 'section', 'library'), 1)
  assert.equal(count(state.updates, 'route', 'library'), 1)
})

test('P97 Wide Web/Desktop photo-wall sections preserve established immediate navigation', () => {
  const state = owner(false)
  state.callbacks.selectSection('favorites')
  assert.equal(count(state.updates, 'section', 'favorites'), 1)
  assert.equal(count(state.updates, 'route', 'favorites'), 1)
  assert.equal(state.requests.length, 1)
  assert.equal(state.requests[0].args[8], undefined)
  state.callbacks.selectSection('library')
  assert.equal(count(state.updates, 'section', 'library'), 1)
  assert.equal(state.requests[1].args[8], undefined)
})

test('P97 source-exact Gallery entrypoints preserve Collections and silent authoritative first-page gates', () => {
  const helper = declaration('openCompactPhotoSection')
  const selected = declaration('selectSection')
  const loaderStart = source.indexOf('  const loadFirstPage = useCallback')
  const loaderEnd = source.indexOf('\n\n  const loadMemories =', loaderStart)
  assert.ok(loaderStart > 0 && loaderEnd > loaderStart)
  const loader = source.slice(loaderStart, loaderEnd)
  assert.match(selected, /nextSection === 'library' \|\| nextSection === 'favorites'/)
  assert.match(selected, /openCompactPhotoSection\(nextSection\)/)
  assert.match(helper, /loadFirstPage\(null, nextQuery, null, null, 'default', null, null, null,/)
  assert.match(helper, /routeSectionAppliedRef\.current = nextSection/)
  assert.match(loader, /const stagedNavigation = Boolean\(onCommitted\)/)
  assert.match(loader, /if \(!stagedNavigation\) commitTarget\(\)/)
  assert.equal((loader.match(/onCommitted\?\.\(\)/g) || []).length, 2)
  assert.equal((loader.match(/virtualCollection\.primePage\(\{/g) || []).length, 2)
  const tab = source.slice(source.indexOf('onMobilePrimaryTabChange={(tab) => {'),
    source.indexOf('onVisibleAnchorNode={rememberMobileGalleryAnchor}'))
  assert.match(tab, /openCompactPhotoSection\('library'\)/)
  assert.match(tab, /collectionTargetRef\.current\?\.kind === 'all'/)
  const child = source.slice(source.indexOf('onOpenSection={(next) => {'),
    source.indexOf('onOpenAlbum={onOpenAlbum}', source.indexOf('onOpenSection={(next) => {')))
  assert.match(child, /next !== 'library' && next !== 'favorites'/)
  const route = source.slice(source.indexOf('  useEffect(() => {\n    const nextSection = initialSection'),
    source.indexOf('\n\n  useEffect(() => () => {\n    requestID', source.indexOf('const nextSection = initialSection')))
  assert.match(route, /pendingCompactPhoto/)
  assert.match(route, /if \(!pendingCompactPhoto\) setMobileCollectionsOverview\(false\)/)
  assert.ok(source.includes('XDriveMediaAsyncThumbnail'))
  assert.ok(source.includes('XDriveMediaAsyncVideoPoster'))
  const agents = read('AGENTS.md')
  assert.equal(agents.split('P97 Mobile Gallery Library/Favorites atomic photo-wall navigation (mandatory)').length, 2)
})
