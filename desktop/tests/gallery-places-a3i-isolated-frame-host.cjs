'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { webcrypto } = require('node:crypto')

const root = path.resolve(__dirname, '../..')
function originalTS(relative, overrides = {}) {
  const file = path.join(root, relative)
  const source = fs.readFileSync(file, 'utf8')
  const result = ts.transpileModule(source, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual(result.diagnostics || [], [], 'original TS diagnostics: '+relative)
  const compiled = new Module(file, module)
  compiled.filename = file
  compiled.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
  const originalRequire = compiled.require.bind(compiled)
  compiled.require = request => Object.hasOwn(overrides, request)
    ? overrides[request] : originalRequire(request)
  compiled._compile(result.outputText, file)
  return compiled.exports
}
const protocolPath = 'ui/shared/src/media-gallery-baidu-isolated-origin-protocol.ts'
const framePath = 'ui/shared/src/media-gallery-baidu-isolated-frame-host.ts'
const protocol = originalTS(protocolPath)
const {
  xDriveMountBaiduIsolatedFrame,
} = originalTS(framePath, { './media-gallery-baidu-isolated-origin-protocol': protocol })
const hostSource = fs.readFileSync(path.join(root, framePath), 'utf8')

function fixture(childOrigin = 'https://map-isolated.example.org', crypto = webcrypto) {
  const seen = []
  const listeners = new Map()
  const childListeners = new Map()
  const frame = {
    sandbox: { flags: [], add(...flags) { this.flags.push(...flags) } },
    attributes: {},
    setAttribute(key, val) { this.attributes[key] = val },
    contentWindow: { postMessage(payload, targetOrigin) {
      seen.push({ payload, targetOrigin })
    } },
    addEventListener(type, fn) { childListeners.set(type, fn) },
    removeEventListener(type) { childListeners.delete(type) },
    remove() { this.removed = true },
    removed: false,
  }
  const parentWindow = {
    location: {origin: 'https://gallery.example.net'},
    crypto,
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
  }
  const document = {
    defaultView: parentWindow,
    createElement(tag) { assert.equal(tag, 'iframe'); return frame },
  }
  const host = {
    ownerDocument: document,
    children: [],
    appendChild(node) { this.children.push(node) },
  }
  const selections = []
  const cameras = []
  const cancels = []
  const options = {
    childOrigin, parentWindow, host,
    onActivateCell: selection => selections.push(selection),
    onCamera: camera => cameras.push(camera),
    onCancel: () => cancels.push(true),
  }
  const emit = (kind, rest = {}) => {
    const packet = seen[0]?.payload
    assert.ok(packet, 'invoke child load handshake before authenticated child messages')
    const fn = listeners.get('message')
    assert.ok(fn, 'parent listening for actual MessageEvent')
    fn({origin: childOrigin, source: frame.contentWindow,
      data: {version:1, generation:packet.generation, nonce:packet.nonce, kind, ...rest}})
  }
  return {seen,frame,parentWindow,host,selections,cameras,cancels,options,emit,listeners,childListeners}
}

test('A3i-Msg2 rejects same-site subdomains, IP/localhost, ports and missing secure crypto before iframe creation', () => {
  for (const origin of [
    'https://gallery.example.net',
    'https://gallery.example.net:9443',
    'https://map-isolated.example.net', // sibling host can share Domain cookies
    'https://sub.map-isolated.example.net',
    'https://other.example.net',
    'https://localhost',
    'https://127.0.0.1',
    'http://map-isolated.example.org',
    'data:text/html,evil',
    'https://user:pw@map-isolated.example.org',
    'https://map-isolated.example.org/?password=evil',
    'https://map-isolated.example.org/child',
  ]) {
    const f = fixture(origin)
    assert.equal(xDriveMountBaiduIsolatedFrame(f.options), null, origin)
    assert.equal(f.host.children.length, 0, origin)
  }
  const f = fixture(undefined, {})
  assert.equal(xDriveMountBaiduIsolatedFrame(f.options), null)
  assert.equal(f.host.children.length, 0)
})

test('A3i-Msg2 mounts ONLY conservatively cross-site HTTPS sandbox and sends empty challenge to exact child Origin', () => {
  const f = fixture()
  const result = xDriveMountBaiduIsolatedFrame(f.options)
  assert.ok(result)
  assert.equal(result.element, f.frame)
  assert.equal(f.frame.src, f.options.childOrigin + '/_xdrive_baidu_isolated/index.html')
  assert.deepEqual(f.frame.sandbox.flags, ['allow-scripts', 'allow-same-origin'])
  assert.equal(f.frame.referrerPolicy, 'no-referrer')
  assert.equal(f.frame.attributes.allow, '')
  assert.equal(f.frame.attributes.loading, 'eager')
  assert.equal(f.frame.attributes['data-xdrive-baidu-isolated-frame'], 'true')
  assert.equal(f.seen.length, 0, 'no private data or even challenge before load')
  f.childListeners.get('load')()
  assert.equal(f.seen.length, 1)
  assert.equal(f.seen[0].targetOrigin, f.options.childOrigin)
  assert.equal(f.seen[0].payload.kind, 'cells')
  assert.deepEqual(f.seen[0].payload.cells, [])
  assert.match(f.seen[0].payload.nonce, /^[a-f0-9]{64}$/)
  result.dispose()
  assert.equal(f.frame.removed, true)
  assert.equal(f.listeners.has('message'), false)
})

test('A3i-Msg2 never sends Owner selections/Node IDs/pixels, and emits only reauthorization intent', () => {
  const f = fixture()
  const result = xDriveMountBaiduIsolatedFrame(f.options)
  assert.ok(result)
  f.childListeners.get('load')()
  const secretSelection = Object.freeze({node_id:192, jwt:'secret', photo_url:'/owner/private.jpg'})
  assert.equal(result.replaceAuthorizedCells([{
    latitude:35.4,longitude:139.5,count:8,selection:secretSelection,
  }]), true)
  assert.equal(f.seen.length, 1, 'not sent before exact child ready')
  f.emit('ready')
  assert.equal(f.seen.length, 2)
  const msg = f.seen.at(-1).payload
  assert.equal(msg.cells.length, 1)
  assert.deepEqual(Object.keys(msg.cells[0]).sort(), ['count','key','latitude','longitude'])
  assert.equal(msg.cells[0].latitude, 35.4)
  assert.equal(msg.cells[0].count, 8)
  const wire = JSON.stringify(f.seen)
  for (const forbidden of ['secret','/owner/private.jpg','node_id','jwt','photo_url']) {
    assert.equal(wire.includes(forbidden), false, 'private data leaked: '+forbidden)
  }
  f.emit('activate-cell', {key: msg.cells[0].key})
  assert.deepEqual(f.selections, [secretSelection], 'selection stays entirely in parent')
  f.emit('activate-cell', {key: '0'.repeat(32)})
  assert.equal(f.selections.length, 1)
  result.dispose()
})

test('A3i-Msg2 ignores malicious child origin/source/replay/credential fields and invalidates old cells on revoke', () => {
  const f=fixture()
  const result=xDriveMountBaiduIsolatedFrame(f.options)
  assert.ok(result)
  f.childListeners.get('load')()
  f.emit('ready')
  const valid={latitude: 0,longitude:0,count:1,selection: 'authorized-cell-1'}
  assert.equal(result.replaceAuthorizedCells([valid]), true)
  const msg=f.seen.at(-1).payload
  const own={version:1,generation:msg.generation,nonce:msg.nonce,kind:'activate-cell',key:msg.cells[0].key}
  const recv=f.listeners.get('message')
  recv({origin:'https://attacker.example.net',source:f.frame.contentWindow,data:own})
  recv({origin:f.options.childOrigin,source:{},data:own})
  recv({origin:f.options.childOrigin,source:f.frame.contentWindow,data:{...own,nonce:'0'.repeat(64)}})
  recv({origin:f.options.childOrigin,source:f.frame.contentWindow,data:{...own,jwt:'bad'}})
  assert.deepEqual(f.selections,[])
  f.emit('camera',{camera:{coordinate_space:'bd09ll',latitude:39,longitude:116,zoom:12}})
  assert.equal(f.cameras.length,1)
  f.emit('camera',{camera:{coordinate_space:'wgs84',latitude:39,longitude:116,zoom:12}})
  assert.equal(f.cameras.length,1)
  assert.equal(result.replaceAuthorizedCells([{...valid,count:0}]),false,
    'new invalid receipt must revoke previous accepted keys')
  assert.deepEqual(f.seen.at(-1).payload.cells,[])
  f.emit('activate-cell',{key:own.key})
  assert.deepEqual(f.selections,[])
  assert.equal(result.replaceAuthorizedCells([valid]),true)
  f.emit('cancel')
  assert.equal(f.cancels.length,1)
  result.dispose()
  recv({origin:f.options.childOrigin,source:f.frame.contentWindow,data:own})
  assert.deepEqual(f.selections,[])
})

test('A3i-Msg2 bounded randomized keys, no static credentials or same-document provider injection', () => {
  const f=fixture()
  const result=xDriveMountBaiduIsolatedFrame(f.options)
  assert.ok(result)
  f.childListeners.get('load')()
  f.emit('ready')
  const cells=Array.from({length:64},(_,i)=>({latitude:35,longitude:139,count:i+1,selection:i}))
  assert.equal(result.replaceAuthorizedCells(cells),true)
  assert.equal(f.seen.at(-1).payload.cells.length,64)
  const keys=f.seen.at(-1).payload.cells.map(x=>x.key)
  assert.equal(new Set(keys).size,64)
  assert.equal(result.replaceAuthorizedCells(cells.concat(cells[0])),false)
  assert.deepEqual(f.seen.at(-1).payload.cells,[])
  for(const unsafe of ['document.cookie','localStorage','sessionStorage','window.BMap',
    '.appendChild(script)','Authorization:','Bearer ']) {
    assert.equal(hostSource.includes(unsafe),false,'unexpected credential/SDK source: '+unsafe)
  }
  assert.match(hostSource,/No user URL, no data\/blob\/file: iframe/)
  result.dispose()
})

test('isolated frame restores valid BD09 camera only after Child map-ready', () => {
  const fixtureMap=fixture(),frame=xDriveMountBaiduIsolatedFrame(fixtureMap.options)
  assert.ok(frame)
  const camera={coordinate_space:'bd09ll',latitude:35.5,longitude:139.4,zoom:13}
  assert.equal(frame.restoreCamera(camera),false,'no camera before handshake')
  fixtureMap.childListeners.get('load')()
  fixtureMap.emit('ready')
  assert.equal(frame.restoreCamera(camera),false,'SDK must signal map-ready')
  fixtureMap.emit('map-ready')
  assert.equal(frame.restoreCamera(camera),true)
  const packet=fixtureMap.seen.at(-1)
  assert.equal(packet.targetOrigin,fixtureMap.options.childOrigin)
  assert.deepEqual(packet.payload.camera,camera)
  assert.equal(packet.payload.kind,'restore-camera')
  assert.equal(JSON.stringify(packet).includes('owner'),false)
  assert.equal(frame.restoreCamera({...camera,coordinate_space:'wgs84'}),false)
  assert.equal(frame.restoreCamera({...camera,originalGPS:'private'}),false)
  const sent=fixtureMap.seen.length
  frame.dispose()
  assert.equal(frame.restoreCamera(camera),false)
  assert.equal(fixtureMap.seen.length,sent)
})

test('host rotates iframe challenge on reload, ignores ready replay, and bounds untrusted viewport bursts', async () => {
  const f=fixture()
  const received={ready:0,mapReady:0,cancel:0,viewports:[]}
  f.options.onReady=()=>{ received.ready++ }
  f.options.onMapReady=()=>{ received.mapReady++ }
  f.options.onCancel=()=>{ received.cancel++ }
  f.options.onViewport=bounds=>{ received.viewports.push(bounds) }
  const frame=xDriveMountBaiduIsolatedFrame(f.options)
  assert.ok(frame)
  f.childListeners.get('load')()
  const old=f.seen.at(-1).payload
  f.emit('ready')
  f.emit('ready')
  assert.equal(received.ready,1,'replayed ready may not mint a second ticket')
  const first={coordinate_space:'bd09ll',west:100,east:101,south:30,north:31}
  const latest={coordinate_space:'bd09ll',west:105,east:107,south:35,north:36}
  f.emit('viewport',{bounds:first})
  assert.equal(received.viewports.length,0,'viewport before map-ready is not trusted')
  f.emit('map-ready')
  f.emit('map-ready')
  assert.equal(received.mapReady,1,'duplicate SDK-ready events must be inert')
  for(let i=0;i<20;i++)f.emit('viewport',{bounds:i===19?latest:first})
  assert.equal(received.viewports.length,0,'no synchronous burst of Owner SQL reads')
  await new Promise(resolve=>setTimeout(resolve,155))
  assert.deepEqual(received.viewports,[latest],'only the final current viewport is queried')
  f.emit('viewport',{bounds:first})
  f.emit('cancel')
  assert.equal(received.cancel,1,'Go Abort begins immediately, not after debounce')
  await new Promise(resolve=>setTimeout(resolve,155))
  assert.deepEqual(received.viewports,[latest],'cancel must discard queued viewport')
  f.childListeners.get('load')()
  const current=f.seen.at(-1).payload
  assert.notEqual(current.nonce,old.nonce,'new iframe load must rotate nonce')
  assert.notEqual(current.generation,old.generation,'old generation must be rejected')
  const receive=f.listeners.get('message')
  const packet=shape=>receive({origin:f.options.childOrigin,source:f.frame.contentWindow,
    data:{version:1,kind:'ready',...shape}})
  packet({generation:old.generation,nonce:old.nonce})
  assert.equal(received.ready,1,'old child must not reenter after reload')
  packet({generation:current.generation,nonce:current.nonce})
  assert.equal(received.ready,2,'new challenge is permitted exactly once')
  packet({generation:current.generation,nonce:current.nonce})
  assert.equal(received.ready,2,'new ready cannot be replayed')
  frame.dispose()
})

test('trusted Owner photo-cover projections never release media IDs to independent Child', () => {
  const f=fixture()
  const projected=[]
  f.options.onProjectedCells=value=>projected.push(value)
  const frame=xDriveMountBaiduIsolatedFrame(f.options)
  assert.ok(frame)
  f.childListeners.get('load')()
  f.emit('ready')
  const selection={node_id:42,node_revision:7,asset_id:90,jwt:'private'}
  assert.equal(frame.replaceAuthorizedCells([{latitude:35,longitude:139,count:20,selection}]),true)
  const packet=f.seen.at(-1).payload
  const key=packet.cells[0].key
  assert.equal(JSON.stringify(packet).includes('node_id'),false)
  f.emit('cell-projections',{width:640,height:480,points:[{key,x:150,y:210}]})
  assert.equal(projected.at(-1).cells.length,0,'before map-ready pixels are rejected')
  f.emit('map-ready')
  f.emit('cell-projections',{width:640,height:480,points:[{key,x:150,y:210}]})
  assert.deepEqual(projected.at(-1),{width:640,height:480,
    cells:[{selection,count:20,x:150,y:210}]})
  const before=projected.length
  f.emit('cell-projections',{width:640,height:480,points:[{key:'c'.repeat(32),x:10,y:10}]})
  f.emit('cell-projections',{width:640,height:480,points:[{key,x:-1,y:20}]})
  f.emit('cell-projections',{width:640,height:480,points:[{key,x:10,y:20,node_id:42}]})
  assert.equal(projected.length,before,'forged stale IDs or pixels may not publish covers')
  f.emit('cancel')
  assert.deepEqual(projected.at(-1),{width:0,height:0,cells:[]})
  f.emit('cell-projections',{width:640,height:480,points:[{key,x:150,y:210}]})
  assert.equal(projected.at(-1).cells.length,0,'revoked keys never reactivate')
  frame.dispose()
})
