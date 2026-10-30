'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')

const root=path.resolve(__dirname,'../..')
const inline=fs.readFileSync(path.join(root,
  'ui/shared/src/media-gallery-baidu-inline-map-host.ts'),'utf8')
const isolated=fs.readFileSync(path.join(root,
  'deploy/baidu-isolated-child/child.js'),'utf8')
const surface=fs.readFileSync(path.join(root,
  'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')

const primary={key:'a'.repeat(32),latitude:36,longitude:117,
  count:9,selection:{node_id:75,node_revision:2,photo_count:9}}
const secondary={key:'b'.repeat(32),latitude:38,longitude:119,
  count:2,selection:{node_id:95,node_revision:1,photo_count:2}}

function makeProjectionHost(kind,results,activeCells=[primary]) {
  const sameOrigin=kind==='inline'
  const source=sameOrigin?inline:isolated
  const start=source.indexOf(sameOrigin
    ? '  const emitProjections = (gesture=false) => {'
    : '  const emitCellProjections = (gesture = false) => {')
  const finish=source.indexOf(sameOrigin
    ? '  const projectGesture = () => {'
    : '  // The SDK owns the actual camera translation/zoom',start)
  assert.ok(start>=0&&finish>start,kind+' real projection source unavailable')
  const part=source.slice(start,finish)
  const transpiled=sameOrigin
    ? ts.transpileModule(part,{fileName:'inline-map-host.ts',
      reportDiagnostics:true,compilerOptions:{
        module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
    : {outputText:part,diagnostics:[]}
  assert.deepEqual((transpiled.diagnostics||[]).filter(d=>
    d.category===ts.DiagnosticCategory.Error),[])
  const canvas={clientWidth:900,clientHeight:700}
  const sdk={Point:class Point{constructor(lng,lat){this.lng=lng;this.lat=lat}}}
  const map={pointToPixel:(point)=>results.get(point.lng)}
  const events=[]
  const args=sameOrigin?{
    alive:true,ready:true,map,sdk,canvas,gestureCells:activeCells,cells:activeCells,
    options:{
      onGestureProjectedCells:event=>events.push({kind:'gesture',event}),
      onProjectedCells:event=>events.push({kind:'current',event}),
    },
  }:{
    active:true,disposed:false,map,sdk,canvas,gestureCells:activeCells,
    cells:activeCells,allowedKeys:new Set(activeCells.map(c=>c.key)),
    send:(kind,event)=>events.push({kind,event}),
  }
  const names=Object.keys(args)
  const exported=sameOrigin?'emitProjections':'emitCellProjections'
  const execute=new Function(...names,transpiled.outputText+
    '\nreturn '+exported+';')
  return {emit:execute(...names.map(k=>args[k])),events}
}
function pixels(values) {
  const results=new Map()
  values.forEach(([cell,value])=>results.set(cell.longitude,value))
  return results
}

for(const kind of ['inline','isolated']){
  test(kind+': transient NaN/throw in every gesture point never clears last inert covers',()=>{
    for(const bad of [{x:NaN,y:NaN},null,()=>{throw Error('moving')}]){
      const results=pixels([[primary,bad]])
      const {emit,events}=makeProjectionHost(kind,{
        get(key){
          const value=results.get(key)
          if(typeof value==='function')return value()
          return value
        },
      })
      emit(true)
      assert.deepEqual(events,[],'no empty projection from transient SDK failure')
      // A normal current (non-gesture) read must still report zero, preventing
      // stale signed photo authority on startup or a new Owner /cells page.
      emit(false)
      assert.equal(events.length,1)
      assert.equal(events[0].kind,kind==='inline'?'current':'cell-projections')
      assert.deepEqual(kind==='inline'
        ? events[0].event.cells : events[0].event.points,[])
    }
  })
  test(kind+': an actually offscreen finite position clears only the visual layer',()=>{
    const {emit,events}=makeProjectionHost(kind,
      pixels([[primary,{x:950,y:340}]]))
    emit(true)
    assert.equal(events.length,1)
    assert.deepEqual(kind==='inline'
      ? events[0].event.cells:events[0].event.points,[])
  })
  test(kind+': first valid frame after glitch restores only verified geometry',()=>{
    const response=pixels([[primary,{x:NaN,y:NaN}]])
    const {emit,events}=makeProjectionHost(kind,response)
    emit(true)
    assert.equal(events.length,0)
    response.set(primary.longitude,{x:155,y:212})
    emit(true)
    assert.equal(events.length,1)
    const pins=kind==='inline'?events[0].event.cells:events[0].event.points
    assert.equal(pins.length,1)
    assert.equal(pins[0].x,155)
    assert.equal(pins[0].y,212)
    if(kind==='inline')assert.strictEqual(pins[0].selection,primary.selection)
    else assert.deepEqual(Object.keys(pins[0]).sort(),['key','x','y'])
  })
  test(kind+': partial invalid result does not suppress the other valid cover',()=>{
    const response=pixels([[primary,{x:NaN,y:NaN}],
      [secondary,{x:251,y:202}]])
    const {emit,events}=makeProjectionHost(kind,response,[primary,secondary])
    emit(true)
    assert.equal(events.length,1)
    const pins=kind==='inline'?events[0].event.cells:events[0].event.points
    assert.equal(pins.length,1)
    assert.equal(pins[0].x,251)
  })
}
test('trusted shared Parent keeps invalidated gesture pixels inert and bounded',()=>{
  assert.match(surface,/gesturePresentation\.owner===\(scope\?\?''\)/)
  assert.match(surface,/gesturePresentation\.key===currentFilterKey/)
  assert.match(surface,/disabled=\{!currentCoverActive\}/)
  assert.match(surface,/aria-hidden=\{!currentCoverActive\}/)
  assert.match(surface,/onClick=\{currentCoverActive/)
  assert.match(inline,/if \(gesture && gestureCells.length>0 && validPixels===0\) return/)
  assert.match(isolated,/if \(gesture && gestureCells.length>0 && validPixels===0\) return/)
  assert.doesNotMatch(isolated,/\.node_id\b|\.asset_id\b|photo_url|Authorization:/)
})


test('fresh signed zero-photo Camera retires old gesture covers in shared Parent',()=>{
  const query=surface.slice(
    surface.indexOf('    const queryCells = async'),
    surface.indexOf('    refreshFilteredCells.current=(skipPending=false)=>{'))
  const signed=query.indexOf('if(!xDriveValidBaiduNativeCellsPage(page,bounds)')
  const accepted=query.indexOf('acceptedCells.current=cells.map(item=>item.selection)')
  const zero=query.indexOf('if (page.total_count === 0 && cells.length === 0) {')
  const summary=query.indexOf('setSummary(page)')
  assert.ok(signed>=0&&accepted>signed&&zero>accepted&&summary>zero,
    'retire gesture only AFTER validated current Owner Cells, before painting empty')
  assert.match(query.slice(zero,summary),
    /committedPresentation\.current=null[\s\S]*?clearGesturePresentation\(\)/)
  assert.match(surface,/const gesturePins=gesturePresentation &&/)
  assert.match(surface,/disabled=\{!currentCoverActive\}/)
  // Both SDK Hosts share this Parent query; neither isolated Child nor
  // same-document Baidu SDK receives photo identity to clear the cover.
  assert.match(surface,/xDriveMountBaiduInlineMap/)
  assert.match(surface,/xDriveMountBaiduIsolatedFrame/)
})
