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

test('compact touch provides direct open and explicit multi-select without touch drag', () => {
  for (const token of [
    'XDRIVE_FILE_EXPLORER_TOUCH_LONG_PRESS_MS = 450',
    'setTouchSelectionMode(true)',
    'toggleTouchSelection(item, index)',
    'onOpenItem?.(item)',
    "Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 10) {\n      suppressTouchClickRef.current = true",
    'draggable={!compactTouch && Boolean(onDropItemsToFolder) && !renaming}',
    '已选择 {selectedItems.length} 项',
    'setTouchSelectionMode(false)',
    '完成',
  ]) {
    assert.ok(explorer.includes(token) || controller.includes(token), 'missing compact-touch selection/open behavior: ' + token)
  }
})

test('compact touch uses touch-size commands, explicit More buttons and mobile overlays', () => {
  for (const token of [
    'data-xdrive-file-explorer-touch-command-bar',
    "'& .MuiIconButton-root': { width: 44, height: 44",
    'data-xdrive-file-explorer-item-more',
    'data-xdrive-file-explorer-touch-navigation-drawer',
    'data-xdrive-file-explorer-touch-action-sheet',
    "anchor=\"bottom\"",
    "minHeight: 48, color: menuItem.danger ? 'error.main' : undefined",
  ]) {
    assert.ok(explorer.includes(token), 'missing compact-touch UI affordance: ' + token)
  }
})

test('compact touch projects mobile geometry without overwriting desktop pane/column preferences', () => {
  for (const token of [
    'const detailsRowHeight = compactTouch',
    '? 52',
    "? ['name' as XDriveFileExplorerDetailsColumnKey]",
    "? 'minmax(0, 1fr)'",
    'viewPreferences.navigationPaneVisible && !compactTouch',
    'inspectorOpen && !compactTouch',
    "const effectiveGridSize: XDriveFileExplorerGridSize = compactTouch ? 'medium' : viewPreferences.gridSize",
    "{compactTouch ? (",
    "setViewMode('details')",
    "setViewMode('grid')",
    'window.localStorage.setItem(detailsPreferencesKey, JSON.stringify(detailsLayout))',
    'window.localStorage.setItem(viewPreferencesKey, JSON.stringify(viewPreferences))',
  ]) {
    assert.ok(explorer.includes(token), 'missing mobile projection/persistence boundary: ' + token)
  }
})

test('compact touch collapses search and keeps low-frequency commands discoverable', () => {
  for (const token of [
    'compactTouch && !touchSearchOpen',
    'setTouchSearchOpen(true)',
    "aria-label={compactTouch ? '关闭搜索' : '搜索'}",
    'compactTouch && onPaste',
    'compactTouch && onRefresh',
    '(compactTouch || commandBarOverflowLevel >= 2) && onCreateFolder',
    '(compactTouch || commandBarOverflowLevel >= 1) && onUploadFolder',
  ]) {
    assert.ok(explorer.includes(token), 'missing compact-touch search/overflow behavior: ' + token)
  }
})
