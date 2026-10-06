const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

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
    'path: resultPath || \`${crumbProjection.pathPrefix}${node.name}\`',
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
  assert.ok(web.includes('searchCrumbsForResult: (result) => result.breadcrumbs'), 'Web must adapt result.breadcrumbs into the shared workspace')
  assert.ok(desktop.includes('searchCrumbsForResult: (result) => result.crumbs'), 'Desktop must adapt result.crumbs into the shared workspace')
})
