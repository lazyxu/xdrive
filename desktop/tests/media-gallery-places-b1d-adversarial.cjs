'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
const transpile = text => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function validatorsFromProduction() {
  const source = read('ui/shared/src/media-gallery-places-hierarchy-validation.ts')
  const ast = ts.createSourceFile('place-validation.ts', source,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const constants = new Set(['HIERARCHY_WINDOW_LIMIT', 'GEO_COUNTRY', 'GEO_REGION', 'GEO_CITY'])
  const functions = new Set([
    'xDriveValidMediaPlaceHierarchyID', 'xDriveValidMediaPlaceHierarchyPage',
  ])
  const nodes = ast.statements.filter(statement =>
    (ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(decl =>
        constants.has(decl.name.getText(ast)))) ||
    (ts.isFunctionDeclaration(statement) && functions.has(statement.name?.text)))
  assert.equal(nodes.length, 6, 'must execute the real production validators')
  const mod = { exports: {} }
  new Function('exports', 'module', transpile(nodes.map(n => n.getText(ast)).join('\n')))(
    mod.exports, mod)
  return mod.exports
}

const {
  xDriveValidMediaPlaceHierarchyID: validID,
  xDriveValidMediaPlaceHierarchyPage: validPage,
} = validatorsFromProduction()

test('B1-D checks stable country/Admin1/nearest-city identity without display-name collisions', () => {
  for (const [id, level] of [
    ['country:JP', 'country'], ['region:JP:13', 'region'],
    ['city:JP:13:1850147', 'city'], ['city:JP:13:1850148', 'city'],
  ]) assert.equal(validID(id, level), true, id)
  for (const [id, level] of [
    ['country:jp', 'country'], ['country:JPN', 'country'],
    ['region:JP:../../', 'region'], ['region:jp:13', 'region'],
    ['city:JP:13:0', 'city'], ['city:JP:13:01', 'city'],
    ['city:JP:13:9007199254740992', 'city'], ['city:JP:13:-1', 'city'],
    ['city:JP:13:123', 'country'],
  ]) assert.equal(validID(id, level), false, id)
})

test('B1-D rejects duplicate, cross-parent, malformed and unbounded facet responses', () => {
  const request = { level: 'city', country: 'JP', region: '13', limit: 48 }
  const first = { id: 'city:JP:13:1850147', name: '附近城市 · 东京',
    photo_count: 3, cover_node_id: 42, match_kind: 'nearest_city_geonames' }
  const second = { ...first, id: 'city:JP:13:1850148', photo_count: 1, cover_node_id: 43 }
  const good = { items: [first, second], level: 'city', available: true,
    dataset_version: 'fixtures:1', has_more: true, next_cursor: second.id }
  assert.equal(validPage(good, request), true)
  assert.equal(validPage({ ...good, items: [first, first] }, request), false)
  assert.equal(validPage({ ...good, items: [first, { ...second, id: 'city:US:CA:1850148' }] }, request), false)
  assert.equal(validPage({ ...good, next_cursor: first.id }, request), false)
  assert.equal(validPage({ ...good, items: [first, { ...second, photo_count: 0 }] }, request), false)
  assert.equal(validPage({ ...good, items: [first, { ...second, cover_node_id: -1 }] }, request), false)
  assert.equal(validPage({ ...good, items: Array(49).fill(first) }, request), false)
  assert.equal(validPage({ ...good, available: false }, request), false)
  assert.equal(validPage({ ...good, dataset_version: '' }, request), false)
  assert.equal(validPage({ ...good, has_more: false, next_cursor: second.id }, request), false)
  assert.equal(validPage({ ...good, items: [first, { ...second, id: 'city:JP:13:9007199254740992' }] }, request), false)
  const notReady = { items: [], level: 'country', has_more: false, available: false }
  assert.equal(validPage(notReady, { level: 'country' }), true)
  assert.equal(validPage({ ...notReady, items: [first] }, { level: 'country' }), false)
  assert.match(read('ui/shared/src/mui/MediaGalleryPlacesHierarchy.tsx'),
    /xDriveValidMediaPlaceHierarchyPage\(page, request\)/)
})

function realHierarchyIPC(calls) {
  const source = read('desktop/src/main/index.cts')
  const ast = ts.createSourceFile('index.cts', source,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let handler
  const find = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' &&
        node.arguments[0]?.text === 'agent:get-media-place-hierarchy') {
      handler = node.arguments[1]
    }
    ts.forEachChild(node, find)
  }
  find(ast)
  assert.ok(handler, 'the real Electron main handler must remain registered')
  const signal = new AbortController().signal
  const mod = { exports: null }
  const execute = new Function('module', 'runAgentAction', 'viewportRequests',
    'requireAgentLifecycle', 'requireAgentCapability', 'requireAgentClient',
    'AgentIPCError', transpile('module.exports = ' + handler.getText(ast) + ';'))
  execute(mod, fn => fn(), {
    run: (_sender, requestID, fn) => {
      calls.push({ requestID })
      return fn(signal)
    },
  }, () => ({ ensureRunning: async () => ({ capabilities: ['media-gallery'] }) }),
  (hello, capability) => assert.ok(hello.capabilities.includes(capability)),
  () => ({ mediaPlaceHierarchy: async (request, filters, actualSignal) => {
    assert.equal(actualSignal, signal, 'the request must remain cancellable')
    calls.push({ request, filters })
    return { level: request.level, items: [], available: true, has_more: false }
  }}), class AgentIPCError extends Error {})
  return mod.exports
}

test('B1-D actual Electron main uses authenticated bounded requests and propagates cancellation', async () => {
  for (const [request, filters] of [
    [{ level: 'country', limit: 48 }, {}],
    [{ level: 'region', country: 'JP', cursor: 'region:JP:13', limit: 48 },
      { favorite: true }],
    [{ level: 'city', country: 'JP', region: '13',
      cursor: 'city:JP:13:1850147', limit: 48 },
      { captured_from: '2026-10-01T00:00:00Z', cameras: ['Canon'] }],
  ]) {
    const calls = []
    const handler = realHierarchyIPC(calls)
    const result = await handler({ sender: {} }, request, filters, 'b1d-verify')
    assert.equal(result.level, request.level)
    assert.equal(calls[0].requestID, 'b1d-verify')
    assert.deepEqual(calls[1].request, request)
    assert.deepEqual(calls[1].filters, filters)
  }
})

test('B1-D Electron main rejects cross-region cursors, malicious keys, bad arrays and circular filters', async () => {
  const malicious = [
    [{ level: 'country', country: 'JP' }, {}],
    [{ level: 'region', country: 'jp' }, {}],
    [{ level: 'city', country: 'JP', region: '../../' }, {}],
    [{ level: 'city', country: 'JP', region: '13', cursor: 'city:JP:27:123' }, {}],
    [{ level: 'region', country: 'JP', cursor: 'region:US:CA' }, {}],
    [{ level: 'city', country: 'JP', region: '13', cursor: 'city:JP:13:9007199254740992' }, {}],
    [{ level: 'country', limit: 101 }, {}],
    [{ level: 'country', search: '京'.repeat(81) }, {}],
    [{ level: 'country', search: '\u0000' }, {}],
    [{ level: 'country', owner_id: 10 }, {}],
    [{ level: 'country' }, { owner_id: 10 }],
    [{ level: 'country' }, { cameras: [42] }],
    [{ level: 'country' }, { fold_member_ids: [-4] }],
  ]
  for (const [request, filters] of malicious) {
    const calls = []
    await assert.rejects(realHierarchyIPC(calls)({ sender: {} }, request, filters, 'bad'))
    assert.equal(calls.some(e => e.request), false, JSON.stringify(request))
  }
  const circular = {}
  circular.next = circular
  const calls = []
  await assert.rejects(realHierarchyIPC(calls)({ sender: {} },
    { level: 'country' }, circular, 'bad'))
  assert.equal(calls.some(e => e.request), false)
})


test('B1-D composed Gallery filters preserve selected Owner hierarchy and cancel it on section exit', () => {
  // Execute the production TS helper, without a replicated implementation.
  const source = read('ui/shared/src/media-gallery-places-hierarchy-query.ts')
  const mod = { exports: {} }
  new Function('exports', 'module', transpile(source))(mod.exports, mod)
  const keep = mod.exports.xDriveKeepMediaPlaceHierarchyQuery
  assert.equal(typeof keep, 'function')
  for (const hierarchy of ['country:JP', 'region:JP:13', 'city:JP:13:1850147']) {
    const active = { place_hierarchy: hierarchy, favorite: true }
    for (const next of [
      { captured_from: '2026-01-01T00:00:00Z', favorite: false },
      { search: 'camera', cameras: ['Canon'], formats: ['image/jpeg'] },
      { sort_by: 'added', sort_dir: 'asc', time_zone: 'Asia/Tokyo' },
      { place: 'place:3500:13900', nearby: '35,139,50', bbox: '130,20,140,40', has_location: false },
      {},
    ]) {
      const before = JSON.stringify(next)
      const result = keep(next, active, 'places')
      assert.equal(result.place_hierarchy, hierarchy)
      assert.equal(result.has_location, next.has_location,
      'location filter stays editable; hierarchy identity itself validates GPS')
      assert.equal(result.place, undefined)
      assert.equal(result.nearby, undefined)
      assert.equal(result.bbox, undefined)
      for (const [key, value] of Object.entries(next)) {
        if (!['place', 'nearby', 'bbox', 'has_location'].includes(key)) assert.deepEqual(result[key], value)
      }
      assert.equal(JSON.stringify(next), before, 'query composition must be pure')
    }
    assert.deepEqual(keep({ favorite: true }, active, 'albums'), { favorite: true })
  }
  assert.deepEqual(keep({ favorite: true }, {}, 'places'), { favorite: true })
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.equal((gallery.match(/xDriveKeepMediaPlaceHierarchyQuery\(/g) || []).length, 5,
    'facets, applied filters, timezone, clear and chip removal must preserve hierarchy')
})
