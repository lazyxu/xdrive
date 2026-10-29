'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const source = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')

test('both SDK Hosts recheck only an accepted EMPTY Owner map at a bounded visible interval', () => {
  assert.match(source,/xDriveMountBaiduInlineMap/)
  assert.match(source,/xDriveMountBaiduIsolatedFrame/)
  assert.match(source,/const recheckEmptyMap = phase === 'ready' && scopeIsCurrent &&/)
  assert.match(source,/trustedSummary\?\.total_count === 0 && !activeDrawer/)
  assert.match(source,/if \(!recheckEmptyMap\) return/)
  assert.match(source,/setInterval\(\(\) => \{/)
  assert.match(source,/ownerDocument\.visibilityState === 'hidden'/)
  assert.match(source,/refreshFilteredCells\.current\?\.\(true\)/)
  assert.match(source,/\}, 120_000\)/)
  assert.match(source,/return \(\) => clearInterval\(timer\)/)
  assert.match(source,/\}, \[recheckEmptyMap, currentFilterKey\]\)/)
  assert.match(source,/data-xdrive-places-empty-map-recheck/)
  assert.match(source,/onClick=\{\(\) => refreshFilteredCells\.current\?\.\(true\)\}/)
  assert.match(source,/刷新定位照片/)
  const effect = source.slice(source.indexOf('  const recheckEmptyMap ='),
    source.indexOf('  // Revoke stale SDK pins'))
  assert.doesNotMatch(effect,/mintChildTicket|beginAuthorizedInlineSession|ForwardWGS84|fetch\(/)
})

test('empty-map refresh reuses the original scoped Camera and never steals an in-flight request', () => {
  const start=source.indexOf('    refreshFilteredCells.current=(skipPending=false)=>{')
  const end=source.indexOf('    const acquireTicket=async()',start)
  assert.ok(start>0 && end>start)
  const handler=source.slice(start,end)
  const run=(options={})=>{
    const visited=[]
    const b={coordinate_space:'bd09ll',west:116,south:39,east:117,north:40}
    const refreshFilteredCells={current:null}
    const args={
      refreshFilteredCells,lifetime:{signal:{aborted:false}},failed:false,
      lastViewport:{current:{bounds:b,live:true}},
      activeQuery:null,acceptedScope:{current:{key:'owner:favorite'}},
      failedCellsScopeRef:{current:null},scope:'owner-one',
      filterRef:{current:{key:'owner:favorite'}},
      initialWorldEmpty:false,cameraTouched:true,
      queryCells:(bounds,live)=>{visited.push({bounds,live});return Promise.resolve(true)},
      ...options,
    }
    const names=Object.keys(args)
    new Function(...names,handler)(...names.map(name=>args[name]))
    return {visited,handler:refreshFilteredCells.current,bounds:b}
  }
  const fresh=run()
  fresh.handler(true)
  assert.deepEqual(fresh.visited,[{bounds:fresh.bounds,live:true}])
  assert.notEqual(fresh.visited[0].bounds,fresh.bounds,
    'the existing signed bounds must be copied before querying')
  // When initial worldwide Cells were empty and the camera was untouched,
  // the next automatic probe must look worldwide, not at SDK's default
  // local camera (which could miss every newly converted Owner photo).
  const discovering=run({initialWorldEmpty:true,cameraTouched:false})
  discovering.handler(true)
  assert.deepEqual(discovering.visited,[{bounds:{
    coordinate_space:'bd09ll',west:-180,south:-85,east:180,north:85,
  },live:false}])
  const pending=run({activeQuery:{}})
  pending.handler(true)
  assert.equal(pending.visited.length,0,
    'automatic recheck never cancels a more recent camera request')
  const changed=run({acceptedScope:{current:{key:'prior'}}})
  changed.handler(true)
  assert.equal(changed.visited.length,0,'a different Owner/photo filter cannot poll')
  const recover=run({acceptedScope:{current:null},
    failedCellsScopeRef:{current:{owner:'owner-one',key:'owner:favorite'}}})
  recover.handler(true)
  assert.equal(recover.visited.length,1,
    'only a previously failed exact Owner filter may retry without accepted Cells')
  const otherScope=run({acceptedScope:{current:null},
    failedCellsScopeRef:{current:{owner:'owner-one',key:'owner:previous'}}})
  otherScope.handler(true)
  assert.equal(otherScope.visited.length,0,'never retry an old Owner/album filter')
  const otherOwner=run({acceptedScope:{current:null},
    failedCellsScopeRef:{current:{owner:'owner-two',key:'owner:favorite'}}})
  otherOwner.handler(true)
  assert.equal(otherOwner.visited.length,0,
    'even matching filter keys cannot retry across Owner sessions')
  const aborted=run({lifetime:{signal:{aborted:true}}})
  aborted.handler(true)
  assert.equal(aborted.visited.length,0)
  const absent=run({lastViewport:{current:null}})
  absent.handler(true)
  assert.equal(absent.visited.length,0)
  const stopped=run({failed:true})
  stopped.handler(true)
  assert.equal(stopped.visited.length,0)
  // Explicit filter changes can still cancel/restart their older read.
  const filtering=run({activeQuery:{}})
  filtering.handler()
  assert.equal(filtering.visited.length,1)
})

test('manual refresh and empty-map interval never widen Owner scope or call the third-party SDK', () => {
  const refresh=source.slice(source.indexOf('    refreshFilteredCells.current=(skipPending=false)=>{'),
    source.indexOf('    const acquireTicket=async()'))
  assert.match(refresh,/acceptedScope\.current\?\.key!==filterRef\.current\.key/)
  assert.match(refresh,/const worldwideDiscovery = skipPending && initialWorldEmpty && !cameraTouched/)
  assert.match(refresh,/void queryCells\(bounds,worldwideDiscovery \? false : last\.live\)/)
  assert.match(source,/let cameraTouched = Boolean\(returnCamera\)/)
  const callback=source.slice(source.indexOf('      onCancel:()=>{'),
    source.indexOf('      onCamera:',source.indexOf('      onCancel:()=>{')))
  assert.match(callback,/cameraTouched=true/)
  assert.match(callback,/const resized=Boolean/)
  assert.match(callback,/pendingResizeDrawer\.current=null/)
  assert.match(callback,/cancel\(Boolean\(keepVisual\)\)/,
    'gesture and resize must unconditionally invalidate old Camera and Cells')
  assert.match(source,/const refocus = !liveCamera && initialWorldEmpty && !cameraTouched/)
  assert.match(source,/queueMicrotask\(\(\) => \{/)
  assert.match(source,/frame\.restoreCamera\(\{coordinate_space:'bd09ll'/)
  assert.match(source,/run !== generation \|\| approved\.key!==filterRef\.current\.key/)
  assert.doesNotMatch(refresh,/listOwnerCellItems|xDriveMount|bootstrapMapSession/)
  const query=source.slice(source.indexOf('    const queryCells = async'),
    source.indexOf('    refreshFilteredCells.current='))
  assert.match(query,/cancel\(Boolean\(keepVisual\)\)/)
  assert.match(query,/gesturePresentationRef\.current\?\.owner/)
  assert.match(query,/frame\.replaceAuthorizedCells\(\[\]\)/)
  assert.match(query,/frame\.replaceAuthorizedCells\(\[\]\)/)
  assert.match(query,/await listOwnerCells\(bounds,request\.signal,/)
  assert.match(query,/approved\.key!==filterRef\.current\.key/)
  assert.match(query,/xDriveValidBaiduNativeCellsPage\(page,bounds\)/)
  assert.match(query,/frame\.replaceAuthorizedCells\(cells\)/)
  const child=read('deploy/baidu-isolated-child/child.js')
  assert.doesNotMatch(child,/getMediaThumbnail|loadThumbnail|PhotoAsset/)
})

test('real Chromium replays only actual 120s visible Parent poll in both SDK Hosts',()=>{
  const driver=read('desktop/scripts/gallery-places-dual-host-chromium.cjs')
  const start=driver.indexOf('async function testAutomaticBD09VisibilityRecheck(')
  const end=driver.indexOf('// Post-ready Server /cells failure',start)
  assert.ok(start>0&&end>start)
  const proof=driver.slice(start,end)
  assert.match(proof,/page\.addInitScript\(/)
  assert.match(proof,/if\(window\.top!==window\)return/)
  assert.match(proof,/interval===120000/)
  assert.match(proof,/__xdriveBD09SyntheticHidden=true/)
  assert.match(proof,/__xdriveBD09SyntheticHidden=false/)
  assert.match(proof,/__xdriveBD09IntervalTick\(\)/)
  assert.match(proof,/__xdriveBD09IntervalStopped/)
  assert.match(proof,/q\.bounds\.west===-180\s*&&\s*q\.bounds\.east===180/)
  assert.match(proof,/owner\?\.total===9&&owner\?\.items===9/)
  assert.match(proof,/start a new Owner read/)
  assert.doesNotMatch(proof,/\[data-xdrive-places-empty-map-recheck\]'\)\.click\(/)
  assert.doesNotMatch(proof,/mintChildTicket|localStorage|sessionStorage/)
  assert.match(driver,/await testAutomaticBD09VisibilityRecheck\(browser,'inline',port\)/)
  assert.match(driver,/await testAutomaticBD09VisibilityRecheck\(browser,'isolated',port\)/)
})
