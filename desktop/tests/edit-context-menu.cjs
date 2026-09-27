const test = require('node:test')
const assert = require('node:assert/strict')

const { editContextMenuTemplate } = require('../dist/main/edit_context_menu.cjs')

test('editable context menu follows Chromium edit flags', () => {
  const menu = editContextMenuTemplate({
    canUndo: true,
    canRedo: false,
    canCut: true,
    canCopy: true,
    canPaste: false,
    canDelete: true,
    canSelectAll: true,
  })
  const byRole = Object.fromEntries(menu.filter((item) => item.role).map((item) => [item.role, item]))
  assert.equal(byRole.undo.enabled, true)
  assert.equal(byRole.redo.enabled, false)
  assert.equal(byRole.cut.enabled, true)
  assert.equal(byRole.copy.enabled, true)
  assert.equal(byRole.paste.enabled, false)
  assert.equal(byRole.delete.enabled, true)
  assert.equal(byRole.selectAll.enabled, true)
  assert.deepEqual(menu.filter((item) => item.type === 'separator').length, 2)
})

test('editable context menu uses localized desktop labels', () => {
  const menu = editContextMenuTemplate({})
  assert.deepEqual(
    menu.filter((item) => item.label).map((item) => item.label),
    ['撤销', '重做', '剪切', '复制', '粘贴', '删除', '全选'],
  )
})
