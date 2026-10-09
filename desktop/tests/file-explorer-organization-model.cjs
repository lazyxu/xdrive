const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')

const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
const modules = new Map()
function loadSource(relativePath) {
  const filename = path.resolve(repo, relativePath)
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }
  modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const localRequire = request => request.startsWith('.')
    ? loadSource(path.resolve(path.dirname(filename), request + '.ts')) : require(request)
  new Function('module', 'exports', 'require', output)(mod, mod.exports, localRequire)
  return mod.exports
}
const model = loadSource('ui/shared/src/file-explorer-organization.ts')
const { useXDriveFileExplorerOrganization } = loadSource('ui/shared/src/mui/FileExplorerOrganizationController.ts')
const saved = { id: 17, name: '旅行照片', query: 'photo', filters: { kind: 'image', tagID: 7 }, position: 0, created_at: '', updated_at: '' }
const tag = { id: 7, name: '旅行', item_count: 0, created_at: '', updated_at: '' }
const state = (patch = {}) => {
  assert.equal(typeof model.xDriveFileExplorerOrganizationSearchState, 'function')
  return model.xDriveFileExplorerOrganizationSearchState({ active: true, query: 'photo', filters: { ...saved.filters }, savedSearches: [saved], ...patch })
}

test('portable saved-rule signatures normalize query edges and filter order while excluding device availability', () => {
  const signature = model.xDriveFileExplorerSavedSearchSignature
  assert.equal(typeof signature, 'function')
  assert.equal(signature(' photo ', { tagID: 7, minSize: 0, kind: 'image', availability: 'local' }), signature('photo', { kind: 'image', minSize: 0, tagID: 7 }))
  assert.notEqual(signature('photo', { minSize: 0 }), signature('photo', {}), 'an explicit zero size bound is a Server predicate')
  assert.notEqual(signature('photo', { tagID: 7 }), signature('photo', { tagID: 8 }))
  assert.notEqual(signature('photo', {}), signature('invoice', {}))
})

test('organization markers derive from the committed active Search and preserve combined tag predicates', () => {
  assert.equal(state().activeSavedSearchID, 17)
  assert.equal(state().activeTagID, 7)
  assert.equal(state({ query: 'invoice' }).activeSavedSearchID, null)
  assert.equal(state({ query: 'invoice' }).activeTagID, 7)
  assert.equal(state({ active: false }).activeSavedSearchID, null)
  assert.equal(state({ active: false }).activeTagID, null)
})

test('every saved definition with the same portable rule is marked as matching without click history', () => {
  const equivalent = { ...saved, id: 18, name: '图片归档', query: ' photo ', filters: { tagID: 7, kind: 'image' } }
  const matching = state({ savedSearches: [saved, equivalent] })
  assert.deepEqual(matching.matchingSavedSearchIDs, [17, 18])
  assert.equal(matching.activeSavedSearchID, 17, 'the singular compatibility marker remains deterministic')
  assert.deepEqual(state({ savedSearches: [equivalent, saved] }).matchingSavedSearchIDs, [18, 17])
  assert.deepEqual(state({ active: false, savedSearches: [saved, equivalent] }).matchingSavedSearchIDs, [])
  assert.deepEqual(state({ query: 'invoice', savedSearches: [saved, equivalent] }).matchingSavedSearchIDs, [])
})

test('local availability is an additional unsaved condition and cannot form a portable saved rule alone', () => {
  const combined = state({ filters: { ...saved.filters, availability: 'online-only' } })
  assert.equal(combined.activeSavedSearchID, 17)
  assert.equal(combined.canSaveCurrentSearch, true)
  assert.match(combined.currentSearchNotice, /设备/)
  assert.match(combined.currentSearchNotice, /不.*保存|不.*包含/)
  const onlyDevice = state({ query: '', filters: { availability: 'local' } })
  assert.equal(onlyDevice.canSaveCurrentSearch, false)
  assert.equal(onlyDevice.activeSavedSearchID, null)
  assert.match(onlyDevice.currentSearchNotice, /设备/)
})

test('saved-rule labels use authoritative option names and retain unknown identifiers and exact bounds', () => {
  const labels = model.xDriveFileExplorerSavedSearchRuleLabels
  assert.equal(typeof labels, 'function')
  const value = labels({ ...saved, filters: { ...saved.filters, sourceID: 9, minSize: 0, maxSize: 17 } }, { tagOptions: [tag] }).join(' · ')
  assert.match(value, /photo/)
  assert.match(value, /类型：图片/)
  assert.match(value, /标签：旅行/)
  assert.match(value, /同步文件夹：9/)
  assert.match(value, /至少 0 字节/)
  assert.match(value, /至多 17 字节/)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function mountOrganization(override = {}, initialEnabled = true) {
  const errors = [], frames = []
  let current, renderer, lifecycleKey = 'account-a', enabled = initialEnabled
  const adapter = {
    listTags: async () => [tag], listSavedSearches: async () => [saved],
    createTag: async () => tag, updateTag: async () => tag, deleteTag: async () => {},
    queryNodeTags: async () => [], addTagNodes: async () => {}, removeTagNodes: async () => {},
    createSavedSearch: async () => saved, updateSavedSearch: async () => saved,
    deleteSavedSearch: async () => {}, reorderSavedSearches: async () => {}, ...override,
  }
  function Harness({ owner, supported }) {
    current = useXDriveFileExplorerOrganization({ lifecycleKey: owner, enabled: supported, adapter, onError: error => errors.push(String(error)) })
    frames.push({ owner, supported, tags: current.tags, savedSearches: current.savedSearches, loading: current.loading, error: current.error })
    return null
  }
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Harness, { owner: lifecycleKey, supported: enabled })) })
  return {
    get current() { return current }, frames, errors,
    async run(action) { await TestRenderer.act(async () => { await action(current) }) },
    async replaceOwner(owner) { lifecycleKey = owner; await TestRenderer.act(async () => { renderer.update(React.createElement(Harness, { owner, supported: enabled })) }) },
    async setEnabled(value) { enabled = value; await TestRenderer.act(async () => { renderer.update(React.createElement(Harness, { owner: lifecycleKey, supported: enabled })) }) },
    async dispose() { await TestRenderer.act(async () => renderer.unmount()) },
  }
}

test('organization first render marks an enabled unread list as pending', async () => {
  const pending = deferred()
  const h = await mountOrganization({ listTags: () => pending.promise, listSavedSearches: () => pending.promise })
  try { assert.equal(h.frames[0].loading, true, 'an unread enabled list must not first paint as a confirmed empty list') }
  finally { await h.dispose() }
})

test('first enabled-capability frame remains pending until the organization read completes', async () => {
  const pending = deferred()
  const h = await mountOrganization({ listTags: () => pending.promise, listSavedSearches: () => pending.promise }, false)
  try {
    assert.equal(h.current.loading, false)
    await h.setEnabled(true)
    const firstEnabled = h.frames.find(frame => frame.supported)
    assert.equal(firstEnabled.loading, true, 'newly available organization has not returned a confirmed empty result')
    assert.deepEqual(firstEnabled.tags, [])
    assert.deepEqual(firstEnabled.savedSearches, [])
  } finally { await h.dispose() }
})

test('organization load failure is retained for inline retry and a successful retry clears it', async () => {
  let fail = true
  const h = await mountOrganization({ listTags: async () => { if (fail) throw new Error('读取失败'); return [tag] } })
  try {
    assert.match(h.current.error ?? '', /读取失败/)
    assert.equal(h.current.loading, false)
    fail = false
    await h.run(org => org.refresh())
    assert.equal(h.current.error, '')
    assert.deepEqual(h.current.tags, [tag])
  } finally { await h.dispose() }
})

test('failed refresh retains known rows while exposing the actual read error', async () => {
  let fail = false
  const h = await mountOrganization({ listTags: async () => { if (fail) throw new Error('暂时离线'); return [tag] } })
  try {
    fail = true
    await h.run(org => org.refresh())
    assert.deepEqual(h.current.tags, [tag])
    assert.deepEqual(h.current.savedSearches, [saved])
    assert.match(h.current.error ?? '', /暂时离线/)
  } finally { await h.dispose() }
})

test('first new-account organization frame cannot expose the previous owner lists or load error', async () => {
  let owner = 'A'
  const pending = deferred()
  const h = await mountOrganization({
    listTags: () => owner === 'A' ? Promise.resolve([tag]) : pending.promise,
    listSavedSearches: () => owner === 'A' ? Promise.resolve([saved]) : pending.promise,
  })
  try {
    assert.deepEqual(h.current.tags, [tag])
    owner = 'B'
    await h.replaceOwner('account-b')
    const firstB = h.frames.find(frame => frame.owner === 'account-b')
    assert.deepEqual(firstB.tags, [], 'first B frame must not publish A tag definitions')
    assert.deepEqual(firstB.savedSearches, [], 'first B frame must not publish A saved rules')
    assert.equal(firstB.loading, true)
    assert.equal(firstB.error, '')
  } finally { await h.dispose() }
})
