const test = require('node:test')
const assert = require('node:assert/strict')

const {
  sourceRunIsTerminal,
  sourceRunNotificationPresentation,
} = require('../dist/main/source_run_notification.cjs')

function run(overrides = {}) {
  return {
    mode: 'sync',
    status: 'completed',
    scanned_file_items: 700,
    scanned_directory_items: 12,
    scanned_bytes: 1536 * 1024 * 1024,
    synced_file_items: 584,
    synced_directory_items: 16,
    synced_bytes: 1152 * 1024 * 1024,
    created_items: 585,
    updated_items: 15,
    skipped_items: 112,
    transferred_bytes: 1100 * 1024 * 1024,
    failed_items: 0,
    ...overrides,
  }
}

test('native source sync toast reports files, folders, size and outcomes', () => {
  const view = sourceRunNotificationPresentation({ name: '一刻相册' }, run())
  assert.equal(view.title, 'xDrive 一刻相册')
  assert.match(view.body, /^同步完成\n/)
  assert.match(view.body, /已同步 584 个文件 · 16 个文件夹 · 1\.1 GiB/)
  assert.match(view.body, /新增 585/)
  assert.match(view.body, /更新\/移动 15/)
  assert.match(view.body, /实际传输 1\.1 GiB/)
  assert.match(view.body, /跳过 112/)
})

test('native source sync toast distinguishes partial failures', () => {
  const view = sourceRunNotificationPresentation({ name: '群晖 Photos' }, run({
    status: 'partial',
    failed_items: 99,
  }))
  assert.match(view.body, /^同步部分完成\n/)
  assert.match(view.body, /失败 99/)
})

test('native source sync toast explains no-change runs with scan totals', () => {
  const view = sourceRunNotificationPresentation({ name: '群晖 File Station' }, run({
    synced_file_items: 0,
    synced_directory_items: 0,
    synced_bytes: 0,
    created_items: 0,
    updated_items: 0,
    transferred_bytes: 0,
  }))
  assert.match(view.body, /没有需要同步的变更/)
  assert.match(view.body, /扫描 700 个文件 · 12 个文件夹 · 1\.5 GiB/)
})

test('native scan-only toast uses scan file and folder counts', () => {
  const view = sourceRunNotificationPresentation({ name: '只扫描' }, run({
    mode: 'scan',
    status: 'completed',
    skipped_items: 0,
    transferred_bytes: 0,
  }))
  assert.match(view.body, /^扫描完成\n/)
  assert.match(view.body, /扫描 700 个文件 · 12 个文件夹 · 1\.5 GiB/)
  assert.doesNotMatch(view.body, /已同步/)
})

test('source run terminal detection excludes running state', () => {
  assert.equal(sourceRunIsTerminal('running'), false)
  for (const status of ['completed', 'partial', 'failed', 'cancelled']) {
    assert.equal(sourceRunIsTerminal(status), true)
  }
})
