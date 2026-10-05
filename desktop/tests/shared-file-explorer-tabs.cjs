const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const navigation = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts')
const search = read('ui', 'shared', 'src', 'mui', 'FileExplorerSearch.ts')
const workspace = read('ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts')
const tabs = read('ui', 'shared', 'src', 'mui', 'FileExplorerTabs.tsx')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const index = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared navigation controller owns independent tab workspaces', () => {
  for (const token of [
    'export type XDriveFileExplorerNavigationTab',
    'history: TCrumb[][]',
    'historyIndex: number',
    'sort: XDriveFileExplorerSort',
    'viewMode: XDriveFileExplorerViewMode',
    'const [tabs, setTabs]',
    'const [activeTabID, setActiveTabID]',
    'const newTab = async () =>',
    'const activateTab = async (id: string) =>',
    'const closeTab = async (id = activeTabID) =>',
    'const cycleTab = async (delta: -1 | 1) =>',
    'await onLoadDirectory(target.id, targetCrumbs, targetTab.sort)',
    'canNewTab: tabs.length < maxTabs',
    'canCloseTab: tabs.length > 1',
  ]) {
    assert.ok(navigation.includes(token), 'tab navigation contract missing: ' + token)
  }
})

test('shared search controller preserves search state per workspace tab', () => {
  for (const token of [
    "workspaceKey = 'default'",
    'const requestRef = useRef<Record<string, number>>({})',
    'const [entries, setEntries]',
    'const entry = entries[workspaceKey]',
    'updateEntry(workspaceKey',
    'const key = workspaceKey',
  ]) {
    assert.ok(search.includes(token), 'tab search-state contract missing: ' + token)
  }
  assert.ok(workspace.includes('workspaceKey: navigation.activeTabID'), 'workspace must bind search state to the active tab')
  assert.ok(workspace.includes('searchActive: () => searchActiveRef.current'), 'navigation sort behavior must observe the active tab search state')
})

test('shared FileExplorer renders a reusable tab bar and keyboard tab commands', () => {
  assert.ok(index.includes("export * from './FileExplorerTabs'"), 'shared MUI index must export FileExplorerTabs')
  for (const token of [
    'export function XDriveFileExplorerTabs',
    'role="tablist"',
    'role="tab"',
    'aria-selected={active}',
    'onActivate(tab.id)',
    'onCloseTab(tab.id)',
    'onNewTab',
    "color: '#ffcb3d'",
  ]) {
    assert.ok(tabs.includes(token), 'shared tab bar missing: ' + token)
  }
  assert.equal(tabs.includes('<Tab '), false, 'tab close controls must not be nested inside MUI Tab buttons')

  for (const token of [
    'tabBar?: ReactNode',
    'onNewTab?: () => void',
    'onCloseTab?: () => void',
    'onNextTab?: () => void',
    'onPreviousTab?: () => void',
    "modifier && key === 't'",
    "modifier && key === 'w'",
    "modifier && event.key === 'Tab'",
    'data-xdrive-file-explorer-tab-bar',
  ]) {
    assert.ok(explorer.includes(token), 'FileExplorer tab shell/shortcut missing: ' + token)
  }
})

test('Web and Desktop consume the same shared tab controller and tab bar', () => {
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    for (const token of [
      'XDriveFileExplorerTabs',
      'activeTabID,',
      'newTab,',
      'activateTab,',
      'closeTab,',
      'nextTab,',
      'previousTab,',
      'tabBar={(',
      'onNextTab={tabs.length > 1',
    ]) {
      assert.ok(source.includes(token), label + ' tab adapter missing: ' + token)
    }
    assert.equal(source.includes('useState<FileExplorerTab'), false, label + ' must not own a duplicate tab state machine')
  }
})
