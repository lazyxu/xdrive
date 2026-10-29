'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const name = 'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'
const source = fs.readFileSync(path.join(root, name), 'utf8')

test('the one shared Owner map remains valid TSX for both SDK hosts', () => {
  const compiled = ts.transpileModule(source, {
    fileName: name, reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  assert.deepEqual((compiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  assert.match(source, /const commonMapOptions = \{/)
  assert.match(source, /xDriveMountBaiduInlineMap/)
  assert.match(source, /xDriveMountBaiduIsolatedFrame/)
  assert.equal((source.match(/<XDriveMediaGalleryPlacesPhotoDrawer/g) || []).length, 1)
})

test('gesture-only old Owner photos never become an invisible screen-reader or keyboard action', () => {
  const start = source.indexOf('data-xdrive-places-trusted-photo-cover-pins')
  const end = source.indexOf('{!activeDrawer && trustedSummary ? (', start)
  assert.ok(start > 0 && end > start, 'inspect actual trusted Parent photo overlay')
  const overlay = source.slice(start, end)
  assert.match(overlay, /disabled=\{!currentCoverActive\}/)
  assert.match(overlay, /aria-hidden=\{!currentCoverActive\}/)
  assert.match(overlay, /tabIndex=\{currentCoverActive \? 0 : -1\}/)
  assert.match(overlay, /data-xdrive-places-gesture-photo-cover/)
  assert.match(overlay, /aria-label=\{currentCoverActive/)
  assert.match(overlay, /onClick=\{currentCoverActive\s*\?\s*\(\) => openVerifiedCell\(pin.selection\) : undefined\}/)
  assert.match(source, /const gesturePins=gesturePresentation &&/)
  assert.match(source, /gesturePresentation.owner===\(scope\?\?''\)/)
  assert.match(source, /gesturePresentation.key===currentFilterKey/)
  assert.match(source, /xDriveVerifiedMapPhotoProjections\(/)
})

test('only the current signed Owner photo count is announced politely', () => {
  const start = source.indexOf('{!activeDrawer && trustedSummary ? (')
  const end = source.indexOf('data-xdrive-places-full-camera-wall', start)
  assert.ok(start >= 0 && end > start)
  const summary = source.slice(start, end)
  assert.match(summary, /ref=\{summaryElement\} data-xdrive-places-map-photo-summary/)
  assert.match(summary, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(summary, /trustedSummary.total_count/)
  assert.match(source, /const trustedSummary = scopeIsCurrent \? summary : null/)
  assert.doesNotMatch(summary, /gesturePresentation\.summary\.total_count/)
})

test('accessible signed Cell list has 44px touch targets and a real photo count unit', () => {
  const start = source.indexOf('data-xdrive-places-cluster-list')
  const list = source.slice(start)
  assert.ok(start >= 0)
  assert.match(list, /scopeIsCurrent && accessible.length>0/)
  assert.match(list, /color:'text.secondary',minHeight:44,display:'flex',alignItems:'center'/)
  assert.match(list, /'&:focus-visible'/)
  assert.match(list, /<Box component="nav" aria-label="当前地图聚合区域"/)
  assert.match(list, /aria-label=\{[^}]*cell.label[^}]*张照片[^}]*\}/)
  assert.match(list, /sx=\{\{minHeight:44\}\}/)
  assert.match(list, /onClick=\{\(\)=>openVerifiedCell\(cell.selection\)\} disabled=\{phase!=='ready'\}/)
  assert.doesNotMatch(list, /onOpenPlace|onOpenPrototypePlace|onOpenNearby/)
})
