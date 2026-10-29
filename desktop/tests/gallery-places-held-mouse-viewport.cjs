'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const inlinePath='ui/shared/src/media-gallery-baidu-inline-map-host.ts'
const childPath='deploy/baidu-isolated-child/child.js'
const browserPath='desktop/scripts/gallery-places-dual-host-chromium.cjs'
const read=name=>fs.readFileSync(path.join(root,name),'utf8')
const inline=read(inlinePath),child=read(childPath),browser=read(browserPath)

function snippet(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length)
  assert.ok(a>=0&&b>a,'real SDK host lifecycle not found')
  return source.slice(a,b)
}
function makeHost(kind){
  const isInline=kind==='inline',source=isInline?inline:child
  const part=isInline
    ? snippet(source,'  const scheduleViewport = () => {',
      '  // A responsive container')
    : snippet(source,'  const scheduleViewport = () => {',
      '  const refreshChangedSize = () => {')
  const compiled=isInline
    ? ts.transpileModule(part,{fileName:inlinePath,reportDiagnostics:true,
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
    : {outputText:part,diagnostics:[]}
  assert.deepEqual((compiled.diagnostics||[]).filter(x=>
    x.category===ts.DiagnosticCategory.Error),[])

  const state={timers:[],viewports:0,invalidations:0,
    canceled:0,projected:0,sent:[],listeners:[]}
  const emitter={addEventListener:(name,fn,capture)=>
    state.listeners.push({name,fn,capture}),
    removeEventListener:()=>{}}
  const canvas={...emitter}
  const browserWindow={...emitter}
  const env={
    projectGesture:()=>{state.projected++},
    emitViewport:()=>{state.viewports++},
    invalidate:()=>{state.invalidations++},
    clearTimer:()=>{},
    clearTimeout:()=>{},
    setTimeout:(callback,ms)=>{
      assert.equal(ms,500)
      state.timers.push(callback)
      return state.timers.length
    },
    canvas,browser:browserWindow,window:browserWindow,
    alive:true,ready:true,disposed:false,active:true,map:{},
    allowedKeys:new Set(['signed-cell']),coveredKeys:new Set(),
    cells:[{key:'signed-cell'}],gestureCells:[],
    clearLabels:()=>{},send:kind=>{state.sent.push(kind)},
  }
  const names=Object.keys(env)
  // Execute the real host functions, not a reimplementation of their gate.
  const declarations=isInline
    ? 'let heldMousePointer=null,viewportAfterMouseRelease=false,pendingViewport=null;\n'
    : 'let heldMousePointer=null,viewportAfterMouseRelease=false,viewportTimer=null;\n'
  const body=declarations+compiled.outputText+'\nreturn {'+
    ' onMousePointerDown,releaseHeldMouse,onMousePointerUp,'+
    ' scheduleViewport,stopViewport,'+
    ' status:()=>({heldMousePointer,viewportAfterMouseRelease})};'
  const host=new Function(...names,body)(...names.map(k=>env[k]))
  if(!isInline)host.onMouseWindowBlur=undefined
  return {host,state}
}
const primaryMouse={isTrusted:true,isPrimary:true,pointerType:'mouse',button:0,pointerId:7}

for(const kind of ['inline','isolated']){
  test(kind+': a trusted mouse drag never sends Owner /cells before release',()=>{
    const {host,state}=makeHost(kind)
    host.onMousePointerDown(primaryMouse)
    assert.equal(host.status().heldMousePointer,7)
    host.stopViewport()
    host.scheduleViewport() // early SDK moveend while pointer remains down
    assert.equal(state.timers.length,0,'no settled-camera timer under held mouse')
    assert.equal(state.viewports,0,'no Owner Cell read during held drag')
    assert.equal(host.status().viewportAfterMouseRelease,true)
    if(kind==='inline') assert.equal(state.invalidations,1)
    else assert.deepEqual(state.sent,['cancel'])
    // Wrong pointer's release may never steal the active gesture.
    host.onMousePointerUp({pointerId:99})
    assert.equal(state.timers.length,0)
    host.onMousePointerUp({pointerId:7})
    assert.equal(host.status().heldMousePointer,null)
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)
  })
  test(kind+': early debounced event during actual mouse-down is deferred',()=>{
    const {host,state}=makeHost(kind)
    host.scheduleViewport() // previously scheduled SDK movement
    assert.equal(state.timers.length,1)
    host.onMousePointerDown(primaryMouse)
    state.timers[0]() // fires while button is physically held
    assert.equal(state.viewports,0)
    assert.equal(host.status().viewportAfterMouseRelease,true)
    host.releaseHeldMouse() // blur or a lost-release recovery
    assert.equal(state.timers.length,2)
    state.timers[1]()
    assert.equal(state.viewports,1)
  })
  test(kind+': synthetic or secondary mouse cannot forge held gesture',()=>{
    const {host,state}=makeHost(kind)
    for(const bad of [
      {...primaryMouse,isTrusted:false},
      {...primaryMouse,button:2},
      {...primaryMouse,isPrimary:false},
      {...primaryMouse,pointerType:'touch'},
    ]) host.onMousePointerDown(bad)
    assert.equal(host.status().heldMousePointer,null)
    host.stopViewport()
    host.scheduleViewport()
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)
  })
}
test('two Host lifecycles clean up pointer listeners and preserve protocol isolation',()=>{
  assert.match(inline,/canvas\.addEventListener\('pointerdown', onMousePointerDown, true\)/)
  assert.match(inline,/canvas\.removeEventListener\('pointerdown', onMousePointerDown, true\)/)
  assert.match(inline,/browser\.removeEventListener\('blur', onMouseWindowBlur\)/)
  assert.match(child,/bindMousePointer\(\)/)
  assert.match(child,/releaseMousePointer\(\)/)
  assert.match(child,/canvas\?\.removeEventListener\('pointerdown',onMousePointerDown,true\)/)
  assert.doesNotMatch(child,/\.node_id\b|\.asset_id\b|photo_url|Authorization:/)
  assert.match(browser,/async function testPhotoCoverWhileMouseHeld\(/)
  assert.match(browser,/await testPhotoCoverWhileMouseHeld\(browser,'inline',port\)/)
  assert.match(browser,/await testPhotoCoverWhileMouseHeld\(browser,'isolated',port\)/)
  assert.match(browser,/await page\.mouse\.down\(\)/)
  assert.match(browser,/await page\.waitForTimeout\(700\)/)
  assert.match(browser,/await page\.mouse\.up\(\)/)
})
