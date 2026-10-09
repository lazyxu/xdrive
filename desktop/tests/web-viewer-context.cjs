const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')
const repo = path.join(__dirname, '../..')
function load(filename, bindings = {}, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }; cache.set(filename, mod)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  new Function('exports', 'module', 'require', code)(mod.exports, mod, (request) => {
    if (Object.hasOwn(bindings, request)) return bindings[request]
    if (!request.startsWith('.')) return require(request)
    const base = path.resolve(path.dirname(filename), request)
    const resolved = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync)
    return resolved ? load(resolved, bindings, cache) : require(base)
  })
  return mod.exports
}
const contextModule = load(path.join(repo, 'web/src/webViewerContext.ts'))
const node = (id, revision = 1) => ({ id, revision, name: `${id}.jpg`, type: 'file', size: 12, created_at: '', updated_at: '' })
function fixture(total = 100000) {
  const calls = { range: [], node: [], media: [] }
  const api = {
    node: async (id) => { calls.node.push(id); return node(id) },
    mediaItem: async (id) => { calls.media.push(id); return { node: node(id), metadata: {}, favorite: false } },
  }
  const source = {
    listItemRange: async (limit, offset) => {
      calls.range.push(offset)
      return { total_count: total, items: Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({ node: node(offset + i + 1), metadata: {}, favorite: false })) }
    },
  }
  const context = { kind: 'gallery', target: { kind: 'library', query: {} }, totalCount: total, activeIndex: 64 }
  return { api, source, context, calls }
}
function session(api, source, context) {
  return contextModule.createXDriveWebViewerSession(api, source, context)
}

test('Viewer current/previous/next share one in-flight page and reuse Gallery current metadata', async () => {
  const f = fixture(); const reader = session(f.api, f.source, f.context)
  const [current, previous, next] = await Promise.all([
    reader.current(65, 64, true), reader.neighbor(64, -1, () => true), reader.neighbor(64, 1, () => true),
  ])
  assert.deepEqual([previous.node.id, current.node.id, next.node.id], [64, 65, 66])
  assert.equal(f.calls.range.length, 1, 'same-range current/previous/next must perform one range read')
  assert.equal(f.calls.node.length, 0, 'Gallery page already supplies the current node')
  assert.equal(f.calls.media.length, 0, 'Gallery page already supplies the current MediaItem')
  await reader.current(next.node.id, next.index, true)
  assert.equal(f.calls.range.length, 1, 'navigating to the returned candidate must reuse the resolved page')
})

test('Viewer crosses only necessary range boundaries and shares resolved pages', async () => {
  const f = fixture(); const reader = session(f.api, f.source, f.context)
  await Promise.all([reader.candidateAt(127), reader.neighbor(127, -1, () => true), reader.neighbor(127, 1, () => true)])
  assert.deepEqual(f.calls.range.sort((a, b) => a - b), [0, 128])
  await reader.candidateAt(128)
  assert.equal(f.calls.range.length, 2)
})

test('Viewer page retention stays at three pages across a 100k logical collection', async () => {
  const f = fixture(); const reader = session(f.api, f.source, f.context)
  for (let index = 0; index < 100000; index += 128) await reader.candidateAt(index)
  const before = f.calls.range.length
  await reader.candidateAt(99840)
  assert.equal(f.calls.range.length, before, 'a recently retained page is reused')
  await reader.candidateAt(0)
  assert.equal(f.calls.range.length, before + 1, 'old pages are evicted instead of retaining the collection')
})

test('Viewer retries a rejected page and does not share caches across source/API/context sessions', async () => {
  const f = fixture(); let fail = true; const original = f.source.listItemRange
  f.source.listItemRange = async (...args) => { if (fail) { fail = false; throw Error('offline') }; return original(...args) }
  const reader = session(f.api, f.source, f.context)
  await assert.rejects(reader.candidateAt(10), /offline/)
  assert.equal((await reader.candidateAt(10)).node.id, 11)
  const other = fixture(); other.source.listItemRange = async () => ({ total_count: 1, items: [{ node: node(900), metadata: {} }] })
  assert.equal((await session(other.api, other.source, other.context).candidateAt(0)).node.id, 900)
  assert.equal((await reader.candidateAt(0)).node.id, 1)
})

test('Viewer selection caches a bounded node window and direct links fall back to node/media reads', async () => {
  const f = fixture(); const selection = { kind: 'selection', nodeIDs: Array.from({ length: 500 }, (_, i) => i + 1), activeIndex: 1 }
  const reader = session(f.api, f.source, selection)
  await Promise.all([reader.candidateAt(1), reader.current(2, 1, false)])
  assert.equal(f.calls.node.length, 1)
  for (let i = 2; i < 500; i++) await reader.candidateAt(i)
  const before = f.calls.node.length
  await reader.candidateAt(1)
  assert.equal(f.calls.node.length, before + 1)
  const direct = session(f.api, f.source, null)
  assert.equal((await direct.current(800, 0, true)).mediaItem.node.id, 800)
  assert.equal(f.calls.media.length, 1)
})

test('Viewer rejects mismatched current source identity and updates/invalidate cached mutation metadata', async () => {
  const f = fixture(); const reader = session(f.api, f.source, f.context)
  const current = await reader.current(65, 64, true)
  reader.updateMediaItem({ ...current.mediaItem, favorite: true })
  assert.equal((await reader.current(65, 64, true)).mediaItem.favorite, true)
  f.api.node = async (id) => { f.calls.node.push(id); return node(id, 2) }
  f.api.mediaItem = async (id) => { f.calls.media.push(id); return { node: node(id, 2), metadata: {} } }
  assert.equal((await reader.current(65, 64, true, node(65, 2))).mediaItem.node.revision, 2)
  assert.equal((await reader.current(900, 64, true)).node.id, 900, 'context index belonging to another node cannot supply current metadata')
  reader.invalidate(65)
  await reader.candidateAt(64)
  assert.equal(f.calls.range.length, 2)
})

function hookModule() { return load(path.join(repo, 'web/src/useWebViewerNode.ts')) }
function storageContext(context, id = 'session') {
  const data = new Map([[`xdrive.web_app.session.v1:${id}`, JSON.stringify({ version: 1, context })]])
  global.window = { sessionStorage: { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) } }
}

test('actual Viewer hook reuses Gallery node/media and does not expose the prior target while a new route loads', async () => {
  const f = fixture(); storageContext(f.context)
  const { useViewerNode } = hookModule()
  let value; let renderer; let navigateID
  function Probe(props) { value = useViewerNode(props); return null }
  const props = { api: f.api, gallerySource: f.source, nodeID: 65, contextID: 'session', predicate: () => true, wantsMedia: true, onNavigate: (id) => { navigateID = id } }
  await act(async () => { renderer = create(React.createElement(Probe, props)) })
  try {
    assert.equal(value.node.id, 65)
    assert.equal(f.calls.node.length, 0, 'mounted Gallery Viewer must use node from its range')
    assert.equal(value.mediaItem.node.id, 65)
    assert.equal(f.calls.media.length, 0)
    await act(async () => {
      value.goNext()
      renderer.update(React.createElement(Probe, { ...props, nodeID: navigateID }))
    })
    assert.equal(navigateID, 66)
    assert.equal(value.node.id, 66)
    assert.equal(value.mediaItem.node.id, 66)
    assert.equal(f.calls.range.length, 2, 'one fresh range for each active item')
    let release
    f.api.mediaItem = () => new Promise((resolve) => { release = resolve })
    await act(async () => renderer.update(React.createElement(Probe, { ...props, nodeID: 900 })))
    assert.equal(value.node, null)
    assert.equal(value.mediaItem, null)
    assert.equal(value.loading, true)
    await act(async () => release({ node: node(900), metadata: {} }))
    assert.equal(value.node.id, 900)
  } finally { await act(async () => renderer.unmount()) }
})

test('late old-revision mutation cannot replace a newer direct-link source', async () => {
  const f = fixture()
  f.api.node = async (id) => node(id, 2)
  f.api.mediaItem = async (id) => ({ node: node(id, 2), metadata: {}, favorite: false })
  const reader = session(f.api, f.source, null)
  await reader.current(65, 0, true)
  reader.updateMediaItem({ node: node(65, 1), metadata: {}, favorite: true })
  const current = await reader.current(65, 0, true)
  assert.equal(current.node.revision, 2)
  assert.equal(current.mediaItem.favorite, false)
})

test('mismatched fallback media is rejected, evicted, and retried with current revision', async () => {
  const f = fixture(); const reader = session(f.api, f.source, { kind: 'selection', nodeIDs: [65], activeIndex: 0 })
  f.api.node = async (id) => node(id, 2)
  await assert.rejects(reader.current(65, 0, true), /版本不一致/)
  f.api.mediaItem = async (id) => ({ node: node(id, 2), metadata: {} })
  assert.equal((await reader.current(65, 0, true)).mediaItem.node.revision, 2)
})

test('page LRU keeps exactly three recent pages and reloads only the evicted page', async () => {
  const f = fixture(); const reader = session(f.api, f.source, f.context)
  for (const index of [0, 128, 256, 384, 128, 256, 384]) await reader.candidateAt(index)
  assert.deepEqual(f.calls.range, [0, 128, 256, 384])
  await reader.candidateAt(0)
  assert.deepEqual(f.calls.range, [0, 128, 256, 384, 0])
})

test('hook replacement by account API or Gallery source fences a late prior-session completion', async () => {
  const first = fixture(); storageContext(first.context)
  const second = fixture(); second.source.listItemRange = async () => ({ total_count: 3, items: [1, 2, 3].map((id) => ({ node: node(id + 1000), metadata: {} })) })
  second.api.node = async (id) => node(id, 2)
  second.api.mediaItem = async (id) => ({ node: node(id, 2), metadata: {} })
  let release; first.source.listItemRange = () => new Promise((resolve) => { release = resolve })
  const { useViewerNode } = hookModule(); let value; let renderer
  function Probe(props) { value = useViewerNode(props); return null }
  const props = { api: first.api, gallerySource: first.source, nodeID: 65, contextID: 'session', wantsMedia: true, predicate: () => true, onNavigate() {} }
  await act(async () => { renderer = create(React.createElement(Probe, props)) })
  try {
    await act(async () => renderer.update(React.createElement(Probe, { ...props, api: second.api, gallerySource: second.source })))
    assert.equal(value.node.revision, 2)
    await act(async () => release({ total_count: 100000, items: Array.from({ length: 128 }, (_, i) => ({ node: node(i + 1), metadata: {} })) }))
    assert.equal(value.node.revision, 2)
    assert.equal(value.mediaItem.node.revision, 2)
  } finally { await act(async () => renderer.unmount()) }
})

test('direct Media Viewer reads one authoritative MediaItem without a serial redundant node request', async () => {
  const f = fixture(); const reader = session(f.api, f.source, null)
  const current = await reader.current(700, 0, true)
  assert.equal(current.node.id, 700)
  assert.equal(current.mediaItem.node.id, 700)
  assert.equal(current.totalCount, 1, 'contextless direct media remains a single item')
  assert.equal(f.calls.node.length, 0)
  assert.equal(f.calls.media.length, 1)
  await reader.current(700, 0, true)
  assert.equal(f.calls.media.length, 1)
})

test('explicit current revision replaces cached fallback metadata instead of serving an older source', async () => {
  const f = fixture(); const reader = session(f.api, f.source, null)
  await reader.current(65, 0, true)
  f.api.mediaItem = async (id) => { f.calls.media.push(id); return { node: node(id, 2), metadata: {} } }
  const refreshed = await reader.current(65, 0, true, node(65, 2))
  assert.equal(refreshed.node.revision, 2)
  assert.equal(f.calls.media.length, 2)
})

test('singleton directory hook obtains total count from current page even without neighbors', async () => {
  const f = fixture(1); const context = { kind: 'directory', directoryID: 7, sort: { key: 'name', direction: 'asc' }, activeIndex: 0 }
  storageContext(context)
  f.api.listRange = async (_id, offset) => { f.calls.range.push(offset); return { total_count: 1, items: [node(1)] } }
  const { useViewerNode } = hookModule(); let value; let renderer
  function Probe() { value = useViewerNode({ api: f.api, gallerySource: f.source, nodeID: 1, contextID: 'session', predicate: contextModule.xDriveWebViewerAnyFile, onNavigate() {} }); return null }
  await act(async () => { renderer = create(React.createElement(Probe)) })
  try {
    assert.equal(value.totalCount, 1)
    assert.equal(value.previous, null)
    assert.equal(value.next, null)
    assert.equal(f.calls.node.length, 0)
    assert.deepEqual(f.calls.range, [0])
  } finally { await act(async () => renderer.unmount()) }
})

test('independent mutation patches merge into latest cached same-source media fields', async () => {
  const f = fixture(); const reader = session(f.api, f.source, f.context)
  const { mediaItem: captured } = await reader.current(65, 64, true)
  reader.updateMediaItem(captured, { favorite: true })
  reader.updateMediaItem(captured, { tags: ['normalized'] })
  const current = await reader.current(65, 64, true)
  assert.equal(current.mediaItem.favorite, true)
  assert.deepEqual(current.mediaItem.tags, ['normalized'])
})

test('navigation loading distinguishes pending boundary scan from success or failure', async () => {
  const f = fixture(); f.context.activeIndex = 127; storageContext(f.context)
  let release; const original = f.source.listItemRange
  f.source.listItemRange = (limit, offset) => offset === 128 ? new Promise((resolve, reject) => { release = { resolve, reject } }) : original(limit, offset)
  const { useViewerNode } = hookModule(); let value; let renderer
  function Probe() { value = useViewerNode({ api: f.api, gallerySource: f.source, nodeID: 128, contextID: 'session', predicate: contextModule.xDriveWebViewerMediaFile, wantsMedia: true, onNavigate() {} }); return null }
  await act(async () => { renderer = create(React.createElement(Probe)) })
  try {
    assert.equal(value.loading, false)
    assert.equal(value.navigationLoading, true)
    await act(async () => release.reject(Error('offline')))
    assert.equal(value.navigationLoading, false)
    assert.equal(value.next, null)
    const captured = value.mediaItem
    await act(async () => {
      value.updateMediaItem(captured, { favorite: true })
      value.updateMediaItem(captured, { tags: ['normalized'] })
    })
    assert.equal(value.mediaItem.favorite, true)
    assert.deepEqual(value.mediaItem.tags, ['normalized'])
  } finally { await act(async () => renderer.unmount()) }
})

test('stale browse index preserves known collection total', async () => {
  const f = fixture(200); storageContext(f.context)
  const { useViewerNode } = hookModule(); let value; let renderer
  function Probe() {
    value = useViewerNode({ api: f.api, gallerySource: f.source, nodeID: 66, contextID: 'session',
      predicate: contextModule.xDriveWebViewerMediaFile, wantsMedia: true, onNavigate() {} })
    return null
  }
  await act(async () => { renderer = create(React.createElement(Probe)) })
  try {
    assert.equal(value.node.id, 66)
    assert.equal(value.next.totalCount, 200)
    assert.equal(value.totalCount, 200)
  } finally { await act(async () => renderer.unmount()) }
})

test('returning to a Gallery item refreshes range metadata without an extra point read', async () => {
  const f = fixture(200); storageContext(f.context)
  let revision = 1; const original = f.source.listItemRange
  f.source.listItemRange = async (...args) => {
    const page = await original(...args)
    return { ...page, items: page.items.map((item) => item.node.id === 65
      ? { ...item, node: node(65, revision), favorite: revision === 2 } : item) }
  }
  const { useViewerNode } = hookModule(); let value; let renderer; let target = 65
  function Probe() { value = useViewerNode({ api: f.api, gallerySource: f.source, nodeID: target,
    contextID: 'session', predicate: contextModule.xDriveWebViewerMediaFile, wantsMedia: true,
    onNavigate(id) { target = id; renderer.update(React.createElement(Probe)) } }); return null }
  await act(async () => { renderer = create(React.createElement(Probe)) })
  try {
    await act(async () => value.goNext())
    assert.equal(value.node.id, 66)
    revision = 2
    await act(async () => value.goPrevious())
    assert.equal(value.node.id, 65)
    assert.equal(value.node.revision, 2)
    assert.equal(value.mediaItem.favorite, true)
    assert.equal(f.calls.node.length, 0)
    assert.equal(f.calls.media.length, 0)
    assert.equal(f.calls.range.length, 3, 'one fresh range for each active step')
  } finally { await act(async () => renderer.unmount()) }
})

test('selected candidate remains visible while a fresh active-step range is pending', async () => {
  const f = fixture(200); storageContext(f.context)
  let hold = false, release; const original = f.source.listItemRange
  f.source.listItemRange = (...args) => hold ? new Promise((resolve) => { release = () => original(...args).then(resolve) }) : original(...args)
  const { useViewerNode } = hookModule(); let value, renderer, target = 65
  function Probe() { value = useViewerNode({ api: f.api, gallerySource: f.source, nodeID: target, contextID: 'session',
    predicate: contextModule.xDriveWebViewerMediaFile, wantsMedia: true,
    onNavigate(id) { target = id; renderer.update(React.createElement(Probe)) } }); return null }
  await act(async () => { renderer = create(React.createElement(Probe)) })
  try {
    hold = true
    await act(async () => value.goNext())
    assert.equal(value.node.id, 66)
    assert.equal(value.mediaItem.node.id, 66)
    assert.equal(value.loading, false, 'a selected neighbor does not blank while its fresh neighborhood loads')
    assert.equal(value.navigationLoading, true)
    await act(async () => release())
    assert.equal(value.navigationLoading, false)
    assert.equal(f.calls.range.length, 2)
    assert.equal(f.calls.node.length, 0)
    assert.equal(f.calls.media.length, 0)
  } finally { await act(async () => renderer.unmount()) }
})

test('a same-owner late mutation patches the current step reader after returning to its source', async () => {
  const f = fixture(200); storageContext(f.context)
  const { useViewerNode } = hookModule(); let value, renderer, target = 65, wantsMedia = true
  function Probe() { value = useViewerNode({ api: f.api, gallerySource: f.source, nodeID: target, contextID: 'session',
    predicate: contextModule.xDriveWebViewerMediaFile, wantsMedia,
    onNavigate(id) { target = id; renderer.update(React.createElement(Probe)) } }); return null }
  await act(async () => { renderer = create(React.createElement(Probe)) })
  try {
    const captured = value.mediaItem, apply = value.updateMediaItem
    await act(async () => value.goNext())
    await act(async () => value.goPrevious())
    await act(async () => apply(captured, { favorite: true }))
    assert.equal(value.mediaItem.favorite, true)
    await act(async () => { wantsMedia = false; renderer.update(React.createElement(Probe)) })
    await act(async () => { wantsMedia = true; renderer.update(React.createElement(Probe)) })
    assert.equal(value.mediaItem.favorite, true, 'late mutation must update the currently owned reader as well as visible state')
  } finally { await act(async () => renderer.unmount()) }
})

test('explicit invalidation reloads a direct MediaItem', async () => {
  const f = fixture(); storageContext(f.context); let revision = 1
  f.api.mediaItem = async (id) => { f.calls.media.push(id); return { node: node(id, revision), metadata: {}, favorite: revision === 2 } }
  const { useViewerNode } = hookModule(); let value, renderer
  function Probe() { value = useViewerNode({ api: f.api, gallerySource: f.source, nodeID: 65,
    predicate: contextModule.xDriveWebViewerMediaFile, wantsMedia: true, onNavigate() {} }); return null }
  await act(async () => { renderer = create(React.createElement(Probe)) })
  try {
    revision = 2
    await act(async () => value.invalidate(65))
    assert.equal(value.node.revision, 2)
    assert.equal(f.calls.media.length, 2)
  } finally { await act(async () => renderer.unmount()) }
})

test('pending fresh range preserves acknowledged mutation and independently refreshed fields', async () => {
  const f = fixture(200); storageContext(f.context); let hold = false, release; const original = f.source.listItemRange
  f.source.listItemRange = async (...args) => {
    const snapshot = await original(...args)
    return hold ? new Promise((resolve) => { release = () => resolve({ ...snapshot,
      items: snapshot.items.map((item) => ({ ...item, description: 'server refreshed' })) }) }) : snapshot
  }
  const { useViewerNode } = hookModule(); let value, renderer, target = 65
  function Probe() { value = useViewerNode({ api: f.api, gallerySource: f.source, nodeID: target, contextID: 'session',
    predicate: contextModule.xDriveWebViewerMediaFile, wantsMedia: true,
    onNavigate(id) { target = id; renderer.update(React.createElement(Probe)) } }); return null }
  await act(async () => { renderer = create(React.createElement(Probe)) })
  try {
    hold = true
    await act(async () => value.goNext())
    assert.equal(value.node.id, 66)
    assert.equal(value.loading, false)
    const current = value.mediaItem
    await act(async () => value.updateMediaItem(current, { favorite: true }))
    assert.equal(value.mediaItem.favorite, true)
    await act(async () => release())
    assert.equal(value.mediaItem.favorite, true)
    assert.equal(value.mediaItem.description, 'server refreshed')
    await act(async () => value.updateMediaItem(value.mediaItem, { tags: ['normalized'] }))
    assert.equal(value.mediaItem.favorite, true)
    assert.equal(value.mediaItem.description, 'server refreshed')
    assert.deepEqual(value.mediaItem.tags, ['normalized'])
  } finally { await act(async () => renderer.unmount()) }
})

test('selected neighbor preserves a mutation acknowledged while another item was active', async () => {
  const f = fixture(200); storageContext(f.context); let favorite = false, hold = false, release; const original = f.source.listItemRange
  f.source.listItemRange = async (...args) => {
    const page = await original(...args)
    const snapshot = { ...page, items: page.items.map((item) => item.node.id === 65 ? { ...item, favorite } : item) }
    return hold ? new Promise((resolve) => { release = () => resolve(snapshot) }) : snapshot
  }
  const { useViewerNode } = hookModule(); let value, renderer, target = 65
  function Probe() { value = useViewerNode({ api: f.api, gallerySource: f.source, nodeID: target, contextID: 'session',
    predicate: contextModule.xDriveWebViewerMediaFile, wantsMedia: true,
    onNavigate(id) { target = id; renderer.update(React.createElement(Probe)) } }); return null }
  await act(async () => { renderer = create(React.createElement(Probe)) })
  try {
    const captured = value.mediaItem, completeMutation = value.updateMediaItem
    await act(async () => value.goNext())
    favorite = true
    await act(async () => completeMutation(captured, { favorite: true }))
    hold = true
    await act(async () => value.goPrevious())
    assert.equal(value.node.id, 65)
    assert.equal(value.loading, false)
    assert.equal(value.mediaItem.favorite, true, 'selected neighbor must retain acknowledged favorite')
    await act(async () => release())
  } finally { await act(async () => renderer.unmount()) }
})
