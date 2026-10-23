#!/usr/bin/env node
'use strict'
// P4F: no browser URLs, Owner IDs, tokens, filenames, original media,
// SQL bindings, or profile paths are copied into this aggregate.
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const order=['A','B','B','A']
function sha(value){
 assert(/^[a-f0-9]{40}$/.test(value||''),'exact source SHA required')
 return value
}
function number(value,label){
 assert(typeof value==='number'&&Number.isFinite(value)&&value>=0,'invalid '+label)
 return value
}
function percentile(values,fraction){
 assert(values.length>0,'missing samples')
 const xs=values.map((v,i)=>number(v,'percentile '+i)).sort((a,b)=>a-b)
 const i=(xs.length-1)*fraction,lo=Math.floor(i),hi=Math.ceil(i)
 return Number((xs[lo]+(xs[hi]-xs[lo])*(i-lo)).toFixed(3))
}
function readSummary(folder){
 const file=path.resolve(folder,'summary.json'),root=path.resolve(folder)
 assert(file.startsWith(root+path.sep),'unsafe sample directory')
 const stat=fs.lstatSync(file)
 assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<1024*1024,
  'bounded immutable numeric summary required')
 const x=JSON.parse(fs.readFileSync(file,'utf8'))
 assert(x.accepted&&x.nativeChromium&&x.physicalIOS===false)
 assert(x.privatePersistentCache===false&&x.privateCacheUnchanged===true)
 assert(x.optimizationImplemented===false&&x.after===null)
 assert.equal(x.status,'P4A-GENUINE-100K-ATTRIBUTION-BEFORE')
 assert.equal(x.n,3);assert.equal(x.pairs,9)
 assert.equal(x.logicalCount,100000);assert.equal(x.physicalCount,115000)
 assert.equal(x.sha,sha(process.env.XD_PR_HEAD))
 assert.equal(x.resourceWaterfallMeasurement?.schema,'xdrive-pwa-p4b-resource-waterfall-v1')
 assert.equal(x.resourceWaterfallMeasurement.deepViewportCount,12)
 assert(Array.isArray(x.samples)&&x.samples.length===3)
 for(const s of x.samples){
   assert(s.pidA!==s.pidB&&s.profilePersisted)
   assert(s.maxActive<=6&&s.goRSSGrowthBytes<=256*1024*1024)
   assert(s.firstHTTP.requests>0&&s.restartedHTTP.requests>0)
   assert(s.firstHTTP.responseBodyBytes>0&&s.restartedHTTP.responseBodyBytes>0)
   assert(s.pairs.length===3)
   assert.deepEqual(s.pairs.map(p=>p.fraction),[0,0.5,0.95])
   for(const p of s.pairs){
     assert(Array.isArray(p.ids)&&p.ids.length===4&&p.ids.every(Number.isSafeInteger))
     number(p.firstMs,'real cold visible');number(p.restartMs,'restart visible')
     number(p.firstPhases.cpu.TaskDuration,'cold TaskDuration')
     number(p.restartPhases.cpu.TaskDuration,'restart TaskDuration')
     number(p.firstPhases.lateDecodeAwaitMs,'cold post-visible decode await')
     number(p.restartPhases.postDecodeTwoRafMs,'restart two rAF')
     if(p.fraction>0) for(const phase of [p.firstPhases,p.restartPhases]){
       assert(phase.resourceWaterfall?.apiRequestsStarted>=1)
       assert(phase.resourceWaterfall?.apiResponsesCompletedBeforeVisible>=1)
     }
   }
 }
 return x
}
function variant(rows){
 const samples=rows.flatMap(r=>r.samples)
 const views=samples.flatMap(s=>s.pairs)
 const deep=views.filter(v=>v.fraction>0)
 const summary={
   coldP50Ms:percentile(views.map(v=>v.firstMs),.5),
   coldP95Ms:percentile(views.map(v=>v.firstMs),.95),
   restartP50Ms:percentile(views.map(v=>v.restartMs),.5),
   restartP95Ms:percentile(views.map(v=>v.restartMs),.95),
   deepColdP50Ms:percentile(deep.map(v=>v.firstMs),.5),
   deepColdP95Ms:percentile(deep.map(v=>v.firstMs),.95),
   deepRestartP50Ms:percentile(deep.map(v=>v.restartMs),.5),
   deepRestartP95Ms:percentile(deep.map(v=>v.restartMs),.95),
   browserTaskP50Ms:percentile(views.map(v=>v.restartPhases.cpu.TaskDuration),.5),
   browserApiTtfbP95Ms:percentile(rows.map(r=>number(
     r.resourceWaterfallMeasurement.medianViewportTtfbP95Ms,'browser TTFB')),.5),
   lastThumbnailStartP50Ms:percentile(rows.map(r=>number(
     r.resourceWaterfallMeasurement.latestThumbnailStartP50Ms,'last thumbnail')),.5),
   goPeakRSSGrowthMiB:Number((Math.max(...samples.map(s=>s.goRSSGrowthBytes))/(1024*1024)).toFixed(3)),
   goFirstHTTPRequests:samples.reduce((n,s)=>n+s.firstHTTP.requests,0),
   goRestartHTTPRequests:samples.reduce((n,s)=>n+s.restartedHTTP.requests,0),
   goFirstResponseBytes:samples.reduce((n,s)=>n+s.firstHTTP.responseBodyBytes,0),
   goRestartResponseBytes:samples.reduce((n,s)=>n+s.restartedHTTP.responseBodyBytes,0),
   nativeChromiumProcesses:samples.length*2,
   independentGoFixtures:samples.length,
   deepViewportSamples:deep.length
 }
 assert.equal(summary.independentGoFixtures,6)
 assert.equal(summary.nativeChromiumProcesses,12)
 assert.equal(summary.deepViewportSamples,12)
 assert(summary.goPeakRSSGrowthMiB<=256)
 return summary
}
function evaluate(folders){
 assert(Array.isArray(folders)&&folders.length===4,'A-B-B-A folders required')
 const runs=folders.map((folder,index)=>({
   label:order[index], summary:readSummary(folder)
 }))
 const before=variant([runs[0].summary,runs[3].summary])
 const after=variant([runs[1].summary,runs[2].summary])
 function reduction(beforeValue,afterValue){
   number(beforeValue,'before');number(afterValue,'after')
   assert(beforeValue>0,'before must be positive')
   return Number(((beforeValue-afterValue)/beforeValue*100).toFixed(3))
 }
 const improvement={
   deepColdP50Percent:reduction(before.deepColdP50Ms,after.deepColdP50Ms),
   deepRestartP50Percent:reduction(before.deepRestartP50Ms,after.deepRestartP50Ms),
   browserApiTtfbP95Percent:reduction(before.browserApiTtfbP95Ms,after.browserApiTtfbP95Ms)
 }
 const regression=after.deepColdP95Ms>before.deepColdP95Ms*1.15+100||
   after.deepRestartP95Ms>before.deepRestartP95Ms*1.15+100||
   after.browserTaskP50Ms>before.browserTaskP50Ms*1.30+60||
   after.goPeakRSSGrowthMiB>256
 const materialBenefit=improvement.deepColdP50Percent>=5||
   improvement.deepRestartP50Percent>=5
 const result={
   schema:'xdrive-pwa-p4f-native-owner100k-chromium-abba-v1',
   testCommit:sha(process.env.XD_PR_HEAD),
   beforeGoCommit:sha(process.env.XD_P4F_BEFORE_SHA),
   afterGoCommit:sha(process.env.XD_P4F_AFTER_SHA),
   frozenWebSourceTree:sha(process.env.XD_P4F_WEB_TREE),
   sameRunner:true,sameWebRelease:true,
   order,independentFixturesPerRelease:6,
   logicalAssets:100000,metadataNodes:115000,
   nativeChromium:true,physicalIOS:false,physicalAndroid:false,
   privatePersistentCache:false,
   before,after,improvement,
   regression,materialBenefit,
   accepted:!regression&&materialBenefit,
   caveat:'Genuine Chromium 390px/Go/PG17/CAS paired synthetic fixture. Four visible Blob images, not all 100k originals. Browser TTFB mixes queues, network and Go. Limited synthetic/runner scope. Go route-cancel race is not measured here.'
 }
 // This is a true result gate, not a claim of speedup simply because the SQL
 // candidate was faster in a separate test. Inconclusive/worse => RED.
 assert(!regression,'measured 100k Chromium performance/resource regression')
 assert(materialBenefit,'no >=5% deep visible P50 improvement in genuine Chrome')
 return result
}
if(require.main===module){
 try{
   assert.equal(process.argv.length,7,'four folders and one summary path required')
   const result=evaluate(process.argv.slice(2,6))
   const output=path.resolve(process.argv[6])
   fs.mkdirSync(path.dirname(output),{recursive:true})
   fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600})
   console.log('PWA_P4F_REAL_CHROMIUM_ABBA '+JSON.stringify({
     testCommit:result.testCommit,goBefore:result.beforeGoCommit,goAfter:result.afterGoCommit,
     improvement:result.improvement,regression:result.regression,
     accepted:result.accepted,physicalIOS:false,materialBenefit:result.materialBenefit
   }))
 }catch(e){console.error('PWA_P4F_FAILED '+(e.stack||e));process.exitCode=1}
}
module.exports={evaluate,readSummary,variant,percentile}
