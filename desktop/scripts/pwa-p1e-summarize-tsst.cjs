#!/usr/bin/env node
'use strict'
// PWA P1E: frozen single-release route transition T-S-S-T Owner 100k diagnostic.
// This is a source-exact measurement of possible ordering confounds, not a fix.
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const BEFORE='7515c421412666893e4b0519e4b5869d988bf8e1'
const AFTER='7515c421412666893e4b0519e4b5869d988bf8e1'
assert.equal(process.argv.length,7,'require a1 b1 b2 a2 and output pathname')
function safeRead(root,name){
 const base=fs.realpathSync(root)
 const file=path.resolve(base,name)
 assert(file.startsWith(base+path.sep),'unsafe result path')
 const st=fs.lstatSync(file)
 assert(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<2*1024*1024)
 return JSON.parse(fs.readFileSync(file,'utf8'))
}
function med(values){
 assert.equal(values.length,3)
 assert(values.every(x=>Number.isFinite(x)&&x>=0))
 return [...values].sort((a,b)=>a-b)[1]
}
function run(dir,release,index){
 const summary=safeRead(dir,'summary.json')
 assert(summary.passed&&summary.spaMode&&summary.mobileCancelMode&&summary.sampleCount===3)
 assert(summary.cssWindowWidth===390&&summary.worstGoContextMaxMs<=160)
 const originals=[1,2,3].map(i=>safeRead(dir,'sample-'+i+'.json'))
 for(const row of originals){
  assert.equal(row.logicalAssets,100000)
  assert.equal(row.physicalNodes,115000)
  assert(row.spaMode&&row.scroll.kind==='same-document-app-route')
  assert(row.streamCount>=4&&row.streamCount<=6)
  assert(row.go.contextDone===row.streamCount&&row.go.canceled===row.streamCount)
  assert.equal(row.go.stillActiveAt160ms,0)
  assert.equal(row.go.wastedBytesAfterScroll,0)
  assert(row.go.worstContextNotificationMs<=160)
  assert(row.resources.go.peakGrowthBytes<=128*1024*1024)
  assert(row.resources.renderer.peakGrowthBytes<=128*1024*1024)
 }
 return {release,order:index,n:3,logical100k:true,metadata115k:true,
  viewportPhysicalStreams:originals.map(x=>x.streamCount),
  goCancelP50Ms:med(originals.map(x=>x.go.worstContextNotificationMs)),
  goCancelMaxMs:Math.max(...originals.map(x=>x.go.worstContextNotificationMs)),
  rendererRSSP50MiB:Number((med(originals.map(x=>x.resources.renderer.peakGrowthBytes))/1048576).toFixed(3)),
  goRSSP50MiB:Number((med(originals.map(x=>x.resources.go.peakGrowthBytes))/1048576).toFixed(3)),
  rendererCPUP50Ms:med(originals.map(x=>x.resources.renderer.cpuDeltaMs)),
  goCPUP50Ms:med(originals.map(x=>x.resources.go.cpuDeltaMs))}
}
const a1=run(process.argv[2],'transition',1)
const b1=run(process.argv[3],'sync-route',2)
const b2=run(process.argv[4],'sync-route',3)
const a2=run(process.argv[5],'transition',4)
const three=x=>Number(x.toFixed(3))
const difference=(left,right)=>({
 goCancelMs:three(left.goCancelP50Ms-right.goCancelP50Ms),
 rendererRSSMiB:three(left.rendererRSSP50MiB-right.rendererRSSP50MiB),
 goRSSMiB:three(left.goRSSP50MiB-right.goRSSP50MiB),
 rendererCPUMs:three(left.rendererCPUP50Ms-right.rendererCPUP50Ms),
 goCPUMs:three(left.goCPUP50Ms-right.goCPUP50Ms)})
const orderAB=difference(b1,a1),orderBA=difference(b2,a2)
const differenceByOrder=three(orderAB.goCancelMs-orderBA.goCancelMs)
const crossPairMean=three((orderAB.goCancelMs+orderBA.goCancelMs)/2)
const result={schema:'xdrive-pwa-p1e-real-owner-100k-transition-tsst-v1',
 sourceHEAD:process.env.XD_PR_HEAD||'',beforeCommit:BEFORE,afterCommit:AFTER,
 validOriginalSources:true,oneCompiledGoBinary:true,sameRunner:true,
 order:'T-S-S-T',nPerReleaseSession:3,
 genuineOwnerGoPG17CAS:true,physicalIOS:false,distinctPhysical100k:false,
 firstViewportPhysicalJPEGOnly:true,measuredFullStartup:false,measuredFull100kMedia:false,
 productionOptimizationImplemented:false,causalConclusion:'NOT_ESTABLISHED',
 run:[a1,b1,b2,a2],deltaAB:orderAB,deltaBA:orderBA,
 orderDependentGoCancelGapMs:differenceByOrder,
 orderBalancedObservedGoCancelMs:crossPairMean,
 claim:'Same frozen production source with only two test-worktree route transition calls changed; no product code change, no causal claim or complete 100k startup AFTER'}
assert([a1,b1,b2,a2].every(x=>x.goCancelMaxMs<=160))
assert(result.sourceHEAD.match(/^[a-f0-9]{40}$/))
const out=path.resolve(process.argv[6])
const fpPath=path.join(path.dirname(out),'variant-fingerprint.json')
const fp=JSON.parse(fs.readFileSync(fpPath,'utf8'))
assert.equal(fp.sourceRelease,BEFORE)
assert.equal(fp.originalCallCount,2)
assert.equal(fp.productionSourceModified,false)
assert(/^[0-9a-f]{64}$/.test(fp.originalSHA256) && /^[0-9a-f]{64}$/.test(fp.variantSHA256))
assert.notEqual(fp.originalSHA256,fp.variantSHA256)
result.testOnlyTransitionVariant=true
result.variantSHA256=fp.variantSHA256
result.originalSHA256=fp.originalSHA256
result.productionOptimizationImplemented=false
fs.mkdirSync(path.dirname(out),{recursive:true})
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{mode:0o600})
console.log('PWA_P1E_AUTH_OWNER_100K_TRANSITION_TSST '+JSON.stringify({
 sha:result.sourceHEAD,before:BEFORE,after:AFTER,
 AB:orderAB.goCancelMs,BA:orderBA.goCancelMs,observed:crossPairMean,
 causalConclusion:result.causalConclusion}))
