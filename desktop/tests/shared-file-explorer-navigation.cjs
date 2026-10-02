const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts')
const sharedMuiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer navigation controller owns cross-client view and history state', () => {
  for (const token of [
    'useXDriveFileExplorerNavigation',
    "useState<XDriveFileExplorerSort>({ key: 'name', direction: 'asc' })",
    'useState<TCrumb[][]>([])',
    'window.localStorage.setItem(viewModeStorageKey, viewMode)',
    'const navigateTo = async',
    'const goBack = async',
    'const goForward = async',
    'const goUp = async',
    'canGoBack: historyIndex > 0',
    'canGoForward: historyIndex >= 0 && historyIndex < history.length - 1',
    'canGoUp: crumbs.length > 1',
    'if (searchActive) return',
    'onAfterNavigate?.()',
  ]) {
    assert.ok(shared.includes(token), `shared Explorer navigation missing: ${token}`)
  }
  assert.ok(sharedMuiIndex.includes("export * from './FileExplorerNavigation'"), 'shared Explorer navigation controller must be exported')
})

test('Web and Desktop use shared FileExplorer navigation instead of duplicating history state', () => {
  for (const [label, source, key] of [
    ['Web', web, 'FILE_VIEW_KEY'],
    ['Desktop', desktop, 'DESKTOP_FILE_VIEW_KEY'],
  ]) {
    assert.equal((source.match(/useXDriveFileExplorerNavigation\(/g) || []).length, 1, `${label} must use one shared Explorer navigation controller`)
    assert.ok(source.includes(`viewModeStorageKey: ${key}`), `${label} must keep its local storage namespace`)
    assert.equal(source.includes('setHistory('), false, `${label} must not duplicate Explorer history state`)
    assert.equal(source.includes('setHistoryIndex('), false, `${label} must not duplicate Explorer history index state`)
    assert.equal(source.includes('const goBack = async'), false, `${label} must not duplicate Explorer back navigation`)
    assert.equal(source.includes('const goForward = async'), false, `${label} must not duplicate Explorer forward navigation`)
    assert.equal(source.includes('const goUp = async'), false, `${label} must not duplicate Explorer up navigation`)
  }
})
