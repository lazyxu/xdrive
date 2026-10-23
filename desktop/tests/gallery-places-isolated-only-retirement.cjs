'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const Module=require('node:module')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const read=file=>fs.readFileSync(path.join(root,file),'utf8')

test('Static PNG remains retired; legacy Browser AK is Web/PWA only',()=>{
  for(const file of ['ui/shared/src/mui/MediaGalleryBaiduStaticMap.tsx',
    'ui/shared/src/media-gallery-baidu-camera.ts',
    'cmd/xdrive-agent/desktop_ipc_baidu_jsapi_prototype.go'
  ])assert.equal(fs.existsSync(path.join(root,file)),false,file)
  for(const file of ['internal/api/baidu_jsapi4_prototype.go',
    'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx',
    'ui/shared/src/media-gallery-baidu-prototype-cover-pins.ts'
  ])assert.equal(fs.existsSync(path.join(root,file)),true,file)
  assert.match(read('internal/api/baidu_jsapi4_prototype.go'),/baiduJSAPISecretName/)
  assert.match(read('internal/api/baidu_jsapi4_prototype.go'),/validBaiduMapAK/)
  assert.match(read('internal/api/baidu_jsapi4_prototype.go'),/"Cache-Control", "private, no-store"/)
  assert.doesNotMatch(read('desktop/src/main/index.cts'),/agent:get-baidu-jsapi-prototype/)
  assert.doesNotMatch(read('desktop/src/preload/index.cts'),/getBaiduJSAPIPrototype/)
})
test('the signed HTTPS Child still retains independent strict status gating',()=>{
  const parent=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const child=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  assert.match(parent,/getBaiduJSAPI4Status/)
  assert.match(parent,/activation_state === 'authorized_signed_release'/)
  assert.match(parent,/XDriveMediaGalleryBaiduIsolatedPhotoSurface/)
  assert.match(parent,/XDriveMediaGalleryBaiduPrototypeMap/)
  assert.match(child,/mintChildTicket\(lifetime\.signal\)/)
  assert.match(child,/xDriveSelectBaiduNativeCell/)
  assert.doesNotMatch(parent,/MediaGalleryBaiduStaticMap|loadBaiduStaticMap/)
})
test('prototype diagnostics disclose only finite codes, never Browser AK or provider error bodies',()=>{
  const name='ui/shared/src/media-gallery-baidu-diagnostics.ts'
  const built=ts.transpileModule(read(name),{fileName:name,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  const m=new Module(name,module)
  m.filename=path.join(root,name)
  m.paths=module.paths
  m._compile(built.outputText,m.filename)
  const {xDriveBaiduMapDiagnosticDetails:details,
    xDriveClassifyBaiduPrototypeConfigFailure:classify,
    xDriveRecordBaiduMapDiagnostic:record,
    xDriveReadBaiduMapDiagnostic:get,xDriveClearBaiduMapDiagnostic:clear}=m.exports
  assert.ok(details.prototype_config_denied)
  assert.equal(classify({status:403,body:'AK=secret'}),'prototype_config_denied')
  assert.equal(classify({get status(){throw Error('JWT-secret')}}),'prototype_config_unavailable')
  assert.equal(record('web:owner','prototype_config_unavailable'),true)
  assert.deepEqual(Object.keys(get('web:owner')).sort(),['code','recordedAt'])
  assert.equal(JSON.stringify(get('web:owner')).includes('secret'),false)
  clear('web:owner')
})
