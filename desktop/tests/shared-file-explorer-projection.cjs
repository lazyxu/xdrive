const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts')
const workspace = read('ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts')
const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const sharedIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer projection owns node/search view-model derivation', () => {
  for (const token of [
    'useXDriveFileExplorerProjection',
    'TSearch extends XDriveFileExplorerSearchProjection<TNode>',
    'const crumbProjection = useMemo',
    'const projection = useMemo(() => {',
    'const nodeByID = new Map<number, TNode>()',
    'const searchByID = new Map<number, TSearch>()',
    'const explorerItems = new Array<XDriveFileExplorerItem>(sourceLength)',
    'const resultPath = result?.path || undefined',
    'path: resultPath || \`${pathPrefix}${node.name}\`',
    'revision: node.revision',
  ]) {
    assert.ok(shared.includes(token), `shared Explorer projection missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './FileExplorerProjection'"), 'shared Explorer projection must be exported')
})

test('Web and Desktop consume shared FileExplorer projection without duplicating maps', () => {
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal((source.match(/useXDriveFileExplorerWorkspace</g) || []).length, 1, `${label} must consume one shared Explorer workspace controller`)
    assert.equal(source.includes('const activeNodes ='), false, `${label} must not derive active nodes locally`)
    assert.equal(source.includes('const nodeByID = useMemo'), false, `${label} must not build nodeByID locally`)
    assert.equal(source.includes('const searchByID = useMemo'), false, `${label} must not build searchByID locally`)
    assert.equal(source.includes('const explorerItems = useMemo'), false, `${label} must not project Explorer items locally`)
    assert.equal(source.includes('const explorerCrumbs = useMemo'), false, `${label} must not project breadcrumbs locally`)
  }
  assert.ok(controller.includes('xDriveFileExplorerNormalizeCrumbs'), 'shared controller must own search-crumb normalization')
  assert.ok(controller.includes('xDriveFileExplorerOpenItemPlan'), 'shared controller must own open-item planning')
  assert.ok(controller.includes('xDriveFileExplorerDispatchOpenItem'), 'shared controller must own open-item dispatch')
  assert.ok(workspace.includes('useXDriveFileExplorerProjection<'), 'workspace controller must compose shared projection')
  assert.ok(workspace.includes('xDriveFileExplorerDispatchOpenItem({'), 'workspace controller must compose shared open-item dispatch')
  assert.ok(web.includes('searchCrumbsForResult: (result) => result.crumbs'), 'Web must adapt shared result.crumbs into the workspace')
  assert.ok(desktop.includes('searchCrumbsForResult: (result) => result.crumbs'), 'Desktop must adapt result.crumbs into the shared workspace')
})


test('FileExplorer projection indexes bounded virtual nodes without logical-array materialization', () => {
  assert.ok(shared.includes('virtualItems?: ReadonlyMap<number, TNode>'), 'projection must accept sparse node indexes')
  assert.ok(shared.includes('const virtualSearchActive = searchResults != null && virtualSearchItems !== undefined'), 'projection must enter sparse Search only when Search is actually active')
  assert.ok(shared.includes('for (const [index, node] of virtualItems)'), 'projection must iterate only loaded sparse metadata')
  assert.ok(shared.includes('nodeByID.set(node.id, node)'), 'loaded remote nodes must participate in operation lookup')
  assert.equal(shared.includes('new Array<XDriveFileExplorerItem>(virtualItems.size)'), false, 'sparse projection must not create a second loaded array')
})


test('sparse Search projection preserves logical indexes without dense aliases', () => {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts')
  const output = ts.transpileModule(shared, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const react = { useMemo: (factory) => factory() }
  const execute = new Function('exports', 'module', 'require', output)
  execute(mod.exports, mod, (request) => request === 'react' ? react : require(request))

  const result400 = {
    node: {
      id: 401,
      name: 'result-400.jpg',
      type: 'file',
      size: 10,
      revision: 1,
      updated_at: '2026-10-06T00:00:00Z',
    },
    path: 'Search/result-400.jpg',
  }
  const result401 = {
    node: {
      id: 402,
      name: 'result-401.jpg',
      type: 'file',
      size: 20,
      revision: 1,
      updated_at: '2026-10-06T00:00:00Z',
    },
    path: 'Search/result-401.jpg',
  }
  const projected = mod.exports.useXDriveFileExplorerProjection({
    items: [],
    crumbs: [{ id: 1, name: '我的文件' }],
    searchResults: [result400, result401],
    virtualSearchItems: new Map([[400, result400], [401, result401]]),
  })

  assert.equal(projected.explorerItems.length, 0, 'sparse Search must not create dense 0..N aliases')
  assert.deepEqual([...projected.virtualExplorerItems.keys()], [400, 401])
  assert.equal(projected.virtualExplorerItems.get(400).secondaryLabel, 'Search/result-400.jpg')
  assert.equal(projected.nodeByID.get(401).name, 'result-400.jpg')
  assert.equal(projected.searchByID.get(402).path, 'Search/result-401.jpg')
})


test('inactive Search sparse metadata cannot mask loaded directory items', () => {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts')
  const output = ts.transpileModule(shared, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const react = { useMemo: (factory) => factory() }
  const execute = new Function('exports', 'module', 'require', output)
  execute(mod.exports, mod, (request) => request === 'react' ? react : require(request))

  const directoryItems = Array.from({ length: 6 }, (_, index) => ({
    id: index + 10,
    name: index < 5 ? `folder-${index + 1}` : 'file.txt',
    type: index < 5 ? 'dir' : 'file',
    size: index < 5 ? 0 : 12,
    revision: 1,
    updated_at: '2026-10-06T00:00:00Z',
  }))
  const virtualItems = new Map(directoryItems.map((node, index) => [index, node]))

  const projected = mod.exports.useXDriveFileExplorerProjection({
    items: directoryItems,
    crumbs: [{ id: 1, name: '我的文件' }],
    searchResults: null,
    virtualItems,
    // Search controller intentionally exposes an empty sparse map while idle.
    // This must never shadow the active directory VirtualCollection.
    virtualSearchItems: new Map(),
  })

  assert.equal(projected.explorerItems.length, 6, 'dense first directory range must remain projected')
  assert.equal(projected.virtualExplorerItems.size, 6, 'directory sparse cache must retain all loaded first-range items')
  assert.deepEqual(
    [...projected.virtualExplorerItems.values()].map((item) => item.name),
    ['folder-1', 'folder-2', 'folder-3', 'folder-4', 'folder-5', 'file.txt'],
  )
  assert.equal(projected.nodeByID.size, 6, 'loaded directory items must remain interactive by node id')
  assert.equal(projected.virtualExplorerItems.get(0).kind, 'dir')
  assert.equal(projected.virtualExplorerItems.get(5).kind, 'file')
})

test('workspace only forwards sparse Search metadata while Search is active', () => {
  assert.ok(
    workspace.includes('virtualSearchItems: search.searchResults !== null'),
    'idle Search must not shadow the active directory VirtualCollection',
  )
})
