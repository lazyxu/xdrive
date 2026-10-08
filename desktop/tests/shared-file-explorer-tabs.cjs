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
const keyboard = read('ui', 'shared', 'src', 'file-explorer-keyboard.ts')
const actions = read('ui', 'shared', 'src', 'mui', 'FileExplorerActions.tsx')
const index = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared navigation controller owns independent tab workspaces', () => {
  for (const token of [
    'export type XDriveFileExplorerNavigationTab',
    'history: TCrumb[][]',
    'historyIndex: number',
    'sort: XDriveFileExplorerSort',
    'grouping: XDriveFileExplorerGrouping',
    'viewMode: XDriveFileExplorerViewMode',
    'export type XDriveFileExplorerNavigationState',
    'const [navigationState, setNavigationState]',
    'const tabs = navigationState.tabs',
    'const activeTabID = navigationState.activeTabID',
    'const openTab = async (nextCrumbs: TCrumb[]) =>',
    'return openTab([root])',
    'const newTab = async () =>',
    'const activateTab = async (id: string) =>',
    'const closeTab = async (id = activeTabID) =>',
    'const cycleTab = async (delta: -1 | 1) =>',
    'const committed = await onLoadDirectory(',
    'committed === false || !isNavigationCurrent(requestID)',
    'canNewTab: tabs.length < maxTabs',
    'canCloseTab: tabs.length > 1',
  ]) {
    assert.ok(navigation.includes(token), 'tab navigation contract missing: ' + token)
  }
})

test('shared search controller preserves range search state per workspace tab', () => {
  for (const token of [
    "workspaceKey = 'default'",
    'const requestRef = useRef<Record<string, number>>({})',
    'const [entries, setEntries]',
    'const entry = entries[workspaceKey]',
    'workspaceKey: key',
    'targetRef.current = nextTarget',
    'targetRef.current?.workspaceKey === workspaceKey',
  ]) {
    assert.ok(search.includes(token), 'tab search-state contract missing: ' + token)
  }
  assert.ok(
    workspace.includes("navigationSessionStorageKey ?? ''") &&
    workspace.includes('navigation.activeTabID'),
    'workspace must bind search state to both the account lifecycle and active tab',
  )
  assert.ok(workspace.includes('searchActive: () => searchActiveRef.current'), 'navigation sort/group behavior must observe the active tab search state')
  assert.ok(search.includes('groupingSignature'), 'search tab state must bind ranges to grouping identity')
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
    "command === 'new-tab'",
    "command === 'close-tab'",
    "command === 'next-tab' || command === 'previous-tab'",
    'data-xdrive-file-explorer-tab-bar',
  ]) {
    assert.ok(explorer.includes(token), 'FileExplorer tab shell/command missing: ' + token)
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
      'tabBar={trashActive ? undefined : (',
      'onNextTab={!trashActive && tabs.length > 1',
    ]) {
      assert.ok(source.includes(token), label + ' tab adapter missing: ' + token)
    }
    assert.equal(source.includes('useState<FileExplorerTab'), false, label + ' must not own a duplicate tab state machine')
  }
})


test('folders can open in a new shared FileExplorer tab from Web and Desktop', () => {
  for (const token of [
    'xDriveFileExplorerDirectoryCrumbs',
    'const openItemInNewTab = async (item: XDriveFileExplorerItem) =>',
    'const opened = await navigation.openTab(nextCrumbs)',
    'openItemInNewTab,',
  ]) {
    assert.ok(workspace.includes(token), 'workspace new-tab folder contract missing: ' + token)
  }

  for (const token of [
    'onOpenInNewTab,',
    'onOpenInNewTab?: () => void',
    "id: 'open-new-tab'",
    "label: '在新标签页中打开'",
    'onSelect: onOpenInNewTab',
  ]) {
    assert.ok(actions.includes(token), 'shared folder menu new-tab action missing: ' + token)
  }

  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('openItemInNewTab,'), label + ' must consume shared openItemInNewTab')
    assert.ok(
      source.includes("onOpenInNewTab: node.type === 'dir' && canNewTab"),
      label + ' must expose Open in New Tab only for folders while capacity remains',
    )
    assert.ok(
      source.includes('void openItemInNewTab(item)'),
      label + ' must delegate folder new-tab navigation to the shared workspace',
    )
  }
})


test('deep tab workflows stay in shared navigation and shared MUI', () => {
  for (const token of [
    'export type XDriveFileExplorerTabDropPosition',
    'closedTabsRef',
    'const reorderTab = (',
    'const duplicateTab = async',
    'const closeOtherTabs = async',
    'const closeTabsToRight = async',
    'const restoreClosedTab = async',
    'canRestoreClosedTab:',
    'rememberClosedTabs(',
    'consumeClosedTab(',
  ]) {
    assert.ok(navigation.includes(token), 'shared deep-tab navigation missing: ' + token)
  }

  for (const token of [
    'draggable={Boolean(onReorderTab) && tabs.length > 1}',
    'onAuxClick={(event) =>',
    'onReorderTab(draggedTabID, tab.id, position)',
    '复制标签',
    '关闭其他标签页',
    '关闭右侧标签页',
    '恢复关闭的标签页',
    'canRestoreClosedTab',
  ]) {
    assert.ok(tabs.includes(token), 'shared deep-tab strip missing: ' + token)
  }

  for (const token of [
    'onOpenItemInNewTab?: (item: XDriveFileExplorerItem) => void',
    'openItemInNewTabFromMouse',
    "event.button !== 1",
    "item.kind !== 'dir'",
    "command === 'restore-closed-tab'",
    'onRestoreClosedTab?: () => void',
  ]) {
    assert.ok(explorer.includes(token), 'shared FileExplorer tab interaction missing: ' + token)
  }

  assert.ok(
    keyboard.includes("| 'restore-closed-tab'"),
    'keyboard contract must expose restore-closed-tab',
  )
  assert.ok(
    keyboard.includes("if (key === 't') return 'restore-closed-tab'"),
    'Ctrl/Cmd+Shift+T must restore the most recently closed FileExplorer tab',
  )

  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    for (const token of [
      'reorderTab,',
      'duplicateTab,',
      'closeOtherTabs,',
      'closeTabsToRight,',
      'restoreClosedTab,',
      'canRestoreClosedTab,',
      'onOpenItemInNewTab=',
      'onReorderTab={(sourceID, targetID, position) =>',
      'onDuplicateTab={(id) =>',
      'onCloseOtherTabs={(id) =>',
      'onCloseTabsToRight={(id) =>',
      'onRestoreClosedTab={() =>',
    ]) {
      assert.ok(source.includes(token), label + ' deep-tab adapter missing: ' + token)
    }
  }
})


test('active tabs use neutral surface hierarchy instead of a strong primary underline', () => {
  assert.ok(tabs.includes("bgcolor: active ? 'background.paper' : 'transparent'"))
  assert.ok(tabs.includes("borderTopColor: active ? 'divider' : 'transparent'"))
  assert.ok(tabs.includes("borderBottomColor: active ? 'background.paper' : 'transparent'"))
  assert.ok(tabs.includes("fontWeight: active ? 600 : 400"))
  assert.equal(tabs.includes('inset 0 -2px 0 var(--mui-palette-primary-main)'), false)
})
