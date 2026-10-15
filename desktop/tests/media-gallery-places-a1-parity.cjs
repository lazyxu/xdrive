'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const repo = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(repo, name), 'utf8')
const transpile = code => ts.transpileModule(code, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
}}).outputText
const compileModule = js => {
  const output = { exports: {} }
  new Function('exports', 'module', js)(output.exports, output)
  return output.exports
}
const web = read('web/src/api.ts')
const webAST = ts.createSourceFile('api.ts', web, ts.ScriptTarget.Latest, true)
const api = webAST.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'XDriveApi')
assert.ok(api)
const method = api.members.find(m => ts.isMethodDeclaration(m) &&
  m.name.getText(webAST) === 'mediaPlacesPage')
assert.ok(method, 'real authenticated Web API supports paginated owner Places')
const { VerifiedWebPlacesAPI } = compileModule(transpile(
  'export class VerifiedWebPlacesAPI { ' + method.getText(webAST) + ' }',
))
test('P0-Places-A1 actual Web API sends bounded pages and never requests original bytes', async () => {
  for (const [limit, offset, expectedLimit, expectedOffset] of [
    [24, 0, 24, 0], [48, 48, 48, 48], [100, 99900, 100, 99900],
    [500, -3, 100, 0],
  ]) {
    const api = new VerifiedWebPlacesAPI()
    let captured
    api.request = async route => { captured = new URL(route, 'https://fixture.invalid'); return {
      items: [], total_count: 1300, limit: expectedLimit, offset: expectedOffset, has_more: true,
    } }
    const result = await api.mediaPlacesPage(limit, offset)
    assert.equal(captured.pathname, '/api/v1/media/places/page')
    assert.equal(Number(captured.searchParams.get('limit')), expectedLimit)
    assert.equal(Number(captured.searchParams.get('offset')), expectedOffset)
    assert.equal(result.total_count, 1300)
  }
})

const main = read('desktop/src/main/index.cts')
const mainAST = ts.createSourceFile('index.cts', main, ts.ScriptTarget.Latest, true)
let handler = null
function scan(node) {
  if (ts.isCallExpression(node) && node.expression.getText(mainAST) === 'ipcMain.handle' &&
    node.arguments[0]?.text === 'agent:get-media-places-page') handler = node.arguments[1]
  ts.forEachChild(node, scan)
}
scan(mainAST)
assert.ok(handler, 'real registered Desktop Main IPC handler is required')
const desktopHandler = (calls, capabilities = ['media-gallery']) => {
  const js = transpile('const handler = ' + handler.getText(mainAST) + '; return handler;')
  return new Function('runAgentAction', 'requireAgentLifecycle', 'requireAgentCapability',
    'requireAgentClient', 'AgentIPCError', js)(
    fn => fn(), () => ({ensureRunning: async () => ({capabilities})}),
    (hello, cap) => assert.ok(hello.capabilities.includes(cap), 'capability ' + cap),
    () => ({mediaPlacesPage: async (limit,offset) => {
      calls.push({limit,offset}); return {items:[],total_count:120,limit,offset,has_more:true}
    }}),
    class AgentIPCError extends Error {
      constructor(code, status, message) {super(message); this.code=code; this.status=status}
    },
  )
}
test('P0-Places-A1 real Desktop IPC invokes only bounded Agent page endpoint', async () => {
  for (const [limit, offset] of [[48,0],[24,24],[100,100000]]) {
    const calls=[]
    const result=await desktopHandler(calls)({},limit,offset)
    assert.deepEqual(calls,[{limit,offset}])
    assert.equal(result.offset,offset)
  }
  for (const [limit,offset] of [[101,0],[1,-1],[24,10000001],[0,0]]) {
    const calls=[]
    await assert.rejects(desktopHandler(calls)({},limit,offset), /pagination is invalid/)
    assert.deepEqual(calls,[])
  }
})

test('P0-Places-A1 existing Web/Mobile shared DataSource and Desktop Agent transport stay unified', () => {
  const ports=read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const route=read('internal/api/router.go')
  const manifest=read('internal/api/router_contract_test.go')
  const client=read('internal/client/media.go')
  const agent=read('cmd/xdrive-agent/desktop_ipc.go')
  const webAdapter=read('web/src/mediaGalleryAdapter.ts')
  const desktopAdapter=read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const preload=read('desktop/src/preload/index.cts')
  const dc=read('desktop/src/main/agent_client.cts')
  assert.match(route,/authed.GET\("\/media\/places\/page", s.listMediaPlacesPage\)/)
  assert.match(manifest,/path: "\/api\/v1\/media\/places\/page"/)
  assert.match(client,/func \(c \*Client\) MediaPlacesPage\(/)
  assert.match(agent,/CloudMediaPlacesPage\(r.Context\(\), limit, offset\)/)
  assert.match(dc,/mediaPlacesPage\(limit = 48, offset = 0\)/)
  assert.match(preload, /getMediaPlacesPage: \(limit = 48, offset = 0\)/)
  assert.match(webAdapter,/listPlacesPage: \(limit = 48, offset = 0\) => api.mediaPlacesPage\(limit, offset\)/)
  assert.match(desktopAdapter,/listPlacesPage: \(limit = 48, offset = 0\) => agent.getMediaPlacesPage\(limit, offset\)/)
  assert.match(ports,/listPlacesPage: port.listPlacesPage/)
  assert.match(ports,/resolveXDriveTransport\(port.listPlacesPage!\(limit, offset\)\)/)
  assert.match(gallery,/useXDriveVirtualCollection<MediaItem>/)
  assert.match(gallery,/placesExpandedRef.current && source.listPlacesPage/)
  assert.match(gallery,/source.listPlacesPage\(48, placesCameraRef.current\?\.placesPageOffset \?\? 0\)/)
  assert.match(gallery,/data-xdrive-places-pagination/)
  assert.doesNotMatch(gallery,/places.slice\(0, 24\)/)
  assert.match(gallery,/setPlaces\(page.items\)/)
  assert.match(gallery,/rangeGeneration !== requestID.current/)
})
test('P0-Places-A1 actual photo coordinate is distinct from coordinate-cell midpoint', () => {
  const map=read('ui/shared/src/mui/MediaGalleryBaiduStaticMap.tsx')
  const server=read('internal/api/media_places.go')
  const filters=read('internal/api/media_filters.go')
  assert.match(map,/place\?\.sample_latitude \?\? place\?\.latitude/)
  assert.match(map,/place\?\.sample_longitude \?\? place\?\.longitude/)
  assert.match(server,/ARRAY_AGG\(xd_media_metadata.latitude ORDER BY pa.primary_node_id\)/)
  assert.match(server,/ARRAY_AGG\(xd_media_metadata.longitude ORDER BY pa.primary_node_id\)/)
  assert.match(server,/CoordinateKind:\s*"grid_cell_center"/)
  assert.match(server,/mediaPlaceValidGPSPredicate/)
  assert.match(filters,/query = query.Where\(mediaPlaceValidGPSPredicate\)/)
  assert.match(filters,/query = query.Where\("NOT " \+ mediaPlaceValidGPSPredicate\)/)
})
