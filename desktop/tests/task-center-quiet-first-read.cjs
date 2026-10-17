const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const controller = read('ui','shared','src','mui','TaskCenterController.ts')
const page = read('ui','shared','src','mui','TaskCenterPage.tsx')
const ui = read('ui','shared','src','mui','BackgroundTaskCenter.tsx')

test('background first read is quiet until real owner data or a slow request', () => {
  for (const s of ['hasLoaded: false','failed: false','hasLoaded: true',
    'mineHasLoaded: ownerCurrent && scopedMine.hasLoaded',
    'globalHasLoaded: ownerCurrent && scopedGlobal.hasLoaded',
    'setMineLoadEpoch((epoch) => epoch + 1)',
    'setGlobalLoadEpoch((epoch) => epoch + 1)']) {
    assert.ok(controller.includes(s), s)
  }
  assert.ok(ui.includes('useXDriveDeferredLoading(loading && !loaded, loadEpoch)'))
  assert.ok(ui.includes('data-xdrive-background-tasks-first-read'))
  assert.ok(ui.includes('data-xdrive-global-background-tasks-first-read'))
  assert.ok(ui.includes('minHeight: 120'))
  assert.equal(ui.includes('if (loading && tasks.length === 0)'), false)
})

test('only an accepted current-account page claims an empty task list', () => {
  for (const s of ['backgroundTasksLoaded: background.mineHasLoaded',
    'globalBackgroundTasksLoaded: background.globalHasLoaded',
    'backgroundTasksReadFailed: background.mineReadFailed',
    'globalBackgroundTasksReadFailed: background.globalReadFailed',
    'ownerCurrent && scopedMine.hasLoaded','ownerCurrent && scopedGlobal.hasLoaded']) {
    assert.ok(controller.includes(s), s)
  }
  assert.ok(ui.includes('if (!loaded && tasks.length === 0)'))
  assert.ok(ui.includes('failed && !loading ? ('))
  assert.ok(ui.includes('后台任务读取失败，请重新进入或刷新。'))
  assert.ok(ui.includes('全局后台任务读取失败，请重新进入或刷新。'))
  assert.ok(page.includes('backgroundTasksLoaded ? syncTasks.length : undefined'))
  assert.ok(page.includes('backgroundTasksLoaded ? derivedTasks.length : undefined'))
  assert.ok(page.includes('globalTasksAvailable && globalBackgroundTasksLoaded'))
  assert.ok(page.includes('loaded={backgroundTasksLoaded}'))
  assert.ok(page.includes('loaded={globalBackgroundTasksLoaded}'))
})

test('polling errors retain last accepted rows without changing transfer controls', () => {
  assert.ok(controller.includes('setMine((previous) => ({ ...previous, failed: true }))'))
  assert.ok(controller.includes('setGlobalTasks((previous) => ({ ...previous, failed: true }))'))
  assert.ok(controller.includes('history: previous.loadedMore'))
  assert.ok(controller.includes('onErrorRef.current?.(error)'))
  assert.ok(page.includes('<XDriveFileOperationCenter'))
  assert.ok(page.includes('<XDriveTransferCenter'))
  assert.ok(page.includes('<XDriveTaskHistorySentinel'))
  assert.ok(page.includes('loadEpoch={backgroundTasksLoadEpoch}'))
  assert.ok(page.includes('loadEpoch={globalBackgroundTasksLoadEpoch}'))
})
