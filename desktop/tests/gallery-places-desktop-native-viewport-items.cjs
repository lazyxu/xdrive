'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8')
const main=read('desktop/src/main/index.cts')
const client=read('desktop/src/main/agent_client.cts')
const preload=read('desktop/src/preload/index.cts')
const rendererTypes=read('desktop/src/renderer/global.d.ts')
const adapter=read('desktop/src/renderer/mediaGalleryAdapter.ts')
const server=read('internal/api/baidu_photo_map_viewport_range.go')
const go=read('internal/client/media_baidu_native_viewport_items.go')
const agent=read('cmd/xdrive-agent/desktop_ipc_baidu_native_viewport_items.go')
test('Desktop BD09 signed Owner camera range is wired end-to-end',()=>{
 for(const [content,need] of [
  [main,"agent:get-media-baidu-native-viewport-items"],
  [client,"/v1/media/places/baidu-native-viewport-items?"],
  [preload,"agent:get-media-baidu-native-viewport-items"],
  [rendererTypes,"getMediaBaiduNativeViewportItems: ("],
  [adapter,"listBaiduNativeViewportItems: (bounds, limit, offset, query, signal)"],
  [go,"/api/v1/media/places/baidu-jsapi/viewport-items?"],
  [agent,"parseDesktopIPCBaiduNativeViewportItems("],
  [server,"baiduMapViewportPageMembersStillAuthorized("],
 ]){
   assert.ok(content.includes(need),need)
 }
})
test('Agent and Electron reject unsafe geometry, unknown filters and bypass to all-media',()=>{
 for(const name of ['coordinate_space','fold_duplicates','sort_by','anchor_node_id','favorite',
   'captured_from','captured_to','time_zone','asset_kind']){
   assert.ok(main.includes(name),name)
 }
 assert.match(main,/Object\.entries\(raw\)\.some/)
 assert.match(client,/Object\.entries\(filters\)\.some/)
 assert.match(main,/v\.coordinate_space !== 'bd09ll'/)
 assert.match(client,/bounds\.coordinate_space !== 'bd09ll'/)
 assert.match(agent,/unsupported_baidu_viewport_items/)
 assert.doesNotMatch(agent,/\/media\/items|\/v1\/media\/items/)
 assert.ok(adapter.includes('xDriveDesktopViewportRequest(signal, requestID =>'))
})
