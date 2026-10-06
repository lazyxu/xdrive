const test = require('node:test')
const assert = require('node:assert/strict')

const { trayUpdatePresentation } = require('../dist/main/tray_update.cjs')

test('tray update presentation shows percentage, total size, and current speed', () => {
  const view = trayUpdatePresentation({
    mode: 'download',
    status: 'downloading',
    current_version: '1.2.3',
    latest_version: '1.2.4',
    update_available: true,
    downloaded: false,
    install_supported: true,
    bytes_done: 50 * 1024 * 1024,
    bytes_total: 200 * 1024 * 1024,
    bytes_per_second: 4 * 1024 * 1024,
  })
  assert.equal(view.headline, '正在下载 25.0%')
  assert.equal(view.detail, '已下载 50 MiB / 总大小 200 MiB · 当前速度 4 MiB/s')
  assert.equal(view.busy, true)
})

test('tray update presentation summarizes available and downloaded states', () => {
  assert.deepEqual(
    trayUpdatePresentation({
      mode: 'manual',
      status: 'available',
      current_version: '1.2.3',
      latest_version: '1.2.4',
      update_available: true,
      downloaded: false,
      install_supported: true,
    }),
    { headline: '发现新版本 v1.2.4', busy: false },
  )
  assert.deepEqual(
    trayUpdatePresentation({
      mode: 'manual',
      status: 'downloaded',
      current_version: '1.2.3',
      latest_version: '1.2.4',
      update_available: true,
      downloaded: true,
      install_supported: true,
    }),
    { headline: 'v1.2.4 已下载，等待安装', busy: false },
  )
})
