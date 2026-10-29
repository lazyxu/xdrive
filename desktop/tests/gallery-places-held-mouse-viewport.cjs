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
function makeHost(kind,{empty=false,alreadyGesturing=false}={}){
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
    allowedKeys:new Set(empty||alreadyGesturing?[]:['signed-cell']),
    coveredKeys:new Set(),
    cells:empty||alreadyGesturing?[]:[{key:'signed-cell'}],
    gestureCells:alreadyGesturing?[{key:'signed-cell'}]:[],
    clearLabels:()=>{},send:kind=>{state.sent.push(kind)},
  }
  const names=Object.keys(env)
  // Execute the real host functions, not a reimplementation of their gate.
  const declarations=isInline
    ? 'let heldMousePointer=null,heldTouchPointers=new Set(),pointerOrigins=new Map(),viewportAfterMouseRelease=false,pendingViewport=null;\n'
    : 'let heldMousePointer=null,heldTouchPointers=new Set(),pointerOrigins=new Map(),viewportAfterMouseRelease=false,viewportTimer=null;\n'
  const body=declarations+compiled.outputText+'\nreturn {'+
    ' onMousePointerDown,onMapPointerMove,releaseHeldMouse,onMousePointerUp,onMouseWindowBlur,'+
    ' scheduleViewport,stopViewport,'+
    ' status:()=>({heldMousePointer,touches:[...heldTouchPointers],origins:[...pointerOrigins],viewportAfterMouseRelease})};'
  const host=new Function(...names,body)(...names.map(k=>env[k]))
  // The actual native blur handler is exported in both Host test harnesses.
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
    host.onMousePointerUp({pointerId:99,isTrusted:true})
    assert.equal(state.timers.length,0)
    host.onMousePointerUp({pointerId:7,isTrusted:true})
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
      {...primaryMouse,pointerType:'other'},
    ]) host.onMousePointerDown(bad)
    assert.equal(host.status().heldMousePointer,null)
    host.stopViewport()
    host.scheduleViewport()
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)
  })
}
for(const kind of ['inline','isolated']){
  test(kind+': two real touch contacts defer signed /cells until the LAST release',()=>{
    const {host,state}=makeHost(kind)
    const primary={isTrusted:true,isPrimary:true,
      pointerType:'touch',button:0,pointerId:21}
    const secondary={...primary,isPrimary:false,pointerId:22}
    host.onMousePointerDown(primary)
    host.onMousePointerDown(secondary)
    assert.deepEqual(host.status().touches,[21,22])
    host.stopViewport()
    host.scheduleViewport() // native moveend can precede touchend
    assert.equal(state.timers.length,0)
    assert.equal(state.viewports,0)
    host.onMousePointerUp({pointerId:21,isTrusted:true}) // one finger lifts mid-pinch
    assert.deepEqual(host.status().touches,[22])
    assert.equal(state.timers.length,0)
    host.onMousePointerUp({pointerId:99,isTrusted:true}) // unrelated contact is ignored
    assert.deepEqual(host.status().touches,[22])
    host.onMousePointerUp({pointerId:22,isTrusted:true}) // final finger lifts
    assert.deepEqual(host.status().touches,[])
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)
  })
  test(kind+': cancelled pen and lost window focus release a held viewport',()=>{
    const {host,state}=makeHost(kind)
    const pen={isTrusted:true,isPrimary:true,pointerType:'pen',
      button:0,pointerId:41}
    host.onMousePointerDown(pen)
    host.stopViewport()
    host.scheduleViewport()
    assert.equal(state.viewports,0)
    host.onMousePointerUp({pointerId:41,isTrusted:true}) // pointercancel event path
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)

    const second=makeHost(kind)
    second.host.onMousePointerDown({...pen,pointerId:42})
    second.host.stopViewport()
    second.host.scheduleViewport()
    second.host.releaseHeldMouse() // blur: every held contact is cleared
    assert.deepEqual(second.host.status().touches,[])
    assert.equal(second.state.timers.length,1)
    second.state.timers[0]()
    assert.equal(second.state.viewports,1)
  })
  test(kind+': synthetic touch/pen cannot hold a trusted Owner camera',()=>{
    const {host,state}=makeHost(kind)
    for(const bad of [
      {isTrusted:false,isPrimary:true,pointerType:'touch',button:0,pointerId:4},
      {isTrusted:false,isPrimary:true,pointerType:'pen',button:0,pointerId:5},
      {isTrusted:true,isPrimary:true,pointerType:'touch',button:2,pointerId:6},
    ])host.onMousePointerDown(bad)
    assert.deepEqual(host.status().touches,[])
    host.stopViewport()
    host.scheduleViewport()
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)
  })
}

for(const kind of ['inline','isolated']){
  test(kind+': forged pointerup, cancel and blur cannot end a held signed-camera gesture',()=>{
    const {host,state}=makeHost(kind)
    host.onMousePointerDown(primaryMouse)
    host.stopViewport()
    host.scheduleViewport()
    assert.equal(host.status().heldMousePointer,7)
    assert.equal(state.timers.length,0)

    // Third-party scripts may dispatch an event with the REAL pointer ID.
    // isTrusted is false for such synthetic release/cancel events.
    host.onMousePointerUp({pointerId:7,isTrusted:false,pointerType:'mouse'})
    host.onMousePointerUp({pointerId:7,isTrusted:undefined})
    host.onMouseWindowBlur({isTrusted:false})
    assert.equal(host.status().heldMousePointer,7)
    assert.equal(state.timers.length,0)
    assert.equal(state.viewports,0)

    // Native browser release is still handled and debounced exactly once.
    host.onMousePointerUp({pointerId:7,isTrusted:true,pointerType:'mouse'})
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)

    const touch=makeHost(kind)
    touch.host.onMousePointerDown({isTrusted:true,isPrimary:true,
      pointerType:'touch',button:0,pointerId:21})
    touch.host.stopViewport()
    touch.host.scheduleViewport()
    touch.host.onMousePointerUp({pointerId:21,isTrusted:false})
    assert.deepEqual(touch.host.status().touches,[21])
    assert.equal(touch.state.timers.length,0)
    touch.host.onMouseWindowBlur({isTrusted:true})
    assert.deepEqual(touch.host.status().touches,[])
    assert.equal(touch.state.timers.length,1)
    touch.state.timers[0]()
    assert.equal(touch.state.viewports,1)
  })
}

for(const kind of ['inline','isolated']){
  test(kind+': real drag with missing SDK movestart/moveend still revokes old photos and refreshes on release',()=>{
    const {host,state}=makeHost(kind)
    const start={...primaryMouse,clientX:100,clientY:200}
    host.onMousePointerDown(start)
    const noCancel=()=>kind==='inline'
      ? state.invalidations===0 : state.sent.length===0
    host.onMapPointerMove({...start,clientX:108,clientY:205})
    host.onMapPointerMove({...start,isTrusted:false,clientX:400,clientY:400})
    assert.ok(noCancel(),'a short press or forged move must not invalidate')
    host.onMapPointerMove({...start,clientX:120,clientY:210})
    assert.equal(kind==='inline'?state.invalidations:state.sent.length,1)
    assert.equal(host.status().viewportAfterMouseRelease,true)
    assert.equal(state.timers.length,0)
    // The SDK may omit 'moving' for the entire drag. Reproject every
    // subsequent REAL pointer move without repeating Owner invalidation.
    const firstProjection=state.projected
    assert.ok(firstProjection>0,'first drag must request inert projection')
    host.onMapPointerMove({...start,clientX:140,clientY:230})
    host.onMapPointerMove({...start,clientX:160,clientY:245})
    assert.equal(kind==='inline'?state.invalidations:state.sent.length,1)
    assert.ok(state.projected>=firstProjection+2,
      'every later pointer move must drive existing frame-coalesced projection')
    assert.equal(host.status().origins.length,1,
      'bounded pointer origin is retained through the real drag')
    host.onMousePointerUp({isTrusted:true,pointerId:start.pointerId})
    assert.deepEqual(host.status().origins,[],
      'pointer origin is cleared on real release')
    const projectedAtRelease=state.projected
    host.onMapPointerMove({...start,clientX:190,clientY:265})
    assert.equal(state.projected,projectedAtRelease,
      'late or synthetic motion after release cannot redraw a stale photo')
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)
  })
  test(kind+': missing SDK start must requery even when previous camera had ZERO photos',()=>{
    const {host,state}=makeHost(kind,{empty:true})
    const pen={isTrusted:true,isPrimary:true,
      pointerType:'pen',button:0,pointerId:9,clientX:25,clientY:30}
    host.onMousePointerDown(pen)
    host.onMapPointerMove({...pen,clientX:48,clientY:48})
    assert.equal(kind==='inline'?state.invalidations:state.sent.length,1)
    assert.equal(host.status().viewportAfterMouseRelease,true)
    host.onMousePointerUp({pointerId:9,isTrusted:true})
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)
  })
  test(kind+': an already-invalidated SDK gesture never double-cancels',()=>{
    const {host,state}=makeHost(kind,{alreadyGesturing:true})
    const start={...primaryMouse,clientX:120,clientY:130}
    host.onMousePointerDown(start)
    host.onMapPointerMove({...start,clientX:142,clientY:147})
    assert.equal(kind==='inline'?state.invalidations:state.sent.length,0)
    assert.equal(host.status().viewportAfterMouseRelease,true)
    host.onMousePointerUp({pointerId:start.pointerId,isTrusted:true})
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)
  })
  test(kind+': genuine two-finger movement can start pan without SDK events',()=>{
    const {host,state}=makeHost(kind)
    const first={isTrusted:true,isPrimary:true,
      pointerType:'touch',button:0,pointerId:21,clientX:70,clientY:90}
    const second={...first,isPrimary:false,pointerId:22,clientX:110,clientY:90}
    host.onMousePointerDown(first)
    host.onMousePointerDown(second)
    host.onMapPointerMove({...second,clientX:130,clientY:98})
    assert.equal(kind==='inline'?state.invalidations:state.sent.length,1)
    const touchProjection=state.projected
    host.onMapPointerMove({...second,clientX:145,clientY:111})
    assert.ok(state.projected>touchProjection,
      'a second finger continues the same inert photo re-projection')
    assert.equal(kind==='inline'?state.invalidations:state.sent.length,1)
    host.onMousePointerUp({pointerId:22,isTrusted:true})
    assert.equal(state.timers.length,0,'first released finger never settles camera')
    host.onMousePointerUp({pointerId:21,isTrusted:true})
    assert.equal(state.timers.length,1)
    state.timers[0]()
    assert.equal(state.viewports,1)
  })
  test(kind+': a tap under movement threshold does not cause a needless Owner query',()=>{
    const {host,state}=makeHost(kind)
    const press={...primaryMouse,clientX:100,clientY:100}
    host.onMousePointerDown(press)
    host.onMapPointerMove({...press,clientX:107,clientY:107})
    host.onMousePointerUp({pointerId:press.pointerId,isTrusted:true})
    assert.equal(kind==='inline'?state.invalidations:state.sent.length,0)
    assert.equal(state.timers.length,0)
    assert.equal(state.viewports,0)
  })
}

test('two Host lifecycles clean up pointer listeners and preserve protocol isolation',()=>{
  assert.match(inline,/canvas\.addEventListener\('pointerdown', onMousePointerDown, true\)/)
  assert.match(inline,/canvas\.removeEventListener\('pointerdown', onMousePointerDown, true\)/)
  assert.match(inline,/browser\.removeEventListener\('blur', onMouseWindowBlur\)/)
  assert.match(child,/bindMousePointer\(\)/)
  assert.match(child,/releaseMousePointer\(\)/)
  assert.match(inline,/pointerOrigins\.clear\(\)/)
  assert.match(child,/pointerOrigins\.clear\(\)/)
  assert.match(inline,/browser\.removeEventListener\('pointermove', onMapPointerMove, true\)/)
  assert.match(child,/window\.removeEventListener\('pointermove',onMapPointerMove,true\)/)
  assert.match(child,/canvas\?\.removeEventListener\('pointerdown',onMousePointerDown,true\)/)
  assert.doesNotMatch(child,/\.node_id\b|\.asset_id\b|photo_url|Authorization:/)
  assert.match(browser,/async function testPhotoCoverWhileMouseHeld\(/)
  assert.match(browser,/await testPhotoCoverWhileMouseHeld\(browser,'inline',port\)/)
  assert.match(browser,/await testPhotoCoverWhileMouseHeld\(browser,'isolated',port\)/)
  assert.match(browser,/await page\.mouse\.down\(\)/)
  assert.match(browser,/await page\.waitForTimeout\(700\)/)
  assert.match(browser,/await page\.mouse\.up\(\)/)
})
