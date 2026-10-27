'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {execFileSync,spawnSync}=require('node:child_process')
const repo=path.resolve(__dirname,'../..')
const script=path.join(repo,'desktop/scripts/pwa-p1-mixed-100k-abba-summary.cjs')
const flow=fs.readFileSync(path.join(repo,'.github/workflows/pwa-p1-mixed-owner-100k-abba.yml'),'utf8')
const before='6d3743c114b03b158efb4fba52338435a9d0be66'
const after='bac65ab3154c50c0c8c0d478a81a1aaa5fd72aa1'

test('heavy ABBA uses reviewed path/branch scope and immutable code/Go source pair',()=>{
  assert.match(flow,/name: PWA P1M Mixed Owner 100k Viewer ABBA/)
  assert.match(flow,/pull_request:\s*\n\s+branches: \[master\]\s*\n\s+paths:/)
  assert.match(flow,/desktop\/tests\/pwa-p1-mixed-100k-abba-contract\.cjs/)
  assert.match(flow,/desktop\/scripts\/pwa-p1-mixed-100k-abba-summary\.cjs/)
  assert.match(flow,/github\.head_ref == 'test\/pwa-p1-mixed-owner-100k-abba-20261027'/)
  assert.match(flow,/cancel-in-progress:.*github\.event_name == 'pull_request'/)
  assert.match(flow,/permissions:\s*\n\s+contents: read/)
  assert.doesNotMatch(flow,/contents: write|pull-requests: write|secrets\./)
  for(const flag of ['XD_PWA_P0C2_SPA_BEFORE','XD_PWA_P1_100K_VIEWER_BACK',
    'XD_PWA_P1_H264_VIEWER_FRAME','XD_PWA_P1_LIVE_MOTION_HOLD',
    'XD_PWA_P1_VIEWER_VIDEO_RANGE_CANCEL'])
    assert.ok(flow.includes(flag),'missing real workload '+flag)
  assert.match(flow,/run_arm before a1[\s\S]*run_arm after b1[\s\S]*run_arm after b2[\s\S]*run_arm before a2/)
  assert.match(flow,/cmp "before\/\$file" "after\/\$file"/)
  assert.match(flow,/desktop\/scripts\/gallery-mobile-web-go-cancel-100k-main\.cjs/)
  assert.match(flow,/\/api\.test/)
  assert.ok(flow.includes(before)&&flow.includes(after))
})

function row(sample,ms) {
  return {
    sample,logicalAssets:100000,physicalNodes:115000,spaMode:true,streamCount:4,
    p1ViewerBack:{passed:true,originalDecodedMs:ms,returnMs:15,
      returned:{sameDocument:true,sameGrid:true,scrollDelta:0}},
    p1H264Frames:{passed:true,presentedFrameDelta:1,presentedMs:ms/3,
      restoredScrollDelta:0},
    p1LiveMotion:{passed:true,frameDelta:2,pausedOnRelease:true,
      stillAfterRelease:true,displayedMs:ms/4,restoredScrollDelta:0},
    p1ViewerRangeAbort:{passed:true,signedPartialContent:1,goContextDone:1,
      stillActiveAt160Ms:0,wastedBytesAfterViewerBack:0,
      restoredScrollDelta:0,goContextMaxMs:65},
    go:{started:4,contextDone:4,canceled:4,stillActiveAt160ms:0,
      wastedBytesAfterScroll:0,worstContextNotificationMs:63},
    resources:{go:{peakGrowthBytes:10485760,cpuDeltaMs:80},
      renderer:{peakGrowthBytes:15728640,cpuDeltaMs:120}},
  }
}
function makeArm(root,name,ms) {
  const dir=path.join(root,name)
  fs.mkdirSync(dir)
  const summary={passed:true,sampleCount:3,cssWindowWidth:390,
    spaMode:true,p1ViewerBackMode:true,p1H264ViewerMode:true,
    p1LiveHoldMode:true,p1ViewerVideoAbortMode:true,
    worstGoContextMaxMs:63,p1ViewerRangeGoMaxMs:65}
  fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary))
  for(let n=1;n<=3;n++)
    fs.writeFileSync(path.join(dir,'sample-'+n+'.json'),JSON.stringify(row(n,ms+n)))
  return dir
}
test('real Node summarizer reports observed AB/BA deltas without causal speedup',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-p1m-valid-'))
  try{
    const arms=[makeArm(dir,'a1',3000),makeArm(dir,'b1',2600),
      makeArm(dir,'b2',2500),makeArm(dir,'a2',3200)]
    const out=path.join(dir,'paired.json')
    execFileSync(process.execPath,[script,...arms,out],
      {env:{...process.env,XD_PR_HEAD:'a'.repeat(40)},encoding:'utf8'})
    const s=JSON.parse(fs.readFileSync(out,'utf8'))
    assert.equal(s.releaseOrder,'A-B-B-A')
    assert.equal(s.runsPerArm,3)
    assert.deepEqual(s.arms.map(a=>a.release),['A','B','B','A'])
    assert.equal(s.beforeCommit,before)
    assert.equal(s.afterCommit,after)
    assert.equal(s.deltaAB.jpegOriginalMs,-400)
    assert.equal(s.deltaBA.jpegOriginalMs,-700)
    assert.equal(s.orderBalancedObservedDelta.jpegOriginalMs,-550)
    assert.equal(s.causalConclusion,'NOT_ESTABLISHED')
    assert.equal(s.materialGainEstablished,false)
    assert.equal(s.physicalOriginals115k,false)
    assert.equal(s.bitwiseDataEqualityVerified,false)
    assert.equal(s.realIOSSafari,false)
    assert.equal(s.arms[0].samples.length,3)
    assert.equal(fs.statSync(out).mode&0o777,0o600)
    assert.doesNotMatch(JSON.stringify(s),/Bearer |Authorization:|access_token|Cookie:/)
    const again=spawnSync(process.execPath,[script,...arms,out],
      {env:{...process.env,XD_PR_HEAD:'a'.repeat(40)},encoding:'utf8'})
    assert.notEqual(again.status,0,'no overwrite of accepted metric artifacts')
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('source-negative fixture refuses stale H264 bytes and cannot emit a fake pass',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-p1m-negative-'))
  try{
    const arms=['a1','b1','b2','a2'].map(s=>makeArm(dir,s,3000))
    const bad=path.join(arms[1],'sample-2.json')
    const data=JSON.parse(fs.readFileSync(bad,'utf8'))
    data.p1ViewerRangeAbort.wastedBytesAfterViewerBack=1
    fs.writeFileSync(bad,JSON.stringify(data))
    const out=path.join(dir,'bad.json')
    const result=spawnSync(process.execPath,[script,...arms,out],
      {env:{...process.env,XD_PR_HEAD:'b'.repeat(40)},encoding:'utf8'})
    assert.notEqual(result.status,0)
    assert.equal(fs.existsSync(out),false)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

test('failed B2 never aborts A2 collection and publishes ONLY sanitized incomplete evidence',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-p1m-four-arms-'))
  try{
    const arms=['a1','b1','b2','a2'].map(name=>makeArm(dir,name,3000))
    for(let i=0;i<4;i++)
      fs.writeFileSync(path.join(arms[i],'exit-code.txt'),i===2?'1\n':'0\n')
    // A real signed H264 Range went over budget on B2 sample 3: preserve
    // the failure WITHOUT promoting the first two B2 samples to valid n3.
    fs.unlinkSync(path.join(arms[2],'sample-3.json'))
    fs.unlinkSync(path.join(arms[2],'summary.json'))
    const bad={
      passed:false,rangeStarted:2,signedPartialContent:2,goContextDone:2,
      stillActiveAt160Ms:0,wastedBytesAfterViewerBack:0,
      goContextMaxMs:193.593,restoredScrollDelta:0,
      activeAtMark:2,requestsStartedAtMark:2,requestsStartedAfter160Ms:3,
      rangeStartsAtMark:2,rangeStartsAfter160Ms:3,
      contextDoneAtMark:0,contextDoneAfter160Ms:2,
      ticket:'PRIVATE_SHOULD_NOT_APPEAR',
    }
    fs.writeFileSync(path.join(arms[2],'private-trace.log'),
      'GALLERY_MOBILE_WEB_GO_CANCEL_100K_ERROR AssertionError [ERR_ASSERTION]: genuine Viewer video Range did not stop Go work: '+
      JSON.stringify(bad)+'\nAuthorization: PRIVATE_SHOULD_NOT_APPEAR\n')
    const out=path.join(dir,'diagnostic.json')
    execFileSync(process.execPath,[script,'--diagnostic',...arms,out],
      {env:{...process.env,XD_PR_HEAD:'c'.repeat(40)},encoding:'utf8'})
    const report=JSON.parse(fs.readFileSync(out,'utf8'))
    assert.equal(report.schema,'xdrive-pwa-p1m-mixed-abba-diagnostic-v1')
    assert.equal(report.allArmsComplete,false)
    assert.deepEqual(report.failedArms,['b2'])
    assert.deepEqual(report.arms.map(a=>a.completedSampleCount),[3,3,2,3])
    assert.equal(report.arms[2].samples[1].sample,2)
    assert.equal(report.arms[2].failureEvidence.goContextMaxMs,193.593)
    assert.equal(report.arms[2].failureEvidence.requestsStartedAtMark,2)
    assert.equal(report.arms[2].failureEvidence.requestsStartedAfter160Ms,3)
    assert.equal(report.arms[2].failureEvidence.newRequestsAfterMark,1)
    assert.equal(report.arms[2].failureEvidence.activeAtMark,2)
    assert.equal(report.arms[2].failureEvidence.contextDoneAfter160Ms,2)
    assert.equal(report.arms[2].failureEvidence.stillActiveAt160Ms,0)
    assert.equal(report.arms[2].failureEvidence.wastedBytesAfterViewerBack,0)
    assert.equal(report.arms[3].complete,true,
      'a2 must remain present, even though b2 failed its original native gate')
    assert.equal(report.causalConclusion,'NOT_ESTABLISHED')
    assert.equal(report.materialGainEstablished,false)
    assert.equal(report.noInvalidSamplesDiscarded,true)
    assert.equal(fs.statSync(out).mode&0o777,0o600)
    assert.doesNotMatch(JSON.stringify(report),/PRIVATE_SHOULD_NOT_APPEAR|Authorization:/)
    const strict=spawnSync(process.execPath,[script,...arms,path.join(dir,'paired.json')],
      {env:{...process.env,XD_PR_HEAD:'c'.repeat(40)},encoding:'utf8'})
    assert.notEqual(strict.status,0,'incomplete B2 must not produce a legitimate paired result')
    assert.equal(fs.existsSync(path.join(dir,'paired.json')),false)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('a successful diagnostic is not itself a performance acceleration claim',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-p1m-valid-diagnostic-'))
  try{
    const arms=['a1','b1','b2','a2'].map(name=>makeArm(dir,name,3000))
    for(const item of arms)
      fs.writeFileSync(path.join(item,'exit-code.txt'),'0\n')
    const out=path.join(dir,'diag.json')
    execFileSync(process.execPath,[script,'--diagnostic',...arms,out],
      {env:{...process.env,XD_PR_HEAD:'d'.repeat(40)},encoding:'utf8'})
    const report=JSON.parse(fs.readFileSync(out,'utf8'))
    assert.equal(report.allArmsComplete,true)
    assert.deepEqual(report.failedArms,[])
    assert.equal(report.materialGainEstablished,false)
    assert.equal(report.causalConclusion,'NOT_ESTABLISHED')
    assert.deepEqual(report.arms.map(a=>a.completedSampleCount),[3,3,3,3])
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

test('native cancellation failures still fail the job after ALL four arms and retain only sanitized artifact paths',()=>{
  assert.match(flow,/run_arm before a1[\s\S]*run_arm after b1[\s\S]*run_arm after b2[\s\S]*run_arm before a2/)
  assert.match(flow,/2>&1 \| tee "\$OUT\/\$label\/private-trace\.log" \|\| status=\$\?/)
  assert.match(flow,/--diagnostic "\$OUT\/a1" "\$OUT\/b1" "\$OUT\/b2" "\$OUT\/a2"/)
  assert.match(flow,/if \(!diagnostic\.allArmsComplete \|\| diagnostic\.failedArms\.length>0\)/)
  assert.match(flow,/process\.exit\(1\)/)
  assert.match(flow,/rm -f "\$input"\/summary\.json "\$input"\/sample-1\.json/)
  assert.match(flow,/run_arm before a2/)
  assert.match(flow,/rm -f "\$OUT"\/a1\/private-trace\.log/)
  assert.match(flow,/pwa-p1m-mixed-abba-results\/diagnostic\.json/)
  assert.doesNotMatch(flow,/pwa-p1m-mixed-abba-results\/\*\*|if-no-files-found: ignore/)
})

test('native Range count-only instrumentation is identical on A and B and fail-closed',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-p1m-instrument-'))
  try{
    const source=fs.readFileSync(
      path.join(repo,'desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs'),'utf8')
    const driver='gallery-mobile-web-go-cancel-100k-main.cjs'
    const both=['before','after'].map(label=>{
      const dest=path.join(dir,label,'desktop','scripts',driver)
      fs.mkdirSync(path.dirname(dest),{recursive:true})
      fs.writeFileSync(dest,source)
      return dest
    })
    const res=execFileSync(process.execPath,[script,'--instrument',...both],{
      encoding:'utf8'
    })
    assert.match(res,/identicalBefore/)
    const changed=fs.readFileSync(both[0],'utf8')
    assert.equal(changed,fs.readFileSync(both[1],'utf8'))
    assert.ok(changed.includes('requestsStartedAtMark:markStats.started'))
    assert.ok(changed.includes('requestsStartedAfter160Ms:after.started'))
    assert.ok(changed.includes('contextDoneAfter160Ms:after.context_done'))
    assert.ok(changed.includes('after.max_cancel_us<=160000'))
    assert.ok(changed.includes("assert(row.passed,'genuine Viewer video Range did not stop Go work: '"))
    assert.equal(fs.readFileSync(
      path.join(repo,'desktop/scripts',driver),'utf8'),source,
      'instrumentation must NOT change the checked-in frozen driver')
    const repeat=spawnSync(process.execPath,[script,'--instrument',...both],{
      encoding:'utf8'
    })
    assert.notEqual(repeat.status,0,'must refuse double instrumentation')
    fs.writeFileSync(both[1],source+'\n// mismatched source')
    const mismatch=spawnSync(process.execPath,[script,'--instrument',...both],{
      encoding:'utf8'
    })
    assert.notEqual(mismatch.status,0,'must refuse A/B harness mismatch')
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('all four arms retain unchanged native threshold and upload only sanitized diagnostics',()=>{
  assert.match(flow,/--instrument\s+\\\n\s+"before\/desktop\/scripts\/gallery-mobile-web-go-cancel-100k-main\.cjs"/)
  assert.match(flow,/node --check after\/desktop\/scripts\/gallery-mobile-web-go-cancel-100k-main\.cjs/)
  assert.match(flow,/run_arm before a1[\s\S]*run_arm after b1[\s\S]*run_arm after b2[\s\S]*run_arm before a2/)
  assert.match(flow,/if \(!diagnostic\.allArmsComplete \|\| diagnostic\.failedArms\.length>0\)/)
})

test('P1M source-exact test overlay tracks Viewer signed ticket SHA256, not other Gallery posters',()=>{
  const runner=path.join(repo,'desktop/scripts/pwa-p1m-signed-range-instrument.cjs')
  const sources=[
    'internal/api/pwa_p1_viewer_video_range_cancel_fixture_test.go',
    'internal/api/gallery_real_web_cold_performance_integration_test.go',
    'desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs',
  ]
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-p1m-ticket-overlay-'))
  const a=path.join(temp,'before'),b=path.join(temp,'after')
  const setup=home=>{
    for(const source of sources){
      const target=path.join(home,source)
      fs.mkdirSync(path.dirname(target),{recursive:true})
      fs.copyFileSync(path.join(repo,source),target)
    }
  }
  try {
    setup(a);setup(b)
    execFileSync(process.execPath,[runner,a,b],{encoding:'utf8'})
    for(const source of sources){
      const left=fs.readFileSync(path.join(a,source),'utf8')
      const right=fs.readFileSync(path.join(b,source),'utf8')
      assert.equal(left,right,'frozen A/B test-only overlay must be byte-identical')
      assert.notEqual(left,fs.readFileSync(path.join(repo,source),'utf8'))
    }
    const go=fs.readFileSync(path.join(a,sources[0]),'utf8')
    const api=fs.readFileSync(path.join(a,sources[1]),'utf8')
    const driver=fs.readFileSync(path.join(a,sources[2]),'utf8')
    assert.match(go,/sha256\.Sum256\(\[\]byte\(r\.URL\.Query\(\)\.Get\("ticket"\)\)\)/)
    assert.match(go,/tickets\s+sync\.Map/)
    assert.match(go,/w\.ticket\.partialContent\.Add\(1\)/)
    assert.match(go,/w\.ticket\.emittedBytes\.Add\(int64\(n\)\)/)
    assert.match(go,/ticket\.contextDone\.Add\(1\)/)
    assert.match(go,/ticket\.cancelled\.Add\(1\)/)
    assert.match(api,/case "\/__perf\/viewer-video-range-target":/)
    assert.match(api,/case "\/__perf\/viewer-video-range-target-stats":/)
    assert.match(api,/hex\.DecodeString\(hash\)/)
    assert.match(api,/targetHash\.Store\(hash\)/)
    assert.match(driver,/crypto\.subtle\.digest/)
    assert.match(driver,/p1BindSignedViewerRangeTicket\(win,base\)/)
    assert.match(driver,/p1ViewerVideoTicketStats\(base\)/)
    assert.match(driver,/const globalVideo=await p1ViewerVideoProbeStats\(base\)/)
    assert.match(driver,/after\.max_cancel_us<=160000/)
    assert.match(driver,/after\.emitted_bytes===markStats\.mark_emitted_bytes/)
    assert.doesNotMatch(driver,/console\.log\([^)]*ticket_hash/)
    new Function('require','process',driver)
    // A real A/B mismatch must fail the overlay's exact SHA comparison,
    // not merely fail because a previously instrumented file was reused.
    const other=path.join(temp,'different-A'),different=path.join(temp,'different-B')
    for(const dir of [other,different]){
      for(const source of sources){
        const target=path.join(dir,source)
        fs.mkdirSync(path.dirname(target),{recursive:true})
        fs.copyFileSync(path.join(repo,source),target)
      }
    }
    fs.appendFileSync(path.join(different,sources[2]),'\n// drifting fixture with valid anchors\n')
    const drift=spawnSync(process.execPath,[runner,other,different],{encoding:'utf8'})
    assert.notEqual(drift.status,0)
    assert.match(drift.stderr,/A\/B instrumentation source must be identical/)
  } finally {fs.rmSync(temp,{recursive:true,force:true})}
})
test('P1M scoped Range instrumentation only applies after frozen source proof',()=>{
  assert.match(flow,/node --check probe\/desktop\/scripts\/pwa-p1m-signed-range-instrument\.cjs/)
  assert.match(flow,/node probe\/desktop\/scripts\/pwa-p1m-signed-range-instrument\.cjs before after/)
  assert.match(flow,/cmp "before\/\$file" "after\/\$file"/)
  assert.match(flow,/gofmt -w before\/internal\/api/)
  assert.match(flow,/node --check before\/desktop\/scripts\/gallery-mobile-web-go-cancel-100k-main\.cjs/)
  assert.match(flow,/XD_PWA_P1_VIEWER_VIDEO_RANGE_CANCEL: '1'/)
  assert.doesNotMatch(flow,/sed -i .*threshold|160000.*200000/)
})
