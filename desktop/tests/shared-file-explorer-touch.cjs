const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const explorer = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'), 'utf8')
const controller = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'file-explorer-controller.ts'), 'utf8')

test('shared FileExplorer keeps compact touch input separate from desktop mouse semantics', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px) and (pointer: coarse)')",
    'xDriveFileExplorerTouchItemIntent({',
    "if (!compactTouch || pointerType !== 'touch') return 'desktop-select'",
    "return selectionMode ? 'toggle-selection' : 'open'",
    'onDoubleClick={() => {',
    'event.ctrlKey || event.metaKey',
  ]) {
    assert.ok(explorer.includes(token) || controller.includes(token), 'missing touch/desktop input contract: ' + token)
  }
})

test('compact touch opens, holds for Context Menu, drags to valid folders, and offers explicit Select', () => {
  for (const token of [
    'XDRIVE_MOBILE_ITEM_HOLD_MS',
    'openItemContextMenuAt(press.item, press.startX + 2, press.startY - 6)',
    'touchDrag.begin(event, source.map',
    'setTouchSelectionMode(true)',
    'toggleTouchSelection(item, index)',
    'onOpenItem?.(item)',
    'xDriveMobileItemMoved({ x: press.startX, y: press.startY }',
    'draggable={!compactTouch && Boolean(onDropItemsToFolder) && !renaming}',
    '已选择 {selectedCount} 项',
    'setTouchSelectionMode(false)',
    '完成',
  ]) {
    assert.ok(explorer.includes(token) || controller.includes(token), 'missing compact-touch selection/open behavior: ' + token)
  }
})

test('held item gesture arms drag before a menu and releases stationery into Context Menu only', () => {
  const start = explorer.slice(explorer.indexOf('const startTouchItemPress = ('), explorer.indexOf('const finishTouchItemPress = ('))
  const finish = explorer.slice(explorer.indexOf('const finishTouchItemPress = ('), explorer.indexOf('const activateItem = ('))
  assert.match(start, /press\.held = true/)
  assert.match(start, /touchDrag\.begin\(event, source\.map/)
  assert.doesNotMatch(start, /openItemContextMenuAt\(/, 'opening a Drawer during the held contact intercepts drag and scroll')
  assert.match(finish, /if \(press\?\.held && press\.pointerId === event\.pointerId\)/)
  assert.match(finish, /openItemContextMenuAt\(press\.item,/)
  assert.match(finish, /blockHeldClick/, 'compatibility click must not activate a menu row underneath the finger')
  assert.match(finish, /const abortTouchItemPress =/)
  assert.match(explorer, /onPointerCancel=\{abortTouchItemPress\}/)
  assert.match(explorer, /onDrop: \(source, point\) => \{\s*cancelTouchItemPress\(\)/)
})

test('compact touch uses touch-size commands and one on-demand Context Menu without per-item More buttons', () => {
  for (const token of [
    'data-xdrive-file-explorer-touch-command-bar',
    "'& .MuiIconButton-root': { width: 44, height: 44",
    'onContextMenu={(event) => openItemContextMenu(event, item)}',
    'data-xdrive-file-explorer-touch-navigation-drawer',
    'data-xdrive-file-explorer-touch-action-sheet',
    "anchor=\"bottom\"",
    "minHeight: 48, color: menuItem.danger ? 'error.main' : undefined",
  ]) {
    assert.ok(explorer.includes(token), 'missing compact-touch UI affordance: ' + token)
  }
  assert.doesNotMatch(explorer, /data-xdrive-file-explorer-item-more/, 'the old per-file button must not regress')
})

test('compact viewports project mobile geometry without overwriting desktop pane/column preferences', () => {
  for (const token of [
    'const detailsRowHeight = compactViewport',
    '? 52',
    "? ['name' as XDriveFileExplorerDetailsColumnKey]",
    "? 'minmax(0, 1fr)'",
    'viewPreferences.navigationPaneVisible && !compactViewport',
    'inspectorOpen && !compactViewport',
    "const effectiveGridSize: XDriveFileExplorerGridSize = compactViewport ? 'medium' : viewPreferences.gridSize",
    "{compactViewport ? (",
    "setViewMode('details')",
    "setViewMode('grid')",
    'window.localStorage.setItem(detailsPreferencesKey, JSON.stringify(detailsLayout))',
    'window.localStorage.setItem(viewPreferencesKey, JSON.stringify(viewPreferences))',
  ]) {
    assert.ok(explorer.includes(token), 'missing mobile projection/persistence boundary: ' + token)
  }
})

test('compact viewports collapse search and keep low-frequency commands discoverable', () => {
  for (const token of [
    'compactViewport && !touchSearchOpen',
    'setTouchSearchOpen(true)',
    "aria-label={compactViewport ? '关闭搜索框' : '搜索'}",
    'compactViewport && onPaste',
    'compactViewport && onRefresh',
    '(compactViewport || commandBarOverflowLevel >= 2) && onCreateFolder',
    '(compactViewport || commandBarOverflowLevel >= 1) && onUploadFolder',
  ]) {
    assert.ok(explorer.includes(token), 'missing compact-viewport search/overflow behavior: ' + token)
  }
})
