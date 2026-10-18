'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const helper = read('ui/shared/src/mui/FileExplorerMenuReasons.ts')
const js = ts.transpileModule(helper, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const mod = { exports: {} }
new Function('exports', 'module', js)(mod.exports, mod)
const { xDriveFileExplorerMenuDisabledReason: reason,
  xDriveFileExplorerMenuReasonLabel: caption } = mod.exports
test('F03 disabled reason is only rendered when disabled, with explicit authoritative reason', () => {
  assert.equal(reason({ disabled: false, disabledReason: '拒绝访问' }), null)
  assert.equal(caption({ disabled: false, disabledReason: '拒绝访问' }), null)
  assert.equal(reason({ disabled: true, disabledReason: '超过 200 项操作上限' }), '超过 200 项操作上限')
  assert.equal(caption({ disabled: true, disabledReason: '超过 200 项操作上限' }), '不可用：超过 200 项操作上限')
  assert.equal(reason({ disabled: true, disabledReason: '   ' }), '此操作当前不可用')
  assert.equal(reason({ disabled: true }), '此操作当前不可用')
})
test('F03 shared details/right-click/touch item menu carries current selection error without permission guesses', () => {
  const s = read('ui/shared/src/mui/FileExplorer.tsx')
  for (const action of ['cut', 'copy', 'move-to', 'copy-to', 'download', 'delete', 'manage-tags']) {
    assert(s.includes("disabledReason: selectionActionDisabledReason('" + action + "', selection, contextSelectionCount) ?? undefined"), action)
  }
  assert(s.includes("disabledReason: renameSubmitting ?"))
  assert(s.includes('aria-label={menuItem.disabled ? menuItem.label'))
  assert(s.includes('secondary={xDriveFileExplorerMenuReasonLabel(menuItem) ?? undefined}'))
  assert(s.includes('slotProps={{ list: { disabledItemsFocusable: true } }}'))
  assert(s.includes("title={xDriveFileExplorerMenuDisabledReason(menuItem) ?? undefined}"))
  assert(s.includes("xDriveFileExplorerMenuReasonLabel(menuItem) ? ' · '"))
  assert(s.includes('menuItem.onSelect()'), 'disabled menu does not bypass original callbacks')
})
test('F03 Mobile Files iOS27 item/keyboard menu visibly explains disabled operations', () => {
  const mobile = read('web/src/MobileFiles.tsx')
  assert(mobile.includes("import { xDriveFileExplorerMenuDisabledReason, xDriveFileExplorerMenuReasonLabel }"))
  assert(mobile.includes('data-mobile-files-context-action={action.id}'))
  assert(mobile.includes('aria-label={reason ? action.label'))
  assert(mobile.includes('xDriveFileExplorerMenuReasonLabel(action)'))
  assert(mobile.includes("reason ? <Typography variant=\"caption\""))
  assert(mobile.includes('disabledItemsFocusable: true'))
  assert(mobile.includes("data-mobile-files-context-selection-action={option.action}"))
  assert(mobile.includes("props.getSelectionActionDisabledReason?.(option.action, [item], 1)"))
  assert(mobile.includes("title={reason || undefined}"))
  assert(mobile.includes('action.onSelect()'))
})
test('F03 shared default disabled state never invents a Server ACL verdict', () => {
  const items = read('ui/shared/src/mui/FileExplorerActions.tsx')
  assert(items.includes('quickAccessDisabled ?'))
  assert(items.includes('favoriteDisabled ?'))
  assert(items.includes('disabledReason: primaryDisabled ?'))
  assert(!/deleteReasonFromName|permissionFromFileExtension/.test(items))
})
test('F03 four clients share existing operation API without a new transport', () => {
  const web = read('web/src/WebFileExplorer.tsx')
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const mobile = read('web/src/MobileFiles.tsx')
  assert(web.includes('getSelectionActionDisabledReason={getSelectionActionDisabledReason}'))
  assert(desktop.includes('getSelectionActionDisabledReason={getSelectionActionDisabledReason}'))
  assert(mobile.includes('props.getItemMenuItems(item)'))
  assert.doesNotMatch(helper, /fetch\s*\(|api\/v1|localStorage|BroadcastChannel|skipWaiting/)
})

test('F03/U03 Mobile batch More provides real 200/500/1000 reasons, keyboard focus and one callback owner', () => {
  const source = read('web/src/MobileFiles.tsx')
  for (const key of ['cut', 'copy-to', 'download', 'manage-tags', 'copy-paths', 'properties']) {
    assert(source.includes(`data-mobile-files-selection-action="${key}"`), key)
  }
  assert(source.includes('selectionMoreReason'))
  assert(source.includes('selectionMoreReasons'))
  assert(source.includes('xDriveFileExplorerMenuReasonLabel({ disabled: true, disabledReason: reason })'))
  assert(source.includes("...MOBILE_FILES_MENU_TOUCH_SX, maxWidth: 'calc(100vw - 24px)'"))
  assert(source.includes("maxHeight: 'min(70dvh, 560px)', overflowY: 'auto'"))
  assert(source.includes("if (selectionMoreReasons.manageTags) return"))
  assert(source.includes("if (selectionMoreReasons.common) return"))
  assert(!/getSelectionActionDisabledReason\?\.\('manage-tags'.*\) \? 'permission/.test(source),
    'permission must not be guessed from names or client presentation')
})

test('F03/D01 Desktop native Open With and CfAPI commands explain only temporary busy state', () => {
  const s = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const start = s.indexOf('const getItemMenuItems = (item:')
  const end = s.indexOf('async function downloadSelected', start)
  assert.ok(start >= 0 && end > start)
  const menu = s.slice(start, end)
  assert.ok(menu.includes('const localActionDisabledReason = explorerActionBusy'))
  assert.ok(menu.includes('当前文件操作尚未完成，请稍后重试。'))
  for (const id of ['open-with', 'availability-keep', 'availability-release']) {
    const p = menu.indexOf(`id: '${id}'`)
    assert.ok(p >= 0, `missing Desktop-only action ${id}`)
    const item = menu.slice(p, p + 550)
    assert.match(item, /disabled: explorerActionBusy,\s*disabledReason: localActionDisabledReason,/, id)
  }
  assert.equal((menu.match(/disabledReason: localActionDisabledReason,/g) || []).length, 3,
    'only the three Desktop-specific busy-disabled actions gain the explicit reason')
  assert.equal(caption({ disabled: true, disabledReason: '当前文件操作尚未完成，请稍后重试。' }),
    '不可用：当前文件操作尚未完成，请稍后重试。')
  assert.equal(caption({ disabled: false, disabledReason: '当前文件操作尚未完成，请稍后重试。' }), null)
  assert.ok(menu.includes("node.type === 'file' && openWithSupported"),
    'unsupported old Agents and non-Windows platforms must not gain a fake Open With command')
  assert.ok(menu.includes('if (!fileAvailabilitySupported) return desktopItems'),
    'CfAPI commands still require a current device capability')
  assert.doesNotMatch(menu, /fetch\s*\(|api\/v1|canModify|guessPermission|role.*administrator/i,
    'busy presentation does not guess Server ACLs or add a transport')
})

test('F03 wide command overflow shows disabled reasons, permits keyboard inspection and preserves operations', () => {
  const s = read('ui/shared/src/mui/FileExplorer.tsx')
  const begin = s.indexOf('anchorEl={commandBarOverflowAnchor}')
  const end = s.indexOf('</Menu>', begin)
  assert.ok(begin > 0 && end > begin)
  const overflow = s.slice(begin, end)
  assert.ok(overflow.includes('slotProps={{ list: { disabledItemsFocusable: true } }}'))
  const expected = [
    ['undo', '!canUndo', '撤销', 'onUndo'],
    ['redo', '!canRedo', '重做', 'onRedo'],
    ['paste', '!canPaste', '粘贴', '() => onPaste()'],
    ['refresh', 'loading', '刷新', 'onRefresh'],
  ]
  for (const [kind, predicate, label, callback] of expected) {
    assert.ok(overflow.includes('disabled={' + predicate + '}'), kind + ': original predicate')
    assert.ok(overflow.includes('title={commandBarOverflowDisabledReasons.' + kind + ' ?? undefined}'), kind + ': visible hint')
    assert.ok(overflow.includes('aria-label={commandBarOverflowDisabledReasons.' + kind + ' ?'), kind + ': reader hint')
    assert.ok(overflow.includes('primary="' + label + '"'), kind + ': original label')
    assert.ok(overflow.includes('disabledReason: commandBarOverflowDisabledReasons.' + kind + ' ?? undefined'), kind + ': visible secondary text')
    assert.ok(overflow.includes('runCommandBarOverflowAction(' + callback + ')'), kind + ': original operation owner')
  }
  assert.ok(s.includes('当前没有可用的撤销操作'))
  assert.ok(s.includes('当前没有可用的重做操作'))
  assert.ok(s.includes('当前目录暂不能粘贴'))
  assert.ok(s.includes('列表正在读取，暂不能刷新'))
  assert.equal(caption({ disabled: false, disabledReason: '旧错误' }), null)
  assert.equal(caption({ disabled: true, disabledReason: '权限不足' }), '不可用：权限不足')
  assert.doesNotMatch(overflow, /fetch\s*\(|api\/v1|localStorage|guessPermission|isAdmin/)
})
