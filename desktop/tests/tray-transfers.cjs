const test = require('node:test')
const assert = require('node:assert/strict')

const { trayTransferPresentation } = require('../dist/main/tray_transfers.cjs')

function transfer(id, state, done, total, speed, direction = 'download') {
  return {
    id,
    file_name: id,
    kind: direction === 'upload' ? 'upload' : 'download',
    direction,
    state,
    bytes_done: done,
    bytes_total: total,
    percent: total > 0 ? done * 100 / total : 0,
    instant_bytes_per_second: speed,
    average_bytes_per_second: speed,
    elapsed_ms: 1,
    retry_count: 0,
    retryable: true,
    started_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
}

test('tray transfer summary shows active count and aggregate speed', () => {
  const view = trayTransferPresentation({
    revision: 1,
    transfers: [
      transfer('video.mp4', 'running', 50, 100, 2 * 1024 * 1024),
      transfer('photo.jpg', 'running', 25, 100, 512 * 1024, 'upload'),
    ],
  })
  assert.equal(view.label, '传输 · 2 进行中 · 2.50 MiB/s')
  assert.equal(view.items.length, 2)
  assert.equal(view.items[0].label, '下载 · video.mp4 · 50.0% · 2.00 MiB/s')
  assert.equal(view.items[1].label, '上传 · photo.jpg · 25.0% · 512 KiB/s')
  assert.equal(view.failed, 0)
})

test('tray transfer summary limits detailed rows and reports failures', () => {
  const view = trayTransferPresentation({
    revision: 1,
    transfers: [
      transfer('a', 'running', 1, 2, 1),
      transfer('b', 'retrying', 0, 0, 0),
      transfer('c', 'running', 1, 4, 0),
      transfer('d', 'running', 1, 4, 0),
      transfer('failed', 'failed', 0, 10, 0),
    ],
  }, 3)
  assert.equal(view.items.length, 3)
  assert.equal(view.extraActive, 1)
  assert.equal(view.failed, 1)
  assert.match(view.items[1].label, /正在重试/)
})

test('tray transfer summary reports idle and failed-only states', () => {
  assert.equal(trayTransferPresentation({ revision: 0, transfers: [] }).label, '传输 · 空闲')
  assert.equal(
    trayTransferPresentation({ revision: 1, transfers: [transfer('broken', 'failed', 0, 10, 0)] }).label,
    '传输 · 1 个失败',
  )
})


test('tray counts a hierarchical folder transfer once and summarizes parent progress', () => {
  const parent = {
    ...transfer('Photos', 'running', 50, 200, 1024 * 1024, 'upload'),
    scope: 'group',
    root_id: 'Photos',
    phase: 'transferring',
    scan_complete: true,
    items_total: 4,
    items_completed: 1,
    items_failed: 1,
    items_running: 1,
    items_queued: 1,
  }
  const childA = {
    ...transfer('a.jpg', 'completed', 100, 100, 0, 'upload'),
    parent_id: 'Photos',
    root_id: 'Photos',
    scope: 'item',
    relative_path: 'a.jpg',
  }
  const childB = {
    ...transfer('b.mov', 'running', 50, 100, 1024 * 1024, 'upload'),
    parent_id: 'Photos',
    root_id: 'Photos',
    scope: 'item',
    relative_path: 'sub/b.mov',
  }
  const view = trayTransferPresentation({
    revision: 2,
    transfers: [parent, childA, childB],
  })
  assert.equal(view.label, '传输 · 1 进行中 · 1.00 MiB/s')
  assert.equal(view.items.length, 1)
  assert.match(view.items[0].label, /上传 · Photos · 25.0% · 2\/4 文件/)
  assert.equal(view.extraActive, 0)
})

test('tray shows folder scanning as discovery rather than a fake final percentage', () => {
  const parent = {
    ...transfer('Camera Roll', 'running', 0, 0, 0, 'upload'),
    scope: 'group',
    root_id: 'Camera Roll',
    phase: 'scanning',
    scan_complete: false,
    items_total: 128,
    items_completed: 0,
    items_failed: 0,
    items_running: 0,
    items_queued: 128,
  }
  const view = trayTransferPresentation({ revision: 3, transfers: [parent] })
  assert.match(view.items[0].label, /扫描中 · 已发现 128 个文件/)
  assert.doesNotMatch(view.items[0].label, /%/)
})
