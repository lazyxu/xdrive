'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { performance } = require('node:perf_hooks')
const { AgentIPCClient } = require('../dist/main/agent_client.cjs')
const { DesktopViewportRequests } = require('../dist/main/viewport_requests.cjs')

const root = path.resolve(__dirname, '../..')
const out = path.join(root, 'desktop/gallery-agent-go-cancel-results')
const webDist = path.join(root, 'web/dist')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const p50 = values => [...values].sort((a,b) => a-b)[1]
const n = 3, budgetMs = 160

function rss(pid) {
  const match = fs.readFileSync('/proc/' + pid + '/status','utf8').match(/^VmRSS:\s+(\d+) kB/m)
  assert(match, 'real Linux Go Agent RSS unavailable')
  return Number(match[1]) * 1024
}
async function until(fn, limit, label) {
  const began = performance.now()
  while (performance.now()-began < limit) {
    const value = await fn()
    if (value) return value
    await delay(25)
  }
  throw Error('timeout ' + label)
}
async function probe(url) {
  const res = await fetch(url + '/__perf/viewport-cancel-stats', {cache:'no-store'})
  assert.equal(res.status, 200)
  return res.json()
}
async function fixture(sample, ready) {
  const log = fs.createWriteStream(path.join(out,'server-'+sample+'.log'))
  const child = spawn('go',[
    'test','-run','^TestGalleryRealWebColdFixture100K$','-count=1','-timeout=14m','-v','./internal/api'
  ], {
    cwd:root, env:{...process.env,
      XD_GALLERY_REAL_WEB_COLD_PERF:'1',
      XD_GALLERY_REAL_VIEWPORT_CANCEL_PERF:'1',
      XD_GALLERY_REAL_WEB_DIST:webDist,
      XD_GALLERY_REAL_WEB_READY_FILE:ready
    }, stdio:['ignore','pipe','pipe']
  })
  child.stdout.pipe(log,{end:false})
  child.stderr.pipe(log,{end:false})
  child.once('error', e=>log.write('SPAWN_ERROR '+String(e)))
  const exited = new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
  const config = await until(()=>{
    if(child.exitCode!==null) throw Error('Gin fixture stopped: '+child.exitCode)
    return fs.existsSync(ready)?JSON.parse(fs.readFileSync(ready,'utf8')):null
  },240000,'native PostgreSQL17 100k fixture')
  assert.equal(config.logical_assets,100000)
  assert.equal(config.physical_nodes,115000)
  assert(config.first_image_nodes>=12)
  return {config,child,exited,log}
}
async function stopFixture(f) {
  if(!f) return
  await fetch(f.config.url+'/__perf/stop',{method:'POST'}).catch(()=>{})
  const result=await Promise.race([f.exited,delay(30000).then(()=>({code:'timeout'}))])
  f.log.end()
  if(result.code!==0) {f.child.kill('SIGKILL');throw Error('Gin fixture exit: '+JSON.stringify(result))}
}
async function group({f,client,mgr,items,sample,ordinal,mode}) {
  const sender=new EventEmitter()
  sender.id=sample*100+ordinal
  const ids=items.map((_,i)=>'request-'+sample+'-'+ordinal+'-'+i)
  const promises=items.map((item,i)=>
    mgr.run(sender,ids[i], signal=>client.mediaThumbnail(item.node.id,signal,item.node.revision))
      .then(()=>({rejected:false}),error=>({rejected:true,code:String(error?.message||error)}))
  )
  const count=ordinal*6
  const started=await until(async()=>{
    const x=await probe(f.config.url)
    if(x.started>count)throw Error('unbounded requests: '+JSON.stringify(x))
    return x.started===count && x.active===6 && x.first_chunks===count &&
      x.emitted_bytes===count*256 ? x : null
  },45000,'six genuine active JPEG GETs after 256 bytes')
  const mark=await fetch(f.config.url+'/__perf/viewport-cancel-mark',{method:'POST'})
  assert.equal(mark.status,204)
  if(mode==='viewport-cancel') ids.forEach(id=>mgr.cancel(sender,id))
  else if(mode==='sender-destroyed') sender.emit('destroyed')
  else throw Error('unknown mode '+mode)
  await delay(budgetMs)
  const after=await probe(f.config.url)
  const settled=await Promise.all(promises)
  const row={
    sample,mode,requested:6,receivedFirstBytes:6*256,
    canceled:after.cancelled-started.cancelled,
    contextDone:after.context_done-started.context_done,
    activeHandlersAt160ms:after.active,
    additionalBytesAt160ms:after.emitted_bytes-started.emitted_bytes,
    maxGoContextNotifyMs:after.max_cancel_us/1000,
    rejectedAgentRequests:settled.filter(x=>x.rejected).length,
    errorExamples:[...new Set(settled.map(x=>x.code).filter(Boolean))].slice(0,2)
  }
  console.log('GALLERY_AGENT_GO_CANCEL_100K_GROUP '+JSON.stringify(row))
  assert.equal(row.canceled,6,'real Gin handler not canceled')
  assert.equal(row.contextDone,6,'real Request.Context.Done not notified')
  assert.equal(row.activeHandlersAt160ms,0,'orphaned Go load')
  assert.equal(row.additionalBytesAt160ms,0,'stale HTTP payload')
  assert.equal(row.rejectedAgentRequests,6,'Agent canceled request resolved')
  assert(row.maxGoContextNotifyMs<=budgetMs,'Go notification exceeds 160ms')
  return row
}
async function agentSample(sample,f,temp) {
  const config=path.join(temp,'config-'+sample),cache=path.join(temp,'cache-'+sample)
  fs.mkdirSync(config,{recursive:true})
  fs.mkdirSync(cache,{recursive:true})
  const log=fs.createWriteStream(path.join(out,'agent-'+sample+'.log'))
  const child=spawn(process.env.XD_GALLERY_AGENT_BINARY,[],{
    cwd:root,env:{...process.env,XDG_CONFIG_HOME:config,XDG_CACHE_HOME:cache,
      XD_DISABLE_SECRET_SERVICE:'1'},
    stdio:['ignore','pipe','pipe']
  })
  child.stdout.pipe(log,{end:false})
  child.stderr.pipe(log,{end:false})
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
  const discover=path.join(config,'xdrive/desktop-ipc.json')
  let client
  try{
    await until(()=>{
      if(child.exitCode!==null)throw Error('real Go Agent stopped: '+child.exitCode)
      return fs.existsSync(discover)
    },25000,'Go Agent IPC ready')
    client=new AgentIPCClient(discover)
    const hello=await client.hello()
    assert(hello.protocol_min<=2 && hello.protocol_max>=2)
    const login=await client.login({server:f.config.url,username:'gallery-web-cold-100k',
      password:'browser-performance-password'})
    assert(login.configured&&!login.must_change_password,'real Agent login failed')
    await client.setPaused(true)
    const rssBefore=rss(child.pid)
    const start=performance.now()
    const first=await client.mediaItemRange('',100,0,{})
    const firstRangeMs=performance.now()-start
    assert.equal(first.total_count,100000)
    assert.equal(first.items?.length,100)
    const images=first.items.filter(x=>x.metadata?.media_kind==='image').slice(0,12)
    assert.equal(images.length,12)
    const mgr=new DesktopViewportRequests()
    const a=await group({f,client,mgr,items:images.slice(0,6),sample,ordinal:1,mode:'viewport-cancel'})
    const b=await group({f,client,mgr,items:images.slice(6,12),sample,ordinal:2,mode:'sender-destroyed'})
    const recovered=await client.mediaItemRange('',200,50000,{})
    assert.equal(recovered.total_count,100000)
    assert.equal(recovered.items?.length,200)
    const rssAfter=rss(child.pid)
    const row={sample,logical:100000,physicalNodes:115000,livePairs:15000,
      firstRangeMs,seedMsExcluded:f.config.seed_ms,groups:[a,b],
      recovered:{offset:50000,count:recovered.total_count,returned:recovered.items.length},
      agentRssStartBytes:rssBefore,agentRssEndBytes:rssAfter,
      agentRssDeltaBytes:rssAfter-rssBefore}
    assert(row.agentRssDeltaBytes<=128*1024*1024,'Agent RSS growth budget exceeded')
    return row
  } finally {
    if(client)await client.shutdown().catch(()=>{})
    let stopped=await Promise.race([exited,delay(5000).then(()=>null)])
    if(!stopped){child.kill('SIGTERM');stopped=await Promise.race([exited,delay(3000).then(()=>null)])}
    if(!stopped){child.kill('SIGKILL');await exited}
    log.end()
  }
}
async function main(){
  assert(process.env.XD_TEST_DATABASE_URL,'native PG17 DSN required')
  assert(process.env.XD_GALLERY_AGENT_BINARY&&fs.existsSync(process.env.XD_GALLERY_AGENT_BINARY),
    'production Go Agent binary required')
  assert(fs.existsSync(path.join(webDist,'index.html')),'real bundled Web fixture required')
  fs.mkdirSync(out,{recursive:true})
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-real-agent-go-cancel-'))
  const samples=[]
  try{
    for(let i=1;i<=n;i++){
      let f
      try{
        f=await fixture(i,path.join(tmp,'ready-'+i+'.json'))
        const row=await agentSample(i,f,tmp)
        samples.push(row)
        fs.writeFileSync(path.join(out,'sample-'+i+'.json'),JSON.stringify(row,null,2)+'\n')
        console.log('GALLERY_AGENT_GO_CANCEL_100K_SAMPLE '+JSON.stringify(row))
      }finally{await stopFixture(f)}
    }
    const groups=samples.flatMap(x=>x.groups)
    const summary={
      name:'gallery-agent-go-context-cancel-100k',
      status:'measured-current-before-only',
      boundary:'Desktop Main request-owner shim -> real token-protected Go Agent IPC -> signed Go Server/Gin/PostgreSQL/local CAS; NOT renderer/preload or actual OS window',
      workload:{logicalAssets:100000,physicalNodes:115000,livePhotoPairs:15000,
        physicalJpegs:'12 first viewport JPEGs, NOT 100k individual CAS payloads'},
      samples,groups:groups.length,goCanceled:groups.reduce((n,x)=>n+x.canceled,0),
      goContextDone:groups.reduce((n,x)=>n+x.contextDone,0),
      maxGoContextNotifyMs:Math.max(...groups.map(x=>x.maxGoContextNotifyMs)),
      medianFirstRangeMs:p50(samples.map(x=>x.firstRangeMs)),
      maxAgentRssGrowthBytes:Math.max(...samples.map(x=>x.agentRssDeltaBytes)),
      limits:{samples:n,groupsPerSample:2,requestsPerGroup:6,
        observeAfterMs:budgetMs,maxAgentRssGrowthMiB:128},
      passed:samples.length===3&&groups.length===6&&groups.every(x=>
        x.canceled===6&&x.contextDone===6&&x.activeHandlersAt160ms===0&&
        x.additionalBytesAt160ms===0&&x.rejectedAgentRequests===6&&x.maxGoContextNotifyMs<=budgetMs)
        &&samples.every(x=>x.recovered.count===100000&&x.recovered.returned===200&&
          x.agentRssDeltaBytes<=128*1024*1024),
      exclusions:'No actual Electron Renderer/Preload, browser/window lifecycle, 1/4GiB transfer, 100k physical JPEG decode, network WAN or Task Center durable cancel'
    }
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n')
    console.log('GALLERY_AGENT_GO_CANCEL_100K_SUMMARY '+JSON.stringify(summary))
    assert(summary.passed,'real Agent-to-Go cancel resource budget failed')
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
main().catch(e=>{console.error('GALLERY_AGENT_GO_CANCEL_100K_ERROR '+(e?.stack||String(e)));process.exitCode=1})
