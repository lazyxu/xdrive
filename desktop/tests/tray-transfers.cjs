const test = require('node:test')
const assert = require('node:assert/strict')

const { trayTransferPresentation, trayTransferRateKey } = require('../dist/main/tray_transfers.cjs')

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
    updated_at: new Date().toISOString(),
    speed_updated_at: new Date().toISOString(),
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
  assert.equal(view.label, '传输 · 2 进行中 · 2.5 MiB/s')
  assert.equal(view.items.length, 2)
  assert.equal(view.items[0].label, '下载 · video.mp4 · 50.0% · 2 MiB/s')
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
  assert.equal(view.label, '传输 · 1 进行中 · 1 MiB/s')
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

test('tray expires stale instantaneous speed even when progress updates do not refresh wire samples', () => {
  const now = Date.parse('2026-10-10T07:00:08.000Z')
  const stale = {
    ...transfer('stalled.bin', 'running', 123, 999, 1.3 * 1024 * 1024),
    updated_at: new Date(now).toISOString(),
    speed_updated_at: new Date(now - 8_000).toISOString(),
  }
  const view = trayTransferPresentation({ revision: 2, transfers: [stale] }, 3, now)
  assert.equal(view.label, '传输 · 1 进行中')
  assert.equal(view.items[0].label, '下载 · stalled.bin · 12.3%')
})

test('tray displays stable sampled speed while retaining current byte progress', () => {
  const now = Date.parse('2026-10-10T07:00:08.000Z')
  const item = {
    ...transfer('active.bin', 'running', 80, 100, 16 * 1024 * 1024),
    updated_at: new Date(now).toISOString(),
    speed_updated_at: new Date(now).toISOString(),
  }
  const samples = new Map([[trayTransferRateKey(item), {
    instant_bytes_per_second: 1024 * 1024,
    speed_updated_at: new Date(now - 1500).toISOString(),
    updated_at: new Date(now - 1500).toISOString(),
  }]])
  const view = trayTransferPresentation({ revision: 4, transfers: [item] }, 3, now, samples)
  assert.equal(view.label, '传输 · 1 进行中 · 1 MiB/s')
  assert.match(view.items[0].label, /80\.0% · 1 MiB\/s/)
  assert.equal(trayTransferPresentation({ revision: 4, transfers: [item] }, 3, now + 2000, samples).label, '传输 · 1 进行中')
})

test('tray never borrows a stale rate across a new transfer attempt or phase change', () => {
  const now = Date.parse('2026-10-10T07:00:08.000Z')
  const old = { ...transfer('a', 'running', 20, 100, 1024 * 1024), started_at: new Date(now - 8_000).toISOString() }
  const next = { ...old, started_at: new Date(now - 1_000).toISOString(), speed_updated_at: new Date(now).toISOString() }
  const samples = new Map([[trayTransferRateKey(old), {
    instant_bytes_per_second: 1024 * 1024,
    speed_updated_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  }]])
  assert.equal(trayTransferPresentation({ revision: 5, transfers: [next] }, 3, now, samples).label, '传输 · 1 进行中')
  assert.equal(trayTransferPresentation({ revision: 5, transfers: [{ ...old, phase: 'finalizing' }] }, 3, now, samples).label, '传输 · 1 进行中')
})
