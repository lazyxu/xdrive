'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const assert = require('node:assert/strict')
const electron = require('electron')
const { AgentIPCClient } = require('../dist/main/agent_client.cjs')

const root = path.resolve(__dirname, '../..')
const desktopRoot = path.join(root, 'desktop')
const webDist = path.join(root, 'web', 'dist')
const output = path.join(desktopRoot, 'gallery-desktop-real-go-cancel-results')
const agentBinary = path.resolve(process.env.XD_GALLERY_AGENT_BINARY || '')
const modes = ['virtual-scroll', 'app-switch', 'window-destroy']
const independentSamples = 3
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const median = values => [...values].sort((a, b) => a - b)[1]

function rss(pid) {
  const row = fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^VmRSS:\s+(\d+) kB/m)
  assert(row, 'native Linux Go Agent VmRSS unavailable')
  return Number(row[1]) * 1024
}
async function until(fn, budget, label) {
  const start = performance.now()
  while (performance.now() - start < budget) {
    const found = await fn()
    if (found) return found
    await delay(100)
  }
  throw Error('timeout waiting for ' + label)
}
function launch(command, args, env, logName, parseLine = null, cwd = root) {
  const log = fs.createWriteStream(path.join(output, logName + '.log'))
  const child = spawn(command, args, { cwd, env, stdio: ['ignore','pipe','pipe'] })
  let carry = ''
  child.stdout.on('data', part => {
    log.write(part)
    if (parseLine) {
      const lines = (carry + part.toString()).split('\n')
      carry = lines.pop()
      for (const line of lines) parseLine(line)
    }
  })
  child.stderr.pipe(log, {end:false})
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})))
  child.once('exit', () => { if (parseLine && carry) parseLine(carry); log.end() })
  child.once('error', err => log.write('LAUNCH_ERROR: '+String(err)+'\n'))
  return {child,exited}
}
async function stop(proc, grace = 5000) {
  if (!proc) return
  let finished = await Promise.race([proc.exited, delay(grace).then(() => null)])
  if (finished) return finished
  proc.child.kill('SIGTERM')
  finished = await Promise.race([proc.exited,delay(3000).then(() => null)])
  if (finished) return finished
  proc.child.kill('SIGKILL')
  return proc.exited
}
async function startFixture(sample, temp) {
  const readyFile = path.join(temp,'fixture-'+sample+'.json')
  const proc = launch('go', [
    'test', '-run', '^TestGalleryRealWebColdFixture100K$', '-count=1',
    '-timeout=14m', '-v', './internal/api',
  ], {
    ...process.env,
    XD_GALLERY_REAL_WEB_COLD_PERF:'1',
    XD_GALLERY_REAL_VIEWPORT_CANCEL_PERF:'1',
    XD_GALLERY_REAL_WEB_READY_FILE:readyFile,
    XD_GALLERY_REAL_WEB_DIST:webDist,
  }, 'gin-'+sample)
  try {
    const config = await until(()=>{
      if(proc.child.exitCode !== null) throw Error('native Gin fixture exited before ready')
      return fs.existsSync(readyFile) ? JSON.parse(fs.readFileSync(readyFile,'utf8')) : null
    },240000,'PostgreSQL17/Gin/CAS 100k fixture')
    assert.equal(config.logical_assets, 100000)
    assert.equal(config.physical_nodes, 115000)
    assert.equal(config.first_image_nodes >= 12, true)
    assert.equal(config.first_live_assets > 0, true)
    return { proc, config }
  } catch(error) {
    await stop(proc, 1000)
    throw error
  }
}
async function stopFixture(f) {
  if (!f) return
  await fetch(f.config.url+'/__perf/stop',{method:'POST'}).catch(()=>{})
  const ended=await stop(f.proc,30000)
  assert.equal(ended?.code,0,'real Gin server aborted unexpectedly: '+JSON.stringify(ended))
}
async function electronMode(sample, mode, env) {
  const bootstrap=path.join(desktopRoot,'.gallery-desktop-go-cancel-entry.cjs')
  fs.writeFileSync(bootstrap,"require('./scripts/gallery-desktop-real-go-cancel-electron-main.cjs')\n",{mode:0o600})
  let received=null
  let ipcFailures=[]
  const label='GALLERY_REAL_DESKTOP_GO_CANCEL_SAMPLE '
  const proc=launch(electron,['--no-sandbox',bootstrap], {
    ...process.env,...env,
    XD_GALLERY_DESKTOP_GO_CANCEL_MODE:mode,
    XD_GALLERY_DESKTOP_GO_CANCEL_SAMPLE:String(sample),
  },'electron-'+sample+'-'+mode,line=>{
    const i=line.indexOf(label)
    if(i>=0){ try{received=JSON.parse(line.slice(i+label.length))}catch(e){ipcFailures.push(String(e))} }
  },desktopRoot)
  try {
    const end=await Promise.race([proc.exited,delay(100000).then(()=>({code:'timeout'}))])
    if(received)fs.writeFileSync(path.join(output,'sample-'+sample+'-'+mode+'.json'),
      JSON.stringify(received,null,2)+'\n')
    assert.equal(end.code,0,'real Electron '+mode+' did not exit cleanly: '+JSON.stringify({end,ipcFailures,received}))
    assert(received?.passed,'actual Renderer/Preload/Main/Agent/Gin context gate did not pass')
    return received
  } finally {
    await stop(proc)
    fs.rmSync(bootstrap,{force:true})
  }
}
async function agentSample(sample, fixture, temp) {
  const configHome=path.join(temp,'config-'+sample)
  const cacheHome=path.join(temp,'cache-'+sample)
  fs.mkdirSync(configHome,{recursive:true})
  fs.mkdirSync(cacheHome,{recursive:true})
  const env={
    XDG_CONFIG_HOME:configHome, XDG_CACHE_HOME:cacheHome,
    XD_DISABLE_SECRET_SERVICE:'1',
    XD_AGENT_PATH:agentBinary,
    XD_GALLERY_DESKTOP_GO_CANCEL_SERVER:fixture.config.url,
  }
  const proc=launch(agentBinary,[],{...process.env,...env},'agent-'+sample)
  const discovery=path.join(configHome,'xdrive','desktop-ipc.json')
  let client
  try{
    await until(()=>{
      if(proc.child.exitCode !== null)throw Error('real Agent exited before IPC discovery')
      return fs.existsSync(discovery)
    },20000,'production Agent IPC discovery')
    client=new AgentIPCClient(discovery)
    const hello=await client.hello()
    assert(hello.protocol_min<=2&&hello.protocol_max>=2,'production Agent v2 protocol required')
    const login=await client.login({
      server:fixture.config.url,username:'gallery-web-cold-100k',
      password:'browser-performance-password',
    })
    assert(login.configured&&!login.must_change_password,'native Agent login failed')
    await client.setPaused(true)
    const rssStart=rss(proc.child.pid)
    const modesResult=[]
    for(const mode of modes){
      const outcome=await electronMode(sample,mode,env)
      modesResult.push(outcome)
      const healthy=await client.mediaItemRange('',200,50000,{})
      assert.equal(healthy.total_count,100000,'new Agent Gallery count corrupted')
      assert.equal(healthy.items?.length,200,'new Agent Gallery 200-page unavailable')
      outcome.recovery={offset:50000,count:healthy.total_count,returned:healthy.items.length}
      fs.writeFileSync(path.join(output,'sample-'+sample+'-'+mode+'.json'),
        JSON.stringify(outcome,null,2)+'\n')
    }
    const rssEnd=rss(proc.child.pid)
    const row={
      sample,logicalAssets:100000,physicalMediaNodes:115000,pairedLiveAssets:15000,
      actualFirstViewportDistinctJpegNodes:12,seedMsExcluded:fixture.config.seed_ms,
      agentRssBeforeBytes:rssStart,agentRssAfterBytes:rssEnd,
      agentRssDeltaBytes:rssEnd-rssStart,modes:modesResult,
    }
    assert(row.agentRssDeltaBytes<=128*1024*1024,'native Go Agent exceeded 128MiB RSS growth')
    return row
  } finally {
    if(client) await client.shutdown().catch(()=>{})
    await stop(proc)
  }
}
async function main(){
  assert(process.env.XD_TEST_DATABASE_URL,'native PostgreSQL17 DSN required')
  assert(process.env.XD_GALLERY_AGENT_BINARY&&fs.existsSync(agentBinary),
    'real compiled xdrive-agent binary required')
  for(const f of [
    path.join(webDist,'index.html'),
    path.join(desktopRoot,'dist/main/index.cjs'),
    path.join(desktopRoot,'dist/preload/index.cjs'),
    path.join(desktopRoot,'dist/renderer/index.html'),
  ]) assert(fs.existsSync(f),'real production build asset missing: '+f)
  fs.mkdirSync(output,{recursive:true})
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-gallery-electron-go-cancel-'))
  const rows=[]
  try {
    for(let sample=1;sample<=independentSamples;sample++){
      const f=await startFixture(sample,temp)
      try{
        const row=await agentSample(sample,f,temp)
        rows.push(row)
        fs.writeFileSync(path.join(output,'sample-'+sample+'.json'),JSON.stringify(row,null,2)+'\n')
        console.log('GALLERY_REAL_DESKTOP_GO_CANCEL_AGENT_SAMPLE '+JSON.stringify(row))
      } finally { await stopFixture(f) }
    }
    const all=rows.flatMap(row=>row.modes)
    const report={
      name:'gallery-real-electron-desktop-100k-viewport-window-go-context-cancel',
      status:'measured-CURRENT-BEFORE-only',
      workload:{
        logicalAssets:100000,physicalMediaNodes:115000,pairedLivePhotoAssets:15000,
        realCasJpegsPerFixture:12,
        client:'actual xDrive Electron Renderer, Preload, Main, Go Agent, signed Gin/PG17/CAS',
        modes,independentPostgresAndAgentSamples:independentSamples,
        firstFlushedBytesPerRequest:256,testOnlyBodyHoldMs:1500,
      },
      samples:rows,modeResults:all.length,
      totalStarted:all.reduce((n,x)=>n+x.startedRequests,0),
      totalContexts:all.reduce((n,x)=>n+x.contextDone,0),
      totalCanceled:all.reduce((n,x)=>n+x.returnedCanceledHandlers,0),
      totalWastedOldBytes:all.reduce((n,x)=>n+x.extraStaleHttpBytes,0),
      worstGoNotificationMs:Math.max(...all.map(x=>x.worstGoNotificationMs)),
      maxAgentRssDeltaBytes:Math.max(...rows.map(x=>x.agentRssDeltaBytes)),
      budgets:{
        n:3,modeCount:3,startedPerMode:6,contextDonePerMode:6,
        goNotificationDeadlineMs:160,activeHandlersAfterDeadline:0,staleBytesAfterDeadline:0,
        maxAgentRssGrowthMiB:128,actualScrollDeltaPxMin:10000,
        independentFreshPageCount:100000,independentFreshPageReturned:200,
      },
      passed:rows.length===3&&all.length===9&&all.every(x=>x.passed&&x.recovery?.count===100000&&
        x.recovery?.returned===200&&x.startedRequests===6&&x.contextDone===6&&
        x.returnedCanceledHandlers===6&&x.activeOldHandlers===0&&x.extraStaleHttpBytes===0&&
        x.worstGoNotificationMs<=160)&&rows.every(x=>x.agentRssDeltaBytes<=128*1024*1024),
      scopeLimits:'Only first real 12 CAS JPEGs in 100k metadata, not 100k distinct physical media or HEVC/RAW/LIVP decode, not hardware Windows or WAN; no durable Task Center task cancellation tested.',
    }
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2)+'\n')
    console.log('GALLERY_REAL_DESKTOP_GO_CANCEL_SUMMARY '+JSON.stringify(report))
    assert(report.passed,'real production Electron-to-Go cancellation gate failed')
  } finally {fs.rmSync(temp,{recursive:true,force:true})}
}
main().catch(err=>{console.error('GALLERY_REAL_DESKTOP_GO_CANCEL_RUNNER_ERROR '+(err?.stack||String(err)));process.exitCode=1})
