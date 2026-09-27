const test = require('node:test')
const assert = require('node:assert/strict')

const {
  defaultDesktopPreferences,
  normalizeDesktopPreferences,
  resolveWindowBounds,
} = require('../dist/main/window_preferences.cjs')

test('desktop preferences migrate old startup-only settings', () => {
  assert.deepEqual(normalizeDesktopPreferences({ start_at_login: false }), {
    start_at_login: false,
    close_to_tray: true,
    close_behavior_prompted: false,
    window_bounds: undefined,
    window_maximized: false,
  })
})

test('desktop window bounds restore onto a visible work area', () => {
  assert.deepEqual(
    resolveWindowBounds(
      { x: 1800, y: 900, width: 1400, height: 1000 },
      [{ x: 0, y: 0, width: 1920, height: 1080 }],
    ),
    { x: 520, y: 80, width: 1400, height: 1000 },
  )
})

test('desktop rejects fully off-screen saved bounds', () => {
  assert.equal(
    resolveWindowBounds(
      { x: 5000, y: 5000, width: 1120, height: 760 },
      [{ x: 0, y: 0, width: 1920, height: 1080 }],
    ),
    undefined,
  )
})

test('desktop defaults keep background sync on close', () => {
  assert.equal(defaultDesktopPreferences().close_to_tray, true)
})
