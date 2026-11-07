'use strict'
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {spawn,spawnSync}=require('node:child_process')
const {AgentIPCClient}=require('../dist/main/agent_client.cjs')
const electronBinary=require('electron')

const root=path.resolve(__dirname,'../..')
const desktop=path.join(root,'desktop')
const webdist=path.join(root,'web','dist')
const agentBinary=path.resolve(process.env.XD_DESKTOP_PLACES_AGENT_BINARY||'')
const ip='10.233.15.19'
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function openssl(dir,args){
  const result=spawnSync('openssl',args,{cwd:dir,encoding:'utf8'})
  assert.equal(result.status,0,'synthetic certificate fixture failed')
}
function certificate(dir){
  openssl(dir,['req','-x509','-newkey','rsa:2048','-nodes','-days','2',
    '-subj','/CN=xDrive production map E2E synthetic CA',
    '-addext','basicConstraints=critical,CA:TRUE',
    '-addext','keyUsage=critical,keyCertSign,cRLSign',
    '-keyout','root.key','-out','root.pem'])
  openssl(dir,['req','-new','-newkey','rsa:2048','-nodes',
    '-subj','/CN=xDrive production map E2E synthetic IP',
    '-keyout','leaf.key','-out','leaf.csr'])
  fs.writeFileSync(path.join(dir,'leaf.ext'),
    'basicConstraints=critical,CA:FALSE\n'+
    'keyUsage=critical,digitalSignature,keyEncipherment\n'+
    'extendedKeyUsage=serverAuth\nsubjectAltName=IP:'+ip+'\n')
  openssl(dir,['x509','-req','-in','leaf.csr','-CA','root.pem','-CAkey','root.key',
    '-CAcreateserial','-days','1','-out','leaf.pem','-extfile','leaf.ext'])
  return {ca:fs.readFileSync(path.join(dir,'root.pem'),'utf8'),
    key:path.join(dir,'leaf.key'),cert:path.join(dir,'leaf.pem')}
}
async function until(fn,timeout,label){
  const start=Date.now()
  while(Date.now()-start<timeout){
    const v=await fn()
    if(v)return v
    await delay(180)
  }
  throw Error('timed out waiting for '+label)
}
function launch(binary,args,env){
  const child=spawn(binary,args,{cwd:root,env,stdio:['ignore','pipe','pipe']})
  let carry='',errors='',highlighted='',stderrTail=''
  const markers=[]
  child.stdout.on('data',chunk=>{
    const parts=(carry+chunk.toString()).split('\n')
    carry=parts.pop()
    for(const line of parts){
      if(line.startsWith('XDRIVE_PLACES_PRODUCTION_RESTART ')){
        markers.push(JSON.parse(line.slice('XDRIVE_PLACES_PRODUCTION_RESTART '.length)))
      }
      if(line.includes('XDRIVE_PLACES_PRODUCTION_FAILED'))errors+=line.slice(0,900)+'\n'
    }
  })
  child.stderr.on('data',chunk=>{
    const next=chunk.toString()
    errors=(errors+next).slice(-3500)
    const lines=(stderrTail+next).split('\n')
    stderrTail=lines.pop()
    for(const line of lines)if(line.includes('XDRIVE_PLACES_PRODUCTION_FAILED ')){
      // Retain the bounded test-only stage, not Chromium's noisy D-Bus tail.
      highlighted=line.slice(line.indexOf('XDRIVE_PLACES_PRODUCTION_FAILED '),1000)
    }
  })
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
  return {child,exited,markers,getError:()=>highlighted||errors}
}
async function stop(processInfo){
  if(!processInfo||processInfo.child.exitCode!==null)return
  processInfo.child.kill('SIGTERM')
  if(await Promise.race([processInfo.exited,delay(5000).then(()=>null)]))return
  processInfo.child.kill('SIGKILL')
  await processInfo.exited
}
async function bootElectron(boot,env,bootstrap){
  const electronEnv={...process.env,...env,XD_DESKTOP_PLACES_BOOT:String(boot)}
  delete electronEnv.ELECTRON_RUN_AS_NODE
  const proc=launch(electronBinary,['--no-sandbox','--disable-gpu',bootstrap],electronEnv)
  try{
    const result=await Promise.race([
      proc.exited,delay(135000).then(()=>({code:'timeout'}))
    ])
    assert.equal(result.code,0,'production Desktop map boot '+boot+
      ' failed: '+proc.getError().slice(-1800))
    assert.equal(proc.markers.length,1,'real production Web map result absent')
    const row=proc.markers[0]
    assert.equal(row.passed,true)
    assert.equal(row.phase,boot)
    assert.equal(row.productionMain,true)
    assert.equal(row.productionPreload,true)
    assert.equal(row.productionRenderer,true)
    assert.equal(row.actualWebVite,true)
    assert.equal(row.realGuest,true)
    assert.equal(row.noNestedLogin,true)
    assert.equal(row.exactOwnerCells,9)
    assert.equal(row.exactFavorites,3)
    assert.equal(row.exactFamily,3)
    assert.equal(row.exactFamilyFavorites,2)
    assert.equal(row.exactViewerRange,9)
    assert.equal(row.viewerMetadata,true)
    assert.equal(row.noUnrelatedMapBearerAccess,true)
    return row
  }finally{
    await stop(proc)
  }
}
async function main(){
  assert.ok(process.env.XD_TEST_DATABASE_URL,'isolated PostgreSQL required')
  assert.ok(fs.existsSync(agentBinary),'real compiled Go Agent required')
  for(const file of [path.join(webdist,'index.html'),
    path.join(desktop,'dist','main','index.cjs'),
    path.join(desktop,'dist','preload','index.cjs'),
    path.join(desktop,'dist','preload','places_embed.cjs'),
    path.join(desktop,'dist','renderer','index.html')]){
    assert.ok(fs.existsSync(file),'real built Desktop/Web asset missing')
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xd-real-production-places-'))
  const bootstrap=path.join(desktop,'.places-production-e2e-entry.cjs')
  const config=path.join(dir,'config'),cache=path.join(dir,'cache')
  fs.mkdirSync(config,{recursive:true})
  fs.mkdirSync(cache,{recursive:true})
  const env={
    XDG_CONFIG_HOME:config,XDG_CACHE_HOME:cache,
    XD_DISABLE_SECRET_SERVICE:'1',XD_AGENT_PATH:agentBinary,
  }
  let server=null,agent=null,ipc=null
  try{
    const tls=certificate(dir)
    const ready=path.join(dir,'ready.json'),stopFile=path.join(dir,'stop')
    server=launch('go',['test','-run','^TestDesktopPlacesProductionWebRestartFixture$',
      '-count=1','-timeout=8m','-v','./internal/api'],{
      ...process.env,XD_DESKTOP_PLACES_PRODUCTION_E2E:'1',
      XD_DESKTOP_PLACES_IP:ip,
      XD_DESKTOP_PLACES_WEB_DIST:webdist,
      XD_DESKTOP_PLACES_READY_FILE:ready,
      XD_DESKTOP_PLACES_STOP_FILE:stopFile,
      XD_DESKTOP_PLACES_CERT_FILE:tls.cert,
      XD_DESKTOP_PLACES_KEY_FILE:tls.key,
    })
    const fixture=await until(()=>{
      if(server.child.exitCode!==null)throw Error('real Gin/PostgreSQL fixture failed')
      return fs.existsSync(ready)?JSON.parse(fs.readFileSync(ready,'utf8')):null
    },240000,'real production Web PostgreSQL fixture')
    assert.ok(fixture.url.startsWith('https://'+ip+':'))
    assert.equal(fixture.owner,'production-map-owner')
    assert.equal(fixture.total_owner,9)
    agent=launch(agentBinary,[],{...process.env,...env})
    const discovery=path.join(config,'xdrive','desktop-ipc.json')
    await until(()=>{
      if(agent.child.exitCode!==null)throw Error('real Go Agent exited unexpectedly')
      return fs.existsSync(discovery)
    },30000,'native Agent IPC')
    ipc=new AgentIPCClient(discovery)
    const hello=await ipc.hello()
    assert.ok(hello.protocol_min<=2&&hello.protocol_max>=2)
    const auth=await ipc.login({
      server:fixture.url,username:fixture.owner,
      password:'OnlySyntheticAgent-2026!',trusted_lan_root_pem:tls.ca,
    })
    assert.equal(auth.configured,true)
    assert.equal(auth.username,fixture.owner)
    await ipc.setPaused(true)
    fs.writeFileSync(bootstrap,
      "require('./scripts/places-desktop-production-web-electron-main.cjs')\n",
      {mode:0o600})
    const results=[]
    for(let boot=1;boot<=2;boot++){
      results.push(await bootElectron(boot,{
        ...env,XD_DESKTOP_PLACES_PRODUCTION_ORIGIN:fixture.url,
        XD_DESKTOP_PLACES_PRODUCTION_OWNER:fixture.owner,
      },bootstrap))
      const status=await ipc.status()
      assert.equal(status.configured,true)
      assert.equal(status.username,fixture.owner)
    }
    await ipc.logout()
    console.log('XDRIVE_PLACES_PRODUCTION_MAIN_WEB_COMPLETE '+JSON.stringify({
      passed:true,actualGinPostgres:true,actualAgent:true,
      productionDesktopMain:true,productionDesktopPreload:true,
      productionDesktopRenderer:true,productionWebGallery:true,
      productionMapGuest:true,restarts:results.length,
      AgentSessionRetained:true,savedDesktopPassword:false,
      noSecondLogin:true,OwnerExact:true,syntheticPhotoFixture:true,
      actualSignedOwnerCells:true,scopedAlbumFavoritesAndDate:true,
      actualViewerMetadata:true,mapBearerRouteFence:true,
      // No manual test, provider SDK, installed Windows or production server.
      physicalSystemTested:false,
    }))
  }finally{
    try{if(ipc)await ipc.shutdown()}catch{}
    await stop(agent)
    if(server){
      fs.writeFileSync(path.join(dir,'stop'),'stop')
      const exit=await Promise.race([server.exited,delay(12000).then(()=>null)])
      if(!exit)await stop(server)
    }
    fs.rmSync(bootstrap,{force:true})
    fs.rmSync(dir,{recursive:true,force:true})
  }
}
main().catch(error=>{
  console.error('PRODUCTION_MAP_TEST_FAIL '+String(error?.message||error).slice(0,900))
  process.exitCode=1
})
