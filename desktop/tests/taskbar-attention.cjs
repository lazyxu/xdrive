const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { taskbarOverlayDataURL, taskbarOverlayKind } = require('../dist/main/taskbar_attention.cjs')

function status(overrides = {}) {
  return {
    revision: 1,
    configured: true,
    auth_status: '已登录',
    sync_status: '同步正常',
    paused: false,
    must_change_password: false,
    has_conflict: false,
    conflict_count: 0,
    version: '1.0.0',
    ...overrides,
  }
}

test('taskbar overlay only represents actionable problem states', () => {
  assert.equal(taskbarOverlayKind(false), 'offline')
  assert.equal(taskbarOverlayKind(true, status({ has_conflict: true, conflict_count: 1 })), 'conflict')
  assert.equal(taskbarOverlayKind(true, status({ last_error: 'network failed' })), 'offline')
  assert.equal(taskbarOverlayKind(true, status({ auth_status: '登录已过期' })), 'offline')
  assert.equal(taskbarOverlayKind(true, status({ paused: true })), null)
  assert.equal(taskbarOverlayKind(true, status({ sync_status: '正在同步' })), null)
  assert.equal(taskbarOverlayKind(true, status()), null)
})


test('taskbar overlays are status badges rather than a second xDrive logo', () => {
  for (const kind of ['conflict', 'offline']) {
    const url = taskbarOverlayDataURL(kind)
    assert.ok(url.startsWith('data:image/svg+xml;base64,'))
    const svg = Buffer.from(url.split(',')[1], 'base64').toString('utf8')
    assert.ok(svg.includes('<circle'), `${kind}: badge should contain a status circle`)
    assert.equal(svg.includes('#1787FA'), false, `${kind}: badge must not embed the blue xDrive application icon`)
    assert.equal(svg.includes('xDrive'), false, `${kind}: overlay must not contain the application logo`)
  }
})

test('taskbar overlay rendering is best effort and cannot abort Desktop startup', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.cts'), 'utf8')
  assert.equal(source.includes('xDrive taskbar overlay badge is invalid'), false)
  assert.ok(source.includes('nativeImage.createFromPath(trayStatusAssetPath(kind))'))
  assert.ok(source.includes("taskbar_overlay_unavailable"))
})
