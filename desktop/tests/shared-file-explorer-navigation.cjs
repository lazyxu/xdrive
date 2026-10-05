const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts')
const workspace = read('ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts')
const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const sharedMuiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer navigation controller owns cross-client per-tab view and history state', () => {
  for (const token of [
    'useXDriveFileExplorerNavigation',
    'export type XDriveFileExplorerNavigationTab',
    'history: TCrumb[][]',
    'historyIndex: number',
    'sort: XDriveFileExplorerSort',
    'viewMode: XDriveFileExplorerViewMode',
    'const [tabs, setTabs]',
    'const [activeTabID, setActiveTabID]',
    'window.localStorage.setItem(viewModeStorageKey, viewMode)',
    "const pathValue = crumbs.map((crumb) => crumb.name).join('/')",
    'const refresh = () =>',
    'onLoadDirectory(current.id, crumbs, sort)',
    'const navigateTo = async',
    'const navigateToCrumb = async (index: number)',
    'index < 0 || index >= crumbs.length',
    'crumbs.slice(0, index + 1)',
    'const goBack = async',
    'const goForward = async',
    'const goUp = async',
    'canGoBack: historyIndex > 0',
    'canGoForward: historyIndex >= 0 && historyIndex < history.length - 1',
    'canGoUp: crumbs.length > 1',
    'if (isSearchActive()) return',
    'onAfterNavigate?.()',
    'const newTab = async () =>',
    'const activateTab = async (id: string) =>',
    'const closeTab = async (id = activeTabID) =>',
  ]) {
    assert.ok(shared.includes(token), `shared Explorer navigation missing: ${token}`)
  }
  assert.ok(controller.includes("XDRIVE_FILE_EXPLORER_DEFAULT_SORT = {\n  key: 'name',\n  direction: 'asc',"), 'framework-neutral controller must own the default Explorer sort')
  assert.ok(shared.includes("import { XDRIVE_FILE_EXPLORER_DEFAULT_SORT } from '../file-explorer-controller'"), 'navigation must consume the shared default sort')
  assert.ok(sharedMuiIndex.includes("export * from './FileExplorerNavigation'"), 'shared Explorer navigation controller must be exported')
})

test('Web and Desktop use shared FileExplorer navigation instead of duplicating history state', () => {
  for (const [label, source, key] of [
    ['Web', web, 'FILE_VIEW_KEY'],
    ['Desktop', desktop, 'DESKTOP_FILE_VIEW_KEY'],
  ]) {
    assert.equal((source.match(/useXDriveFileExplorerWorkspace</g) || []).length, 1, `${label} must use one shared Explorer workspace controller`)
    assert.ok(source.includes(`viewModeStorageKey: ${key}`), `${label} must keep its local storage namespace`)
    assert.equal(source.includes('setHistory('), false, `${label} must not duplicate Explorer history state`)
    assert.equal(source.includes('setHistoryIndex('), false, `${label} must not duplicate Explorer history index state`)
    assert.equal(source.includes('const goBack = async'), false, `${label} must not duplicate Explorer back navigation`)
    assert.equal(source.includes('const goForward = async'), false, `${label} must not duplicate Explorer forward navigation`)
    assert.equal(source.includes('const goUp = async'), false, `${label} must not duplicate Explorer up navigation`)
    assert.equal((source.match(/onRefresh=\{refresh\}/g) || []).length, 1, `${label} Explorer toolbar must use shared refresh`)
    assert.ok(source.includes('onRefresh: refresh'), `${label} background menu must use shared refresh`)
    assert.equal(source.includes('if (current) void onLoadDirectory(current.id, crumbs, sort)'), false, `${label} must not duplicate current-directory refresh`)
    assert.ok(source.includes('pathValue={pathValue}'), `${label} must use shared navigation path display`)
    assert.ok(source.includes('navigateToCrumb(index)'), `${label} must use shared breadcrumb navigation`)
    assert.equal(source.includes("crumbs.map((crumb) => crumb.name).join('/')"), false, `${label} must not derive the path display locally`)
    assert.equal(source.includes('navigateTo(crumbs.slice(0, index + 1))'), false, `${label} must not slice breadcrumb navigation locally`)
  }
  assert.ok(workspace.includes('useXDriveFileExplorerNavigation({'), 'workspace controller must compose shared navigation')
})
