'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const source = read('ui/shared/src/cloud-files.ts')
const web = read('web/src/api.ts')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const go = read('internal/client/client.go')
const js = ts.transpileModule(source, {
  fileName: 'cloud-files.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', js)(mod, mod.exports)
const match = mod.exports.xDriveCloudFilesPositionMatchesRequest
const request = {
  nodeID: 42, sort: 'updated', order: 'desc',
  grouping: { groupBy: 'modified', foldersFirst: false },
}
const result = {
  node_id: 42, revision: 8, index: 54321,
  sort: 'updated', order: 'desc', group: 'modified', folders_first: false,
}

test('U09-D2a exact Node identity and directory ordering guard rejects stale position', () => {
  assert.equal(match(result, request), true)
  for (const [field, bad] of [
    ['node_id', 43], ['node_id', 0], ['revision', 0], ['index', -1],
    ['index', 1.5], ['sort', 'name'], ['order', 'asc'],
    ['group', 'type'], ['folders_first', true],
  ]) assert.equal(match({ ...result, [field]: bad }, request), false, field)
  assert.equal(match(null, request), false)
  assert.equal(match({}, request), false)
  assert.equal(match(result, { ...request, nodeID: 0 }), false)
  assert.equal(match(result, { ...request, nodeID: Number.MAX_SAFE_INTEGER + 1 }), false)
})

test('U09-D2a Web/Mobile and Go share cancellable, typed Server position transport', () => {
  for (const token of [
    'childPosition(', 'signal?.throwIfAborted()',
    'appendFileExplorerGrouping(query, grouping)',
    'xDriveCloudFilesPositionMatchesRequest(position, {',
    '/children/position?', '{ signal }',
  ]) assert.ok(web.includes(token), token)
  assert.ok(web.includes('this.request<XDriveCloudFilesPosition>('))
  assert.ok(go.includes('func (c *Client) LocateChildPosition('))
  assert.ok(go.includes('c.json(ctx, http.MethodGet,'))
  assert.ok(go.includes('values.Set("node_id", strconv.FormatUint(nodeID, 10))'))
  assert.ok(!desktop.includes('children/position?'),
    'Desktop renderer must not bypass Agent and make unauthenticated direct HTTP')
})
