const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer owns persisted view-density and grid-size preferences', () => {
  for (const token of [
    "XDriveFileExplorerDetailsDensity = 'normal' | 'compact'",
    "XDriveFileExplorerGridSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge'",
    'xDriveDefaultFileExplorerViewPreferences',
    'xDriveNormalizeFileExplorerViewPreferences',
    'viewPreferencesKey?: string',
    'loadFileExplorerViewPreferences(viewPreferencesKey)',
    'window.localStorage.setItem(viewPreferencesKey, JSON.stringify(viewPreferences))',
    "viewPreferences.detailsDensity === 'compact'",
    "viewPreferences.gridSize === 'tiny'",
    "viewPreferences.gridSize === 'small'",
    "viewPreferences.gridSize === 'medium'",
    "viewPreferences.gridSize === 'large'",
    "viewPreferences.gridSize === 'huge'",
    'navigationPaneVisible: true',
    'navigationPaneWidth: fileExplorerNavigationPaneDefaultWidth',
    'inspectorWidth: fileExplorerInspectorDefaultWidth',
  ]) {
    assert.ok(explorer.includes(token), `shared view preferences missing: ${token}`)
  }
})

test('shared FileExplorer uses dynamic Details and Grid metrics', () => {
  for (const token of [
    'const detailsNormalRowHeight = 36',
    'const detailsCompactRowHeight = 28',
    "viewPreferences.detailsDensity === 'compact'",
    "const effectiveGridSize: XDriveFileExplorerGridSize = compactViewport ? 'medium' : viewPreferences.gridSize",
    'fileExplorerGridMetrics[effectiveGridSize]',
    'gridMetrics.minColumnWidth',
    'gridMetrics.minItemHeight',
    'gridMetrics.thumbnailWidth',
    'gridMetrics.thumbnailHeight',
    'gridMetrics.estimatedRowHeight',
    "viewPreferences.detailsDensity === 'compact'",
  ]) {
    assert.ok(explorer.includes(token), `dynamic FileExplorer metric missing: ${token}`)
  }
})

test('Grid Ctrl-wheel scaling is shared, clamped and discoverable', () => {
  for (const token of [
    'xDriveFileExplorerNextGridSize',
    "fileExplorerGridSizeOrder: XDriveFileExplorerGridSize[] = ['tiny', 'small', 'medium', 'large', 'huge']",
    "viewMode !== 'grid'",
    'event.ctrlKey || event.metaKey',
    'event.deltaY < 0 ? 1 : -1',
    'onWheel={handleViewWheel}',
    'Grid 模式可用 Ctrl + 滚轮缩放',
    '紧凑详细信息',
    '超小图标',
    '小图标',
    '中图标',
    '大图标',
    '超大图标',
  ]) {
    assert.ok(explorer.includes(token), `Grid scaling contract missing: ${token}`)
  }
})

test('Web and Desktop persist the same shared view-preference contract', () => {
  assert.ok(web.includes("FILE_VIEW_PREFERENCES_KEY = 'xdrive.files.view_preferences'"), 'Web view preference key missing')
  assert.ok(web.includes('viewPreferencesKey={FILE_VIEW_PREFERENCES_KEY}'), 'Web must pass the shared view preference key')
  assert.ok(desktop.includes("DESKTOP_FILE_VIEW_PREFERENCES_KEY = 'xdrive.desktop.files.view_preferences'"), 'Desktop view preference key missing')
  assert.ok(desktop.includes('viewPreferencesKey={DESKTOP_FILE_VIEW_PREFERENCES_KEY}'), 'Desktop must pass the shared view preference key')
})


test('shared view preferences persist resizable navigation and inspector panes', () => {
  for (const token of [
    'fileExplorerNavigationPaneMinWidth = 176',
    'fileExplorerNavigationPaneMaxWidth = 320',
    'fileExplorerInspectorMinWidth = 260',
    'fileExplorerInspectorMaxWidth = 480',
    'data-xdrive-file-explorer-navigation-splitter',
    'data-xdrive-file-explorer-inspector-splitter',
    'startNavigationPaneResize',
    'moveNavigationPaneResize',
    'startInspectorResize',
    'moveInspectorResize',
    'navigationPaneVisible: !current.navigationPaneVisible',
  ]) {
    assert.ok(explorer.includes(token), 'resizable pane contract missing: ' + token)
  }
})
