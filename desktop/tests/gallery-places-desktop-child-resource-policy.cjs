'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const file = 'desktop/src/main/baidu_map_child_resource_policy.cts'
const transpiled = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
  fileName:file, reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((transpiled.diagnostics||[]).filter(x=>
  x.category===ts.DiagnosticCategory.Error),[])
const mod={exports:{}}
new Function('module','exports','require',transpiled.outputText)(
  mod,mod.exports,()=>{throw Error('Child policy must not load runtime modules')})
const {xDriveReleasedBaiduChildOrigin:validate,
  xDriveBaiduReleasedChildResourceAllowed:allowed}=mod.exports
const parent='https://gallery.example.com'
const child='https://map-isolated.example.org'
const release={provider:'baidu-jsapi-4.0',enabled:true,
  activation_state:'authorized_signed_release',attribution:'© 百度地图',
  isolated_child_origin:child}
test('Main accepts only the current source-verified Server release with canonical independent HTTPS origin',()=>{
  assert.equal(validate(release,parent),child)
  for(const input of [
    {...release,enabled:false},
    {...release,activation_state:'blocked_pending_licence_and_proxy'},
    {...release,provider:'other'},
    {...release,attribution:'other'},
    {...release,owner_id:1},
    {...release,asset_id:12},
    {...release,jwt:'secret'},
    {...release,isolated_child_origin:parent},
    {...release,isolated_child_origin:child+'/'},
    {...release,isolated_child_origin:child+'?x=1'},
    {...release,isolated_child_origin:'https://user:pass@map-isolated.example.org'},
    {...release,isolated_child_origin:'http://map-isolated.example.org'},
    {...release,isolated_child_origin:'https://localhost'},
    {...release,isolated_child_origin:'file:///tmp/map'},
    {...release,isolated_child_origin:'https://map-isolated.example.org.evil.test'},
  ]) assert.equal(validate(input,parent),null,JSON.stringify(input))
  assert.equal(validate(null,parent),null)
  assert.equal(validate(release,'http://gallery.example.com'),null)
})
test('only Child Caddy files, Child session and Go-reviewed same-origin provider routes can leave Electron',()=>{
  for(const p of [
    '/_xdrive_baidu_isolated/index.html',
    '/_xdrive_baidu_isolated/child.js',
    '/_xdrive_baidu_isolated/child.css',
    '/_xdrive_baidu_isolated/session',
    '/_BMapService/api?v=4.0',
    '/_BMapService/approved-asset?version=1',
  ]) assert.equal(allowed(child+p,child),true,p)
  for(const p of [
    '/', '/admin', '/api/v1/media/items',
    '/_xdrive_baidu_isolated/index.html?token=evil',
    '/_xdrive_baidu_isolated/child.js#fragment',
    '/_BMapService', '/_BMapService/../../api/v1/media/items',
  ]) assert.equal(allowed(child+p,child),false,p)
  for(const url of ['https://api.map.baidu.com/api?v=4.0',
    'https://gallery.example.com/api/v1/media/items',
    'https://map-isolated.example.org.evil.test/_BMapService/api',
    'https://evil.example/_BMapService/api',
    'http://map-isolated.example.org/_BMapService/api',
    'file:///tmp/image.jpg',
    'data:text/html,alert(1)',
    'blob:https://map-isolated.example.org/opaque']) assert.equal(allowed(url,child),false,url)
  assert.equal(allowed(child+'/_BMapService/api',undefined),false)
})
