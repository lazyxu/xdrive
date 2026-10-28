'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const framePath = 'desktop/src/renderer/DesktopHostFrame.tsx'
const hostPath = 'desktop/src/renderer/desktopWindowHostAdapter.ts'
const source = read(framePath), app = read('desktop/src/renderer/App.tsx')
function compile(file) {
  const compiled = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  })
  assert.deepEqual((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
    .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
  return compiled.outputText
}
const calls = []
const fakeWindow = { xdriveDesktop: {
  minimizeWindow: () => calls.push('minimize'),
  toggleMaximizeWindow: () => calls.push('toggle'),
  closeWindow: () => calls.push('close'),
} }
const host = { exports: {} }
new Function('module', 'exports', 'require', 'window', compile(hostPath))(
  host, host.exports, () => { throw Error('Unexpected native dependency') }, fakeWindow)
const windowHost = host.exports.desktopWindowHostAdapter
const jsx = (type, props, key) => ({ type, props: props || {}, key })
const frame = { exports: {} }
new Function('module', 'exports', 'require', compile(framePath))(frame, frame.exports, name => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (name === '@mui/material') return { IconButton: 'IconButton' }
  if (name === '@xdrive/ui/mui') return { XDriveBrandLockup: 'XDriveBrandLockup' }
  if (name.endsWith('.svg')) return { __esModule: true, default: 'xdrive-icon' }
  if (name.startsWith('@mui/icons-material/'))
    return { __esModule: true, default: name.split('/').at(-1) + 'Icon' }
  throw Error('Unexpected UI import: ' + name)
})
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return tree && typeof tree === 'object' && tree.props
    ? [tree, ...nodes(tree.props.children)] : []
}
const render = maximized => frame.exports.DesktopHostFrame({
  maximized, windowHost, children: 'canonical XDriveApp', titlebarActions: 'desktop actions',
})

test('native operations remain in a narrow Host adapter, outside React JSX', () => {
  assert.deepEqual(Object.keys(windowHost).sort(), ['close', 'minimize', 'toggleMaximize'])
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|backup\.cgi/)
  assert.match(app, /<DesktopHostFrame maximized=\{windowMaximized\} titlebarActions=\{titlebarActions\} windowHost=\{desktopWindowHostAdapter\}>/)
  assert.doesNotMatch(app, /function DesktopFrame\(|window\.xdriveDesktop\.minimizeWindow\(\)/)
  assert.match(app, /<XDriveApp\b/, 'Desktop and DSM still mount the one shared app')
})

test('the unchanged three titlebar controls dispatch genuine actions once', () => {
  calls.length = 0
  const buttons = nodes(render(false)).filter(x => x.type === 'IconButton')
  assert.deepEqual(buttons.map(x => x.props['aria-label']), ['最小化', '最大化', '关闭'])
  buttons.forEach(x => x.props.onClick())
  assert.deepEqual(calls, ['minimize', 'toggle', 'close'])
})

test('window maximize changes only the icon and accessible label', () => {
  const normal = nodes(render(false)).find(x => x.type === 'IconButton' && x.props['aria-label'] === '最大化')
  const restored = nodes(render(true)).find(x => x.type === 'IconButton' && x.props['aria-label'] === '还原')
  assert.equal(normal.props.children.type, 'CropSquareRoundedIcon')
  assert.equal(restored.props.children.type, 'FilterNoneRoundedIcon')
})

test('titlebar actions, brand and full-height app surface remain in the frame', () => {
  const tree = nodes(render(false))
  assert.ok(tree.some(x => x.props.className === 'desktop-titlebar-actions' && x.props.children === 'desktop actions'))
  assert.ok(tree.some(x => x.props.className === 'desktop-body' && x.props.children === 'canonical XDriveApp'))
  assert.equal(tree.filter(x => x.type === 'XDriveBrandLockup').length, 1)
})
