const test = require('node:test')
const assert = require('node:assert/strict')

const { taskbarOverlayKind } = require('../dist/main/taskbar_attention.cjs')

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
