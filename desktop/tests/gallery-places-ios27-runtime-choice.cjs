'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const filename='ui/shared/src/media-gallery-places-runtime.ts'
const built=ts.transpileModule(read(filename),{
  fileName:filename,reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
})
assert.deepEqual((built.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[])
const m={exports:{}}
new Function('module','exports',built.outputText)(m,m.exports)
const choose=m.exports.xDriveBaiduPlacesRuntime
test('signed Child transport wins even when legacy prototype is also present',()=>{
  assert.equal(choose(true,true),'isolated')
  assert.equal(choose(true,false),'isolated')
  assert.equal(choose(false,true),'prototype')
  assert.equal(choose(false,false),'static')
})
test('actual shared Web adapter cannot override a signed HTTPS Child with prototype',()=>{
  const map=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const web=read('web/src/mediaGalleryAdapter.ts')
  const child=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  for(const key of ['mintBaiduIsolatedChildTicket','listBaiduNativeCells','getBaiduJSAPIPrototype'])
    assert.ok(web.includes(key),key)
  assert.ok(map.includes('const hasIsolatedChildPorts = Boolean('))
  assert.ok(map.includes('const prototypeMap = xDriveBaiduPlacesRuntime('))
  assert.ok(map.includes(") === 'prototype'"))
  assert.ok(map.includes("status.activation_state === 'authorized_signed_release'"))
  assert.ok(child.includes('xDriveSelectBaiduNativeCell(page,bounds,cell)'))
  assert.ok(child.includes('mintChildTicket(lifetime.signal)'))
})
