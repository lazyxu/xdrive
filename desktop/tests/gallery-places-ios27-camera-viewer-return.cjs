'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const file='ui/shared/src/media-gallery-baidu-viewport-return-session.ts'
const compiled=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  reportDiagnostics:true,fileName:file})
assert.deepEqual((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
const obj={exports:{}}
const mapScopeHelper=require('./helpers/load-baidu-map-scope.cjs')
new Function('module','exports','require',compiled.outputText)(obj,obj.exports,id=>{
  assert.equal(id,'./media-gallery-baidu-map-photo-scope')
  return mapScopeHelper
})
const m=obj.exports,scope='viewer:test'
const bounds={coordinate_space:'bd09ll',west:116,south:39,east:117,north:40}
const snapshot={bounds,sort:{by:'captured',dir:'desc'}}
test('a map Viewer return is short lived and one shot, never cached membership',()=>{
  assert.equal(m.xDriveRememberBaiduViewportReturn(scope,snapshot,1000),true)
  assert.equal(m.xDriveTakeBaiduViewportViewerReturn(scope,1001),undefined)
  assert.equal(m.xDriveMarkBaiduViewportViewerReturn(scope,451,34,1002),true)
  const once=m.xDriveTakeBaiduViewportViewerReturn(scope,1003)
  assert.equal(once.anchorNodeID,451)
  assert.equal(once.anchorIndex,34)
  assert.equal(m.xDriveTakeBaiduViewportViewerReturn(scope,1004),undefined)
  assert.equal(m.xDriveMarkBaiduViewportViewerReturn(scope,451,34,1005),true)
  assert.equal(m.xDriveTakeBaiduViewportViewerReturn(scope,1005+10*60*1000),undefined)
})
test('foreign account, altered projection, explicit revocation cannot restore media',()=>{
  assert.equal(m.xDriveRememberBaiduViewportReturn(scope,{...snapshot,bounds:{...bounds,coordinate_space:'wgs84'}},2000),false)
  assert.equal(m.xDriveRememberBaiduViewportReturn(scope,snapshot,2000),true)
  assert.equal(m.xDriveMarkBaiduViewportViewerReturn(scope,10,2,2001),true)
  assert.equal(m.xDriveTakeBaiduViewportViewerReturn('viewer:foreign',2002),undefined)
  m.xDriveClearBaiduViewportReturn(scope)
  assert.equal(m.xDriveTakeBaiduViewportViewerReturn(scope,2002),undefined)
  assert.equal(m.xDriveMarkBaiduViewportViewerReturn(scope,0,1,2003),false)
})
