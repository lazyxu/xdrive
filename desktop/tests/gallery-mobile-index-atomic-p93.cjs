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
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const originalGallery = read('ui/shared/src/mui/MediaGallery.tsx')
const ast = ts.createSourceFile('MediaGallery.tsx', originalGallery, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function declaration(name) {
  const matches = []
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) matches.push(node)
    ts.forEachChild(node, walk)
  }
  walk(ast)
  assert.equal(matches.length, 1, 'must exercise exactly one original ' + name + ' callback')
  return matches[0].getText(ast)
}

// Execute the actual callback initializer extracted from the production
// Gallery TSX, rather than hand-writing a similar navigator in the test.
// The real Page uses React.useCallback; identity is enough to execute its
// unchanged callback body under a mounted original Album Organizer.
function actualCallback(name, env) {
  const factory = 'function instantiate() { const ' + declaration(name) +
    '; return ' + name + '; }'
  const js = ts.transpileModule(factory, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(env), js + '\nreturn instantiate();')(...Object.values(env))
}

function owner(section, mobileGalleryViewport, extra = {}) {
  const mutations = []
  const requests = []
  let generation = 0
  const record = key => value => { mutations.push({ key, value }) }
  const env = {
    useCallback: fn => fn,
    mobileGalleryViewport, section,
    currentAlbum: null, currentFolderView: null,
    currentPerson: null, currentPet: null, currentSuggestedPerson: null,
    syncFolderRequestID: { current: 0 },
    query: {},
    emptyMediaGalleryFilterDraft: {},
    mediaGalleryDraftFromQuery: query => ({ smartQuery: query }),
    mediaGalleryQueryFromDraft: draft => draft,
    setCurrentFolderView: record('folder'),
    setSection: record('section'),
    setActiveMediaType: record('mediaType'),
    setDraftFilters: record('draft'),
    setQuery: record('query'),
    setMobileCollectionsOverview: record('collections'),
    loadFirstPage: async (...args) => {
      const ticket = ++generation
      requests.push({
        args,
        accept: () => {
          if (ticket === generation) args[8]?.()
        },
        // The genuine controller catches errors and never calls onCommitted
        // without an accepted current Owner response.
        fail: () => undefined,
      })
    },
    ...extra,
  }
  return { env, mutations, requests }
}

function loadOriginal(relative, deps) {
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
  mod.require = key => {
    if (!Object.hasOwn(deps, key)) throw Error('Unexpected Gallery test dependency: ' + key)
    return deps[key]
  }
  mod._compile(js, filename)
  return mod.exports
}
const folderModel = loadOriginal('ui/shared/src/mui/MediaGalleryAlbumFolderModel.ts', {})
const prefs = loadOriginal('ui/shared/src/mui/MediaGalleryAlbumOrganization.ts', {})
const mui = Object.fromEntries([
  'Alert', 'Box', 'Breadcrumbs', 'Button', 'Dialog', 'DialogActions',
  'DialogContent', 'DialogTitle', 'IconButton', 'MenuItem', 'Paper',
  'Stack', 'TextField', 'Tooltip', 'Typography',
].map(k => [k, k.toLowerCase()]))
const icons = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : 'icon' })
const Organizer = loadOriginal('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx', {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': mui,
  '@mui/icons-material': icons,
  './MediaGalleryCoverThumbnail': { XDriveMediaGalleryCoverThumbnail: 'thumbnail' },
  './MediaGalleryAlbumOrganization': prefs,
  './MediaGalleryAlbumFolderModel': folderModel,
}).XDriveMediaGalleryAlbumOrganizer
const albumA = { id: 'a', kind: 'manual', name: '相册 A', item_count: 3, cover_node_id: 1, revision: 1 }
const albumB = { id: 'b', kind: 'manual', name: '相册 B', item_count: 7, cover_node_id: 2, revision: 1 }

test('P93 mounted original Album index: held, failed, superseded clicks do not change view before accepted first Range', async () => {
  const state = owner('albums', true)
  const openAlbum = actualCallback('openAlbum', state.env)
  let view
  const card = id => view.root.findAll(n => n.props?.['data-xdrive-gallery-album'] === id)[0]
  try {
    await act(async () => {
      view = Renderer.create(React.createElement(Organizer, {
        albums: [albumA, albumB], accountScope: 'p93-gallery-atomic',
        indexVerified: true, loadThumbnail: async () => null,
        onOpenAlbum: openAlbum,
      }))
    })
    assert.ok(card('a') && card('b'))
    await act(async () => { card('a').props.onClick() })
    assert.equal(state.requests.length, 1)
    assert.equal(typeof state.requests[0].args[8], 'function')
    assert.deepEqual(state.mutations, [], 'a click is only intent; no title/rail/query change')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 365)) })
    assert.ok(card('a') && card('b'), 'the original mounted cards remain after 300ms')
    assert.equal(view.root.findAll(n => n.type === 'circularprogress').length, 0)
    assert.deepEqual(state.mutations, [], 'no artificial intermediate loader or mutated route')
    await act(async () => { state.requests[0].fail() })
    assert.deepEqual(state.mutations, [], 'failed first Range cannot commit')
    await act(async () => { card('b').props.onClick() })
    assert.equal(state.requests.length, 2)
    await act(async () => { state.requests[0].accept() })
    assert.deepEqual(state.mutations, [], 'older accepted response loses to newer intent')
    await act(async () => { state.requests[1].accept() })
    assert.deepEqual(state.mutations.filter(x => x.key === 'section').map(x => x.value), ['albums'])
    assert.equal(state.mutations.filter(x => x.key === 'folder').length, 1)
    assert.equal(state.env.syncFolderRequestID.current, 2)
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('P93 original Person and Suggested Person callbacks stage only accepted compact index cards', () => {
  const state = owner('people', true)
  const openPerson = actualCallback('openPerson', state.env)
  const openSuggestedPerson = actualCallback('openSuggestedPerson', state.env)
  openPerson({ id: 'person1', name: '人物1' })
  assert.equal(state.requests.length, 1)
  assert.equal(typeof state.requests[0].args[8], 'function')
  assert.deepEqual(state.mutations, [])
  openSuggestedPerson({ id: 'candidate1', name: '建议人物' })
  assert.equal(state.requests.length, 2)
  assert.equal(typeof state.requests[1].args[8], 'function')
  assert.deepEqual(state.mutations, [])
  state.requests[0].accept()
  assert.deepEqual(state.mutations, [], 'superseded Person response ignored')
  state.requests[1].fail()
  assert.deepEqual(state.mutations, [], 'failed Suggested Person response stays on original index')
  state.requests[1].accept()
  assert.deepEqual(state.mutations.filter(x => x.key === 'section').map(x => x.value), ['people'])
  assert.deepEqual(state.mutations.filter(x => x.key === 'query').map(x => x.value), [{}])

  const collections = owner('albums', true)
  actualCallback('openAlbum', collections.env)(albumA, true)
  assert.deepEqual(collections.mutations, [], 'existing Collections -> Album staging remains')
  collections.requests[0].accept()
  assert.deepEqual(collections.mutations.filter(x => x.key === 'collections').map(x => x.value), [false])
  const wide = owner('albums', false)
  actualCallback('openAlbum', wide.env)(albumA)
  assert.equal(wide.requests.length, 1)
  assert.deepEqual(wide.mutations.filter(x => x.key === 'section').map(x => x.value), ['albums'],
    'wide Web/Desktop established immediate path unchanged')
})

test('P93 real Gallery Server range acceptance owns the callback, not request start or Boolean loading', () => {
  const start = originalGallery.indexOf('  const loadFirstPage = useCallback')
  const end = originalGallery.indexOf('\n\n  const loadMemories =', start)
  assert.ok(start > 0 && end > start)
  const loader = originalGallery.slice(start, end)
  assert.ok(loader.includes('const stagedNavigation = Boolean(onCommitted)'))
  assert.ok(loader.includes('if (!stagedNavigation) commitTarget()'))
  const rangeStarts = [...loader.matchAll(/const range = await rangePromise/g)].map(x => x.index)
  const commits = [...loader.matchAll(/onCommitted\?\.\(\)/g)].map(x => x.index)
  assert.equal(rangeStarts.length, 2, 'both special root and regular collection ranges')
  assert.equal(commits.length, 2, 'both paths stage an accepted callback')
  for (let i = 0; i < rangeStarts.length; i++) {
    const accepted = loader.slice(rangeStarts[i], commits[i])
    assert.ok(accepted.includes('request !== requestID.current'), 'stale Owner/generation fence')
    assert.ok(accepted.includes('virtualCollection.primePage({'), 'counted first page must exist')
    assert.ok(accepted.indexOf('virtualCollection.primePage({') > accepted.indexOf('request !== requestID.current'))
  }
  for (const name of ['openAlbum', 'openPerson', 'openSuggestedPerson']) {
    const original = declaration(name)
    assert.match(original, /fromCommittedMobileIndex/)
    assert.match(original, /loadFirstPage\(/)
    assert.match(original, /commitAfterFirstRange/)
    assert.doesNotMatch(original, /正在加载|CircularProgress|setTimeout/)
  }
  assert.ok(originalGallery.includes('XDriveMediaAsyncThumbnail'))
  assert.ok(originalGallery.includes('XDriveMediaAsyncVideoPoster'))
  assert.ok(read('web/src/App.tsx').includes('mobileWebChrome\n'))
  assert.ok(read('desktop/src/renderer/App.tsx').includes('XDriveMediaGalleryPage'))
  const agents = read('AGENTS.md')
  assert.equal(agents.split('Permanent no-jitter contract / P78').length, 2)
  assert.equal(agents.split('P93 compact Gallery index first-Range commits (mandatory)').length, 2)
})
