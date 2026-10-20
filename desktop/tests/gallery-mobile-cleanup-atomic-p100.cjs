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
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const originalGallery = read('ui/shared/src/mui/MediaGallery.tsx')
const ast = ts.createSourceFile('MediaGallery.tsx', originalGallery, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function declaration(name) {
  const found = []
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found.push(node)
    ts.forEachChild(node, walk)
  }
  walk(ast)
  assert.equal(found.length, 1, 'one ORIGINAL production ' + name)
  return found[0].getText(ast)
}
function callbacks(env) {
  // Execute original production callbacks in their real lexical order.
  const factory = 'function instantiate() { const ' +
    declaration('openCleanupFromCollections') + '; const ' +
    declaration('selectSection') +
    '; return { openCleanupFromCollections, selectSection }; }'
  const js = ts.transpileModule(factory, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(env), js + '\nreturn instantiate();')(...Object.values(env))
}
function navigation() {
  const rel = 'ui/shared/src/mui/MediaGalleryNavigation.tsx'
  const filename = path.join(root, rel)
  const js = ts.transpileModule(read(rel), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
  const deps = {
    '@mui/material': { Button: 'button', Stack: 'stack', Tooltip: 'tooltip' },
    'react/jsx-runtime': require('react/jsx-runtime'),
  }
  mod.require = key => {
    if (!Object.hasOwn(deps, key)) throw Error('Unexpected Gallery Navigation import ' + key)
    return deps[key]
  }
  mod._compile(js, filename)
  return mod.exports.XDriveMediaGalleryNavigation
}
const Navigation = navigation()
const count = (updates, key, value) => updates.filter(
  x => x.key === key && (value === undefined || x.value === value),
).length
function owner(mobile) {
  const updates = [], pending = []
  const emit = key => value => { updates.push({ key, value }) }
  let renderSection = () => {}
  const requestID = { current: 0 }
  const routeSectionAppliedRef = { current: 'albums' }
  const source = { listBurstReviews(...args) {
    return new Promise((resolve, reject) => { pending.push({ args, resolve, reject }) })
  } }
  const env = {
    // A3h Cell isolation: no Cell request is active in this legacy fixture.
    nativeCellOpenAbort: { current: null },
    useCallback: fn => fn,
    mobileGalleryViewport: mobile,
    requestID, routeSectionAppliedRef, source, preferenceScope: 'p100',
    cleanupMoreInFlightRef: { current: false },
    collectionTargetRef: { current: { kind: 'album', requestID: 7 } },
    virtualCollection: { reset: emit('reset') },
    emptyMediaTimelineGroupSets: () => ({}),
    emptyMediaGalleryFilterDraft: {},
    placesReturnPageRef: { current: null },
    placeOpenedFromCollectionsRef: { current: false },
    placesCameraRef: { current: null },
    placePageRequestID: { current: 0 },
    placesExpandedRef: { current: false },
    syncFolderRequestID: { current: 0 },
    setLoading: emit('loading'), setError: emit('error'),
    reportError: emit('reported-error'),
    setCleanupMoreLoading: emit('more'), setCollectionTarget: emit('target'),
    setCurrentAlbum: emit('album'), setCurrentSuggestedPerson: emit('suggested'),
    setCurrentPerson: emit('person'), setCurrentPet: emit('pet'),
    setCurrentMemory: emit('memory'), setCurrentCleanupReview: emit('review'),
    setCurrentFolderView: emit('folder'),
    setLastOpenedPlaceID: emit('place'), setPlacesPagePending: emit('pending-place'),
    setPlacesPageError: emit('place-error'), setItems: emit('items'),
    setTimelineGroupSets: emit('timeline'), setBurstReviews: emit('bursts'),
    setCleanupIndexReceipt: emit('receipt'),
    setSection: section => { emit('section')(section); renderSection(section) },
    setActiveMediaType: emit('mediaType'), setDraftFilters: emit('draft'),
    setQuery: emit('query'), setMobileCollectionsOverview: emit('collections'),
    onSectionRouteChange: emit('route'),
    mediaGallerySectionDraft: section => ({ section }),
    mediaGalleryQueryFromDraft: draft => ({ ...draft }),
    openTrashFromCollections: () => {},
    openCompactPhotoSection: () => {},
    loadMemories: () => {},
    loadCleanup: () => emit('wide-cleanup')('requested'),
    loadSyncFolders: () => {},
    loadFirstPage: () => {},
  }
  return { updates, pending, requestID, routeSectionAppliedRef,
    callbacks: callbacks(env), publish: fn => { renderSection = fn } }
}

test('P100 real mounted compact Navigation retains accepted section through held, failed and accepted Cleanup list', async () => {
  const h = owner(true)
  let view
  function Page() {
    const [section, setSection] = React.useState('albums')
    h.publish(setSection)
    return React.createElement(Navigation, {
      value: section, onChange: h.callbacks.selectSection, layout: 'drawer',
    })
  }
  const button = value => view.root.findAll(n => n.props?.['data-xdrive-gallery-section'] === value)[0]
  try {
    await act(async () => { view = Renderer.create(React.createElement(Page)) })
    await act(async () => { button('cleanup').props.onClick() })
    assert.equal(h.pending.length, 1)
    assert.deepEqual(h.pending[0].args, [48, 0])
    assert.equal(button('albums').props['aria-current'], 'page')
    for (const key of ['section', 'route', 'items', 'target', 'reset', 'collections']) {
      assert.equal(count(h.updates, key), 0, key + ' must not change on an intent')
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 365)) })
    assert.equal(button('albums').props['aria-current'], 'page')
    assert.equal(view.root.findAll(n => n.type === 'circularprogress').length, 0)
    await act(async () => { h.pending[0].reject(new Error('weak WAN')) })
    assert.equal(count(h.updates, 'reported-error'), 1)
    assert.equal(count(h.updates, 'reset'), 0)
    await act(async () => { button('cleanup').props.onClick() })
    await act(async () => { h.pending[1].resolve({ groups: [], total_groups: 0 }) })
    assert.equal(button('cleanup').props['aria-current'], 'page')
    for (const key of ['section', 'route', 'items', 'reset', 'bursts', 'receipt']) {
      assert.equal(count(h.updates, key), 1, key + ' commits exactly once')
    }
    assert.equal(count(h.updates, 'collections', false), 1)
    assert.equal(h.routeSectionAppliedRef.current, 'cleanup',
      'accepted route echo cannot start an extra network read')
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('P100 superseded Cleanup list cannot replace a newer accepted request', async () => {
  const h = owner(true)
  h.callbacks.selectSection('cleanup')
  h.callbacks.selectSection('cleanup')
  assert.equal(h.pending.length, 2)
  await act(async () => { h.pending[0].resolve({ groups: [{ id: 'stale' }], total_groups: 1 }) })
  assert.equal(count(h.updates, 'section'), 0)
  assert.equal(count(h.updates, 'reset'), 0)
  await act(async () => { h.pending[1].resolve({ groups: [{ id: 'new' }], total_groups: 1 }) })
  assert.equal(count(h.updates, 'section', 'cleanup'), 1)
  assert.equal(count(h.updates, 'reset'), 1)
})

test('P100 Wide Web/Desktop remains on established eager Cleanup section route', () => {
  const h = owner(false)
  h.callbacks.selectSection('cleanup')
  assert.equal(count(h.updates, 'section', 'cleanup'), 1)
  assert.equal(count(h.updates, 'route', 'cleanup'), 1)
  assert.equal(count(h.updates, 'wide-cleanup', 'requested'), 1)
  assert.equal(h.pending.length, 0)
})

test('P100 original Refresh, Back, post-delete and route source preserve one current Owner receipt', () => {
  const select = declaration('selectSection')
  const helper = declaration('openCleanupFromCollections')
  assert.match(select, /mobileGalleryViewport && nextSection === 'cleanup'/)
  assert.match(select, /openCleanupFromCollections\(\)/)
  assert.match(helper, /const nextBursts = await source\.listBurstReviews\(48, 0\)/)
  assert.match(helper, /if \(request !== requestID\.current\) return/)
  assert.ok(helper.indexOf('await source.listBurstReviews(48, 0)') <
    helper.indexOf('virtualCollection.reset('))
  assert.match(helper, /routeSectionAppliedRef\.current = 'cleanup'/)
  const refresh = declaration('refreshGallery')
  assert.match(refresh, /section === 'cleanup' && !currentCleanupReview/)
  assert.match(refresh, /if \(mobileGalleryViewport\) void openCleanupFromCollections\(\)/)
  const leave = declaration('leaveCollection')
  assert.match(leave, /if \(currentCleanupReview\)/)
  assert.match(leave, /if \(mobileGalleryViewport\) void openCleanupFromCollections\(\)/)
  assert.match(originalGallery, /section === 'cleanup' && shouldRefreshCurrentReview/)
  assert.match(originalGallery, /nextSection === 'memories' \|\| nextSection === 'cleanup'/)
  assert.match(originalGallery, /XDriveMediaAsyncThumbnail/)
  assert.match(originalGallery, /XDriveMediaAsyncVideoPoster/)
  const agents = read('AGENTS.md')
  assert.equal(agents.split('P100 Mobile Gallery Cleanup-index atomic first-list navigation (mandatory)').length, 2)
})
