'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const compiled = buildSync({
  entryPoints: [path.join(root, 'ui/shared/src/transfers.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
}).outputFiles[0].text
const loaded = { exports: {} }
new Function('exports', 'module', 'require', compiled)(loaded.exports, loaded, require)
const reveal = loaded.exports.xDriveTransferRevealDestination

test('transfer history prefers cloud for uploads and local for downloads', () => {
  const both = { cloud_parent_id: 19, cloud_node_id: 20, local_revealable: true }
  assert.equal(reveal({ ...both, direction: 'upload' }, { cloud: true, local: true }), 'cloud')
  assert.equal(reveal({ ...both, direction: 'download' }, { cloud: true, local: true }), 'local')
  assert.equal(reveal({ ...both, direction: 'upload' }, { cloud: false, local: true }), 'local')
  assert.equal(reveal({ ...both, direction: 'download' }, { cloud: true, local: false }), 'cloud')
  assert.equal(reveal({ ...both, direction: 'download' }, { cloud: false, local: false }), null)
})

test('transfer history never guesses a path from a filename or invalid cloud ID', () => {
  for (const cloud_node_id of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const task = { direction: 'upload', file_name: 'xDriveSetup.exe', path: 'C:/Downloads/xDriveSetup.exe', cloud_node_id }
    assert.equal(reveal(task, { cloud: true, local: true }), null)
  }
  assert.equal(reveal({ direction: 'download', local_revealable: false }, { cloud: false, local: true }), null)
  assert.equal(reveal({ direction: 'upload', cloud_parent_id: 50 }, { cloud: true, local: false }), 'cloud')
  assert.equal(reveal({ direction: 'download', local_revealable: true }, { cloud: false, local: true }), 'local')
})

test('compact transfer rows show absolute timestamps and keyboard-accessible file navigation', () => {
  const center = read('ui/shared/src/mui/TransferCenter.tsx')
  const popover = read('ui/shared/src/mui/TransferPopover.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  assert.ok(center.includes("'上传时间'"))
  assert.ok(center.includes("'下载时间'"))
  assert.ok(center.includes('transferTime(item.started_at)'))
  assert.ok(center.includes('transferTime(item.completed_at)'))
  assert.ok(center.includes('<ButtonBase'))
  assert.ok(center.includes('aria-label={`定位文件：${name}`}'))
  assert.ok(center.includes('canOpenTask?.(item) !== false'))
  assert.ok(popover.includes('onOpenTask={openTask}'))
  assert.ok(popover.includes('canOpenTask={(task) => revealDestination(task) !== null}'))
  assert.ok(popover.includes("if (destination === 'local') onShowInLocal?.(task)"))
  assert.ok(desktop.includes('openTransferLocal(task.id)'))
  assert.ok(desktop.includes('const locatorID = fileID ?? parentID'), 'cloud reveal must follow the file after a move')
  assert.ok(desktop.includes('getNodeLocation(locatorID)'))
  assert.ok(desktop.includes('无法定位云端文件：文件已移动、删除或所在目录不可用。'))
})
