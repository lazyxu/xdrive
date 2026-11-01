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
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const source = read('ui/shared/src/mui/MediaGallery.tsx')
const ast = ts.createSourceFile('MediaGallery.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function original(name) {
  const matches = []
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1, 'mount original production ' + name)
  return matches[0].getText(ast)
}
function createBack(env) {
  const factory = 'function instantiate() { const ' + original('leaveCollection') +
    '; return leaveCollection; }'
  const js = ts.transpileModule(factory, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  return new Function(...Object.keys(env), js +
    '\nreturn instantiate();')(...Object.values(env))
}
function harness(kind, mobile = true) {
  const requests = [], updates = []
  let publish = () => {}
  const record = key => value => updates.push({ key, value })
  let generation = 0
  const env = {
    // Map-entry return state lives in the original full Gallery instance.
    // Ordinary Back fixtures have no outstanding map return intention.
    mapGalleryEntryReturnRef: { current: null },
    source: {}, preferenceScope: 'p103', currentAlbum: null,
    onSectionRouteChange: () => {},
    onMobileAlbumSelectionChange: record('albumReturn'),
    // A3h Cell isolation: this is an ordinary non-Cell Gallery Back fixture.
    collectionTargetRef: { current: null },
    leaveBaiduCellWall: () => { throw new Error('ordinary Gallery Back must not leave a Cell wall') },
    useCallback: fn => fn,
    mobileGalleryViewport: mobile,
    section: kind === 'media-type' ? 'media-types' :
      kind === 'place' ? 'places' : kind === 'album' ? 'albums' :
        kind === 'person' ? 'people' : 'people',
    activeMediaType: kind === 'media-type' ? 'video' : '',
    currentPet: kind === 'pet' ? { id: 41, name: '宠物' } : null,
    currentFolderView: null,
    currentCleanupReview: null,
    currentMemory: null,
    query: kind === 'place' ? { place: 'local:27' } : {},
    placeOpenedFromCollectionsRef: { current: kind === 'place' },
    mediaGallerySectionDraft: section => ({ section }),
    mediaGalleryQueryFromDraft: draft => ({ ...draft }),
    setCurrentPet: value => { record('pet')(value); publish({ pet: Boolean(value) }) },
    setActiveMediaType: value => { record('mediaType')(value); publish({ mediaType: value }) },
    setDraftFilters: record('draft'),
    setQuery: record('query'),
    setMobileCollectionsOverview: value => { record('collections')(value); publish({ collections: value }) },
    openSyncFolderDirectory: () => {},
    selectSection: () => {},
    setCurrentFolderView: record('folder'),
    loadCleanup: () => {},
    openCleanupFromCollections: () => {},
    loadMemories: () => {},
    loadFirstPage(...args) {
      const ticket = ++generation
      const receipt = args[8]
      requests.push({
        args, firstRange: true,
        accept: () => { if (ticket === generation) receipt?.() },
        fail: () => {},
      })
      return Promise.resolve()
    },
  }
  const back = createBack(env)
  function Page() {
    const [ui, setUi] = React.useState({
      pet: kind === 'pet', mediaType: env.activeMediaType, collections: false,
    })
    publish = partial => setUi(old => ({ ...old, ...partial }))
    return React.createElement('div', { 'data-p103-shell': true },
      React.createElement('button', { 'data-p103-back': true, onClick: back }, '返回'),
      React.createElement('div', {
        'data-p103-committed': true,
        'data-p103-pet': ui.pet,
        'data-p103-media-type': ui.mediaType,
        'data-p103-collections': ui.collections,
      }, '已确认的原照片与滚动容器'),
    )
  }
  return { Page, env, requests, updates }
}
const count = (updates, key) => updates.filter(x => x.key === key).length
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
function committed(view) {
  return view.root.findByProps({ 'data-p103-committed': true }).props
}
async function mounted(kind, run) {
  const h = harness(kind)
  let view
  try {
    await act(async () => { view = Renderer.create(React.createElement(h.Page)) })
    await run(h, view)
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
}

test('P103 original mounted Mobile Pet Back never clears accepted detail before real Range0', async () => {
  await mounted('pet', async (h, view) => {
    const back = () => view.root.findByProps({ 'data-p103-back': true }).props.onClick()
    await act(async () => { back() })
    assert.equal(h.requests.length, 1)
    assert.equal(h.requests[0].args[8] instanceof Function, true)
    assert.equal(committed(view)['data-p103-pet'], true)
    assert.equal(count(h.updates, 'pet'), 0)
    await act(async () => { await wait(370) })
    assert.equal(committed(view)['data-p103-pet'], true, 'held network cannot blank detail')
    await act(async () => { h.requests[0].fail() })
    assert.equal(committed(view)['data-p103-pet'], true, 'failure retains old content')
    await act(async () => { back() })
    assert.equal(h.requests.length, 2)
    await act(async () => { h.requests[0].accept() })
    assert.equal(committed(view)['data-p103-pet'], true, 'superseded return cannot commit')
    await act(async () => { h.requests[1].accept() })
    assert.equal(committed(view)['data-p103-pet'], false, 'accepted empty/nonempty Range owns commit')
    assert.equal(count(h.updates, 'pet'), 1)
  })
})

test('P103 original mounted Mobile Media-Type Back preserves selected tab and filters through slow/failed network', async () => {
  await mounted('media-type', async (h, view) => {
    const back = () => view.root.findByProps({ 'data-p103-back': true }).props.onClick()
    await act(async () => { back() })
    assert.equal(h.requests.length, 1)
    assert.equal(typeof h.requests[0].args[8], 'function')
    assert.equal(committed(view)['data-p103-media-type'], 'video')
    assert.equal(count(h.updates, 'mediaType'), 0)
    assert.equal(count(h.updates, 'draft'), 0)
    assert.equal(count(h.updates, 'query'), 0)
    await act(async () => { await wait(370) })
    assert.equal(committed(view)['data-p103-media-type'], 'video')
    await act(async () => { h.requests[0].accept() })
    assert.equal(committed(view)['data-p103-media-type'], '')
    assert.equal(count(h.updates, 'mediaType'), 1)
    assert.equal(count(h.updates, 'draft'), 1)
    assert.equal(count(h.updates, 'query'), 1)
  })
})

test('P103 compact Album/Person/Place detail Back keeps query/Collections anchor until latest verified receipt', async () => {
  for (const kind of ['album', 'person', 'place']) {
    await mounted(kind, async (h, view) => {
      const back = () => view.root.findByProps({ 'data-p103-back': true }).props.onClick()
      await act(async () => { back() })
      assert.equal(h.requests.length, 1, kind)
      assert.equal(typeof h.requests[0].args[8], 'function', kind)
      assert.equal(count(h.updates, 'draft'), 0, kind)
      assert.equal(count(h.updates, 'query'), 0, kind)
      assert.equal(count(h.updates, 'collections'), 0, kind)
      assert.equal(committed(view)['data-p103-collections'], false)
      await act(async () => { back() })
      await act(async () => { h.requests[0].accept() })
      assert.equal(count(h.updates, 'query'), 0, kind + ' older GET')
      await act(async () => { h.requests[1].accept() })
      assert.equal(count(h.updates, 'query'), 1, kind + ' latest GET')
      assert.equal(count(h.updates, 'draft'), 1)
      assert.equal(count(h.updates, 'collections'), kind === 'place' ? 1 : 0)
      if (kind === 'place') {
        assert.equal(committed(view)['data-p103-collections'], true)
        assert.equal(h.env.placeOpenedFromCollectionsRef.current, false)
      }
    })
  }
})

test('P103 compact Album Back clears mobile return only after accepted first Range', () => {
  const h = harness('album')
  const back = createBack({ ...h.env, currentAlbum: {
    id: 'owner-album-a', kind: 'manual', name: '相册 A', item_count: 1,
  } })
  back()
  assert.equal(h.requests.length, 1)
  assert.equal(count(h.updates, 'albumReturn'), 0, 'pending Back retains the Album target')
  h.requests[0].fail()
  assert.equal(count(h.updates, 'albumReturn'), 0, 'failed Back cannot discard Album target')
  back()
  h.requests[0].accept()
  assert.equal(count(h.updates, 'albumReturn'), 0, 'superseded Back cannot discard it')
  h.requests[1].accept()
  assert.deepEqual(h.updates.filter(x => x.key === 'albumReturn').map(x => x.value),
    [null], 'only accepted index Range clears the mobile Album target')
})


/** Mount the exact production Gallery header Back layout effect with a
 * minimal hook fixture; do not duplicate its detail/Owner routing logic. */
function registerOriginalHeaderBack(env) {
  const matches = []
  function visit(node) {
    if (ts.isCallExpression(node) &&
        node.expression.getText(ast) === 'useLayoutEffect' &&
        node.getText(ast).includes('onMobileAlbumDetailBackChange?.(leaveCollection)')) {
      matches.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1, 'one live shared Gallery header Back effect')
  const js = ts.transpileModule(
    'function mount() { ' + matches[0].getText(ast) + '; }',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  return new Function(...Object.keys(env), js + '\nreturn mount();')(...Object.values(env))
}

test('P103 committed Sync Folder detail registers original mobile header Back; index and wide Web do not', () => {
  const folder = {
    source: { source_id: 7, source_name: '设备' },
    current: { id: 12, name: '照片' },
    breadcrumbs: [{ id: 12, name: '照片' }],
    children: [],
  }
  const cases = [
    { label: 'Sync Folder', section: 'albums', mobile: true, album: null, folder, expected: true },
    { label: 'ordinary Album', section: 'albums', mobile: true, album: { id: 'a' }, folder: null, expected: true },
    { label: 'Albums index', section: 'albums', mobile: true, album: null, folder: null, expected: false },
    { label: 'another section', section: 'library', mobile: true, album: null, folder, expected: false },
    { label: 'wide Web', section: 'albums', mobile: false, album: null, folder, expected: false },
  ]
  for (const sample of cases) {
    const registrations = []
    const back = () => undefined
    const callback = fn => registrations.push(fn)
    registerOriginalHeaderBack({
      mobileGalleryViewport: sample.mobile,
      section: sample.section,
      currentAlbum: sample.album,
      currentFolderView: sample.folder,
      leaveCollection: back,
      onMobileAlbumDetailBackChange: callback,
      useLayoutEffect: effect => { const cleanup = effect(); if (cleanup) cleanup() },
    })
    assert.deepEqual(registrations, sample.expected ? [back, null] : [], sample.label)
  }
})

test('P103 real Sync Folder opens only replace stale Album tab-return hint after accepted first Range', async () => {
  const records = [], requests = [], callbacks = []
  const record = kind => value => records.push({ kind, value })
  const sourceFolder = {
    source: { source_id: 7, source_name: '备份' },
    current: { id: 12, name: '照片' },
    breadcrumbs: [{ id: 12, name: '照片' }],
    children: [],
  }
  const env = {
    useCallback: fn => fn,
    source: { getSyncFolder: async () => sourceFolder },
    syncFolderRequestID: { current: 0 },
    setSyncFoldersLoading: record('loading'),
    setSyncFoldersError: record('error'),
    draftFilters: {},
    query: { include_descendants: false },
    emptyMediaGalleryFilterDraft: {},
    mediaGalleryQueryFromDraft: draft => ({ ...draft }),
    mobileGalleryViewport: true,
    setCurrentFolderView: record('folder'),
    setCurrentAlbum: record('album'),
    setCurrentSuggestedPerson: record('suggested'),
    setCurrentPerson: record('person'),
    setCurrentPet: record('pet'),
    setCurrentMemory: record('memory'),
    setCurrentCleanupReview: record('cleanup'),
    setSection: record('section'),
    setActiveMediaType: record('mediaType'),
    setDraftFilters: record('draft'),
    setQuery: record('query'),
    setMobileCollectionsOverview: record('collections'),
    onMobileAlbumSelectionChange: record('albumReturn'),
    onError: error => { throw error },
    loadFirstPage: async (...args) => { requests.push(args) },
  }
  const factory = 'function instantiate() { const ' + original('openSyncFolderDirectory') +
    '; return openSyncFolderDirectory; }'
  const js = ts.transpileModule(factory, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const open = new Function(...Object.keys(env), js + '\nreturn instantiate();')(...Object.values(env))
  await open(7, 12, true, true)
  assert.equal(requests.length, 1)
  assert.equal(typeof requests[0][8], 'function', 'first authorized Range owns folder commit')
  assert.equal(records.filter(x => x.kind === 'albumReturn').length, 0,
    'metadata alone cannot clear the previous accepted Album return')
  assert.equal(records.filter(x => x.kind === 'folder').length, 0,
    'metadata alone cannot display a new folder detail')
  await open(7, 13, true, true)
  requests[0][8]()
  assert.equal(records.filter(x => x.kind === 'albumReturn').length, 0,
    'superseded folder Range cannot invalidate the last Album')
  requests[1][8]()
  assert.deepEqual(records.filter(x => x.kind === 'albumReturn').map(x => x.value),
    [null], 'only the accepted current folder Range clears the stale Album return')
  assert.equal(records.filter(x => x.kind === 'folder').length, 1)

  const wideRecords = []
  const wideEnv = {
    ...env, mobileGalleryViewport: false,
    onMobileAlbumSelectionChange: value => wideRecords.push(value),
    loadFirstPage: async () => undefined,
  }
  const wide = new Function(...Object.keys(wideEnv), js + '\nreturn instantiate();')(
    ...Object.values(wideEnv))
  await wide(7, 12, true, true)
  assert.deepEqual(wideRecords, [], 'wide Web/Desktop never changes mobile Album return')
})

test('P103 nested Sync Folder header Back delegates to the original authorized ancestor navigation', () => {
  const h = harness('album')
  const requests = []
  const folder = {
    source: { source_id: 7 },
    current: { id: 33 },
    breadcrumbs: [{ id: 12 }, { id: 33 }],
  }
  const back = createBack({
    ...h.env,
    currentFolderView: folder,
    openSyncFolderDirectory: (...args) => requests.push(args),
  })
  back()
  assert.deepEqual(requests, [[7, 12]])
  assert.equal(h.requests.length, 0, 'header Back must not open Library Range for an ancestor folder')
  assert.equal(h.updates.length, 0, 'pending nested Back retains the verified folder view')
})

test('P103 wide Web/Desktop Pet and detail Back retain their pre-existing eager navigation', () => {
  for (const kind of ['pet', 'media-type', 'album', 'place']) {
    const h = harness(kind, false)
    // Not mounted: verify sync behavior in the actual original callback.
    const back = createBack({
      ...h.env,
      setCurrentPet: value => h.updates.push({ key: 'pet', value }),
      setActiveMediaType: value => h.updates.push({ key: 'mediaType', value }),
      setDraftFilters: value => h.updates.push({ key: 'draft', value }),
      setQuery: value => h.updates.push({ key: 'query', value }),
      setMobileCollectionsOverview: value => h.updates.push({ key: 'collections', value }),
    })
    back()
    assert.equal(h.requests.length, 1)
    assert.equal(h.requests[0].args[8], undefined)
    if (kind === 'pet') assert.equal(count(h.updates, 'pet'), 1)
    else { assert.equal(count(h.updates, 'draft'), 1); assert.equal(count(h.updates, 'query'), 1) }
  }
})

test('P103 source-exact original first-Range guards and permanent AGENTS rule', () => {
  const back = original('leaveCollection')
  const first = original('loadFirstPage')
  assert.match(back, /if \(mobileGalleryViewport\) \{/)
  assert.match(back, /void loadFirstPage\(null, \{\}, null, null, 'default', null, null, null, \(\) => \{/)
  assert.match(back, /void loadFirstPage\(null, nextQuery, null, null, 'default',/)
  assert.match(back, /null, null, null, commitReturn\)/)
  assert.match(first, /const stagedNavigation = Boolean\(onCommitted\)/)
  assert.match(first, /if \(!stagedNavigation\) commitTarget\(\)/)
  assert.match(first, /request !== requestID\.current/)
  assert.match(first, /virtualCollection\.primePage\(/)
  assert.ok(source.includes('onBack={leaveCollection}'))
  assert.ok(source.includes('XDriveMediaAsyncThumbnail'))
  assert.ok(source.includes('XDriveMediaAsyncVideoPoster'))
  const agents = read('docs/history/AGENTS-2026-10-27-before-consolidation.md')
  assert.equal(agents.split('## P103 · Mobile Gallery detail Back must wait for verified first photo Range').length, 2)
})
