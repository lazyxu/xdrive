#!/usr/bin/env node
'use strict'
const fs = require('node:fs'), path = require('node:path')
const assert = require('node:assert/strict')
const [a1,b1,b2,a2,out] = process.argv.slice(2)
assert([a1,b1,b2,a2,out].every(Boolean),'four sample directories and result file required')
const read = (dir,file) => {
  const base = fs.realpathSync(dir), target = path.resolve(base,file)
  assert(target.startsWith(base+path.sep),'result traversal')
  const stat = fs.lstatSync(target)
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<2*1024*1024)
  return JSON.parse(fs.readFileSync(target,'utf8'))
}
const median = v => { assert.equal(v.length,3); return [...v].sort((x,y)=>x-y)[1] }
function batch(dir,label){
  const s = read(dir,'summary.json')
  assert(s.passed&&s.spaMode&&s.mobileCancelMode&&s.sampleCount===3)
  assert.equal(s.cssWindowWidth,390)
  const rows=[1,2,3].map(n=>read(dir,'sample-'+n+'.json'))
  for(const r of rows){
    assert.equal(r.logicalAssets,100000)
    assert.equal(r.physicalNodes,115000)
    assert(r.spaMode&&r.scroll.kind==='same-document-app-route')
    assert(r.scroll.galleryUnmounted&&r.scroll.filesMounted)
    assert(r.streamCount>=4&&r.streamCount<=6)
    assert.equal(r.go.started,r.streamCount)
    assert.equal(r.go.contextDone,r.streamCount)
    assert.equal(r.go.canceled,r.streamCount)
    assert.equal(r.go.stillActiveAt160ms,0)
    assert.equal(r.go.wastedBytesAfterScroll,0)
    assert.equal(r.go.wastedBytesAfterAction,0)
    assert(r.go.worstContextNotificationMs<=160,'unacceptable true Go cancel tail')
    assert(r.resources.go.peakGrowthBytes<=128*1024*1024)
    assert(r.resources.renderer.peakGrowthBytes<=128*1024*1024)
  }
  return {label,n:3,goCancelP50Ms:median(rows.map(r=>r.go.worstContextNotificationMs)),
    goCancelMaxMs:Math.max(...rows.map(r=>r.go.worstContextNotificationMs))}
}
const runs=[batch(a1,'A1'),batch(b1,'B1'),batch(b2,'B2'),batch(a2,'A2')]
const delta1=runs[1].goCancelP50Ms-runs[0].goCancelP50Ms
const delta2=runs[2].goCancelP50Ms-runs[3].goCancelP50Ms
const balancedDeltaMs=Number(((delta1+delta2)/2).toFixed(3))
const result={schema:'xdrive-pwa-p1f-resolved-route-paired-v1',head:process.env.XD_PR_HEAD||'',
  baseline:'1fdc58c7c4d99fc634f73199fdead9f57861b3ef',order:'A-B-B-A',
  realGoPG17CAS:true,logicalAssets:100000,physicalNodes:115000,
  runs,delta1,delta2,balancedDeltaMs,physicalIOS:false,
  full100kDistinctOriginals:false,goCancelBudgetMs:160,
  onlyPreviouslyResolvedRoutesSync:true,causalConclusion:'CANDIDATE_NOT_PROVEN'}
fs.mkdirSync(path.dirname(out),{recursive:true})
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n')
console.log('PWA_P1F_REAL_OWNER_100K_RESOLVED_ROUTE '+JSON.stringify(result))
assert(balancedDeltaMs<=-10,'no material balanced cancellation improvement: do not merge')
