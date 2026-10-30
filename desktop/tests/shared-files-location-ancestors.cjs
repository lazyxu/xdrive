'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = 'ui/shared/src/mui/FileExplorerLocationAncestors.ts'
const src = fs.readFileSync(path.join(root, filename), 'utf8')
const output = ts.transpileModule(src, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((output.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', output.outputText)(mod, mod.exports)
const project = mod.exports.xDriveFileExplorerLocationAncestorCrumbs

function location(overrides = {}) {
  return {
    node_id: 321, revision: 7, node_type: 'file',
    parent_id: 12, parent_path: '/Photos',
    path: '/Photos/private.jpg',
    breadcrumbs: [
      { id: 1, name: '我的文件', path: '/private/server/owner' },
      { id: 12, name: 'Photos', path: '/private/server/owner/Photos' },
      { id: 321, name: 'private.jpg', path: '/private/server/owner/Photos/private.jpg' },
    ],
    sources: [{ source_id: 8, source_name: 'Private Source', password: 'SECRET' }],
    sync_folders: [{ target_node_id: 12, credential: 'SECRET' }],
    ...overrides,
  }
}

test('Web/Desktop only receive verified root-to-containing-folder ID/label crumbs', () => {
  const original = location()
  assert.deepEqual(project(original), [
    { id: 1, name: '我的文件' }, { id: 12, name: 'Photos' },
  ])
  assert.strictEqual(original.breadcrumbs.length, 3)
  assert.doesNotMatch(JSON.stringify(project(original)), /private|SECRET|path|sources|credentials/i)
  assert.deepEqual(project(location({
    breadcrumbs: original.breadcrumbs.slice(0, 2),
  })), [
    { id: 1, name: '我的文件' }, { id: 12, name: 'Photos' },
  ], 'some real Host locations omit the file breadcrumb')
})

test('malformed Owner parent, Node ID or disconnected chain cannot trigger navigation', () => {
  const orig = location()
  for (const bad of [
    null, undefined, [],
    location({ node_id: 0 }),
    location({ node_id: '321' }),
    location({ parent_id: 0 }),
    location({ parent_id: -2 }),
    location({ parent_id: 321 }),
    location({ parent_id: 12.5 }),
    location({ parent_id: Number.MAX_SAFE_INTEGER + 1 }),
    location({ breadcrumbs: null }),
    location({ breadcrumbs: [] }),
    location({ breadcrumbs: orig.breadcrumbs.slice(0, 1) }),
    location({ breadcrumbs: [orig.breadcrumbs[0], orig.breadcrumbs[2]] }),
    location({ breadcrumbs: [orig.breadcrumbs[0], orig.breadcrumbs[1], orig.breadcrumbs[1]] }),
    location({ breadcrumbs: [orig.breadcrumbs[0], orig.breadcrumbs[2], orig.breadcrumbs[1]] }),
    location({ breadcrumbs: [{ ...orig.breadcrumbs[0], name: '' }, orig.breadcrumbs[1]] }),
    location({ breadcrumbs: [{ ...orig.breadcrumbs[0], name: ' \n' }, orig.breadcrumbs[1]] }),
    location({ breadcrumbs: [{ ...orig.breadcrumbs[0], name: 'x'.repeat(513) }, orig.breadcrumbs[1]] }),
    location({ breadcrumbs: [{ ...orig.breadcrumbs[0], id: '1' }, orig.breadcrumbs[1]] }),
    location({ breadcrumbs: [{ ...orig.breadcrumbs[0], id: -1 }, orig.breadcrumbs[1]] }),
    location({ breadcrumbs: Array.from({ length: 257 }, (_, i) => ({ id: i + 1, name: 'f' })) }),
  ]) assert.equal(project(bad), null, JSON.stringify(bad)?.slice(0, 160))
})

test('real Desktop and Web Files use one bounded ancestry projection and genuine Host navigation', () => {
  const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/DesktopFileExplorer.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')
  for (const source of [desktop, web]) {
    assert.match(source, /xDriveFileExplorerLocationAncestorCrumbs\(location\)/)
    assert.match(source, /await navigateTo\(/)
    assert.match(source, /isNavigationIntentCurrent\(intent\)/)
    assert.doesNotMatch(source, /\.filter\(crumb => crumb\.id !== location\.node_id\)/)
  }
  assert.match(desktop, /hostPort\.browse\.getNodeLocation\(nodeID, requestID\)/)
  assert.match(web, /api\.nodeLocation\(nodeID, signal\)/)
  assert.match(fs.readFileSync(path.join(root, 'ui/shared/src/mui/index.tsx'), 'utf8'),
    /export \* from '\.\/FileExplorerLocationAncestors'/)
  assert.doesNotMatch(src, /window\.|fetch\s*\(|ipcRenderer|backup\.cgi|setFileAvailability|cloudDelete/)
})
