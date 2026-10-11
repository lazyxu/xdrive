'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const electron = require('electron')

const root = path.resolve(__dirname, '../..')
const desktop = path.join(root, 'desktop')
const dist = path.join(root, 'web/dist')
const out = path.resolve(process.env.XD_REAL_WEB_CAS_RESULTS || path.join(desktop, 'real-web-cas-results'))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const sizes = { gib: 1, bytes: 1073741824, putCount: 128 }
const trials = 3
const modes = ['upload', 'download']
const median = values => [...values].sort((a,b)=>a-b)[1]
const clockTicksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim())
assert(Number.isFinite(clockTicksPerSecond) && clockTicksPerSecond > 0)
function cpuTicks(pid) {
  const raw = fs.readFileSync('/proc/' + pid + '/stat', 'utf8')
  const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/)
  const total = Number(fields[11]) + Number(fields[12])
  assert(Number.isFinite(total) && total >= 0, 'actual Gin process CPU stat unavailable')
  return total
}
function rss(pid) {
  try {
    const row = fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/^VmRSS:\s+(\d+) kB/m)
    return row ? Number(row[1]) * 1024 : null
  } catch { return null }
}
async function until(fn, ms, label) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await delay(50)
  }
  throw Error('timeout waiting for ' + label)
}
function launch(command, args, env, name, cwd = root) {
  const log = fs.createWriteStream(path.join(out, name + '.log'))
  const child = spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']})
  let carry = ''
  const result = []
  child.stdout.on('data',b=>{
    log.write(b)
    const lines = (carry + b.toString()).split('\n')
    carry = lines.pop()
    for(const line of lines) {
      const mark = '__XDRIVE_LARGE_TRANSFER_PERF_RESULT__'
      const at = line.indexOf(mark)
      if (at >= 0) {
        try { result.push(JSON.parse(line.slice(at + mark.length))) }
        catch(error) { log.write('METRICS_PARSE_ERROR: '+String(error)+'\n') }
      }
    }
  })
  child.stderr.pipe(log,{end:false})
  const exited = new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
  child.once('exit',()=>log.end())
  child.once('error',error=>log.write('PROCESS_SPAWN_ERROR: '+String(error)+'\n'))
  return {child,exited,results:result}
}
async function stop(proc, maxWait = 5000) {
  if (!proc) return null
  let result = await Promise.race([proc.exited,delay(maxWait).then(()=>null)])
  if (result) return result
  proc.child.kill('SIGTERM')
  result = await Promise.race([proc.exited,delay(3000).then(()=>null)])
  if (result) return result
  proc.child.kill('SIGKILL')
  return proc.exited
}
async function fixture(sample, dir) {
  const readyFile = path.join(dir, 'ready-' + sample + '.json')
  const testBinary = process.env.XD_REAL_WEB_CAS_TEST_BINARY
  assert(testBinary && fs.existsSync(testBinary), 'actual compiled native Gin API test binary required')
  const proc = launch(testBinary,[
    '-test.run=^TestRealWebLargeTransferCASFixture$',
    '-test.count=1', '-test.timeout=13m', '-test.v'
  ], {...process.env,
    XD_REAL_WEB_CAS_PERF:'1',
    XD_REAL_WEB_CAS_DIST:dist,
    XD_REAL_WEB_CAS_READY_FILE:readyFile,
    XD_REAL_WEB_CAS_SAMPLE:sample,
  }, 'gin-'+sample)
  try {
    const ready = await until(() => {
      if (proc.child.exitCode !== null) throw Error('Gin fixture terminated before READY '+sample)
      return fs.existsSync(readyFile) ? JSON.parse(fs.readFileSync(readyFile,'utf8')) : null
    },240000,'fresh PostgreSQL17 and physical local CAS fixture')
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url))
    assert.equal(ready.size_bytes,sizes.bytes)
    return {proc, ready}
  } catch(error) {
    await stop(proc,1000)
    throw error
  }
}
async function stats(base) {
  const response=await fetch(base + '/__perf/web-transfer-stats', {cache:'no-store'})
  assert.equal(response.status,200)
  return response.json()
}
async function chromium(sample,mode,base) {
  const proc=launch(electron,[
    '--no-sandbox',path.join(desktop,'scripts/large-transfer-real-web-cas-main.cjs'),
    mode,sample
  ],{...process.env,
    XD_REAL_WEB_CAS_URL:base,
    XD_REAL_WEB_CAS_RESULTS:out,
  },'chromium-'+sample+'-'+mode,desktop)
  try {
    const ended=await Promise.race([proc.exited,delay(6*60_000).then(()=>({code:'timeout'}))])
    assert.equal(ended?.code,0, 'real Web Chromium '+mode+' did not complete: '+JSON.stringify(ended))
    assert.equal(proc.results.length,1,'genuine Chromium metrics missing for '+sample+' '+mode)
    return proc.results[0]
  }finally{
    await stop(proc)
  }
}
async function sampleTrial(index,tmp) {
  const label='sample-'+index
  const f=await fixture(label,tmp)
  // PID is now the ACTUAL compiled Gin test binary, never the go test supervisor.
  const startedRss=rss(f.proc.child.pid)
  assert(startedRss !== null && startedRss > 0,'actual Go Gin Server RSS unavailable')
  const cpuStartTicks = cpuTicks(f.proc.child.pid)
  let peakRss=startedRss
  const poll=setInterval(()=>{
    const found=rss(f.proc.child.pid)
    if(found!==null)peakRss=Math.max(peakRss,found)
  },25)
  const rows=[]
  let final=null
  let failed=false
  try {
    const before=await stats(f.ready.url)
    assert.equal(before.put_count,0)
    assert.equal(before.download_get_count,0)
    for(const mode of modes){
      const result=await chromium(label,mode,f.ready.url)
      assert.equal(result.sizeBytes,sizes.bytes)
      assert.equal(result.realServerCAS,true)
      assert.equal(result.scenario,mode)
      assert(result.elapsedMs>0&&Number.isFinite(result.elapsedMs))
      assert(result.rendererWorkingSetDeltaKB >= 0,'Chromium renderer RSS growth unavailable')
      assert(result.rendererWorkingSetDeltaKB <= 256*1024,
        'Chromium renderer grew by more than 256MiB in actual Server/CAS test')
      if(mode==='upload'){
        assert(Number.isSafeInteger(result.uploadedNodeID)&&result.uploadedNodeID>0)
        assert(/^[a-f0-9]{64}$/i.test(result.uploadedSHA256))
      }else{
        assert.equal(result.downloadSpotCheckedBytes,3*1024*1024)
      }
      rows.push(result)
    }
    final=await stats(f.ready.url)
    assert.equal(final.put_count,sizes.putCount)
    assert.equal(final.declared_upload_bytes,sizes.bytes)
    assert.equal(final.download_get_count,1)
    assert.equal(final.file_bytes,sizes.bytes)
    assert.equal(final.cas_bytes,sizes.bytes)
    assert.equal(final.cas_valid,true)
    assert.equal(final.uploaded_node_id,rows[0].uploadedNodeID)
    assert.equal(final.file_sha256,rows[0].uploadedSHA256)
    assert.equal(final.upload_name,'upload-'+label+'.bin')
    const cpuEndTicks=cpuTicks(f.proc.child.pid)
    const serverCpuMs=(cpuEndTicks-cpuStartTicks)*1000/clockTicksPerSecond
    assert(serverCpuMs>=0,'native Go Gin CPU time invalid')
    const growth=Math.max(0,peakRss-startedRss)
    assert(growth<=256*1024*1024,'real Gin/PG/CAS server RSS growth exceeded 256MiB')
    for(const row of rows){
      assert(row.elapsedMs<=240000,'actual Web 1GiB '+row.scenario+' exceeded 240s')
    }
    return {
      sample:label, valid:true,
      upload:rows[0], download:rows[1],
      nativeServer:final, serverRssStartBytes:startedRss,
      serverRssPeakBytes:peakRss, serverRssPeakDeltaBytes:growth,
      serverCpuMs,
      fixtureSizeBytes:sizes.bytes,
    }
  } catch(error) {
    failed=true
    throw error
  }finally{
    clearInterval(poll)
    await fetch(f.ready.url + '/__perf/stop',{method:'POST'}).catch(()=>{})
    const exit=await stop(f.proc,30000)
    if(!failed) assert.equal(exit?.code,0,'native real Server fixture Go test did not validate exit')
  }
}
async function main() {
  assert(process.env.XD_TEST_DATABASE_URL,'PostgreSQL17 URL required')
  assert(fs.existsSync(path.join(dist,'index.html')),'built real Web production bundle missing')
  fs.mkdirSync(out,{recursive:true})
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-real-web-pg-cas-'))
  const rows=[]
  try{
    for(let i=1;i<=trials;i++){
      const sample=await sampleTrial(i,tmp)
      rows.push(sample)
      fs.writeFileSync(path.join(out,sample.sample+'.json'),JSON.stringify(sample,null,2)+'\n')
      console.log('REAL_WEB_CAS_SAMPLE '+JSON.stringify(sample))
    }
    const result={
      name:'real-web-xdriveapi-postgres17-local-cas-1gib-upload-download',
      status:'CURRENT/BEFORE only - no production optimization',
      n:rows.length,
      bytesPerDirection:sizes.bytes,
      uploadElapsedP50Ms:median(rows.map(x=>x.upload.elapsedMs)),
      downloadElapsedP50Ms:median(rows.map(x=>x.download.elapsedMs)),
      uploadThroughputP50MiBps:median(rows.map(x=>x.upload.throughputMiBps)),
      downloadThroughputP50MiBps:median(rows.map(x=>x.download.throughputMiBps)),
      maxRendererWorkingSetDeltaKB:Math.max(...rows.flatMap(x=>[
        x.upload.rendererWorkingSetDeltaKB,x.download.rendererWorkingSetDeltaKB
      ])),
      maxNativeGoServerRssPeakDeltaBytes:Math.max(...rows.map(x=>x.serverRssPeakDeltaBytes)),
      nativeGoServerCpuMsP50:median(rows.map(x=>x.serverCpuMs)),
      each:rows,
      frozenBudgets:{
        individualUploadMs:240000,individualDownloadMs:240000,
        browserWorkingSetDeltaMaxMiB:256,serverRSSPeakGrowthMaxMiB:256,
        uploadHTTPPutCount:128,downloadHTTPGetCount:1,
        spotCheckThreeDistinctMiB:true
      },
      passed:true,
      boundary:'Real Chromium Web XDriveApi upload/download + OPFS, production authenticated Gin/PG17/physical Local CAS; 1GiB sparse zeros on Linux localhost, NOT real Desktop Agent IPC/WAN/4GiB/incompressible media, no durable Task Center abort.',
    }
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n')
    console.log('REAL_WEB_CAS_SUMMARY '+JSON.stringify(result))
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
main().catch(e=>{console.error('REAL_WEB_CAS_ERROR '+(e?.stack||String(e)));process.exitCode=1})
