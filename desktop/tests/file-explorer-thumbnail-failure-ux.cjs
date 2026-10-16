'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'ui/shared/src/mui/FileExplorerThumbnailVisualState.ts')
const source = fs.readFileSync(file, 'utf8')
const thumbnail = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorerThumbnail.tsx'), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleObject = { exports: {} }
new Function('exports', 'module', js)(moduleObject.exports, moduleObject)
const status = moduleObject.exports.xDriveFileExplorerThumbnailVisualState
const basis = { eligible: true, visible: false, failed: false, hasSource: false, canLoad: true }
test('U10 distinguishes viewport-queued, actively loading, ready and failed thumbnails', () => {
  assert.equal(status(basis), 'waiting-viewport')
  assert.equal(status({ ...basis, visible: true }), 'loading')
  assert.equal(status({ ...basis, visible: true, failed: true }), 'failed')
  assert.equal(status({ ...basis, hasSource: true, failed: true }), 'ready')
})
test('U10 unsupported formats or absent loader are normal type-icon fallbacks, not errors', () => {
  assert.equal(status({ ...basis, eligible: false, visible: true, failed: false }), 'type-icon')
  assert.equal(status({ ...basis, eligible: false, visible: true, failed: true }), 'type-icon')
  assert.equal(status({ ...basis, canLoad: false, visible: true }), 'type-icon')
  assert.equal(status({ ...basis, canLoad: false, failed: true }), 'type-icon')
})
test('U10 visible failure badge is noninteractive and does not dispatch requests or disturb Live badges', () => {
  for (const token of [
    'data-xdrive-file-explorer-thumbnail-state={visualState}',
    "visualState === 'failed'",
    'data-xdrive-file-explorer-thumbnail-failure',
    'aria-label="缩略图加载失败，显示文件类型图标"',
    "pointerEvents: 'none'",
    '<XDriveMediaLoadingProgress compact stage={stage} {...progress} />',
    'livePhoto && !failed && Boolean(item.thumbnail || src)',
    'ErrorOutlineRoundedIcon',
  ]) assert(thumbnail.includes(token), token)
  assert(thumbnail.includes('scheduleFileThumbnail('), 'existing scheduler must remain')
  assert(thumbnail.includes('scheduled.cancel()'), 'old cancellation must remain')
  assert(!/fetch\s*\(|\/api\/v1|postMessage|BroadcastChannel/.test(source))
})
