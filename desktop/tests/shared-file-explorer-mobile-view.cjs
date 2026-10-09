const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { createTheme, ThemeProvider } = require('@mui/material/styles')
const { buildSync } = require('esbuild')

// Render the production component and MUI with an explicit SSR media result.
// Pointer events, resizing and persistence are exercised by the browser runner.
const bundled = buildSync({
  entryPoints: [path.join(__dirname, '../../ui/shared/src/mui/FileExplorer.tsx')],
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  write: false,
})
const shared = { exports: {} }
// esbuild preserves Node ESM default-import semantics for the source package;
// MUI's require entry exports the same icon under .default. Unwrap that CJS
// boundary so SSR renders the real icon component, as Vite does in the browser.
const requireShared = (name) => name.startsWith('@mui/icons-material/')
  ? require(name).default
  : require(name)
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(shared, shared.exports, requireShared)
const { XDriveFileExplorer } = shared.exports
const items = [
  { id: 2, name: '第一张照片.jpg', kind: 'file', size: 1024 },
  { id: 3, name: '第二张照片.jpg', kind: 'file', size: 2048 },
]

function renderView(viewMode, compactTouch, extraProps = {}) {
  const theme = createTheme({
    components: {
      MuiUseMediaQuery: {
        defaultProps: { ssrMatchMedia: () => ({ matches: compactTouch }) },
      },
    },
  })
  return renderToStaticMarkup(React.createElement(ThemeProvider, { theme },
    React.createElement(XDriveFileExplorer, {
      items,
      crumbs: [{ id: 1, name: '我的文件' }],
      viewMode,
      loadColumnPage: async () => ({ items, nextCursor: '' }),
      onColumnNavigate() {},
      onOpenItem() {},
      ...extraProps,
    })))
}

test('an inherited columns preference keeps the touch file list without per-item More buttons', () => {
  const html = renderView('columns', true)
  assert.ok(html.includes('aria-label="文件列表"'), 'compact touch must project columns into the usable file list')
  assert.ok(!html.includes('data-xdrive-file-explorer-column-view'), 'desktop columns must not consume the touch workspace')
  assert.equal((html.match(/data-xdrive-file-explorer-item-more=/g) || []).length, 0,
    'no file tile may overlay a More action; Context Menu remains on the row')
  assert.ok(html.includes('data-xdrive-file-explorer-item-id='), 'file rows remain interactive')
})

test('a non-touch presentation keeps the caller columns preference', () => {
  const html = renderView('columns', false)
  assert.ok(html.includes('data-xdrive-file-explorer-column-view'))
  assert.ok(!html.includes('data-xdrive-file-explorer-item-more'))
})

test('compact touch retains supported list and grid choices', () => {
  assert.ok(renderView('details', true).includes('aria-label="文件列表"'))
  assert.ok(renderView('grid', true).includes('aria-label="文件图标"'))
})

test('mobile presents the active file workspace without a tab strip', () => {
  const html = renderView('details', true, {
    tabBar: React.createElement('div', { role: 'tablist' }, '已保存的桌面标签'),
  })
  assert.ok(!html.includes('data-xdrive-file-explorer-tab-bar'), 'mobile must reclaim the complete tab strip height')
  assert.ok(!html.includes('role="tablist"'), 'hidden mobile tabs must not remain in the accessibility tree')
  assert.ok(html.includes('aria-label="文件列表"'), 'the current workspace stays available')
})

test('wide presentation keeps the caller tab strip', () => {
  const html = renderView('details', false, {
    tabBar: React.createElement('div', { role: 'tablist' }, '已保存的桌面标签'),
  })
  assert.ok(html.includes('role="tablist"'))
})

test('search without directory column loaders projects the saved columns preference to List', () => {
  for (const compact of [false, true]) {
    const html = renderView('columns', compact, {
      loadColumnPage: undefined,
      onColumnNavigate: undefined,
    })
    assert.ok(html.includes('aria-label="文件列表"'), 'a logical search collection must render and page as a List')
    assert.ok(!html.includes('aria-label="文件图标"'), 'unsupported Columns must not fall through to Grid')
  }
})

test('active search exposes its real scope, committed conditions, count and actual clear action', () => {
  const html = renderView('details', true, {
    searchValue: '未提交的草稿',
    searchSummary: {
      query: '已提交照片', conditions: ['类型：图片', '标签：旅行'], resultCount: 230,
      onClear() {},
    },
  })
  assert.ok(html.includes('范围：全部文件'))
  assert.ok(html.includes('已提交照片'))
  assert.ok(html.includes('类型：图片'))
  assert.ok(html.includes('标签：旅行'))
  assert.ok(html.includes('230 个结果'))
  assert.ok(html.includes('清除搜索与筛选'))
})

test('presentation status names the sort field, direction, grouping and effective view', () => {
  const html = renderView('columns', true, {
    sort: { key: 'updated', direction: 'desc' },
    grouping: { groupBy: 'type', foldersFirst: true },
  })
  assert.ok(html.includes('修改时间 · 降序'))
  assert.ok(html.includes('按类型分组'))
  assert.ok(html.includes('文件夹优先'))
  assert.ok(html.includes('当前视图：列表'))
})
