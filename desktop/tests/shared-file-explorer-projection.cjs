const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts')
const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const sharedIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer projection owns node/search view-model derivation', () => {
  for (const token of [
    'useXDriveFileExplorerProjection',
    'TSearch extends XDriveFileExplorerSearchProjection<TNode>',
    'const activeNodes = useMemo',
    'const nodeByID = useMemo',
    'const searchByID = useMemo',
    'const explorerItems = useMemo<XDriveFileExplorerItem[]>',
    'const explorerCrumbs = useMemo<XDriveFileExplorerCrumb[]>',
    'secondaryLabel: result?.path || undefined',
    "path: result?.path || [...crumbs.map((crumb) => crumb.name), node.name].join('/')",
    'revision: node.revision',
  ]) {
    assert.ok(shared.includes(token), `shared Explorer projection missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './FileExplorerProjection'"), 'shared Explorer projection must be exported')
})

test('Web and Desktop consume shared FileExplorer projection without duplicating maps', () => {
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal((source.match(/useXDriveFileExplorerProjection\(/g) || []).length, 1, `${label} must use one shared Explorer projection`)
    assert.equal(source.includes('const activeNodes ='), false, `${label} must not derive active nodes locally`)
    assert.equal(source.includes('const nodeByID = useMemo'), false, `${label} must not build nodeByID locally`)
    assert.equal(source.includes('const searchByID = useMemo'), false, `${label} must not build searchByID locally`)
    assert.equal(source.includes('const explorerItems = useMemo'), false, `${label} must not project Explorer items locally`)
    assert.equal(source.includes('const explorerCrumbs = useMemo'), false, `${label} must not project breadcrumbs locally`)
  }
  assert.ok(controller.includes('xDriveFileExplorerNormalizeCrumbs'), 'shared controller must own search-crumb normalization')
  assert.ok(web.includes('xDriveFileExplorerDirectoryCrumbs(node, crumbs, result?.breadcrumbs)'), 'Web must adapt result.breadcrumbs into the shared directory-crumb controller')
  assert.ok(desktop.includes('xDriveFileExplorerDirectoryCrumbs(node, crumbs, searchResult?.crumbs)'), 'Desktop must adapt result.crumbs into the shared directory-crumb controller')
})
