'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const read = p => fs.readFileSync(path.join(repo, p), 'utf8')
const file = 'desktop/src/renderer/DesktopVirtualDriveSettings.tsx'
const parent = read('desktop/src/renderer/DesktopSettingsContent.tsx')
const source = read(file)
const compiled = ts.transpileModule(source, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])

const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
const ui = { jsx, jsxs: jsx, Fragment: 'Fragment' }
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(mod, mod.exports, name => {
  if (name === 'react/jsx-runtime') return ui
  if (name === '@mui/material') return new Proxy({}, { get: (_obj, key) => String(key) })
  if (name === '@xdrive/ui/mui') return { XDriveActionButton: 'XDriveActionButton' }
  if (name === '@xdrive/shared') return { formatBytes: bytes => String(bytes) + ' B' }
  throw Error('unexpected native dependency in desktop UI: ' + name)
})
const VirtualDrive = mod.exports.DesktopVirtualDriveSettings
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !value.type) return []
  return [value, ...nodes(value.props.children)]
}
function find(tree, type, predicate = () => true) {
  const match = nodes(tree).filter(x => x.type === type && predicate(x))
  assert.equal(match.length, 1, 'one expected ' + type)
  return match[0]
}
function words(tree) {
  return nodes(tree).flatMap(x =>
    typeof x.props.children === 'string' ? [x.props.children] : []).join(' ')
}
function setup(platform) {
  const events = []
  const props = {
    settings: { cache_limit_bytes: 2048 },
    mountPath: '/safe/current-mount', cacheLimit: '2',
    platform, storagePoliciesSupported: platform === 'win32',
    busy: '',
    onMountPathChange: v => events.push(['mount',v]),
    onCacheLimitChange: v => events.push(['cache',v]),
    onChooseMountPath: () => events.push(['browse']),
    onSaveSettings: e => events.push(['save',e]),
    onOpenStorage: () => events.push(['storage']),
  }
  return { tree: VirtualDrive(props), events, props }
}
test('the general Desktop settings own no duplicate mount settings or native mount executor', () => {
  assert.match(parent, /<DesktopVirtualDriveSettings\b/)
  assert.match(parent, /settings=\{settings\}/)
  assert.match(parent, /onSaveSettings=\{onSaveSettings\}/)
  assert.doesNotMatch(parent, /component="form"/)
  assert.doesNotMatch(parent, /value=\{mountPath\}|value=\{cacheLimit\}/)
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|backup\.cgi|fetch\s*\(/)
  assert.match(source, /不是「设备备份」中的普通本地来源目录/)
})
test('Windows CfAPI mount and persistent cache stay functional', () => {
  const { tree, events } = setup('win32')
  const e = { preventDefault() {} }
  find(tree,'Box', x=>x.props.component==='form').props.onSubmit(e)
  find(tree,'TextField',x=>x.props.value==='/safe/current-mount')
    .props.onChange({target:{value:'D:/xDrive'}})
  find(tree,'TextField',x=>x.props.value==='2')
    .props.onChange({target:{value:'5.5'}})
  const actions = nodes(tree).filter(x=>x.type==='XDriveActionButton')
  const byText = s => actions.find(x=>x.props.children===s)
  assert.ok(byText('浏览') && byText('管理本地存储'))
  assert.equal(find(tree,'TextField',x=>x.props.value==='2').props.disabled,false)
  byText('浏览').props.onClick()
  byText('管理本地存储').props.onClick()
  assert.deepEqual(events,[['save',e],['mount','D:/xDrive'],['cache','5.5'],['browse'],['storage']])
  assert.match(words(tree), /文件夹存储策略/)
})
test('Linux FUSE preserves mount path but cannot claim Windows-only cache and folder policy', () => {
  const { tree } = setup('linux')
  assert.equal(find(tree,'TextField',x=>x.props.value==='2').props.disabled,true)
  assert.match(words(tree), /Linux FUSE 存储模式/)
  assert.match(words(tree), /查看本地存储/)
  assert.doesNotMatch(words(tree), /管理本地存储/)
})
test('unverified platform does not pretend to have CfAPI or FUSE policies', () => {
  const { tree } = setup('darwin')
  assert.equal(find(tree,'TextField',x=>x.props.value==='2').props.disabled,true)
  assert.match(words(tree), /当前平台没有已验证的 CfAPI\/FUSE/)
})
