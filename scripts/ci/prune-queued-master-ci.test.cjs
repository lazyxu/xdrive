'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {isUnstartedOrClassifierOnlyJob, completeUnstartedInventory, pruneQueuedMasterCI} = require('./prune-queued-master-ci.cjs')

const sha = c => c.repeat(40)
const snapshot = sha('b'), currentMaster = sha('c'), old = sha('a'), unpublished = sha('d')
function fixture(options={}) {
  const calls = {cancel:[], get:[], compare:[], list:[], jobs:[]}
  const run = (id, head_sha=old, extra={}) => ({
    id, head_sha, status:'queued', run_attempt:1, name:'CI', event:'push', head_branch:'master',
    path:'.github/workflows/ci.yml', created_at:'2026-10-27T03:00:00Z', ...extra,
  })
  const runs=options.runs || [run(1),run(2,currentMaster),run(3,unpublished),run(4,snapshot),run(5,old,{status:'in_progress'}),run(6,old,{event:'pull_request'})]
  const github={rest:{
    repos:{
      getReleaseByTag:async()=>({data:{tag_name:'snapshot',draft:false,prerelease:true,
        name:`xDrive snapshot ${snapshot.slice(0,12)}`,
        body:`Rolling development snapshot from master at \`${options.bodySha||snapshot}\`. Verified assets.`}}),
      getBranch:async()=>({data:{commit:{sha:currentMaster}}}),
      compareCommits:async(args)=>{
        calls.compare.push(args)
        if(args.base===snapshot&&args.head===currentMaster) return {data:{status:'ahead',behind_by:0}}
        if(args.base===old&&args.head===snapshot) return {data:{status:'ahead',behind_by:0}}
        return {data:{status:'diverged',behind_by:1}}
      },
    },
    git:{getRef:async()=>({data:{object:{type:'commit',sha:snapshot}}})},
    actions:{
      listWorkflowRuns:async(args)=>{calls.list.push(args);return {data:{workflow_runs:runs}}},
      getWorkflowRun:async(args)=>{calls.get.push(args);const obj=runs.find(x=>x.id===args.run_id);return {data: options.startedId===args.run_id ? {...obj,status:'in_progress'} : obj}},
      listJobsForWorkflowRun:async(args)=>{
        calls.jobs.push(args)
        if(options.jobsError)throw Object.assign(new Error('job list unavailable'),{status:503})
        const rows=options.jobsById?.[args.run_id] ??
          [{id:1000+args.run_id,run_id:args.run_id,status:'queued',conclusion:null}]
        return {data:{total_count:options.jobsTotalCount ?? rows.length,jobs:rows}}
      },
      cancelWorkflowRun:async(args)=>{calls.cancel.push(args.run_id);return {status:202}},
    }
  }}
  const core={info:()=>{},warning:()=>{}}
  const context={repo:{owner:'lazyxu',repo:'xdrive'},eventName:'workflow_dispatch',payload:{action:'xdrive_snapshot_published'},runId:987}
  return {github,core,context,calls,run,runs}
}

test('only older queued push CI ancestors are cancelled, not latest, unpublished, PR or running', async()=>{
  const t=fixture()
  const result=await pruneQueuedMasterCI(t)
  assert.equal(result.cancelled,1)
  assert.deepEqual(t.calls.cancel,[1])
  assert.equal(t.calls.list[0].workflow_id,'ci.yml')
  assert.equal(t.calls.list[0].status,'queued')
})
test('read-only dry-run never sends cancellations', async()=>{
  const t=fixture()
  const result=await pruneQueuedMasterCI({...t,dryRun:true})
  assert.equal(result.eligible,1)
  assert.equal(result.cancelled,0)
  assert.deepEqual(t.calls.cancel,[])
})
test('a run starting after discovery is preserved', async()=>{
  const t=fixture({startedId:1})
  const result=await pruneQueuedMasterCI(t)
  assert.equal(result.cancelled,0)
  assert.equal(result.audit[0].action,'preserved-changed')
})
test('release notes / public tag mismatch is fail closed', async()=>{
  const t=fixture({bodySha:sha('e')})
  await assert.rejects(pruneQueuedMasterCI(t),/Release notes disagree/)
  assert.equal(t.calls.list.length,0)
})
test('unrelated event and cross-repo cannot use privileged workflow', async()=>{
  const a=fixture();a.context.eventName='pull_request'
  await assert.rejects(pruneQueuedMasterCI(a),/unsupported event/)
  const b=fixture();b.context.repo.repo='other'
  await assert.rejects(pruneQueuedMasterCI(b),/not lazyxu\/xdrive/)
})
test('bounded cancellation budget never exceeds 25', async()=>{
  const t=fixture({runs:Array.from({length:40},(_,i)=>({id:i+1,head_sha:old,status:'queued',run_attempt:1,name:'CI',event:'push',head_branch:'master',path:'.github/workflows/ci.yml',created_at:'2026-10-27T03:00:00Z'}))})
  const r=await pruneQueuedMasterCI(t)
  assert.equal(r.eligible,25)
  assert.equal(r.cancelled,25)
  assert.equal(t.calls.cancel.length,25)
})
test('run with incorrect workflow path or manual event stays untouched', async()=>{
  const t=fixture({runs:[
    {id:1,head_sha:old,status:'queued',run_attempt:1,name:'CI',event:'workflow_dispatch',head_branch:'master',path:'.github/workflows/ci.yml'},
    {id:2,head_sha:old,status:'queued',run_attempt:1,name:'CI',event:'push',head_branch:'master',path:'.github/workflows/not-ci.yml'},
  ]})
  const r=await pruneQueuedMasterCI(t)
  assert.equal(r.cancelled,0)
})

test('refuse snapshot whose SHA is not an ancestor of current master', async()=>{
  const t=fixture()
  t.github.rest.repos.compareCommits=async()=>({data:{status:'diverged',behind_by:1}})
  await assert.rejects(pruneQueuedMasterCI(t),/not an ancestor of master/)
  assert.equal(t.calls.list.length,0)
  assert.deepEqual(t.calls.cancel,[])
})
test('a disappeared run is preserved without failing remaining queue', async()=>{
  const t=fixture({runs:[
    {id:1,head_sha:old,status:'queued',run_attempt:1,name:'CI',event:'push',head_branch:'master',path:'.github/workflows/ci.yml'},
    {id:2,head_sha:old,status:'queued',run_attempt:1,name:'CI',event:'push',head_branch:'master',path:'.github/workflows/ci.yml'},
  ]})
  const original=t.github.rest.actions.getWorkflowRun
  t.github.rest.actions.getWorkflowRun=async(args)=>{
    if(args.run_id===1)throw Object.assign(new Error('not found'),{status:404})
    return original(args)
  }
  const res=await pruneQueuedMasterCI(t)
  assert.equal(res.cancelled,1)
  assert.deepEqual(t.calls.cancel,[2])
})
test('manually re-run old push CI is preserved even when snapshot covers it', async()=>{
  const t=fixture({runs:[{
    id:91,head_sha:old,status:'queued',run_attempt:2,name:'CI',event:'push',
    head_branch:'master',path:'.github/workflows/ci.yml', created_at:'2026-10-27T03:00:00Z',
  }]})
  const r=await pruneQueuedMasterCI(t)
  assert.equal(r.cancelled,0)
  assert.deepEqual(t.calls.cancel,[])
})

test('a newly queued manual re-run after initial scan is preserved', async()=>{
  const t=fixture()
  const original=t.github.rest.actions.getWorkflowRun
  t.github.rest.actions.getWorkflowRun=async(args)=>{
    const res=await original(args)
    return {data:{...res.data,run_attempt:2}}
  }
  const r=await pruneQueuedMasterCI(t)
  assert.equal(r.cancelled,0)
  assert.equal(r.audit[0].action,'preserved-changed')
  assert.deepEqual(t.calls.cancel,[])
})

test('GitHub queued workflow containing an in-progress child is never cancelled', async()=>{
  const t=fixture({jobsById:{1:[
    {id:10,run_id:1,status:'queued',conclusion:null},
    {id:11,run_id:1,status:'in_progress',conclusion:null},
  ]}})
  const r=await pruneQueuedMasterCI(t)
  assert.equal(r.cancelled,0)
  assert.equal(r.eligible,0)
  assert.equal(r.audit[0].action,'preserved-started-or-unknown-jobs')
  assert.deepEqual(t.calls.cancel,[])
  assert.equal(t.calls.jobs.length,1)
})

test('completed successful child job preserves queued workflow even in dry-run', async()=>{
  const jobsById={1:[
    {id:10,run_id:1,status:'queued',conclusion:null},
    {id:11,run_id:1,status:'completed',conclusion:'success'},
  ]}
  for(const dryRun of [false,true]){
    const t=fixture({jobsById})
    const r=await pruneQueuedMasterCI({...t,dryRun})
    assert.equal(r.cancelled,0)
    assert.equal(r.eligible,0)
    assert.equal(r.audit[0].action,'preserved-started-or-unknown-jobs')
    assert.deepEqual(t.calls.cancel,[])
  }
})

test('published Snapshot may retire old queued master CI after read-only pr-scope success', async()=>{
  const t=fixture({jobsById:{1:[
    {id:10,run_id:1,name:'pr-scope',status:'completed',conclusion:'success'},
    {id:11,run_id:1,name:'server-image',status:'queued',conclusion:null},
    {id:12,run_id:1,name:'final-gate',status:'queued',conclusion:null},
  ]}})
  const r=await pruneQueuedMasterCI(t)
  assert.equal(r.eligible,1)
  assert.equal(r.cancelled,1)
  assert.deepEqual(t.calls.cancel,[1])
})

test('successful substantive build or policy test cannot masquerade as pr-scope', async()=>{
  for(const name of ['server-image','policy-contract','publish-master','final-gate']){
    const t=fixture({jobsById:{1:[
      {id:10,run_id:1,name:'pr-scope',status:'completed',conclusion:'success'},
      {id:11,run_id:1,name,status:'completed',conclusion:'success'},
      {id:12,run_id:1,name:'server-backup',status:'queued',conclusion:null},
    ]}})
    const r=await pruneQueuedMasterCI(t)
    assert.equal(r.cancelled,0,name)
    assert.deepEqual(t.calls.cancel,[],name)
    assert.equal(r.audit[0].action,'preserved-started-or-unknown-jobs',name)
  }
})

test('failed or cancelled pr-scope and in-progress publisher preserve master CI', async()=>{
  for(const [name,status,conclusion] of [
    ['pr-scope','completed','failure'],
    ['pr-scope','completed','cancelled'],
    ['publish-master','in_progress',null],
  ]){
    const t=fixture({jobsById:{1:[
      {id:10,run_id:1,name,status,conclusion},
      {id:11,run_id:1,name:'server-image',status:'queued',conclusion:null},
    ]}})
    const r=await pruneQueuedMasterCI(t)
    assert.equal(r.cancelled,0)
    assert.deepEqual(t.calls.cancel,[])
  }
})

test('queued and skipped-only jobs remain eligible for bounded pruning', async()=>{
  const t=fixture({jobsById:{1:[
    {id:10,run_id:1,status:'queued',conclusion:null},
    {id:11,run_id:1,status:'completed',conclusion:'skipped'},
  ]}})
  const r=await pruneQueuedMasterCI(t)
  assert.equal(r.cancelled,1)
  assert.equal(r.eligible,1)
  assert.deepEqual(t.calls.cancel,[1])
})

test('unknown, oversized, truncated or mismatched child job inventories fail closed', async()=>{
  for(const options of [
    {jobsError:true},
    {jobsById:{1:[]}},
    {jobsTotalCount:101},
    {jobsTotalCount:2},
    {jobsById:{1:[{id:10,run_id:999,status:'queued',conclusion:null}]}},
  ]){
    const t=fixture(options)
    const r=await pruneQueuedMasterCI(t)
    assert.equal(r.cancelled,0)
    assert.equal(r.eligible,0)
    assert.deepEqual(t.calls.cancel,[])
    assert.match(r.audit[0].action,/^preserved-/)
  }
})


test('release edits and unrelated repository_dispatch events cannot prune CI', async()=>{
  const release=fixture()
  release.context.eventName='release'
  release.context.payload={release:{tag_name:'snapshot',prerelease:true,draft:false}}
  await assert.rejects(pruneQueuedMasterCI(release),/unsupported event/)
  assert.deepEqual(release.calls.cancel,[])
  const wrong=fixture()
  wrong.context.eventName='repository_dispatch'
  wrong.context.payload.action='other_repo_dispatch'
  await assert.rejects(pruneQueuedMasterCI(wrong),/explicit Snapshot-published event/)
  assert.deepEqual(wrong.calls.cancel,[])
})

test('manual dispatch keeps safe dry-run access', async()=>{
  const fixtureRun=fixture()
  fixtureRun.context.eventName='workflow_dispatch'
  fixtureRun.context.payload={}
  const result=await pruneQueuedMasterCI({...fixtureRun,dryRun:true})
  assert.equal(result.eligible,1)
  assert.equal(result.cancelled,0)
  assert.deepEqual(fixtureRun.calls.cancel,[])
})

test('cleanup is dispatched once from the verified publisher, never from release.edited', ()=>{
  const fs=require('node:fs')
  const path=require('node:path')
  const root=path.resolve(__dirname,'../..')
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/snapshot-prune-queued-master-ci.yml'),'utf8')
  const release=fs.readFileSync(path.join(root,'.github/workflows/release.yml'),'utf8')
  assert.ok(workflow.includes('  repository_dispatch:\n    types: [xdrive_snapshot_published]'))
  assert.equal(workflow.includes('    types: [edited]'),false)
  assert.equal(workflow.includes("github.event_name == 'release'"),false)
  assert.ok(workflow.includes("github.event.action == 'xdrive_snapshot_published'"))
  assert.ok(workflow.includes("PRUNE_DRY_RUN: ${{ github.event_name != 'workflow_dispatch' || inputs.dry_run }}"))
  const assetCheck=release.indexOf('      - name: Assert distribution assets are not archive-wrapped')
  const notification=release.indexOf('      - name: Notify bounded queued-CI prune after verified Snapshot publication')
  const stableRelease=release.indexOf('      - name: Publish GitHub Release',notification)
  assert.ok(assetCheck>=0 && notification>assetCheck && stableRelease>notification)
  assert.ok(release.includes('-f event_type=xdrive_snapshot_published'))
  assert.ok(release.includes('if [[ "$published" != "$GITHUB_SHA" ]]'))
})

// Auto-dispatch must never issue master cancellations even if YAML drifts.
test('published Snapshot dispatch is strictly audit-only', async () => {
  const automatic=fixture()
  automatic.context.eventName='repository_dispatch'
  await assert.rejects(pruneQueuedMasterCI(automatic), /audit-only/)
  assert.deepEqual(automatic.calls.cancel, [])

  const readOnly=fixture()
  readOnly.context.eventName='repository_dispatch'
  const report=await pruneQueuedMasterCI({...readOnly,dryRun:true})
  assert.equal(report.eligible,1)
  assert.equal(report.cancelled,0)
  assert.deepEqual(readOnly.calls.cancel, [])
})

test('queued jobs with a runner, completed step or nonzero elapsed timestamp are not unstarted', () => {
  const job = {id:10,run_id:1,status:'queued',conclusion:null,
    runner_id:0,runner_name:'',created_at:'2026-11-01T08:00:00Z',
    started_at:'2026-11-01T08:00:00Z',steps:[]}
  assert.equal(isUnstartedOrClassifierOnlyJob(job,1),true)
  for (const update of [
    {runner_id:27}, {runner_name:'hosted-runner'},
    {started_at:'2026-11-01T08:00:02Z'},
    {steps:[{status:'in_progress'}]}, {steps:[{status:'completed'}]},
    {conclusion:'success'}, {run_id:2},
  ]) assert.equal(isUnstartedOrClassifierOnlyJob({...job,...update},1),false)
  assert.equal(completeUnstartedInventory({total_count:1,jobs:[job]},1),true)
  assert.equal(completeUnstartedInventory({total_count:2,jobs:[job]},1),false)
  assert.equal(completeUnstartedInventory({total_count:1,jobs:[{...job,id:undefined}]},1),false)
})

test('queued CI with an assigned child runner is preserved even during manual cancellation', async () => {
  const job={id:10,run_id:1,status:'queued',conclusion:null,runner_id:83,runner_name:'hosted'}
  const t=fixture({jobsById:{1:[job]}})
  const result=await pruneQueuedMasterCI(t)
  assert.equal(result.eligible,0)
  assert.equal(result.cancelled,0)
  assert.deepEqual(t.calls.cancel,[])
  assert.equal(result.audit[0].action,'preserved-started-or-unknown-jobs')
})

test('manual Snapshot cleanup rechecks jobs immediately before cancellation', async () => {
  const t=fixture()
  let checks=0
  t.github.rest.actions.listJobsForWorkflowRun=async ({run_id})=>{
    checks++
    return {data:{total_count:1,jobs:[{
      id:1001,run_id,status:'queued',conclusion:null,
      runner_id:checks===1?0:9001,runner_name:checks===1?'':'hosted-runner',
      created_at:'2026-11-01T08:00:00Z',started_at:'2026-11-01T08:00:00Z',
      steps:checks===1?[]:[{status:'in_progress'}],
    }]}}
  }
  const result=await pruneQueuedMasterCI(t)
  assert.equal(result.eligible,1)
  assert.equal(result.cancelled,0)
  assert.equal(checks,2)
  assert.equal(result.audit[0].action,'preserved-final-race')
  assert.deepEqual(t.calls.cancel,[])
})

test('manual Snapshot cleanup preserves a replaced child job and incomplete final inventory', async () => {
  for (const kind of ['replaced','truncated']) {
    const t=fixture()
    let call=0
    t.github.rest.actions.listJobsForWorkflowRun=async ({run_id})=>{
      call++
      const jobs=call===1?[{id:1001,run_id,status:'queued',conclusion:null}]:
        (kind==='replaced'?[{id:2001,run_id,status:'queued',conclusion:null}]:[])
      return {data:{total_count:1,jobs}}
    }
    const result=await pruneQueuedMasterCI(t)
    assert.equal(result.cancelled,0)
    assert.equal(result.audit[0].action,'preserved-final-race')
    assert.deepEqual(t.calls.cancel,[])
  }
})
