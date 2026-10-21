'use strict'
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const {spawn}=require('node:child_process')
const electron=require('electron')
const {AgentIPCClient}=require('../dist/main/agent_client.cjs')
const root=path.resolve(__dirname,'../..')
const desktop=path.join(root,'desktop')
const webDist=path.join(root,'web/dist')
const out=path.resolve(process.env.XD_REAL_DESKTOP_CAS_RESULTS||path.join(desktop,'real-desktop-cas-results'))
const agentBinary=path.resolve(process.env.XD_REAL_DESKTOP_AGENT_BINARY||'')
const apiTestBinary=path.resolve(process.env.XD_REAL_DESKTOP_CAS_TEST_BINARY||'')
const sizeGiB=Number(process.env.XD_REAL_CAS_SIZE_GIB||'1')
assert([1,4].includes(sizeGiB),'real Desktop CAS benchmark size must be 1 or 4 GiB')
const transferBytes=sizeGiB*2**30
const putCount=sizeGiB*128
// P043 high-entropy physical original content is a new workload; default P011 stays unchanged.
const highEntropyDesktop=process.env.XD_REAL_DESKTOP_INCOMPRESSIBLE_PERF==='1'
const maxDirectionMs=sizeGiB===4?360000:240000
const delay=ms=>new Promise(r=>setTimeout(r,ms))
// Clear losing timers after Promise.race, otherwise a completed 1GiB native
// benchmark keeps the Node runner alive until the 6-minute watchdog fires.
function withDeadline(promise,ms,timeoutValue=null){
  let timer
  const watchdog=new Promise(resolve=>{timer=setTimeout(()=>resolve(timeoutValue),ms)})
  return Promise.race([promise,watchdog]).finally(()=>clearTimeout(timer))
}
const median=a=>[...a].sort((x,y)=>x-y)[1]
function statsPID(pid){
  try {
    const status=fs.readFileSync('/proc/'+pid+'/status','utf8')
    const match=status.match(/^VmRSS:\s+(\d+) kB/m)
    const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8')
    const rest=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)
    return {rss:match?Number(match[1])*1024:0,cpuTicks:Number(rest[11])+Number(rest[12])}
  }catch{return null}
}
async function until(fn,timeout,label){
  const time=Date.now()+timeout
  while(Date.now()<time){
    const found=await fn()
    if(found)return found
    await delay(100)
  }
  throw Error('timeout waiting for '+label)
}
function spawnLogged(binary,args,env,tag,cwd=root){
  const log=fs.createWriteStream(path.join(out,tag+'.log'))
  const child=spawn(binary,args,{cwd,env,stdio:['ignore','pipe','pipe']})
  const rows=[]
  let carry=''
  child.stdout.on('data',buf=>{
    log.write(buf)
    const parts=(carry+buf.toString()).split('\n')
    carry=parts.pop()
    for(const line of parts){
      const marker='REAL_DESKTOP_TO_CAS_TRANSFER '
      const i=line.indexOf(marker)
      if(i>=0)try{rows.push(JSON.parse(line.slice(i+marker.length)))}catch(e){
        log.write('ROW_PARSE_ERROR '+String(e)+'\n')
      }
    }
  })
  child.stderr.pipe(log,{end:false})
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
  child.once('exit',()=>log.end())
  child.once('error',e=>log.write('SPAWN_ERROR '+String(e)+'\n'))
  return {child,exited,rows}
}
async function stop(proc,ms=5000){
  if(!proc)return null
  let result=await withDeadline(proc.exited,ms,null)
  if(result)return result
  proc.child.kill('SIGTERM')
  result=await withDeadline(proc.exited,3000,null)
  if(result)return result
  proc.child.kill('SIGKILL')
  return proc.exited
}
async function fixture(sample,tmp){
  const readyFile=path.join(tmp,'ready-'+sample+'.json')
  const proc=spawnLogged(apiTestBinary,[
    '-test.run=^TestRealWebLargeTransferCASFixture$','-test.count=1',
    '-test.timeout=18m','-test.v'
  ],{...process.env,
    XD_REAL_WEB_CAS_PERF:'1',
    XD_REAL_WEB_CAS_SAMPLE:sample,
    XD_REAL_WEB_CAS_DIST:webDist,
    XD_REAL_WEB_CAS_READY_FILE:readyFile,
  },'server-'+sample)
  try{
    const info=await until(()=>{
      if(proc.child.exitCode!==null)throw Error('authentic Gin fixture quit unexpectedly')
      return fs.existsSync(readyFile)?JSON.parse(fs.readFileSync(readyFile,'utf8')):null
    },240000,'PG17/Gin/CAS native ready file')
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(info.url))
    assert.equal(info.size_bytes,transferBytes)
    return {process:proc,info}
  }catch(e){await stop(proc,1000);throw e}
}
async function getState(base,token){
  const r=await fetch(base+'/__perf/'+(token?'web-transfer-config':'web-transfer-stats'),{cache:'no-store'})
  assert.equal(r.status,200)
  return r.json()
}
// AES-256-CTR deterministic CSPRNG test data, never user files or production traffic.
function seedHighEntropyPhysicalOriginal(file,bytes,sample){
  const key=crypto.createHash('sha256')
    .update('xdrive-p043-desktop-aes256ctr:'+sample).digest()
  const cipher=crypto.createCipheriv('aes-256-ctr',key,Buffer.alloc(16))
  const sha=crypto.createHash('sha256'),zeros=Buffer.alloc(8*1024*1024)
  const fd=fs.openSync(file,'wx',0o600)
  let allocatedBytes=0
  try{
    for(let done=0;done<bytes;){
      const count=Math.min(zeros.length,bytes-done)
      const block=cipher.update(zeros.subarray(0,count))
      let written=0
      while(written<block.length){
        const n=fs.writeSync(fd,block,written,block.length-written)
        if(n<=0)throw Error('short actual physical CSPRNG fixture write')
        written+=n
      }
      sha.update(block)
      done+=count
    }
    assert.equal(cipher.final().length,0)
    fs.fsyncSync(fd)
    allocatedBytes=fs.fstatSync(fd).blocks*512
  }finally{fs.closeSync(fd)}
  assert(allocatedBytes>=bytes*.98,
    'P043 high-entropy source is sparse or filesystem-compressed: '+allocatedBytes)
  return {sourceSHA256:sha.digest('hex'),allocatedBytes,sourceBytes:bytes}
}
async function hashFile(file){
  const sum=crypto.createHash('sha256')
  for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024})){
    sum.update(chunk)
  }
  return sum.digest('hex')
}
async function launchElectron(sample,mode,env){
  // Electron determines app.getAppPath() from the entry file's parent.
  // A script under desktop/scripts incorrectly identifies "scripts" as
  // the app root; use the same package-root bootstrap as the accepted
  // real Desktop Gallery benchmarks. This changes only the test launcher.
  const bootstrap=path.join(desktop,'.real-desktop-cas-'+sample+'-'+mode+'-entry.cjs')
  fs.writeFileSync(bootstrap,"require('./scripts/real-desktop-cas-electron-main.cjs')\n",{mode:0o600})
  let child
  try{
    child=spawnLogged(electron,['--no-sandbox',bootstrap],
      {...process.env,...env,XD_DESKTOP_CAS_MODE:mode},
      'electron-'+sample+'-'+mode,desktop)
    const exit=await withDeadline(child.exited,6*60*1000,{code:'timeout'})
    assert.equal(exit?.code,0,'authentic Electron '+mode+' failed: '+JSON.stringify(exit))
    assert.equal(child.rows.length,1,'authentic Electron result missing for '+mode)
    return child.rows[0]
  }finally{
    if(child)await stop(child)
    fs.rmSync(bootstrap,{force:true})
  }
}
async function runOne(index,tmp){
  const sample='sample-'+index
  const f=await fixture(sample,tmp)
  const configDir=path.join(tmp,'config-'+sample),cacheDir=path.join(tmp,'cache-'+sample)
  fs.mkdirSync(configDir,{recursive:true})
  fs.mkdirSync(cacheDir,{recursive:true})
  const env={
    XDG_CONFIG_HOME:configDir,
    XDG_CACHE_HOME:cacheDir,
    XD_DISABLE_SECRET_SERVICE:'1',
    XD_AGENT_PATH:agentBinary,
  }
  const agent=spawnLogged(agentBinary,[],{...process.env,...env},'agent-'+sample)
  const discovery=path.join(configDir,'xdrive/desktop-ipc.json')
  let client,statsTimer=null
  let succeeded=false
  try{
    const ready=await until(()=>{
      if(agent.child.exitCode!==null)throw Error('real Go Agent stopped')
      return fs.existsSync(discovery)
    },25000,'actual Agent IPC discovery')
    client=new AgentIPCClient(discovery)
    const hello=await client.hello()
    assert(hello.protocol_min<=2&&hello.protocol_max>=2,'actual Go Agent protocol v2 required')
    const loggedIn=await client.login({
      server:f.info.url,username:'cas-web-'+sample,password:'native-perf-password'
    })
    assert(loggedIn.configured&&!loggedIn.must_change_password,'actual Go Agent login failed')
    await client.setPaused(true)
    const initial=await getState(f.info.url,true)
    const rootNode=await client.cloudRoot()
    assert.equal(rootNode.id,initial.root_id)
    const agentBefore=statsPID(agent.child.pid),serverBefore=statsPID(f.process.child.pid)
    assert(agentBefore?.rss>0&&serverBefore?.rss>0,'authentic Agent/Gin native resource sampler missing')
    let agentRssMax=agentBefore.rss,serverRssMax=serverBefore.rss
    statsTimer=setInterval(()=>{
      const a=statsPID(agent.child.pid),s=statsPID(f.process.child.pid)
      if(a?.rss>0)agentRssMax=Math.max(agentRssMax,a.rss)
      if(s?.rss>0)serverRssMax=Math.max(serverRssMax,s.rss)
    },25)
    const source=path.join(tmp,'upload-'+sample+'.bin')
    let physicalSeed=null
    if(highEntropyDesktop){
      physicalSeed=seedHighEntropyPhysicalOriginal(source,transferBytes,sample)
    }else{
      const handle=fs.openSync(source,'w',0o600)
      try{fs.ftruncateSync(handle,transferBytes)}finally{fs.closeSync(handle)}
    }
    const download=path.join(tmp,'download-'+sample+'.bin')
    const common={
      ...env,
      XD_DESKTOP_CAS_ROOT_ID:String(initial.root_id),
      XD_DESKTOP_CAS_SOURCE_PATH:source,
      XD_DESKTOP_CAS_DESTINATION:download,
    }
    const upload=await launchElectron(sample,'upload',common)
    const afterUpload=await getState(f.info.url,false)
    assert.equal(upload.scenario,'upload')
    assert.equal(upload.bytes,transferBytes)
    assert.equal(afterUpload.put_count,putCount)
    assert.equal(afterUpload.declared_upload_bytes,transferBytes)
    assert.equal(afterUpload.uploaded_node_id,upload.nodeID)
    assert.equal(afterUpload.cas_valid,true)
    if(highEntropyDesktop){
      assert.equal(afterUpload.file_sha256,physicalSeed.sourceSHA256,
        'real Desktop upstream physical seed SHA differs from native server CAS')
      assert(physicalSeed.allocatedBytes>=transferBytes*.98,
        'high-entropy fixture not physically allocated')
    }
    const downloaded=await launchElectron(sample,'download',{
      ...common,XD_DESKTOP_CAS_NODE_ID:String(upload.nodeID)
    })
    assert.equal(downloaded.scenario,'download')
    assert.equal(downloaded.bytes,transferBytes)
    assert.equal(downloaded.nodeID,upload.nodeID)
    const disk=fs.statSync(download)
    assert.equal(disk.size,transferBytes)
    const checksum=await hashFile(download)
    const final=await getState(f.info.url,false)
    assert.equal(checksum,final.file_sha256)
    if(highEntropyDesktop){
      assert.equal(checksum,physicalSeed.sourceSHA256,
        'entire real Desktop native output differs from high-entropy physical source')
    }
    assert.equal(final.cas_valid,true)
    assert.equal(final.cas_bytes,transferBytes)
    assert.equal(final.download_get_count,1)
    const agentAfter=statsPID(agent.child.pid),serverAfter=statsPID(f.process.child.pid)
    const agentRssGrowth=Math.max(0,agentRssMax-agentBefore.rss)
    const serverRssGrowth=Math.max(0,serverRssMax-serverBefore.rss)
    const max=256*1024*1024
    assert(agentRssGrowth<=max&&serverRssGrowth<=max,
      'authentic Agent or Server exceeded RSS budget')
    for(const record of [upload,downloaded]){
      assert(Number.isFinite(record.elapsedMs)&&record.elapsedMs>0,
        'Desktop elapsed metric must be numeric')
      assert(Number.isFinite(record.electronMainCPUUserMs)&&record.electronMainCPUUserMs>=0&&
        Number.isFinite(record.electronMainCPUSystemMs)&&record.electronMainCPUSystemMs>=0,
        'Electron Main CPU samples must be numeric')
      assert(record.elapsedMs<=maxDirectionMs,
        `authentic Desktop ${sizeGiB} GiB transfer elapsed budget exceeded`)
      assert(record.rendererWorkingSetGrowthKiB>=0&&
        record.rendererWorkingSetGrowthKiB<=256*1024,
        'actual Electron Renderer WorkingSet growth budget exceeded')
    }
    succeeded=true
    return {
      sample,uploadedBytes:transferBytes,downloadedBytes:disk.size,
      highEntropyDesktop,
      ...(physicalSeed?{physicalSource:physicalSeed}:{}),
      upload,download:downloaded,server:final,downloadSHA256:checksum,
      agentRssGrowthBytes:agentRssGrowth,
      serverRssGrowthBytes:serverRssGrowth,
      agentCpuDeltaTicks:Math.max(0,(agentAfter?.cpuTicks||0)-agentBefore.cpuTicks),
      serverCpuDeltaTicks:Math.max(0,(serverAfter?.cpuTicks||0)-serverBefore.cpuTicks),
    }
  }finally{
    if(statsTimer)clearInterval(statsTimer)
    if(client)await client.shutdown().catch(()=>{})
    await stop(agent)
    await fetch(f.info.url+'/__perf/stop',{method:'POST'}).catch(()=>{})
    const done=await stop(f.process,30000)
    if(succeeded)assert.equal(done?.code,0,'Gin fixture did not validate full Desktop transfer')
  }
}
async function main(){
  assert(process.env.XD_TEST_DATABASE_URL,'native PostgreSQL17 DSN required')
  assert(agentBinary&&fs.existsSync(agentBinary),'production Go Agent binary missing')
  assert(apiTestBinary&&fs.existsSync(apiTestBinary),'compiled native API test fixture binary missing')
  assert(fs.existsSync(path.join(webDist,'index.html')),'built Web fixture dist missing')
  assert(fs.existsSync(path.join(desktop,'dist/main/index.cjs')),'compiled Desktop Main missing')
  assert(fs.existsSync(path.join(desktop,'dist/preload/index.cjs')),'compiled actual Desktop preload missing')
  assert(fs.existsSync(path.join(desktop,'dist/renderer/index.html')),'actual Desktop Renderer missing')
  fs.mkdirSync(out,{recursive:true})
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-desktop-real-cas-'))
  if(sizeGiB===4){
    const stat=fs.statfsSync(temp,{bigint:true})
    const free=stat.bavail*stat.bsize
    const needed=3n*BigInt(transferBytes)+2n*(2n**30n)
    assert(free>=needed,'INSUFFICIENT_RUNNER_DISK: need '+needed+' B for real Desktop 4GiB CAS/disk, free '+free+' B (infrastructure, not product red)')
  }
  const rows=[]
  try{
    for(let n=1;n<=3;n++){
      const row=await runOne(n,temp)
      rows.push(row)
      fs.writeFileSync(path.join(out,row.sample+'.json'),JSON.stringify(row,null,2)+'\n')
      console.log('REAL_DESKTOP_CAS_SAMPLE '+JSON.stringify(row))
    }
    // A green CI is not sufficient if a result field is accidentally a
    // pathname/string rather than the actual Electron measurement object.
    assert(rows.length===3 && rows.every(row => {
      return row.upload?.scenario==='upload'&&row.download?.scenario==='download'&&
        row.upload.bytes===transferBytes&&row.download.bytes===transferBytes&&
        [row.upload,row.download].every(record=>
          Number.isFinite(record.elapsedMs)&&record.elapsedMs>0&&record.elapsedMs<=maxDirectionMs&&
          Number.isFinite(record.throughputMiBps)&&record.throughputMiBps>0&&
          Number.isFinite(record.rendererWorkingSetGrowthKiB)&&
          record.rendererWorkingSetGrowthKiB>=0&&record.rendererWorkingSetGrowthKiB<=256*1024&&
          Number.isFinite(record.electronMainCPUUserMs)&&
          Number.isFinite(record.electronMainCPUSystemMs))&&
        row.uploadedBytes===transferBytes&&row.downloadedBytes===transferBytes&&
        row.server?.cas_valid===true&&row.server?.put_count===putCount&&
        row.server?.download_get_count===1&&
        row.server?.file_sha256===row.downloadSHA256&&
        (!highEntropyDesktop||(
          row.highEntropyDesktop&&row.physicalSource?.allocatedBytes>=transferBytes*.98&&
          row.physicalSource?.sourceSHA256===row.downloadSHA256&&
          row.physicalSource?.sourceSHA256===row.server.file_sha256))
    }), 'n3 Desktop real CAS result summary missing genuine numeric upload/download and SHA metrics')
    const result={
      name:`desktop-renderer-preload-main-agent-postgres17-physical-cas-${sizeGiB}gib-${highEntropyDesktop?'high-entropy':'sparse-zero'}`,
      highEntropyDesktop,
      physicalPayloadBytes:transferBytes,
      physicalPayloadGiB:sizeGiB,
      status:'CURRENT-BEFORE only / no production code optimization',
      n:rows.length,
      uploadMedianMs:median(rows.map(r=>r.upload.elapsedMs)),
      downloadMedianMs:median(rows.map(r=>r.download.elapsedMs)),
      uploadMedianMiBps:median(rows.map(r=>r.upload.throughputMiBps)),
      downloadMedianMiBps:median(rows.map(r=>r.download.throughputMiBps)),
      maxAgentRSSGrowthBytes:Math.max(...rows.map(r=>r.agentRssGrowthBytes)),
      maxServerRSSGrowthBytes:Math.max(...rows.map(r=>r.serverRssGrowthBytes)),
      maxRendererWorkingSetGrowthKiB:Math.max(...rows.flatMap(r=>[
        r.upload.rendererWorkingSetGrowthKiB,r.download.rendererWorkingSetGrowthKiB])),
      budgets:{
        perDirectionBytes:transferBytes,uploadMsEachMax:maxDirectionMs,downloadMsEachMax:maxDirectionMs,
        agentRssPeakGrowthMaxMiB:256,serverRssPeakGrowthMaxMiB:256,
        rendererWSGrowthMaxMiB:256,
        expectedPUTsEach:putCount,expectedGETsEach:1,
      },
      actualRealUIBoundary:highEntropyDesktop?
        `Authenticated Desktop Renderer/Preload/Main/Go Agent IPC -> Gin/PostgreSQL17/physically allocated high-entropy ${sizeGiB} GiB original CAS; source file SHA256 equals complete downloaded Desktop File SHA256 and actual Server CAS SHA. Linux loopback, not physical Windows Desktop, WAN, installed PWA, permanent task cancellation or FileExplorer button clicks; no production changes.`
        :'Electron Renderer uses actual Preload.cloudUploadDroppedFiles(file) with CDP-inserted File, actual Main upload-paths, real Go Agent IPC and genuine Gin/PostgreSQL/CAS; real Download uses production native Main file-save IPC with ONLY test OS-dialog selection override. NOT actual FileExplorer button clicks, not WAN, not durable cancellation.',
      samples:rows,
      passed:rows.length===3
    }
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n')
    console.log('REAL_DESKTOP_CAS_SUMMARY '+JSON.stringify(result))
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
}
main().catch(err=>{console.error('REAL_DESKTOP_CAS_ERROR '+(err?.stack||String(err)));process.exitCode=1})
