const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { createTheme, ThemeProvider } = require('@mui/material/styles')
const { buildSync } = require('esbuild')

const sourceRoot = process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..')
const bundled = buildSync({
  entryPoints: [path.join(sourceRoot, 'ui/shared/src/mui/FileExplorer.tsx')],
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
})
const shared = { exports: {} }
const requireShared = (name) => name.startsWith('@mui/icons-material/') ? require(name).default : require(name)
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(shared, shared.exports, requireShared)

function render(extra = {}) {
  const theme = createTheme({ components: {
    MuiUseMediaQuery: { defaultProps: { ssrMatchMedia: () => ({ matches: true }) } },
  } })
  return renderToStaticMarkup(React.createElement(ThemeProvider, { theme },
    React.createElement(shared.exports.XDriveFileExplorer, {
      items: [{ id: 2, name: '已加载.txt', kind: 'file', size: 1024 }],
      crumbs: [{ id: 1, name: '我的文件' }], viewMode: 'details', selectedIDs: [2],
      onMoveItemsTo() {}, onCopyItemsTo() {},
      ...extra,
    })))
}

function destinationButtons(html) {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((match) => match[0])
    .filter((button) => /移动到…|复制到…/.test(button))
}

test('compact selection exposes Move To and Copy To before opening any menu', () => {
  const buttons = destinationButtons(render())
  assert.equal(buttons.length, 2, 'both destination actions must be rendered in the compact selection panel')
  assert.ok(buttons.every((button) => !/\bdisabled=""/.test(button)), 'complete eligible selection can choose a target')
})

test('destination actions retain unresolved selection intent instead of submitting its loaded subset', () => {
  const html = render({ selectedIDs: [2, 9001] })
  const buttons = destinationButtons(html)
  assert.equal(buttons.length, 2)
  assert.ok(buttons.every((button) => /\bdisabled=""/.test(button)), 'unavailable selected metadata must disable both destination actions')
  assert.ok(html.includes('部分所选项目暂不可用'), 'the blocked operation must have a readable explanation')
})

test('destination actions consume the adapter eligibility for their own operation', () => {
  const reason = '每次最多处理 200 个项目，请缩小选择范围。'
  const html = render({ getSelectionActionDisabledReason: (action) => action === 'move-to' ? reason : null })
  const buttons = destinationButtons(html)
  assert.equal(buttons.length, 2)
  assert.match(buttons.find((button) => /移动到…/.test(button)), /\bdisabled=""/)
  assert.doesNotMatch(buttons.find((button) => /复制到…/.test(button)), /\bdisabled=""/)
  assert.ok(html.includes(reason), 'the adapter limit must remain readable next to the selected scope')
})
