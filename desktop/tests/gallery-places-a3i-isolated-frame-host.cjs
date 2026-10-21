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
