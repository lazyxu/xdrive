'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')

test('inline and isolated map hosts use one Owner-scoped Parent without legacy photo grant prompts', () => {
  const parent = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const drawer = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
  const legacy = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  assert.match(parent, /mode === 'inline'/)
  assert.match(parent, /xDriveMountBaiduInlineMap/)
  assert.match(parent, /listOwnerCells/)
  assert.match(parent, /Owner\/PhotoScope\/source-revision-fenced/)
  assert.match(parent, /当前地图暂无可显示的定位照片/)
  assert.match(parent, /位置派生完成后会自动重查/)
  assert.match(parent, /data-xdrive-places-empty-map-recheck/)
  assert.match(parent, /刷新定位照片/)
  assert.match(drawer, /正在加载该地点的照片/)
  assert.match(legacy, /张可查看的照片/)
  assert.match(legacy, /选择区域打开照片墙/)
  assert.match(legacy, /当前地图范围内可查看的照片超过 100 张/)
  for (const component of [parent,drawer,legacy]) {
    assert.doesNotMatch(component, /已授权照片|照片详情中查看地图权限|Owner\/Consent/)
    assert.doesNotMatch(component, /请求地图授权|请先授权照片地图|地图位置隐私授权/)
  }
})
