'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(
  __dirname, '../../ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'
), 'utf8')

const section = (start, end) => {
  const begin = source.indexOf(start)
  const finish = source.indexOf(end, begin + start.length)
  assert.ok(begin >= 0 && finish > begin, 'expected source boundaries missing: ' + start)
  return source.slice(begin, finish)
}

test('Baidu native gesture cancel invalidates Owner Camera and current Cells together', () => {
  const cancel = section('    const cancel = (keepGestureVisual = false) => {', '    const failure = () => {')
  assert.match(cancel, /generation\+\+/)
  assert.match(cancel, /lastViewport\.current = null/)
  assert.match(cancel, /activeQuery\?\.abort\(\)/)
  assert.match(cancel, /acceptedScope\.current = null/)
  assert.match(cancel, /acceptedCells\.current = \[\]/)
  assert.match(cancel, /setAcceptedViewport\(null\)/)
  assert.match(cancel, /invalidated\.current\?\.\(\)/)
  const host = section('    const commonMapOptions = {', '    const queryCells = async')
  const callback=section('      onCancel:()=>{', '      onCamera:')
  assert.match(callback,/cameraTouched=true/)
  assert.match(callback,/const resized=Boolean/)
  assert.match(callback,/pendingResizeDrawer\.current=null/)
  assert.match(callback,/cancel\(Boolean\(keepVisual\)\)/,
    'rotation and pan gestures both revoke prior Camera and signed Cells')
  assert.match(source,/let cameraTouched = Boolean\(returnCamera\)/)
  assert.match(host, /onViewport: \(bounds:Bounds\) => \{ void queryCells\(bounds, true\) \}/)
  assert.match(host, /xDriveMountBaiduIsolatedFrame<MediaBaiduNativeCellSelection>/)
  assert.match(host, /xDriveMountBaiduInlineMap<MediaBaiduNativeCellSelection>/)
})

test('filter refresh cannot reauthorize the canceled Camera before a new request', () => {
  const query = section('    const queryCells = async', '    refreshFilteredCells.current=(skipPending=false)=>{')
  const cancelAt = query.indexOf('      cancel(Boolean(keepVisual))')
  const rememberAt = query.indexOf('      lastViewport.current={bounds:{...bounds},live:liveCamera}')
  const fetchAt = query.indexOf('await listOwnerCells(bounds,request.signal,')
  assert.ok(cancelAt >= 0 && cancelAt < rememberAt && rememberAt < fetchAt,
    'new camera can be registered only after old Camera/Cells are invalidated')
  assert.match(query, /request\.signal\.aborted \|\| lifetime\.signal\.aborted \|\| run!==generation/)
  assert.match(query, /approved\.key!==filterRef\.current\.key/)
  const refresh = section('    refreshFilteredCells.current=(skipPending=false)=>{', '    const acquireTicket=async')
  assert.match(refresh, /if\(lifetime\.signal\.aborted \|\| failed \|\| !lastViewport\.current \|\|/)
  assert.match(refresh, /skipPending && \(activeQuery \|\|/)
  assert.match(refresh, /acceptedScope\.current\?\.key!==filterRef\.current\.key/)
  assert.match(refresh, /void queryCells\(bounds,worldwideDiscovery \? false : last\.live\)/)
})

test('canceled Camera cannot leave private cover, filmstrip or full-wall authority', () => {
  const cancel = section('    const cancel = (keepGestureVisual = false) => {', '    const failure = () => {')
  for (const required of ['setSummary(null)', 'setProjected(null)',
    'latestAcceptedViewport.current = null', 'setAccessible([])']) {
    assert.ok(cancel.includes(required), required)
  }
  assert.match(source, /const trustedSummary = scopeIsCurrent \? summary : null/)
  assert.match(source,/data-xdrive-places-gesture-photo-cover/)
  assert.match(source,/disabled=\{!currentCoverActive\}/)
  assert.match(source,/gesturePresentationRef\.current/)
  assert.match(source,/setPhotoCoverSelections/)
  assert.match(source, /const approved=acceptedScope\.current/)
  assert.match(source, /approved\.key===filterRef\.current\.key/)
})
