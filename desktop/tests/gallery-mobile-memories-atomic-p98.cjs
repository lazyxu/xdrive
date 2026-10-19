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
const read = pathName => fs.readFileSync(path.join(root, pathName), 'utf8')
const gallerySource = read('ui/shared/src/mui/MediaGallery.tsx')
const ast = ts.createSourceFile('MediaGallery.tsx', gallerySource,
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function declaration(name) {
  const found = []
  const walk = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found.push(node)
    ts.forEachChild(node, walk)
  }
  walk(ast)
  assert.equal(found.length, 1, 'expected ORIGINAL ' + name)
  return found[0].getText(ast)
}
function originalCallbacks(env) {
  const factory = 'function instantiate() { const ' +
    declaration('loadMemories') + '; const ' +
    declaration('selectSection') + '; return { loadMemories, selectSection }; }'
  const js = ts.transpileModule(factory, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(env), js + '\nreturn instantiate();')(...Object.values(env))
}
function loadOriginalNavigation() {
  const rel = 'ui/shared/src/mui/MediaGalleryNavigation.tsx'
  const filename = path.join(root, rel)
  const js = ts.transpileModule(read(rel), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
  const deps = {
    '@mui/material': { Button: 'button', Stack: 'stack', Tooltip: 'tooltip' },
    'react/jsx-runtime': require('react/jsx-runtime'),
  }
  mod.require = name => {
    if (!Object.hasOwn(deps, name)) throw Error('unexpected original navigation module: ' + name)
    return deps[name]
  }
  mod._compile(js, filename)
  return mod.exports.XDriveMediaGalleryNavigation
}
const Navigation = loadOriginalNavigation()

function harness(mobile) {
  const updates = []
  const pending = []
  const emit = key => value => updates.push({ key, value })
  let updateShown = () => {}
  const requestID = { current: 0 }
  const routeSectionAppliedRef = { current: 'albums' }
  const source = {
    listMemories(...args) {
      return new Promise((resolve, reject) => { pending.push({ args, resolve, reject }) })
    },
  }
  const env = {
    useCallback: value => value,
    mobileGalleryViewport: mobile,
    source, preferenceScope: 'p98-a', requestID,
    collectionTargetRef: { current: { kind: 'album', requestID: 2 } },
    mediaTimeZoneRef: { current: 'Asia/Tokyo' },
    xDriveMediaDayKey: () => '2026-10-19',
    xDriveMediaGalleryErrorMessage: error => error instanceof Error ? error.message : String(error),
    virtualCollection: { reset: emit('reset') },
    setCollectionTarget: emit('target'),
    setCurrentAlbum: emit('album'),
    setCurrentSuggestedPerson: emit('suggestedPerson'),
    setCurrentPerson: emit('person'),
    setCurrentMemory: emit('memory'),
    setItems: emit('items'),
    setTimelineGroupSets: emit('timeline'),
    emptyMediaTimelineGroupSets: () => ({}),
    setLoading: emit('loading'),
    setError: emit('error'),
    setMemories: emit('memories'),
    setMemoryIndexReceipt: emit('receipt'),
    reportError: emit('reportedError'),
    placesReturnPageRef: { current: null },
    placeOpenedFromCollectionsRef: { current: false },
    placesCameraRef: { current: null },
    placePageRequestID: { current: 0 },
    syncFolderRequestID: { current: 0 },
    placesExpandedRef: { current: false },
    routeSectionAppliedRef,
    emptyMediaGalleryFilterDraft: {},
    setLastOpenedPlaceID: emit('place'),
    setPlacesPagePending: emit('placesPending'),
    setPlacesPageError: emit('placesError'),
    setCurrentFolderView: emit('folder'),
    setCurrentPet: emit('pet'),
    setCurrentCleanupReview: emit('cleanupReview'),
    setSection: value => { emit('section')(value); updateShown(value) },
    setActiveMediaType: emit('mediaType'),
    setDraftFilters: emit('draft'),
    setQuery: emit('query'),
    setMobileCollectionsOverview: emit('collections'),
    onSectionRouteChange: emit('route'),
    loadFirstPage() {},
    loadCleanup() {},
    loadSyncFolders() {},
    openTrashFromCollections() {},
    // P97 is independently merged and participates in the shared Navigation
    // callback dependencies; preserve its real source while this P98 suite
    // exercises the original Memories loader and compact section routing.
    openCompactPhotoSection() {},
    // The P100 direct Cleanup callback is a separate scoped owner in this harness.
    openCleanupFromCollections() {},
    mediaGallerySectionDraft: section => ({ section }),
    mediaGalleryQueryFromDraft: draft => ({ ...draft }),
  }
  return { updates, pending, requestID, env,
    callbacks: originalCallbacks(env),
    setPublisher: next => { updateShown = next },
    routeSectionAppliedRef,
  }
}
const count = (list, key, value) => list.filter(
  event => event.key === key && (value === undefined || event.value === value),
).length

test('P98 original mounted compact Gallery Memories tab holds accepted Album/scroll during >350ms read', async () => {
  const state = harness(true)
  let view
  function Page() {
    const [section, setSection] = React.useState('albums')
    state.setPublisher(setSection)
    return React.createElement(Navigation, {
      value: section, layout: 'drawer', onChange: state.callbacks.selectSection,
    })
  }
  const button = id => view.root.findAll(n => n.props?.['data-xdrive-gallery-section'] === id)[0]
  try {
    await act(async () => { view = Renderer.create(React.createElement(Page)) })
    await act(async () => { button('memories').props.onClick() })
    assert.equal(state.pending.length, 1)
    assert.equal(button('albums').props['aria-current'], 'page')
    for (const key of ['section', 'route', 'target', 'items', 'reset', 'memory', 'collections']) {
      assert.equal(count(state.updates, key), 0, key + ' changed on pending intent')
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 365)) })
    assert.equal(button('albums').props['aria-current'], 'page')
    assert.equal(count(state.updates, 'section'), 0)
    await act(async () => { state.pending[0].reject(new Error('weak WAN')) })
    assert.equal(button('albums').props['aria-current'], 'page')
    assert.equal(count(state.updates, 'target'), 0)
    assert.equal(count(state.updates, 'reportedError'), 1)
    await act(async () => { button('memories').props.onClick() })
    assert.equal(state.pending.length, 2)
    await act(async () => { state.pending[1].resolve([]) })
    assert.equal(button('memories').props['aria-current'], 'page')
    assert.equal(count(state.updates, 'section', 'memories'), 1)
    assert.equal(count(state.updates, 'route', 'memories'), 1)
    assert.equal(count(state.updates, 'items'), 1)
    assert.equal(count(state.updates, 'reset'), 1)
    assert.equal(count(state.updates, 'collections', false), 1)
    assert.equal(state.routeSectionAppliedRef.current, 'memories')
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('P98 superseded original list never clears prior collection or commits an obsolete Memories page', async () => {
  const state = harness(true)
  state.callbacks.selectSection('memories')
  state.callbacks.selectSection('memories')
  assert.equal(state.pending.length, 2)
  await act(async () => { state.pending[0].resolve([{ id: 'old' }]); await Promise.resolve() })
  assert.equal(count(state.updates, 'section'), 0)
  assert.equal(count(state.updates, 'reset'), 0)
  await act(async () => { state.pending[1].resolve([{ id: 'latest' }]); await Promise.resolve() })
  assert.equal(count(state.updates, 'section', 'memories'), 1)
  assert.equal(count(state.updates, 'route', 'memories'), 1)
  assert.equal(count(state.updates, 'reset'), 1)
  assert.equal(count(state.updates, 'receipt'), 1)
})

test('P98 original wide Web/Desktop Memories navigation remains immediate', async () => {
  const state = harness(false)
  state.callbacks.selectSection('memories')
  assert.equal(count(state.updates, 'section', 'memories'), 1)
  assert.equal(count(state.updates, 'route', 'memories'), 1)
  assert.equal(count(state.updates, 'reset'), 1)
  assert.equal(state.pending.length, 1)
  await act(async () => { state.pending[0].resolve([]); await Promise.resolve() })
})

test('P98 source-exact Memory return/refresh, first-list owner acceptance and AGENTS contract', () => {
  const loader = declaration('loadMemories')
  const selector = declaration('selectSection')
  assert.match(loader, /onCommitted\?: \(\) => void/)
  assert.match(loader, /if \(!onCommitted\) commitIndex\(\)/)
  assert.match(loader, /if \(request !== requestID\.current\) return/)
  assert.match(loader, /if \(onCommitted\) commitIndex\(\)/)
  assert.match(loader, /setMemoryIndexReceipt\(\{ owner: preferenceScope, dataSource: source, state: 'ready' \}\)/)
  assert.match(loader, /onCommitted\?\.\(\)/)
  assert.match(selector, /mobileGalleryViewport && nextSection === 'memories'/)
  assert.match(selector, /loadMemories\(\(\) =>/)
  assert.doesNotMatch(selector, /setTimeout|CircularProgress/)
  assert.match(gallerySource, /void loadMemories\(mobileGalleryViewport && memoriesReadState === 'ready'/)
  assert.match(gallerySource, /void loadMemories\(mobileGalleryViewport \? \(\) => \{\} : undefined\)/)
  assert.match(gallerySource, /next !== 'trash' && next !== 'cleanup' && next !== 'memories'/)
  assert.match(gallerySource, /const request = \+\+requestID\.current/)
  assert.ok(gallerySource.includes('XDriveMediaAsyncThumbnail'))
  assert.ok(gallerySource.includes('XDriveMediaAsyncVideoPoster'))
  const agents = read('AGENTS.md')
  assert.equal(agents.split('P98 compact Memories index atomic navigation and refresh (mandatory)').length, 2)
})
