'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const transpile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const navigatorText = read('ui/shared/src/mui/MediaGalleryPlaceHierarchyNavigator.tsx')
const nav = ts.createSourceFile('MediaGalleryPlaceHierarchyNavigator.tsx',
  navigatorText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = new Set(['PAGE_LIMIT', 'GEO_COUNTRY', 'GEO_REGION', 'GEO_CITY'])
const validators = new Set(['xDriveValidMediaPlaceHierarchyID', 'xDriveValidMediaPlaceHierarchyPage'])
const declarations = nav.statements.filter(statement =>
  ts.isFunctionDeclaration(statement) && validators.has(statement.name?.text) ||
  ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d =>
    names.has(d.name.getText(nav))))
const navOutput = { exports: {} }
new Function('exports', 'module', transpile(declarations.map(s => s.getText(nav)).join('\n')))(
  navOutput.exports, navOutput)
const { xDriveValidMediaPlaceHierarchyID: validID,
  xDriveValidMediaPlaceHierarchyPage: validPage } = navOutput.exports

test('B1-D stable identities distinguish same-name cities and reject overlarge IDs', () => {
  assert.equal(validID('country:JP', 'country'), true)
  assert.equal(validID('region:JP:13', 'region'), true)
  assert.equal(validID('city:JP:13:1850147', 'city'), true)
  assert.equal(validID('city:JP:13:1850148', 'city'), true)
  for (const [id, level] of [
    ['country:jp', 'country'], ['region:JP:13', 'country'],
    ['region:JP:../../', 'region'], ['region:jp:13', 'region'],
    ['city:JP:13:0', 'city'], ['city:JP:13:01', 'city'],
    ['city:JP:13:9007199254740992', 'city'],
    ['city:JP:13:1850147', 'region'],
  ]) assert.equal(validID(id, level), false, id)
})

test('B1-D bounded authoritative cursor page rejects duplicated or foreign photos', () => {
  const request = { level: 'city', country: 'JP', region: '13', limit: 48 }
  const a = { id:'city:JP:13:1850147', name:'附近城市 · 东京',
    photo_count: 3, cover_node_id: 42, match_kind:'nearest_city_geonames' }
  const b = { ...a, id:'city:JP:13:1850148', photo_count: 1, cover_node_id: 43 }
  const page = { items:[a,b], level:'city', has_more:true,
    next_cursor:b.id, dataset_version:'fixtures:1', available:true }
  assert.equal(validPage(page, request), true)
  assert.equal(validPage({ ...page, items:[a,a] }, request), false)
  assert.equal(validPage({ ...page, items:[a, {...b,id:'city:US:CA:1850148'}] }, request), false)
  assert.equal(validPage({ ...page, next_cursor:a.id }, request), false)
  assert.equal(validPage({ ...page, items:[a, {...b,photo_count:0}] }, request), false)
  assert.equal(validPage({ ...page, items:[a, {...b, cover_node_id:-1}] }, request), false)
  assert.equal(validPage({ ...page, items:Array(49).fill(a) }, request), false)
  assert.equal(validPage({ ...page, available:false }, request), false)
})

const mainText = read('desktop/src/main/index.cts')
const main = ts.createSourceFile('index.cts', mainText, ts.ScriptTarget.Latest, true)
let handler
function scan(node) {
  if (ts.isCallExpression(node) && node.expression.getText(main) === 'ipcMain.handle' &&
    node.arguments[0]?.text === 'agent:get-media-places-hierarchy') handler = node.arguments[1]
  ts.forEachChild(node, scan)
}
scan(main)
assert.ok(handler, 'the real Desktop Main hierarchy IPC must be registered')

function makeDesktopHandler(calls) {
  const signal = new AbortController().signal
  const js = transpile('const handler = ' + handler.getText(main) + '; return handler;')
  const invoke = new Function('runAgentAction', 'viewportRequests',
    'requireAgentLifecycle', 'requireAgentCapability', 'requireAgentClient', 'AgentIPCError', js)
  return invoke(fn => fn(), {
    run: (_sender, requestID, fn) => {
      calls.push({ cancelledBy: requestID })
      return fn(signal)
    },
  }, () => ({ensureRunning:async () => ({capabilities:['media-gallery']})}),
  (hello, capability) => assert.ok(hello.capabilities.includes(capability)),
  () => ({mediaPlacesHierarchy: async (req, passedSignal) => {
    assert.equal(passedSignal, signal)
    calls.push({ request:req })
    return { items:[], level:req.level, has_more:false, available:true }
  }}), class AgentIPCError extends Error {})
}

test('B1-D Desktop Main only forwards Owner bounded valid country/region/city requests', async () => {
  for (const req of [
    { level:'country', limit:48 },
    { level:'region', country:'JP', limit:48, cursor:'region:JP:13' },
    { level:'city', country:'JP', region:'13', search:'东京',
      cursor:'city:JP:13:1850147', limit:48 },
  ]) {
    const calls = []
    const result = await makeDesktopHandler(calls)({sender:{}}, req, 'req-b1d')
    assert.equal(result.level, req.level)
    assert.deepEqual(calls[1].request, req)
    assert.equal(calls[0].cancelledBy, 'req-b1d')
  }
})
test('B1-D Desktop Main refuses malicious parent/cursor and unauthorised query fields', async () => {
  for (const req of [
    {level:'region', country:'US',cursor:'region:JP:13'},
    {level:'city', country:'JP',region:'13',cursor:'city:JP:27:1850147'},
    {level:'country',country:'JP'},
    {level:'region',country:'jp'},
    {level:'city',country:'JP',region:'../../'},
    {level:'country', limit:101},
    {level:'country',search:'京'.repeat(81)},
    {level:'country',owner_id:2},
    {level:'city',country:'JP',region:'13',cursor:'city:JP:13:9007199254740992'},
  ]) {
    const calls = []
    await assert.rejects(makeDesktopHandler(calls)({sender:{}},req,'req-b1d'))
    assert.equal(calls.some(e => e.request), false)
  }
})

test('B1-D all three clients reuse Owner Media Range and a bounded authenticated hierarchy API', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const port = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const web = read('web/src/mediaGalleryAdapter.ts')
  const desktop = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const client = read('internal/client/media.go')
  const goAgent = read('cmd/xdrive-agent/desktop_ipc_media_places_hierarchy.go')
  const routes = read('cmd/xdrive-agent/desktop_ipc.go')
  const preload = read('desktop/src/preload/index.cts')
  const apiRouter = read('internal/api/router.go')
  assert.match(apiRouter, /authed\.GET\("\/media\/places\/hierarchy"/)
  assert.match(routes, /HandleFunc\("GET \/v1\/media\/places\/hierarchy"/)
  assert.match(client, /func \(c \*Client\) MediaPlacesHierarchy\(/)
  assert.match(goAgent, /CloudMediaPlacesHierarchy\(r\.Context\(\), request\)/)
  assert.match(preload, /agent:get-media-places-hierarchy/)
  assert.match(web, /listPlacesHierarchy: \(request, signal\) => api\.mediaPlaceHierarchy\(request, \{\}, signal\)/)
  assert.match(desktop, /listPlacesHierarchy: \(request, signal\) => xDriveDesktopViewportRequest\(/)
  assert.match(port, /resolveXDriveTransport\(port\.listPlacesHierarchy!\(request, signal\)\)/)
  assert.match(gallery, /<XDriveMediaGalleryPlaceHierarchyNavigator/)
  assert.match(gallery, /place_hierarchy: place\.id/)
  assert.match(gallery, /listPlacesHierarchy=\{source\.listPlacesHierarchy\}/)
  assert.match(gallery, /useXDriveVirtualCollection<MediaItem>/)
  assert.doesNotMatch(navigatorText, /\/media\/places\/page\?.*offset|Promise\.all\(.*places/i)
})
