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
