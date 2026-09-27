const test = require('node:test')
const assert = require('node:assert/strict')

const { desktopTaskbarProgress } = require('../dist/main/taskbar_progress.cjs')

function transfer(id, done, total, state = 'running') {
  return {
    id,
    file_name: id,
    kind: 'download',
    direction: 'download',
    state,
    bytes_done: done,
    bytes_total: total,
    percent: total > 0 ? done * 100 / total : 0,
    instant_bytes_per_second: 0,
    average_bytes_per_second: 0,
    elapsed_ms: 1,
    retry_count: 0,
    retryable: true,
    started_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
}

test('Windows taskbar prioritizes update download percentage', () => {
  const progress = desktopTaskbarProgress({
    mode: 'download',
    status: 'downloading',
    current_version: '1.0.0',
    latest_version: '1.1.0',
    update_available: true,
    downloaded: false,
    install_supported: true,
    bytes_done: 47,
    bytes_total: 100,
  }, { revision: 1, transfers: [transfer('sync', 90, 100)] })
  assert.deepEqual(progress, { value: 0.47, mode: 'normal' })
})

test('Windows taskbar aggregates active sync transfer bytes', () => {
  const progress = desktopTaskbarProgress(null, {
    revision: 1,
    transfers: [
      transfer('a', 25, 100),
      transfer('b', 75, 100),
      transfer('done', 100, 100, 'completed'),
    ],
  })
  assert.deepEqual(progress, { value: 0.5, mode: 'normal' })
})

test('Windows taskbar uses indeterminate progress when total bytes are unknown', () => {
  assert.deepEqual(
    desktopTaskbarProgress(null, { revision: 1, transfers: [transfer('a', 5, 0)] }),
    { value: 2, mode: 'indeterminate' },
  )
})

test('Windows taskbar removes sync progress while paused', () => {
  assert.equal(
    desktopTaskbarProgress(null, { revision: 1, transfers: [] }, {
      revision: 1,
      configured: true,
      auth_status: '已登录',
      sync_status: '同步正常',
      paused: true,
      must_change_password: false,
      has_conflict: false,
      conflict_count: 0,
      version: '1.0.0',
    }),
    null,
  )
})
