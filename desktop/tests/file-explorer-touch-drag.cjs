const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')

const root = path.join(__dirname, '../..')
const helperPath = path.join(root, 'ui/shared/src/file-explorer-drag.ts')
const source = fs.readFileSync(helperPath, 'utf8')
const js = ts.transpileModule(source, { fileName: helperPath, compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
}}).outputText
const mod = { exports: {} }
new Function('module', 'exports', js)(mod, mod.exports)
const {
  XDRIVE_FILE_EXPLORER_TOUCH_DRAG_START_DISTANCE: threshold,
  xDriveFileExplorerTouchDragActivated: activated,
  xDriveFileExplorerTouchDropAllowed: allowed,
} = mod.exports
const explorer = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')

test('touch drag does not activate on tap, jitter or invalid pointer coordinates', () => {
  assert.equal(threshold, 10)
  assert.equal(activated(20, 30, 20, 30), false)
  assert.equal(activated(20, 30, 28, 34), false)
  assert.equal(activated(20, 30, 26, 38), true)
  assert.equal(activated(20, 30, 20, 40), true)
  assert.equal(activated(20, 30, Number.NaN, 99), false)
})

test('drop target never accepts a dragged source node, even in a multi-selection', () => {
  assert.equal(allowed([{ id: 1 }, { id: 2 }], { id: 1 }), false)
  assert.equal(allowed([{ id: 1 }, { id: 2 }], { id: 2 }), false)
  assert.equal(allowed([{ id: 1 }, { id: 2 }], { id: 3 }), true)
  assert.equal(allowed([{ id: '1' }], { id: 1 }), true, 'typed IDs must remain distinct')
})

test('touch drag uses a dedicated no-pan gesture handle and keeps normal rows scrollable', () => {
  assert.match(explorer, /data-xdrive-file-explorer-touch-drag-handle/)
  assert.match(explorer, /touchAction: 'none'/)
  assert.match(explorer, /compactTouch && touchSelectionMode/)
  assert.match(explorer, /onPointerCancel=\{\(event\) => finishTouchDrag\(event, true\)\}/)
  assert.match(explorer, /setPointerCapture\(event\.pointerId\)/)
  assert.match(explorer, /data-xdrive-file-explorer-drop-folder-index/)
  assert.match(explorer, /data-xdrive-file-explorer-drop-crumb-index/)
  assert.match(explorer, /xDriveFileExplorerTouchDragActivated\(/)
  assert.match(explorer, /xDriveFileExplorerTouchDropAllowed\(/)
  assert.match(explorer, /selectionActionDisabledReason\(/)
  assert.match(explorer, /fromSelection \? selectedCount : 1/)
  assert.match(explorer, /touchDragSession\.captureHost\.releasePointerCapture/)
  assert.match(explorer, /onDropItemsToFolder\?\.\(session\.items, target\.item, 'move'\)/)
  assert.match(explorer, /onDropItemsToCrumb\?\.\(session\.items, target\.crumb, 'move'\)/)
  assert.match(explorer, /onClick=\{\(event\) => activateItem\(event, item, index, renaming\)\}/)
  assert.match(explorer, /取消拖动/)
  assert.match(explorer, /onMoveItemsTo/)
})
