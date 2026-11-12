const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  MountRunNotificationTracker, mountRunNotificationTarget,
  mountRunNotificationPresentation, mountRunShouldNotify,
} = require('../dist/main/mount_run_notification.cjs')
const { normalizeDesktopPreferences } = require('../dist/main/window_preferences.cjs')

const id1 = '10000000-0000-4000-8000-000000000001'
const id2 = '10000000-0000-4000-8000-000000000002'
const id3 = '10000000-0000-4000-8000-000000000003'
function run(id = id1, overrides = {}) {
  return {
    run_id: id, engine_kind: 'mount', trigger: 'remote',
    started_at: new Date(1_000).toISOString(),
    finished_at: new Date(20_000).toISOString(), status: 'completed',
    outcome: 'unknown', detail_complete: false, details_expired: false,
    stats: {
      items: 0, successful: 0, created: 0, updated: 0, deleted: 0,
      moved: 0, renamed: 0, uploaded: 0, downloaded: 0, skipped: 0,
      failed: 0, conflicted: 0, transferred_bytes: null,
    },
    ...overrides,
  }
}
function changed(id = id1, overrides = {}) {
  const value = run(id, overrides)
  return { ...value, stats: { ...value.stats,
    created: 3, renamed: 1, uploaded: 2, transferred_bytes: 8192,
    ...overrides.stats,
  }, outcome: 'changed' }
}

test('default setting migrates old Desktop preferences and validates all levels', () => {
  assert.equal(normalizeDesktopPreferences({ start_at_login: true }).sync_notification_level, 'changes-and-errors')
  assert.equal(normalizeDesktopPreferences({ sync_notification_level: 'all' }).sync_notification_level, 'all')
  assert.equal(normalizeDesktopPreferences({ sync_notification_level: 'errors-only' }).sync_notification_level, 'errors-only')
  assert.equal(normalizeDesktopPreferences({ sync_notification_level: 'untrusted' }).sync_notification_level, 'changes-and-errors')
})

test('no-change checks are silent by default; errors and confirmed changes surface', () => {
  assert.equal(mountRunShouldNotify(run(), 'changes-and-errors'), false)
  assert.equal(mountRunShouldNotify(run(), 'errors-only'), false)
  assert.equal(mountRunShouldNotify(run(), 'all'), true)
  assert.equal(mountRunShouldNotify(changed(), 'changes-and-errors'), true)
  assert.equal(mountRunShouldNotify(changed(), 'errors-only'), false)
  assert.equal(mountRunShouldNotify(run(id1, { status: 'failed' }), 'errors-only'), true)
  assert.equal(mountRunShouldNotify(run(id1, { status: 'interrupted' }), 'errors-only'), true)
  assert.equal(mountRunShouldNotify(run(id1, { status: 'partial' }), 'errors-only'), true)
  assert.equal(mountRunShouldNotify(run(id1, { status: 'cancelled' }), 'changes-and-errors'), false)
  assert.equal(mountRunShouldNotify(run(id1, { status: 'running' }), 'all'), false)
})

test('Mount summary does not invent per-file counts or network bytes', () => {
  const changedView = mountRunNotificationPresentation(changed())
  assert.equal(changedView.title, 'xDrive · 文件同步完成')
  assert.match(changedView.body, /新增 3/)
  assert.match(changedView.body, /重命名 1/)
  assert.match(changedView.body, /上传 2/)
  assert.match(changedView.body, /实际传输 8(?:\.0)? KiB/)
  const quiet = mountRunNotificationPresentation(run())
  assert.equal(quiet.title, 'xDrive · 同步检查结束')
  assert.match(quiet.body, /不能据此断言没有变化/)
  assert.doesNotMatch(quiet.body, /实际传输 0/)
  const failed = mountRunNotificationPresentation(run(id1, { status: 'failed' }))
  assert.equal(failed.title, 'xDrive · 同步需要处理')
})

test('typed notification targets reject arbitrary paths and missing Owners', () => {
  assert.deepEqual(
    mountRunNotificationTarget(id1, { server: 'https://nas.example', username: 'alice' }),
    { kind: 'mount-run', runID: id1, server: 'https://nas.example', username: 'alice' },
  )
  assert.equal(mountRunNotificationTarget('../../x', { server: 'https://nas', username: 'alice' }), null)
  assert.equal(mountRunNotificationTarget(id1, { server: '', username: 'alice' }), null)
})

test('first page seeds baseline; repeat polling and restarts do not replay terminal runs', () => {
  const t = new MountRunNotificationTracker()
  const at = 60_000
  assert.deepEqual(t.observe('ownerA', [run(id1, { status: 'running', finished_at: null })], at), [])
  const terminal = changed(id1, { finished_at: new Date(at + 3_000).toISOString() })
  assert.deepEqual(t.observe('ownerA', [terminal], at + 5_000).map(x => x.run_id), [id1])
  assert.deepEqual(t.observe('ownerA', [terminal], at + 8_000), [])
  // Restarting the poll loop with the same tracker is not a new lifecycle.
  assert.deepEqual(t.observe('ownerA', [terminal], at + 11_000), [])
  assert.deepEqual(t.observe('ownerB', [terminal], at + 12_000), [])
  // Even a terminal history from the previous account cannot appear in B.
  assert.deepEqual(t.observe('ownerB', [terminal], at + 15_000), [])
})

test('short runs between polls still notify; historical/stale run reports stay silent', () => {
  const t = new MountRunNotificationTracker()
  t.observe('ownerA', [], 100_000)
  const fresh = changed(id2, { finished_at: new Date(103_000).toISOString() })
  assert.deepEqual(t.observe('ownerA', [fresh], 105_000).map(x => x.run_id), [id2])
  assert.deepEqual(t.observe('ownerA', [fresh], 106_000), [])
  const stale = changed(id3, { finished_at: new Date(40_000).toISOString() })
  assert.deepEqual(t.observe('ownerA', [stale, fresh], 110_000), [])
  const future = changed(id3, { finished_at: new Date(900_000).toISOString() })
  assert.deepEqual(t.observe('ownerA', [future, fresh], 112_000), [])
  t.reset()
  assert.deepEqual(t.observe('ownerA', [fresh], 113_000), [])
})

test('auth health probes do not forge Mount completion or clear Mount failures', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.cts'), 'utf8')
  const agent = fs.readFileSync(path.join(__dirname, '..', '..', 'cmd', 'xdrive-agent', 'controller.go'), 'utf8')
  assert.doesNotMatch(main, /before\.sync_status === '正在同步' && after\.sync_status === '同步正常'/)
  const mark = agent.indexOf('Root() proves this session can authenticate')
  assert.ok(mark > 0, 'auth check must not be treated as a Mount completion')
  const block = agent.slice(mark, mark + 340)
  assert.match(block, /s.AuthStatus = "已登录"/)
  assert.doesNotMatch(block, /s.SyncStatus = "同步正常"/)
  assert.doesNotMatch(block, /s.LastError = ""/)
  assert.match(main, /mountRunNotificationTracker\.reset\(\)/)
})
