'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' }
const mui = Object.fromEntries(
  ['Box', 'Chip', 'List', 'ListItemButton', 'ListItemIcon', 'ListItemText', 'Typography']
    .map(name => [name, name])
)
let narrow = false
mui.useMediaQuery = () => narrow
function loadProduction(relative, dependencies) {
  const file = path.join(root, relative)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  assert.deepEqual((compiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports, name => {
      assert.ok(Object.hasOwn(dependencies, name), 'unexpected production import: ' + name)
      return dependencies[name]
    },
  )
  return mod.exports
}
const nav = loadProduction('ui/shared/src/mui/SidebarNav.tsx', {
  'react/jsx-runtime': runtime,
  '@mui/material': mui,
  './WorkspaceNavigation': { xDriveCoreWorkspaceDestinations: () => [
    { key: 'files', label: '文件', icon: 'file' },
    { key: 'gallery', label: '图库', icon: 'gallery' },
  ] },
})
const { XDriveWorkspaceSidebar } = loadProduction('ui/shared/src/mui/WorkspaceSidebar.tsx', {
  'react/jsx-runtime': runtime,
  '@mui/material': mui,
  './SidebarNav': nav,
  './SidebarStorageSummary': { XDriveSidebarStorageSummary: 'StorageSummary' },
  './WorkspaceCompactNavigation': { XDriveWorkspaceCompactNavigation: 'CompactNavigation' },
  './WorkspaceNavigation': { xDriveCompactWorkspaceNavigation: () => ({ primary: [], moreSections: [] }) },
})
function expand(node) {
  if (node == null || node === false) return []
  if (Array.isArray(node)) return node.flatMap(expand)
  if (typeof node !== 'object' || !('type' in node)) return []
  if (typeof node.type === 'function') return expand(node.type(node.props))
  return [node, ...expand(node.props?.children)]
}
function render(disabled, responsive = true) {
  const events = []
  const tree = XDriveWorkspaceSidebar({
    selected: 'files', disabled, responsive,
    ariaLabel: 'xDrive', navAriaLabel: 'features',
    sections: [
      { key: 'overview', placement: 'before-core',
        items: [{ key: 'overview', label: '主页', icon: 'home' }] },
      { key: 'conflicts', placement: 'after-core',
        items: [{ key: 'conflicts', label: '冲突', icon: 'alert' }] },
      { key: 'admin', placement: 'after-core', label: '管理',
        items: [{ key: 'admin-users', label: '用户管理', icon: 'admin' }] },
      { key: 'settings', placement: 'bottom',
        items: [{ key: 'settings', label: '设置', icon: 'settings' }] },
    ],
    onSelect: key => events.push(key),
  })
  return { tree, events, all: expand(tree) }
}
for (const responsive of [false, true]) {
  test('wide sidebar disabled blocks every route, responsive=' + responsive, () => {
    narrow = false
    const view = render(true, responsive)
    const buttons = view.all.filter(node => node.type === 'ListItemButton')
    assert.equal(buttons.length, 6)
    for (const button of buttons) {
      assert.equal(button.props.disabled, true)
      button.props.onClick({ type: 'click' })
    }
    assert.deepEqual(view.events, [], 'no stale callback may reach either Host')
  })
  test('enabled wide sidebar retains route order, responsive=' + responsive, () => {
    narrow = false
    const view = render(false, responsive)
    const buttons = view.all.filter(node => node.type === 'ListItemButton')
    assert.equal(buttons.length, 6)
    for (const button of buttons) {
      assert.equal(button.props.disabled, false)
      button.props.onClick({ type: 'click' })
    }
    assert.deepEqual(view.events,
      ['overview','files','gallery','conflicts','admin-users','settings'])
  })
}
test('small viewport preserves existing compact disabled contract', () => {
  narrow = true
  assert.equal(render(true).tree.props.disabled, true)
  assert.equal(render(false).tree.props.disabled, false)
  assert.equal(render(true).tree.type, 'CompactNavigation')
  narrow = false
})
