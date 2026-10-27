#!/usr/bin/env node
'use strict'
// Frozen #2808 source A-B-B-A. This is synthetic 100k Owner mixed media,
// NOT bitwise-equivalent 115k physical originals or real iOS Safari.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const BEFORE='6d3743c114b03b158efb4fba52338435a9d0be66'
const AFTER='bac65ab3154c50c0c8c0d478a81a1aaa5fd72aa1'
const KEYS=['jpegOriginalMs','jpegReturnMs','h264PresentedMs','livePresentedMs',
  'rangeGoCancelMs','galleryGoCancelMs','goRSSMiB','rendererRSSMiB',
  'goCPUMs','rendererCPUMs','galleryRequests']
function safeJSON(folder, name) {
  const base=fs.realpathSync(folder)
  const file=path.resolve(base,name)
  assert(file.startsWith(base+path.sep),'unsafe artifact path')
  const stat=fs.lstatSync(file)
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<3*1024*1024,
    'missing, link or oversized benchmark artifact')
  return JSON.parse(fs.readFileSync(file,'utf8'))
}
function finite(v,k) {
  assert(Number.isFinite(v)&&v>=0,'invalid metric '+k)
  return v
}
function p50(values) {
  assert.equal(values.length,3,'require n3 independent runs per arm')
  return [...values].sort((a,b)=>a-b)[1]
}
const rnd=v=>Number(v.toFixed(3))
function arm(dir,label,release) {
  const s=safeJSON(dir,'summary.json')
  assert(s.passed===true&&s.sampleCount===3&&s.cssWindowWidth===390&&
    s.spaMode===true&&s.p1ViewerBackMode===true&&
    s.p1H264ViewerMode===true&&s.p1LiveHoldMode===true&&
    s.p1ViewerVideoAbortMode===true&&s.worstGoContextMaxMs<=160&&
    s.p1ViewerRangeGoMaxMs<=160,'signed Owner mixed media run invalid')
  const samples=[1,2,3].map(n=>{
    const r=safeJSON(dir,'sample-'+n+'.json')
    assert(r.sample===n&&r.logicalAssets===100000&&r.physicalNodes===115000&&
      r.spaMode===true&&r.streamCount>=4&&r.streamCount<=6,'wrong corpus or mode')
    assert(r.p1ViewerBack?.passed&&r.p1ViewerBack.returned?.sameDocument&&
      r.p1ViewerBack.returned?.sameGrid&&r.p1ViewerBack.returned?.scrollDelta<=2,
      'real JPEG Viewer Back anchor unavailable')
    assert(r.p1H264Frames?.passed&&r.p1H264Frames.presentedFrameDelta>=1&&
      r.p1H264Frames.restoredScrollDelta<=2,'real H264 advancing frames absent')
    assert(r.p1LiveMotion?.passed&&r.p1LiveMotion.frameDelta>=1&&
      r.p1LiveMotion.pausedOnRelease&&r.p1LiveMotion.stillAfterRelease&&
      r.p1LiveMotion.restoredScrollDelta<=2,'Live held motion not verified')
    assert(r.p1ViewerRangeAbort?.passed&&
      r.p1ViewerRangeAbort.signedPartialContent>=1&&
      r.p1ViewerRangeAbort.goContextDone>=1&&
      r.p1ViewerRangeAbort.stillActiveAt160Ms===0&&
      r.p1ViewerRangeAbort.wastedBytesAfterViewerBack===0&&
      r.p1ViewerRangeAbort.restoredScrollDelta<=2,'signed Range cancellation failed')
    assert(r.go?.contextDone===r.streamCount&&r.go?.canceled===r.streamCount&&
      r.go?.stillActiveAt160ms===0&&r.go?.wastedBytesAfterScroll===0&&
      r.go?.worstContextNotificationMs<=160,'old Gallery requests not cancelled')
    const m={
      jpegOriginalMs:r.p1ViewerBack.originalDecodedMs,
      jpegReturnMs:r.p1ViewerBack.returnMs,
      h264PresentedMs:r.p1H264Frames.presentedMs,
      livePresentedMs:r.p1LiveMotion.displayedMs,
      rangeGoCancelMs:r.p1ViewerRangeAbort.goContextMaxMs,
      galleryGoCancelMs:r.go.worstContextNotificationMs,
      goRSSMiB:r.resources.go.peakGrowthBytes/1048576,
      rendererRSSMiB:r.resources.renderer.peakGrowthBytes/1048576,
      goCPUMs:r.resources.go.cpuDeltaMs,
      rendererCPUMs:r.resources.renderer.cpuDeltaMs,
      galleryRequests:r.go.started,
    }
    for(const k of KEYS)finite(m[k],k)
    assert(m.rangeGoCancelMs<=160&&m.galleryGoCancelMs<=160&&
      m.goRSSMiB<=128&&m.rendererRSSMiB<=128,'resource budget exceeded')
    return Object.fromEntries(KEYS.map(k=>[k,rnd(m[k])]))
  })
  return {label,release,commit:release==='A'?BEFORE:AFTER,n:3,
    samples,p50:Object.fromEntries(KEYS.map(k=>[k,rnd(p50(samples.map(s=>s[k])))]))}
}
function difference(newer,older) {
  return Object.fromEntries(KEYS.map(k=>[k,rnd(newer.p50[k]-older.p50[k])]))
}
function main(){
  assert.equal(process.argv.length,7,'usage: script a1 b1 b2 a2 out.json')
  const probe=process.env.XD_PR_HEAD||''
  assert(/^[0-9a-f]{40}$/.test(probe),'missing exact PR HEAD')
  const arms=[
    arm(process.argv[2],'a1','A'),arm(process.argv[3],'b1','B'),
    arm(process.argv[4],'b2','B'),arm(process.argv[5],'a2','A'),
  ]
  const ab=difference(arms[1],arms[0]),ba=difference(arms[2],arms[3])
  const observed=Object.fromEntries(KEYS.map(k=>[k,rnd((ab[k]+ba[k])/2)]))
  const report={
    schema:'xdrive-pwa-p1m-mixed-owner-abba-v1',
    probeCommit:probe,beforeCommit:BEFORE,afterCommit:AFTER,
    releaseOrder:'A-B-B-A',runsPerArm:3,arms,
    runner:{platform:process.platform,architecture:process.arch,
      kernel:os.release(),node:process.version},
    logicalAssets:100000,metadataNodes:115000,
    realGoGinPG17CAS:true,physicalOriginals115k:false,
    sourceFixtureIdentical:true,bitwiseDataEqualityVerified:false,
    realIOSSafari:false,materialGainEstablished:false,
    causalConclusion:'NOT_ESTABLISHED',metrics:KEYS,
    deltaAB:ab,deltaBA:ba,orderBalancedObservedDelta:observed,
    limitations:'The original pinned Go fixture creates 100k logical PhotoAssets and 115k metadata Nodes but only bounded real JPEG/H264/Live originals. No 115k distinct CAS objects, physical iOS Home Screen, per-arm physical-file SHA equality, or independent causal proof. Go/renderer CPU/RSS are sampled in the initial Gallery cancellation segment, not continuously across every subsequent Viewer.',
  }
  const file=path.resolve(process.argv[6])
  fs.mkdirSync(path.dirname(file),{recursive:true})
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'})
  console.log('PWA_P1M_MIXED_ABBA '+JSON.stringify({
    probe,before:BEFORE,after:AFTER,order:report.releaseOrder,n:3,
    observedJPEGMs:observed.jpegOriginalMs,
    observedH264Ms:observed.h264PresentedMs,
    observedLiveMs:observed.livePresentedMs,
    causalConclusion:report.causalConclusion}))
}

/** Evidence-only mode. Keeps failed B2 in the report, then runs the A2
 * arm. It NEVER marks a failed arm valid or changes the native 160ms gate.
 * Trace logs and original media/request fields are not uploaded. */
function diagnostic() {
  assert.equal(process.argv.length,8,
    'usage: script --diagnostic a1 b1 b2 a2 diagnostic.json')
  const probe=process.env.XD_PR_HEAD||''
  assert(/^[0-9a-f]{40}$/.test(probe),'exact probe SHA required')
  const dirs=process.argv.slice(3,7)
  const labels=['a1','b1','b2','a2']
  const arms=dirs.map((dir,i)=>{
    const exitText=fs.readFileSync(path.join(dir,'exit-code.txt'),'utf8').trim()
    assert(/^\d+$/.test(exitText),'native arm exit code missing')
    const exitCode=Number(exitText)
    const summaryPath=path.join(dir,'summary.json')
    const summary=fs.existsSync(summaryPath)?safeJSON(dir,'summary.json'):null
    const samples=[]
    for(let n=1;n<=3;n++){
      const f=path.join(dir,'sample-'+n+'.json')
      if(!fs.existsSync(f))continue
      const row=safeJSON(dir,'sample-'+n+'.json')
      const num=value=>Number.isFinite(value)&&value>=0?rnd(value):null
      samples.push({
        sample:n,
        logicalAssets:row.logicalAssets===100000?100000:null,
        metadataNodes:row.physicalNodes===115000?115000:null,
        validJPEG:row.p1ViewerBack?.passed===true,
        validH264:row.p1H264Frames?.passed===true,
        validLive:row.p1LiveMotion?.passed===true,
        validSignedRange:row.p1ViewerRangeAbort?.passed===true,
        jpegOriginalMs:num(row.p1ViewerBack?.originalDecodedMs),
        h264PresentedMs:num(row.p1H264Frames?.presentedMs),
        livePresentedMs:num(row.p1LiveMotion?.displayedMs),
        signedRangeGoCancelMs:num(row.p1ViewerRangeAbort?.goContextMaxMs),
        emittedBytesAfterCancel:num(row.p1ViewerRangeAbort?.wastedBytesAfterViewerBack),
        galleryGoCancelMs:num(row.go?.worstContextNotificationMs),
        goRSSGrowthMiB:num(row.resources?.go?.peakGrowthBytes/1048576),
        rendererRSSGrowthMiB:num(row.resources?.renderer?.peakGrowthBytes/1048576),
      })
    }
    const traceFile=path.join(dir,'private-trace.log')
    let failureEvidence=null
    if(fs.existsSync(traceFile)){
      const st=fs.lstatSync(traceFile)
      assert(st.isFile()&&!st.isSymbolicLink()&&st.size<30*1024*1024,
        'untrusted trace file size/type')
      const raw=fs.readFileSync(traceFile,'utf8')
      const match=raw.match(/genuine Viewer video Range did not stop Go work: (\{[^\r\n]+\})/)
      if(match){
        try {
          const parsed=JSON.parse(match[1])
          const num=value=>Number.isFinite(value)&&value>=0?rnd(value):null
          failureEvidence={
            category:'signed-H264-Range-Go-cancel-over-budget',
            goContextMaxMs:num(parsed.goContextMaxMs),
            signedPartialContent:num(parsed.signedPartialContent),
            contextDone:num(parsed.goContextDone),
            stillActiveAt160Ms:num(parsed.stillActiveAt160Ms),
            wastedBytesAfterViewerBack:num(parsed.wastedBytesAfterViewerBack),
            restoredScrollDelta:num(parsed.restoredScrollDelta),
          }
        } catch { failureEvidence={category:'invalid-Range-diagnostic'} }
      }
    }
    const sampleCount=samples.length
    const complete=exitCode===0&&sampleCount===3&&summary?.passed===true&&
      summary.sampleCount===3&&samples.every(row=>
        row.logicalAssets===100000&&row.metadataNodes===115000&&
        row.validJPEG&&row.validH264&&row.validLive&&row.validSignedRange&&
        row.signedRangeGoCancelMs!==null&&row.signedRangeGoCancelMs<=160&&
        row.emittedBytesAfterCancel===0)
    return {label:labels[i],release:i===0||i===3?'A':'B',
      sourceCommit:i===0||i===3?BEFORE:AFTER,exitCode,
      completedSampleCount:sampleCount,complete,failed:!complete,
      samples,failureEvidence:complete?null:
        failureEvidence||{category:'native-arm-or-evidence-incomplete'}}
  })
  const failedArms=arms.filter(arm=>arm.failed).map(arm=>arm.label)
  const result={
    schema:'xdrive-pwa-p1m-mixed-abba-diagnostic-v1',
    probeCommit:probe,beforeCommit:BEFORE,afterCommit:AFTER,
    order:'A-B-B-A',nRequiredPerArm:3,arms,failedArms,
    allArmsComplete:failedArms.length===0,
    causalConclusion:'NOT_ESTABLISHED',materialGainEstablished:false,
    physicalOriginals115k:false,realIOSSafari:false,
    noInvalidSamplesDiscarded:true,
    limits:'Diagnostic only. Incomplete/failed arms are never dropped from the balanced comparison. Native signed Range Context.Done remains <=160ms; zero extra bytes and original scroll anchor are mandatory. Only bounded per-sample numeric snapshots and a whitelist of Range error fields are exported.',
  }
  const out=path.resolve(process.argv[7])
  fs.mkdirSync(path.dirname(out),{recursive:true})
  fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',
    {mode:0o600,flag:'wx'})
  console.log('PWA_P1M_MIXED_ABBA_DIAGNOSTIC '+JSON.stringify({
    probe,failedArms,counts:arms.map(a=>a.completedSampleCount),
    causalConclusion:result.causalConclusion}))
}
if(process.argv[2]==='--diagnostic') diagnostic()
else main()
