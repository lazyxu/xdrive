'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const {webcrypto} = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const protocolPath = 'ui/shared/src/media-gallery-baidu-isolated-origin-protocol.ts'
const hostPath = 'ui/shared/src/media-gallery-baidu-isolated-frame-host.ts'
function realTS(relative, substitutes = {}) {
  const filename = path.join(root, relative)
  const code = ts.transpileModule(fs.readFileSync(filename,'utf8'), {
    fileName:filename, reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  assert.deepEqual(code.diagnostics||[],[])
  const m = new Module(filename, module)
  m.filename=filename
  m.paths=Module._nodeModulePaths(path.join(root,'desktop'))
  const requireBase=m.require.bind(m)
  m.require=name=>Object.hasOwn(substitutes,name)?substitutes[name]:requireBase(name)
  m._compile(code.outputText,filename)
  return m.exports
}
const protocol=realTS(protocolPath)
const {xDriveMountBaiduIsolatedFrame:mount}=realTS(hostPath,{
  './media-gallery-baidu-isolated-origin-protocol':protocol,
})
const hostSource=fs.readFileSync(path.join(root,hostPath),'utf8')
function fixture(childOrigin='https://isolated-map.example.org', crypto=webcrypto) {
  const outgoing=[], parentEvents=new Map(), childEvents=new Map(), activated=[], cameras=[], cancels=[]
  const childWindow={postMessage(data,origin){outgoing.push({data,origin})}}
  const iframe={
    sandbox:{flags:[],add(...xs){this.flags.push(...xs)}},
    contentWindow:childWindow,
    attrs:{},
    setAttribute(name,value){this.attrs[name]=value},
    addEventListener(name,fn){childEvents.set(name,fn)},
    removeEventListener(name){childEvents.delete(name)},
    remove(){this.removed=true},
  }
  const parent={
    location:{origin:'https://gallery.example.net'}, crypto,
    addEventListener(name,fn){parentEvents.set(name,fn)},
    removeEventListener(name){parentEvents.delete(name)},
  }
  const document={defaultView:parent,createElement(tag){assert.equal(tag,'iframe');return iframe}}
  const element={ownerDocument:document,nodes:[],appendChild(node){this.nodes.push(node)}}
  const opts={parentWindow:parent,host:element,childOrigin,
    onActivateCell:s=>activated.push(s),
    onCamera:c=>cameras.push(c),
    onCancel:()=>cancels.push(true)}
  function emit(kind,extra={}, origin=childOrigin, source=childWindow) {
    const challenge=outgoing[0]?.data
    assert.ok(challenge)
    const packet={version:1,generation:challenge.generation,nonce:challenge.nonce,kind,...extra}
    const fn=parentEvents.get('message')
    assert.ok(fn)
    fn({origin,source,data:packet})
  }
  return {opts,iframe,element,outgoing,parentEvents,childEvents,activated,cameras,cancels,emit}
}
test('A3i-Msg2 rejects same HTTPS hostname, same-origin, file/http and unsafe endpoints',()=>{
  for(const origin of [
    'https://gallery.example.net','https://gallery.example.net:9443',
    'http://isolated-map.example.org','data:text/html,unsafe',
    'https://user:pass@isolated-map.example.org',
    'https://isolated-map.example.org/a',
    'https://isolated-map.example.org/?ak=secret',
  ]) {
    const f=fixture(origin)
    assert.equal(mount(f.opts),null,origin)
    assert.equal(f.element.nodes.length,0,origin)
  }
  const missing=fixture(undefined,{})
  assert.equal(mount(missing.opts),null)
  assert.equal(missing.element.nodes.length,0)
})
test('A3i-Msg2 uses approved exact child origin, bounded nonce challenge and no app credentials',()=>{
  const f=fixture()
  const host=mount(f.opts)
  assert.ok(host)
  assert.equal(host.element,f.iframe)
  assert.equal(f.iframe.src,f.opts.childOrigin+'/_xdrive_baidu_isolated/index.html')
  assert.deepEqual(f.iframe.sandbox.flags,['allow-scripts','allow-same-origin'])
  assert.equal(f.iframe.referrerPolicy,'no-referrer')
  assert.equal(f.iframe.attrs.allow,'')
  assert.equal(f.outgoing.length,0)
  f.childEvents.get('load')()
  assert.equal(f.outgoing.length,1)
  assert.equal(f.outgoing[0].origin,f.opts.childOrigin)
  assert.deepEqual(f.outgoing[0].data.cells,[])
  assert.match(f.outgoing[0].data.nonce,/^[a-f0-9]{64}$/)
  host.dispose()
  assert.ok(f.iframe.removed)
  assert.equal(f.parentEvents.has('message'),false)
})
test('A3i-Msg2 never posts Owner identity, pixels or URL and parent-only Cell selection remains an intent',()=>{
  const f=fixture()
  const host=mount(f.opts)
  assert.ok(host)
  f.childEvents.get('load')()
  const selection=Object.freeze({node_id:42,jwt:'secret',photo_url:'/owner/private'})
  assert.equal(host.replaceAuthorizedCells([{
    latitude:35.6,longitude:139.7,count:6,selection,
  }]),true)
  assert.equal(f.outgoing.length,1)
  f.emit('ready')
  assert.equal(f.outgoing.length,2)
  const cells=f.outgoing.at(-1).data.cells
  assert.equal(cells.length,1)
  assert.deepEqual(Object.keys(cells[0]).sort(),['count','key','latitude','longitude'])
  const wire=JSON.stringify(f.outgoing)
  for(const bad of ['secret','node_id','jwt','photo_url','/owner/private'])assert.equal(wire.includes(bad),false,bad)
  f.emit('activate-cell',{key:cells[0].key})
  assert.deepEqual(f.activated,[selection])
  f.emit('activate-cell',{key:'f'.repeat(32)})
  assert.equal(f.activated.length,1)
  host.dispose()
})
test('A3i-Msg2 ignores hostile source/origin/nonce/credentials and clears cells on revoke or logout',()=>{
  const f=fixture()
  const host=mount(f.opts)
  assert.ok(host)
  f.childEvents.get('load')()
  f.emit('ready')
  assert.equal(host.replaceAuthorizedCells([{latitude:0,longitude:0,count:1,selection:'owner-cell'}]),true)
  const msg=f.outgoing.at(-1).data
  f.emit('activate-cell',{key:msg.cells[0].key},'https://evil.example.com')
  f.emit('activate-cell',{key:msg.cells[0].key},f.opts.childOrigin,{})
  f.emit('activate-cell',{key:msg.cells[0].key,jwt:'unsafe'})
  f.emit('activate-cell',{key:msg.cells[0].key,nonce:'0'.repeat(64)})
  assert.equal(f.activated.length,0)
  f.emit('camera',{camera:{coordinate_space:'bd09ll',latitude:40,longitude:116,zoom:12}})
  f.emit('camera',{camera:{coordinate_space:'wgs84',latitude:40,longitude:116,zoom:12}})
  assert.equal(f.cameras.length,1)
  assert.equal(host.replaceAuthorizedCells([{latitude:0,longitude:0,count:0,selection:'revoked'}]),false)
  assert.deepEqual(f.outgoing.at(-1).data.cells,[])
  f.emit('activate-cell',{key:msg.cells[0].key})
  assert.equal(f.activated.length,0)
  f.emit('cancel')
  assert.equal(f.cancels.length,1)
  host.dispose()
  f.emit // stale listener no longer exists
  assert.equal(f.parentEvents.size,0)
})
test('A3i-Msg2 enforces 64-cell bound and fresh random opaque keys',()=>{
  const f=fixture()
  const host=mount(f.opts)
  assert.ok(host)
  f.childEvents.get('load')()
  f.emit('ready')
  const cells=Array.from({length:64},(_,i)=>({latitude:35,longitude:139,count:i+1,selection:i}))
  assert.equal(host.replaceAuthorizedCells(cells),true)
  const keys=f.outgoing.at(-1).data.cells.map(x=>x.key)
  assert.equal(new Set(keys).size,64)
  assert.equal(host.replaceAuthorizedCells(cells.concat(cells[0])),false)
  assert.deepEqual(f.outgoing.at(-1).data.cells,[])
  for(const bad of ['document.cookie','localStorage','sessionStorage','window.BMap',
      '.appendChild(script)','Bearer ','Authorization:']) {
    assert.equal(hostSource.includes(bad),false,bad)
  }
  host.dispose()
})
