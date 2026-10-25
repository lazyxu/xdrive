'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const map = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
const sheet = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
const surface = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')

test('inline and isolated SDK hosts share the trusted Parent map and photo drawer', () => {
  assert.match(surface, /const commonMapOptions = \{/)
  assert.match(surface, /xDriveMountBaiduInlineMap/)
  assert.match(surface, /xDriveMountBaiduIsolatedFrame/)
  assert.equal((surface.match(/<XDriveMediaGalleryPlacesPhotoDrawer/g) || []).length, 1)
  assert.match(map, /<XDriveMediaGalleryBaiduIsolatedPhotoSurface/)
})

test('both shared map menus dismiss on click-away and Escape and exclude each other', () => {
  assert.match(map, /ClickAwayListener/)
  assert.equal((map.match(/<ClickAwayListener/g) || []).length, 2)
  for (const ref of ['filterMenuRef', 'moreMenuRef']) {
    assert.match(map, new RegExp('const ' + ref + ' = useRef<HTMLDetailsElement'))
    assert.match(map, new RegExp(ref + '\\.current\\.open = false'))
    assert.match(map, new RegExp(ref + '\\.current\\?\\.querySelector<HTMLElement>\\(\'summary\'\\)\\?\\.focus\\(\\)'))
  }
  assert.match(map, /data-xdrive-places-map-filter-menu/)
  assert.match(map, /data-xdrive-places-map-more-menu/)
  assert.equal((map.match(/event\.key !== 'Escape'/g) || []).length, 2)
  assert.match(map, /moreMenuRef\.current\.open = false/)
  assert.match(map, /filterMenuRef\.current\.open = false/)
  assert.match(map, /window.addEventListener\('blur', dismissMapMenus\)/)
  assert.match(map, /dismissMapMenus\(\)/)
  assert.match(map, /\[onNativeCameraChange, dismissMapMenus\]/)
})

test('photo drawer drag handle offers mouse/keyboard click and touch/pen swipe', () => {
  assert.match(sheet, /component="button" type="button"/)
  assert.match(sheet, /data-xdrive-places-photo-drawer-handle/)
  assert.match(sheet, /data-xdrive-places-photo-drawer-grip/)
  assert.match(sheet, /aria-expanded=\{expanded\}/)
  assert.match(sheet, /event\.currentTarget\.setPointerCapture\(event\.pointerId\)/)
  assert.match(sheet, /onPointerCancel/)
  assert.match(sheet, /suppressDragClick\.current = true/)
  assert.match(sheet, /Math\.abs\(dy\)<36/)
  assert.match(sheet, /Math\.abs\(dy\)<Math\.abs\(dx\)\*1\.25/)
  assert.match(sheet, /onExpand\(dy<0\)/)
  assert.match(sheet, /onExpand\(!expanded\)/)
  const handle = sheet.slice(sheet.indexOf('component="button" type="button"'),
    sheet.indexOf('<Stack direction="row" spacing={1}'))
  assert.doesNotMatch(handle, /<IconButton/)
})
