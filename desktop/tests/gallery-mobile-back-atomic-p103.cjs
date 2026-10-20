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
  const agents = read('AGENTS.md')
  assert.equal(agents.split('## P103 · Mobile Gallery detail Back must wait for verified first photo Range').length, 2)
})
