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
