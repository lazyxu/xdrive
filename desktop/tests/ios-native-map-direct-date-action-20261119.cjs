'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = file => fs.readFileSync(path.join(__dirname,'../..',file),'utf8')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const ui = read('ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift')

test('local/Owner real Map actions provide a direct date picker before the years menu', () => {
  for (const [s,id] of [[local,'native-ios-local-map-select-date'],[owner,'native-ios-owner-map-select-date']]) {
    // Both map screens have earlier unrelated overlays. The last overlay
    // is the actual bottom-leading native Map actions Menu.
    const actions=s.slice(s.lastIndexOf('.overlay(alignment: .bottomLeading)'))
    const item='Button("按指定日期") { datePickerOpen = true }'
    const pos=actions.indexOf(item)
    const next=actions.indexOf('Menu {\n                        Button("全部日期")')
    assert.ok(pos>=0 && next>pos, 'direct Date action must precede date presets')
    assert.equal(actions.split(item).length-1,1,'one non-duplicated Date picker action')
    assert.match(actions,new RegExp('Button\\("按指定日期"\\) \\{ datePickerOpen = true \\}\\s*\\.accessibilityIdentifier\\("'+id+'"\\)'))
    assert.match(actions,/Label\("地图日期", systemImage: "calendar"\)/)
    assert.match(actions,/Section\("按年份"\)/)
    assert.match(actions,/Label\("地图操作", systemImage: "ellipsis.circle"\)/)
  }
})

test('genuine Simulator checks the direct calendar item and the DatePicker sheet', () => {
  const b=ui.slice(ui.indexOf('func testMapCameraLayoutAndUnverifiedGestureNeverClosesTheApp()'),
                   ui.indexOf('func testCollectionsUtilityOpensSameMapKitAndReturnsToCollections'))
  assert.match(b,/native-ios-local-map-actions/)
  assert.match(b,/native-ios-local-map-capture-menu/)
  assert.match(b,/native-ios-local-map-select-date/)
  assert.doesNotMatch(b,/dateMenu\.tap\(\)/)
  assert.match(b,/chooseDate\.tap\(\)/)
  assert.match(b,/native-ios-map-selected-month/)
})
