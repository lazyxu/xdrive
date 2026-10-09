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

function render(extra = {}, compact = false) {
  const theme = createTheme({ components: {
    MuiUseMediaQuery: { defaultProps: { ssrMatchMedia: () => ({ matches: compact }) } },
  } })
  return renderToStaticMarkup(React.createElement(ThemeProvider, { theme },
    React.createElement(shared.exports.XDriveFileExplorer, {
      items: [{ id: 2, name: '已加载.txt', kind: 'file', size: 1024 }],
      crumbs: [{ id: 1, name: '我的文件' }], viewMode: 'details', selectedIDs: [2],
      onCopyItems() {}, onCutItems() {}, onDeleteItems() {}, onDownloadItems() {},
      ...extra,
    })))
}

test('selection count retains selected identities whose metadata is temporarily unavailable', () => {
  const html = render({ selectedIDs: [2, 9001] }, true)
  assert.ok(html.includes('已选择 2 项'), 'a missing item must not silently reduce the displayed selection')
  assert.ok(html.includes('1 项暂不可用'), 'the unavailable subset must be explained before an action')
})

test('adapter action eligibility disables the visible primary action and exposes its reason', () => {
  const reason = '每次最多处理 200 个项目，请缩小选择范围。'
  const html = render({ getSelectionActionDisabledReason: (action) => action === 'delete' ? reason : undefined })
  const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0])
  const remove = buttons.find((button) => />删除<\/span>|>删除<\/button>/.test(button))
  assert.ok(remove, 'the primary Delete action must remain discoverable')
  assert.match(remove, /\bdisabled=""/, 'the shared command must honor adapter eligibility')
  assert.ok(html.includes(reason), 'the disabled reason must be available to read')
})

test('Files presents the caller action outcome once inside its own surface', () => {
  const html = render({ actionFeedback: React.createElement('div', { role: 'status' }, '下载结果：2 项成功，1 项失败') }, true)
  assert.equal((html.match(/下载结果：2 项成功，1 项失败/g) || []).length, 1)
  assert.ok(html.includes('data-xdrive-file-explorer-action-feedback-slot'))
})
