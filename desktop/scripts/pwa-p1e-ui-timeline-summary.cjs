'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const OLD='84ef0076506b958001369bb173f221418bf4833a'
const NEW='7515c421412666893e4b0519e4b5869d988bf8e1'
assert.equal(process.argv.length,7,'expect a1 b1 b2 a2 and output')
const median=x=>[...x].sort((a,b)=>a-b)[1]
function read(root,file){
 const base=fs.realpathSync(root),target=path.resolve(base,file)
 assert(target.startsWith(base+path.sep))
 const stat=fs.lstatSync(target)
 assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<2*1024*1024)
 return JSON.parse(fs.readFileSync(target,'utf8'))
}
function one(dir,name,release){
 const s=read(dir,'summary.json')
 assert(s.passed&&s.spaMode&&s.mobileCancelMode&&s.sampleCount===3)
 const runs=[1,2,3].map(n=>read(dir,'sample-'+n+'.json'))
 for(const r of runs){
  assert.equal(r.logicalAssets,100000)
  assert.equal(r.physicalNodes,115000)
  assert(r.spaMode&&r.scroll.kind==='same-document-app-route')
  assert(r.go.started>=4&&r.go.started<=6)
  assert.equal(r.go.contextDone,r.go.started)
  assert.equal(r.go.canceled,r.go.started)
  assert.equal(r.go.wastedBytesAfterAction,0)
  assert(r.go.worstContextNotificationMs<=160)
  for(const key of ['p1eBrowserClickToGalleryUnmountMs','p1eBrowserClickToFilesMountedMs'])
   assert(Number.isFinite(r.scroll[key])&&r.scroll[key]>=0&&r.scroll[key]<2000,
    'genuine in-document timing not observed '+key)
  assert.equal(r.scroll.p1eTimingClock,'browser-performance-now')
 }
 return {name,release,n:3,
  clickToGalleryUnmountP50:median(runs.map(x=>x.scroll.p1eBrowserClickToGalleryUnmountMs)),
  clickToFilesMountedP50:median(runs.map(x=>x.scroll.p1eBrowserClickToFilesMountedMs)),
  goContextDoneP50:median(runs.map(x=>x.go.worstContextNotificationMs)),
  goContextDoneMax:Math.max(...runs.map(x=>x.go.worstContextNotificationMs)),
  noPostCancelBytes:true,actualOwnerGo:true}
}
const runs=[
 one(process.argv[2],'a1',OLD),one(process.argv[3],'b1',NEW),
 one(process.argv[4],'b2',NEW),one(process.argv[5],'a2',OLD)]
function mean(a,b,key){return (a[key]+b[key])/2}
const avg=(key,after)=>after?mean(runs[1],runs[2],key):mean(runs[0],runs[3],key)
const delta=(key)=>Number((avg(key,true)-avg(key,false)).toFixed(3))
const result={schema:'xdrive-pwa-p1e-native-click-unmount-v1',
 sourceHEAD:process.env.XD_PR_HEAD??'',frozenBefore:OLD,frozenAfter:NEW,
 order:'A-B-B-A',nativeChromium:true,genuineOwnerGoPG17CAS:true,
 physicalIOS:false,full100kDistinctMedia:false,productionChanged:false,
 browserClockNotAlignedWithServerClock:true,causalConclusion:'NOT_ESTABLISHED',
 runs,deltaClickToGalleryUnmountMs:delta('clickToGalleryUnmountP50'),
 deltaClickToFilesMountedMs:delta('clickToFilesMountedP50'),
 deltaGoContextDoneMs:delta('goContextDoneP50'),
 allSamplesActualAndCancelled:runs.every(x=>x.noPostCancelBytes&&x.goContextDoneMax<=160)}
assert(/^[a-f0-9]{40}$/.test(result.sourceHEAD))
assert(result.allSamplesActualAndCancelled)
fs.writeFileSync(process.argv[6],JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'})
console.log('PWA_P1E_NATIVE_CLICK_TO_UNMOUNT '+JSON.stringify({
 head:result.sourceHEAD,unmountDeltaMs:result.deltaClickToGalleryUnmountMs,
 filesDeltaMs:result.deltaClickToFilesMountedMs,goDeltaMs:result.deltaGoContextDoneMs,
 causalConclusion:result.causalConclusion}))
