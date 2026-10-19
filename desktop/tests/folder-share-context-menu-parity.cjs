const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/FileExplorerActions.tsx')
const source = fs.readFileSync(filename, 'utf8')
const output = ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const mod = { exports: {} }
const jsx = (type, props) => ({ type, props })
function fakeRequire(name) {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (name === './FileExplorer') return { XDriveFileExplorerCommandButton: () => null }
  if (name.startsWith('@mui/icons-material/')) return () => null
  throw new Error('unexpected FileExplorerActions import: ' + name)
}
new Function('module', 'exports', 'require', output)(mod, mod.exports, fakeRequire)
const standard = mod.exports.xDriveFileExplorerStandardItemMenuItems
function options(kind, overrides = {}) {
  const called = []
  const entries = standard({
    kind,
    onOpen: () => called.push('open'),
    onShare: () => called.push('share'),
    onHistory: () => called.push('history'),
    onDelete: () => called.push('delete'),
    ...overrides,
  })
  return { entries, ids: entries.map(entry => entry.id), called }
}

test('folder right-click and long-press receive one working Share item', () => {
  const { entries, ids, called } = options('dir')
  assert.equal(ids.filter(id => id === 'share').length, 1)
  assert.ok(ids.indexOf('share') > ids.indexOf('open'))
  assert.ok(!ids.includes('history'), 'file history is not folder sharing')
  const share = entries.find(entry => entry.id === 'share')
  assert.equal(share.label, '分享')
  share.onSelect()
  assert.deepEqual(called, ['share'])
})

test('file share stays before file-only History and is not duplicated', () => {
  const { entries, ids, called } = options('file')
  assert.equal(ids.filter(id => id === 'share').length, 1)
  assert.ok(ids.indexOf('share') < ids.indexOf('history'))
  entries.find(entry => entry.id === 'share').onSelect()
  entries.find(entry => entry.id === 'history').onSelect()
  assert.deepEqual(called, ['share', 'history'])
})

test('a missing share callback does not create a fake action', () => {
  for (const kind of ['dir', 'file']) {
    assert.equal(options(kind, { onShare: undefined }).ids.includes('share'), false)
  }
})

test('Web/Desktop/Mobile use the shared menu and existing folder authorization', () => {
  const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')
  const web = read('web/src/WebFileExplorer.tsx')
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const mobile = read('web/src/MobileFiles.tsx')
  const server = read('internal/api/shares.go')
  assert.ok(web.includes('onShare: () => onShare(node),'))
  assert.ok(desktop.includes('onShare: () => onOpenShares(node),'))
  assert.ok(web.includes('getItemMenuItems={trashActive ? trash.getItemMenuItems : getItemMenuItems}'))
  assert.ok(desktop.includes('getItemMenuItems={trashActive ? trash.getItemMenuItems : getItemMenuItems}'))
  assert.ok(mobile.includes('props.getItemMenuItems(item).filter('))
  assert.ok(mobile.includes("action.id === 'share' ? '分享链接' : action.label"))
  assert.ok(server.includes('node.Type != meta.NodeTypeFile && node.Type != meta.NodeTypeDir'))
  assert.ok(server.includes('node.Type == meta.NodeTypeDir && node.ParentID == nil'))
})
