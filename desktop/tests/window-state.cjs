const test = require('node:test')
const assert = require('node:assert/strict')

const { parseDesktopWindowState, restoreDesktopWindowBounds } = require('../dist/main/window_state.cjs')

test('desktop window state parses valid persisted bounds', () => {
  assert.deepEqual(
    parseDesktopWindowState({ x: 100, y: 80, width: 1200, height: 800, maximized: true }),
    { x: 100, y: 80, width: 1200, height: 800, maximized: true },
  )
  assert.equal(parseDesktopWindowState({ x: 0, y: 0, width: 100, height: 100 }), undefined)
})

test('desktop restores visible saved window bounds', () => {
  assert.deepEqual(
    restoreDesktopWindowBounds(
      { x: 100, y: 80, width: 1200, height: 800, maximized: false },
      [{ x: 0, y: 0, width: 1920, height: 1080 }],
      { x: 0, y: 0, width: 1920, height: 1080 },
    ),
    { x: 100, y: 80, width: 1200, height: 800 },
  )
})

test('desktop recenters a window saved on a disconnected display', () => {
  assert.deepEqual(
    restoreDesktopWindowBounds(
      { x: 4000, y: 200, width: 1200, height: 800, maximized: false },
      [{ x: 0, y: 0, width: 1920, height: 1080 }],
      { x: 0, y: 0, width: 1920, height: 1080 },
    ),
    { x: 400, y: 160, width: 1120, height: 760 },
  )
})
