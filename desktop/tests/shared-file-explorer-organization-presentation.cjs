const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { createTheme, ThemeProvider } = require('@mui/material/styles')
const { buildSync } = require('esbuild')

const sourceRoot = process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..')
const output = buildSync({
  entryPoints: [path.join(sourceRoot, 'ui/shared/src/mui/FileExplorerNavigationPane.tsx')],
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
}).outputFiles[0].text
const shared = { exports: {} }
const requireUI = (name) => name.startsWith('@mui/icons-material/') ? require(name).default : require(name)
new Function('module', 'exports', 'require', output)(shared, shared.exports, requireUI)

const saved = { id: 17, name: '项目图片', query: 'photo', filters: { kind: 'image', tagID: 7 }, position: 0, created_at: '', updated_at: '' }
const tag = { id: 7, name: '项目', item_count: 0, created_at: '', updated_at: '' }

function render(props = {}) {
  const theme = createTheme({ components: {
    MuiUseMediaQuery: { defaultProps: { ssrMatchMedia: () => ({ matches: true }) } },
  } })
  return renderToStaticMarkup(React.createElement(ThemeProvider, { theme },
    React.createElement(shared.exports.XDriveFileExplorerNavigationPane, {
      currentCrumbs: [{ id: 1, name: '我的文件' }],
      loadDirectoryPage: async () => ({ items: [], hasMore: false, nextCursor: '' }),
      onNavigate() {}, savedSearchesEnabled: true, tagsEnabled: true,
      onManageTags() {}, onSaveCurrentSearch() {}, onRetryOrganization() {},
      ...props,
    })))
}

function section(html, label) {
  return html.match(new RegExp(`<nav\\b[^>]*aria-label="${label}"[\\s\\S]*?<\\/nav>`))?.[0] || ''
}

test('pending organization reads are not presented as confirmed empty lists', () => {
  const html = render({ organizationLoading: true })
  for (const label of ['智能文件夹', '标签']) {
    const body = section(html, label)
    assert.ok(body.includes(`正在加载${label}`), label + ' has a readable pending state')
    assert.ok(!body.includes('暂无'), label + ' must not claim emptiness before the read completes')
  }
})

test('organization read errors retain known rows and expose a retry in each section', () => {
  const html = render({ organizationError: '读取失败：连接暂时不可用', savedSearches: [saved], tags: [tag] })
  for (const label of ['智能文件夹', '标签']) {
    const body = section(html, label)
    assert.ok(body.includes('读取失败：连接暂时不可用'))
    assert.ok(body.includes(`aria-label="重新加载${label}"`))
    assert.ok(body.includes('上次成功读取'))
  }
  assert.ok(section(html, '智能文件夹').includes(saved.name))
  assert.ok(section(html, '标签').includes(tag.name))
})

test('empty Tags exposes management without requiring a selected file', () => {
  const body = section(render(), '标签')
  const button = body.match(/<button\b[^>]*aria-label="管理标签"[^>]*>/)?.[0]
  assert.ok(button, 'management is a visible named action in the Tags section')
  assert.doesNotMatch(button, /\bdisabled=""/)
  assert.ok(body.includes('暂无标签'))
})

test('saving the current search has an explained unavailable state and a reachable ready state', () => {
  const unavailable = section(render(), '智能文件夹')
  const ready = section(render({ canSaveCurrentSearch: true }), '智能文件夹')
  const button = (body) => body.match(/<button\b[^>]*aria-label="保存当前搜索"[^>]*>/)?.[0]
  assert.ok(button(unavailable))
  assert.match(button(unavailable), /\bdisabled=""/)
  assert.ok(unavailable.includes('先搜索或设置筛选'))
  assert.doesNotMatch(button(ready), /\bdisabled=""/)
})

test('saved rules show their actual query and predicates with the supplied current match', () => {
  const body = section(render({ savedSearches: [saved], tags: [tag], activeSavedSearchID: 17 }), '智能文件夹')
  assert.ok(body.includes('photo'), 'query is readable without opening the options menu')
  assert.ok(body.includes('类型：图片'))
  assert.ok(body.includes('标签：项目'))
  assert.ok(body.includes('当前搜索匹配此规则'))
  assert.ok(body.includes('aria-current="page"'))
})

test('tag navigation distinguishes its global count from an active combined search predicate', () => {
  const body = section(render({ tags: [tag], activeTagID: 7 }), '标签')
  assert.ok(body.includes('共 0 项'), 'a confirmed zero count remains visible')
  assert.ok(body.includes('已用于当前筛选'))
  assert.ok(body.includes('aria-current="page"'))
})

test('equivalent named rules all disclose matching while retaining a single current navigation item', () => {
  const body = section(render({
    savedSearches: [saved, { ...saved, id: 18, name: '另一份图片规则' }],
    activeSavedSearchID: 17, matchingSavedSearchIDs: [17, 18],
  }), '智能文件夹')
  assert.equal((body.match(/当前搜索匹配此规则/g) || []).length, 2)
  assert.equal((body.match(/aria-current="page"/g) || []).length, 1)
})

test('current search notices and empty favorite guidance explain the existing entry points', () => {
  const notice = '可用性仅在此设备生效，不包含在保存规则中。'
  const html = render({ currentSearchNotice: notice, favoritesEnabled: true, quickAccessEnabled: true })
  assert.ok(section(html, '智能文件夹').includes(notice))
  assert.ok(section(html, '收藏').includes('添加到收藏'))
  assert.ok(section(html, '快速访问').includes('固定到快速访问'))
})
