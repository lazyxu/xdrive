'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const repo = path.resolve(__dirname, '../..')
const projectRequire = createRequire(path.join(repo, 'desktop/package.json'))
const { buildSync } = projectRequire('esbuild')
const geometrySource = path.join(repo, 'ui/shared/src/mui/FileExplorerMarqueeGeometry.ts')
const compiled = buildSync({
  entryPoints: [geometrySource],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
}).outputFiles[0].text
const moduleRef = { exports: {} }
new Function('module', 'exports', compiled)(moduleRef, moduleRef.exports)
const { xDriveFileExplorerMarqueeContentPoint: contentPoint } = moduleRef.exports
const explorer = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')

function marquee(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  }
}

function inScrollableViewport(point, viewport) {
  assert.ok(point.x >= viewport.scrollLeft && point.x <= viewport.scrollLeft + viewport.width,
    'X must stay inside the existing horizontal scroll viewport')
  assert.ok(point.y >= viewport.scrollTop && point.y <= viewport.scrollTop + viewport.height,
    'Y must stay inside the existing vertical scroll viewport')
}

test('marquee drag outside all four viewport edges never creates new scroll overflow', () => {
  const viewport = { left: 285, top: 115, width: 1000, height: 600, scrollLeft: 0, scrollTop: 0 }
  const start = contentPoint(viewport, 517, 508)
  assert.deepEqual(start, { x: 232, y: 393 })

  // Captured pointer events outside the Explorer must NOT create a giant
  // absolute-positioned overlay that enlarges scrollWidth / scrollHeight.
  const beyond = contentPoint(viewport, 20000, 20000)
  assert.deepEqual(beyond, { x: 1000, y: 600 })
  const forward = marquee(start, beyond)
  assert.deepEqual(forward, { left: 232, top: 393, right: 1000, bottom: 600 })

  const reverse = contentPoint(viewport, -500, -500)
  assert.deepEqual(reverse, { x: 0, y: 0 })
  const backward = marquee(start, reverse)
  assert.deepEqual(backward, { left: 0, top: 0, right: 232, bottom: 393 })
  for (const point of [start, beyond, reverse]) inScrollableViewport(point, viewport)
})

test('scrolled file grid and scrollbar gutter retain content coordinates without layout stretch', () => {
  const viewport = { left: 320, top: 140, width: 784, height: 360, scrollLeft: 120, scrollTop: 1400 }
  const start = contentPoint(viewport, 510, 300)
  assert.deepEqual(start, { x: 310, y: 1560 })
  const bottomRight = contentPoint(viewport, 1200, 600)
  assert.deepEqual(bottomRight, { x: 904, y: 1760 })
  const topLeft = contentPoint(viewport, 150, 40)
  assert.deepEqual(topLeft, { x: 120, y: 1400 })

  for (const point of [start, bottomRight, topLeft]) inScrollableViewport(point, viewport)
  const selection = marquee(start, bottomRight)
  assert.equal(selection.right, viewport.scrollLeft + viewport.width)
  assert.equal(selection.bottom, viewport.scrollTop + viewport.height)
})

test('bad or zero-size pointer geometry does not produce non-finite overlay coordinates', () => {
  const viewport = { left: 100, top: 50, width: 0, height: 0, scrollLeft: 30, scrollTop: 240 }
  assert.deepEqual(contentPoint(viewport, Infinity, NaN), { x: 30, y: 240 })
  assert.deepEqual(contentPoint(viewport, 200, 500), { x: 30, y: 240 })
})

test('shared Explorer uses bounded coordinates for both start and pointer-move and preserves selection', () => {
  assert.match(explorer, /import \{ xDriveFileExplorerMarqueeContentPoint \} from '\.\/FileExplorerMarqueeGeometry'/)
  const bounds = explorer.slice(explorer.indexOf('const marqueeContentPoint ='), explorer.indexOf('const startMarqueeSelection ='))
  assert.match(bounds, /width: host\.clientWidth/)
  assert.match(bounds, /height: host\.clientHeight/)
  assert.match(bounds, /scrollLeft: host\.scrollLeft/)
  assert.match(bounds, /scrollTop: host\.scrollTop/)
  assert.match(bounds, /xDriveFileExplorerMarqueeContentPoint\(/)

  const start = explorer.slice(explorer.indexOf('const startMarqueeSelection ='), explorer.indexOf('const flushMarqueeSelection ='))
  const flush = explorer.slice(explorer.indexOf('const flushMarqueeSelection ='), explorer.indexOf('const updateMarqueeSelection ='))
  assert.match(start, /marqueeContentPoint\(host, event\.clientX, event\.clientY\)/)
  assert.match(flush, /marqueeContentPoint\(/)
  assert.doesNotMatch(flush, /pending\.clientX - rect\.left \+ host\.scrollLeft/)
  assert.match(start, /host\.setPointerCapture\(event\.pointerId\)/)
  assert.match(flush, /commitSelection\(marqueeSelectionIDs\(/)
  assert.match(explorer, /onPointerCancel=\{\(event\) => finishMarqueeSelection\(event, true\)\}/)

  const surface = explorer.slice(explorer.indexOf('{marqueeRect ? ('), explorer.indexOf('{showDelayedLoading && logicalItemCount > 0 ? ('))
  assert.match(surface, /position: 'absolute'/)
  assert.match(surface, /outline: '1px solid'/)
  assert.doesNotMatch(surface, /border: '1px solid'/)
})
