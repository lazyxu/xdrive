'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {pruneQueuedMasterCI} = require('./prune-queued-master-ci.cjs')

const sha = c => c.repeat(40)
const snapshot = sha('b'), currentMaster = sha('c'), old = sha('a'), unpublished = sha('d')
function fixture(options={}) {
  const calls = {cancel:[], get:[], compare:[], list:[]}
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
      cancelWorkflowRun:async(args)=>{calls.cancel.push(args.run_id);return {status:202}},
    }
  }}
  const core={info:()=>{},warning:()=>{}}
  const context={repo:{owner:'lazyxu',repo:'xdrive'},eventName:'release',payload:{release:{tag_name:'snapshot',prerelease:true,draft:false}},runId:987}
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
