'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
const helper = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorerMenuReasons.ts'), 'utf8')
const js = ts.transpileModule(helper, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const mod = { exports: {} }
new Function('exports', 'module', js)(mod.exports, mod)
const { xDriveFileExplorerMenuDisabledReason: reason,
  xDriveFileExplorerMenuReasonLabel: caption } = mod.exports

test('F03 Mobile More exposes disabled state and live reason to touch, keyboard and screen readers', () => {
  const start = source.indexOf('const overflowAction = (label: string')
  const end = source.indexOf('// iOS 27 Files displays', start)
  assert.ok(start > 0 && end > start)
  const helperBody = source.slice(start, end)
  assert.ok(helperBody.includes('xDriveFileExplorerMenuDisabledReason({ disabled, disabledReason })'))
  assert.ok(helperBody.includes('xDriveFileExplorerMenuReasonLabel({ disabled, disabledReason })'))
  assert.ok(helperBody.includes('title={reason ?? undefined}'))
  assert.ok(helperBody.includes("aria-label={reason ? label + '：' + reason : undefined}"),
    'enabled menu rows rely on their original child name; only disabled actions add an explicit reason')
  assert.ok(helperBody.includes("onClick={() => { setMoreAnchor(null); action() }}"))
  assert.match(helperBody, /reason \? <Box[\s\S]*<\/Box> : label\}/,
    'enabled More actions must keep the original direct label child')
  const open = source.indexOf('<Menu data-mobile-files-more-menu')
  const close = source.indexOf('</Menu>', open)
  assert.ok(open > 0 && close > open)
  const menu = source.slice(open, close)
  assert.ok(menu.includes('list: { disabledItemsFocusable: true }'))
  assert.ok(menu.includes("...MOBILE_FILES_MENU_TOUCH_SX, maxHeight: 'min(70dvh, 520px)'"))
  const items = [
    ["'粘贴'", '!props.canPaste', '当前目录暂不能粘贴'],
    ["'撤销'", '!props.canUndo || !props.onUndo', '当前没有可用的撤销操作'],
    ["'重做'", '!props.canRedo || !props.onRedo', '当前没有可用的重做操作'],
    ["'后退（浏览历史）'", '!props.canHistoryBack || !props.onHistoryBack', '当前没有可用的浏览历史返回操作'],
    ["'前进（浏览历史）'", '!props.canHistoryForward || !props.onHistoryForward', '当前没有可用的浏览历史前进操作'],
  ]
  for (const [label, gate, message] of items) {
    const index = menu.indexOf("overflowAction(" + label)
    assert.ok(index >= 0, label + ': original command')
    const item = menu.slice(index, index + 260)
    assert.ok(item.includes(gate), label + ': original permission/history predicate')
    assert.ok(item.includes(message), label + ': current neutral reason')
  }
  assert.equal(reason({ disabled: false, disabledReason: '权限不足' }), null)
  assert.equal(caption({ disabled: true, disabledReason: '当前没有可用的撤销操作' }),
    '不可用：当前没有可用的撤销操作')
  assert.doesNotMatch(helperBody, /fetch\s*\(|api\/v1|localStorage|permissionFromFileName|isAdmin/)
})

test('F03 mobile More preserves existing P57 100k quiet virtual slots and shared REST', () => {
  assert.ok(source.includes('Unloaded sparse-range cells reserve geometry'))
  assert.ok(source.includes('data-mobile-files-placeholder aria-hidden'))
  assert.ok(source.includes('props.virtualCollection?.itemAt(index)'))
  assert.ok(source.includes('onClick={() => { setMoreAnchor(null); action() }}'))
})
