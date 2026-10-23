#!/usr/bin/env node
'use strict'
// Same-runner n=3 genuine Gin/PG17/CAS 100k logical normal Web A/B.
// Summarizes ONLY anonymized metrics from the unchanged P0-C2b2 fixture.
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const beforeSHA='84ef0076506b958001369bb173f221418bf4833a'
const afterSHA='7515c421412666893e4b0519e4b5869d988bf8e1'
assert.equal(process.argv.length,5,'exactly beforeDir afterDir outFile')
function read(dir,name){
 const file=path.resolve(dir,name),root=path.resolve(dir)
 assert(file.startsWith(root+path.sep),'unsafe relative result path')
 const stat=fs.lstatSync(file)
 assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<2*1024*1024)
 return JSON.parse(fs.readFileSync(file,'utf8'))
}
function median(xs){
 assert.equal(xs.length,3)
 assert(xs.every(x=>Number.isFinite(x)&&x>=0))
 return [...xs].sort((a,b)=>a-b)[1]
}
function load(dir){
 const summary=read(dir,'summary.json')
 assert(summary.passed&&summary.spaMode&&summary.mobileCancelMode&&summary.sampleCount===3)
 assert.equal(summary.cssWindowWidth,390)
 assert(summary.worstGoContextMaxMs<=160)
 const samples=[1,2,3].map(i=>read(dir,'sample-'+i+'.json'))
 for(const row of samples){
  assert(row.logicalAssets===100000&&row.physicalNodes===115000)
  assert(row.spaMode&&row.scroll.kind==='same-document-app-route')
  assert(row.streamCount>=4&&row.streamCount<=6)
  assert(row.go.contextDone===row.streamCount&&row.go.canceled===row.streamCount)
  assert(row.go.stillActiveAt160ms===0&&row.go.wastedBytesAfterScroll===0)
  assert(row.go.worstContextNotificationMs<=160)
  assert(row.resources.go.peakGrowthBytes<=128*1024*1024)
  assert(row.resources.renderer.peakGrowthBytes<=128*1024*1024)
 }
 return {originalVerified:true,samples:3,mediaAssets:100000,metadataNodes:115000,
  goCancelP50Ms:median(samples.map(s=>s.go.worstContextNotificationMs)),
  goCancelMaxMs:Math.max(...samples.map(s=>s.go.worstContextNotificationMs)),
  goPeakRSSGrowthP50MiB:Number((median(samples.map(s=>s.resources.go.peakGrowthBytes))/(1<<20)).toFixed(3)),
  rendererPeakRSSGrowthP50MiB:Number((median(samples.map(s=>s.resources.renderer.peakGrowthBytes))/(1<<20)).toFixed(3)),
  goCPUDeltaP50Ms:median(samples.map(s=>s.resources.go.cpuDeltaMs)),
  rendererCPUDeltaP50Ms:median(samples.map(s=>s.resources.renderer.cpuDeltaMs)),
  physicalStreams:samples.map(s=>s.streamCount)}
}
const before=load(process.argv[2]),after=load(process.argv[3])
const summary={schema:'pwa-p1c-real-owner-100k-paired-v1',
 beforeCommit:beforeSHA,afterCommit:afterSHA,
 sameRunner:true,identicalGoSource:true,identicalBrowserBenchmarkSource:true,
 authenticatedGinPG17CAS:true,normalProductionMobileWeb:true,screenWidth:390,
 logical100k:true,metadata115k:true,distinctPhysical100k:false,
 firstViewportPhysicalJPEGStreamsOnly:true,physicalIOS:false,
 measuredAppStartup:false,measuredOwnerGalleryFirstPaint:false,
 before,after,
 goCancelDeltaMs:Number((after.goCancelP50Ms-before.goCancelP50Ms).toFixed(3)),
 claim:'Owner 100k logical Gallery Files SPA Go cancellation and CPU/RSS only; not 100k physical originals or full startup AFTER'}
assert(summary.goCancelDeltaMs<=160)
assert(after.goCPUDeltaP50Ms<=before.goCPUDeltaP50Ms*1.5+100,
 'Go CPU materially regressed in signed 100k route switch')
assert(after.rendererCPUDeltaP50Ms<=before.rendererCPUDeltaP50Ms*1.5+100,
 'Renderer CPU materially regressed in signed 100k route switch')
const output=path.resolve(process.argv[4])
fs.mkdirSync(path.dirname(output),{recursive:true})
fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n',{mode:0o600})
console.log('PWA_P1C_AUTH_100K_PAIRED '+JSON.stringify({
 beforeSHA,afterSHA,goContextBeforeP50:before.goCancelP50Ms,
 goContextAfterP50:after.goCancelP50Ms,
 rendererRSSBeforeMiB:before.rendererPeakRSSGrowthP50MiB,
 rendererRSSAfterMiB:after.rendererPeakRSSGrowthP50MiB,
 authenticatedGinPG17CAS:true,logical100k:true,distinctPhysical100k:false}))
