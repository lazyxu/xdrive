'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const controls = read('ui/shared/src/mui/MediaGalleryDateNavigation.tsx')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const places = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
const parent = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')

test('full Gallery and scoped Places use identical date control renderer',()=>{
  assert.match(controls,/export function XDriveMediaGalleryDateNavigation\(/)
  assert.match(gallery,/<XDriveMediaGalleryDateNavigation\s+surface="gallery"/)
  assert.match(places,/<XDriveMediaGalleryDateNavigation\s+surface="places"/)
  for(const [source,label] of [[gallery,'Gallery'],[places,'Places']]){
    for(const port of [
      'jumpGroups=', 'dayInput=', 'dayDisabled=', 'currentGroupKey=',
      'hasReturnAnchor=', 'onJumpGroup=', 'onJumpDay=', 'onReturn=',
    ]) assert.ok(source.includes(port),label+' missing '+port)
  }
  assert.match(places,/dayFeedback=\{dayJumpFeedback\}/)
  assert.match(gallery,/onJumpGroup=\{jumpToTimelineGroup\}/)
  assert.match(places,/onJumpGroup=\{jumpToTimelineGroup\}/)
  assert.doesNotMatch(gallery,/<TextField[^>]*data-xdrive-gallery-timeline-day-jump/)
  assert.doesNotMatch(places,/<TextField[^>]*data-xdrive-places-photo-timeline-day-jump/)
})

test('accessible date actions and DOM contract match both old surfaces',()=>{
  for(const suffix of ['jump','day-jump','current-date','return']){
    assert.ok(controls.includes('data-xdrive-gallery-timeline-'+suffix))
    assert.ok(controls.includes('data-xdrive-places-photo-timeline-'+suffix))
  }
  assert.match(controls,/data-xdrive-places-photo-timeline-day-feedback/)
  assert.match(controls,/aria-label="跳转日期"/)
  assert.match(controls,/type="date"/)
  assert.match(controls,/minHeight:44/)
  assert.match(controls,/label = scale === 'year' \? '跳转年份' : '跳转年月'/)
  assert.match(controls,/scale !== 'all'/)
  assert.match(controls,/onJumpDay\(event\.target\.value\)/)
  assert.match(controls,/if \(group\) onJumpGroup\(group\)/)
  assert.match(controls,/onClick=\{onReturn\}/)
})

test('UI-only controls do not own media authority or generate dates',()=>{
  assert.match(controls,/xDriveMediaGalleryTimelineGroupLabel/)
  assert.doesNotMatch(controls, /fetch\(|URLSession|photoContentIdentity|Node|Authorization|JWT|CellItems|localStorage/)
  assert.match(gallery,/xDriveMediaGalleryTimelineNearestDay\(dayGroupsForJump, day\)/)
  assert.match(places,/xDriveMediaGalleryTimelineNearestDay\(timelineGroups\.day, day\)/)
  assert.match(places,/Number\.isSafeInteger\(group\.start_index\)/)
  assert.match(places,/group\.start_index \+ group\.item_count > total/)
  assert.match(places,/onRangeChange: notifyRange/)
  assert.match(parent,/hasAcceptedCell\(selection\)/)
  assert.match(parent,/photoOpener\.current\(state\.selection,approved\.scope,item\.node\.id,item\.node\.revision/)
})

test('existing date-jump return remains scoped to each owning viewport',()=>{
  assert.match(gallery,/hasReturnAnchor=\{timelineReturnAnchor !== null\}/)
  assert.match(gallery,/onReturn=\{returnToTimelineAnchor\}/)
  assert.match(places,/hasReturnAnchor=\{timelineReturnAnchor !== null\}/)
  assert.match(places,/onReturn=\{returnToTimelineAnchor\}/)
  assert.match(places,/restoreLayout\(anchor\.index, anchor\.viewportOffset\)/)
  assert.match(gallery,/viewAnchorIndexRef\.current = index/)
  assert.match(places,/phase==='ready' && timelineGroups && expanded/)
  assert.match(places,/dayDisabled=\{!timelineGroups\.day\.some\(/)
  assert.match(gallery,/dayGroupsForJump\[0\]\?\.key === 'unknown'/)
})
