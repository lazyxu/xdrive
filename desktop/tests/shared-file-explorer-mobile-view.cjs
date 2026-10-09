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

function renderView(viewMode, compactTouch) {
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
    })))
}

test('an inherited columns preference still exposes the touch file list and item actions', () => {
  const html = renderView('columns', true)
  assert.ok(html.includes('aria-label="文件列表"'), 'compact touch must project columns into the usable file list')
  assert.ok(!html.includes('data-xdrive-file-explorer-column-view'), 'desktop columns must not consume the touch workspace')
  assert.equal((html.match(/data-xdrive-file-explorer-item-more=/g) || []).length, 2,
    'both files must expose their touch action entry')
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
