'use strict'
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {spawn,spawnSync}=require('node:child_process')
const {AgentIPCClient}=require('../dist/main/agent_client.cjs')
const root=path.resolve(__dirname,'..','..')
const agentBinary=path.resolve(process.env.XD_DESKTOP_MAP_E2E_AGENT_BINARY||'')
const electronBinary=require('electron')
const ip='10.233.15.12'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function openssl(dir,args){
  const p=spawnSync('openssl',args,{cwd:dir,encoding:'utf8'})
  assert.equal(p.status,0,'synthetic certificate creation failed: '+p.stderr)
}
function certificates(dir){
  openssl(dir,['req','-x509','-newkey','rsa:2048','-nodes','-days','2',
    '-subj','/CN=xDrive synthetic map CA',
    '-addext','basicConstraints=critical,CA:TRUE',
    '-addext','keyUsage=critical,keyCertSign,cRLSign',
    '-keyout','root.key','-out','root.pem'])
  openssl(dir,['req','-new','-newkey','rsa:2048','-nodes',
    '-subj','/CN=xDrive synthetic map leaf',
    '-keyout','leaf.key','-out','leaf.csr'])
  fs.writeFileSync(path.join(dir,'leaf.ext'),
    'basicConstraints=critical,CA:FALSE\n'+
    'keyUsage=critical,digitalSignature,keyEncipherment\n'+
    'extendedKeyUsage=serverAuth\nsubjectAltName=IP:'+ip+'\n')
  openssl(dir,['x509','-req','-in','leaf.csr','-CA','root.pem','-CAkey','root.key',
    '-CAcreateserial','-days','1','-out','leaf.pem','-extfile','leaf.ext'])
  return {ca:fs.readFileSync(path.join(dir,'root.pem'),'utf8'),
    leaf:path.join(dir,'leaf.pem'),key:path.join(dir,'leaf.key')}
}
function run(command,args,env,cwd=root){
  const proc=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']})
  // Never forward private test JWTs or the native Agent's stdout to CI.
  proc.stdout.on('data',()=>{})
  proc.stderr.on('data',()=>{})
  const exit=new Promise(resolve=>proc.once('exit',(code,signal)=>resolve({code,signal})))
  return {proc,exit}
}
async function until(fn,ms,reason){
  const started=Date.now()
  while(Date.now()-started<ms){
    const value=await fn()
    if(value)return value
    await sleep(150)
  }
  throw Error('timeout waiting for '+reason)
}
async function stop(p){
  if(!p||p.proc.exitCode!==null)return
  p.proc.kill('SIGTERM')
  const result=await Promise.race([p.exit,sleep(5000).then(()=>null)])
  if(!result){p.proc.kill('SIGKILL');await p.exit}
}
async function electron(input,env,attempt){
  let passed=null,lines='',errors=''
  const proc=spawn(electronBinary,['--no-sandbox','--disable-gpu',
    path.join(root,'desktop','scripts','places-desktop-real-agent-electron-main.cjs')],{
    cwd:path.join(root,'desktop'),
    env:{...process.env,...env},stdio:['pipe','pipe','pipe']
  })
  proc.stdout.on('data',chunk=>{
    lines+=chunk.toString()
    const parts=lines.split('\n');lines=parts.pop()
    for(const line of parts)if(line.startsWith('XDRIVE_REAL_AGENT_ELECTRON_MAP ')){
      passed=JSON.parse(line.slice('XDRIVE_REAL_AGENT_ELECTRON_MAP '.length))
    }
  })
  proc.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-6000)})
  proc.stdin.end(JSON.stringify(input)+'\n')
  const exited=new Promise(resolve=>proc.once('exit',(code,signal)=>resolve({code,signal})))
  try{
    const end=await Promise.race([exited,sleep(115000).then(()=>({code:'timeout'}))])
    assert.equal(end.code,0,'real Electron launch '+attempt+
      ' failed, private details redacted: '+errors.slice(-1000))
    assert.deepEqual({
      agent:passed?.actualGoAgent,gin:passed?.actualGinPostgres,
      guest:passed?.actualElectronWebView,ticket:passed?.nativeTicketOneUse,
      cookie:passed?.secureHttpOnlyCookie,owner:passed?.exactOwner,
      negatives:passed?.rejectedReplayAndForeignOrigin
    },{agent:true,gin:true,guest:true,ticket:true,cookie:true,
      owner:true,negatives:true})
    return passed
  }finally{
    if(proc.exitCode===null){proc.kill('SIGTERM');await Promise.race([exited,sleep(3000)])}
  }
}
async function main(){
  assert.ok(process.env.XD_TEST_DATABASE_URL,'isolated PostgreSQL required')
  assert.ok(fs.existsSync(agentBinary),'actual compiled Go Agent required')
  assert.ok(fs.existsSync(path.join(root,'desktop','dist','main','index.cjs')),
    'Desktop Main source must be built alongside actual TLS/Agent IPC modules')
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-map-real-agent-'))
  let server=null,agent=null,ipc=null
  try{
    const tls=certificates(temp)
    const ready=path.join(temp,'ready.json'),stopFile=path.join(temp,'stop')
    server=run('go',['test','-run','^TestDesktopMapRealAgentHTTPSFixture$',
      '-count=1','-timeout=6m','-v','./internal/api'],{
      ...process.env,XD_DESKTOP_MAP_REAL_AGENT_E2E:'1',XD_DESKTOP_MAP_E2E_IP:ip,
      XD_DESKTOP_MAP_E2E_CERT_FILE:tls.leaf,
      XD_DESKTOP_MAP_E2E_KEY_FILE:tls.key,
      XD_DESKTOP_MAP_E2E_READY_FILE:ready,XD_DESKTOP_MAP_E2E_STOP_FILE:stopFile
    })
    const fixture=await until(()=>{
      if(server.proc.exitCode!==null)throw Error('Gin PostgreSQL TLS fixture failed')
      return fs.existsSync(ready)?JSON.parse(fs.readFileSync(ready,'utf8')):null
    },180000,'real Gin HTTPS fixture')
    assert.ok(fixture.url.startsWith('https://'+ip+':'))
    assert.equal(fixture.username,'desktop-map-e2e-owner')
    const config=path.join(temp,'config'),cache=path.join(temp,'cache')
    fs.mkdirSync(config,{recursive:true});fs.mkdirSync(cache,{recursive:true})
    const env={XDG_CONFIG_HOME:config,XDG_CACHE_HOME:cache,
      XD_DISABLE_SECRET_SERVICE:'1',XD_AGENT_PATH:agentBinary}
    agent=run(agentBinary,[],{...process.env,...env})
    const discovery=path.join(config,'xdrive','desktop-ipc.json')
    await until(()=>{
      if(agent.proc.exitCode!==null)throw Error('Go Agent exited before discovery')
      return fs.existsSync(discovery)
    },25000,'production local Go Agent IPC')
    ipc=new AgentIPCClient(discovery)
    const hello=await ipc.hello()
    assert.ok(hello.protocol_min<=2&&hello.protocol_max>=2)
    const status=await ipc.login({
      server:fixture.url,username:fixture.username,
      password:'SyntheticAgentOnly-2026!',trusted_lan_root_pem:tls.ca
    })
    assert.equal(status.configured,true)
    assert.equal(status.username,fixture.username)
    assert.equal(status.must_change_password,false)
    await ipc.setPaused(true)
    const results=[]
    for(let attempt=1;attempt<=2;attempt++){
      // Agent lives across both genuine Electron launches. Each gets a unique
      // real single-use ticket and a fresh nonpersistent Chromium partition.
      const grant=await ipc.desktopMapGuestGrant()
      assert.equal(grant.username,fixture.username)
      assert.match(grant.ticket,/^[0-9a-f]{64}$/)
      assert.ok(grant.expires_in>0&&grant.expires_in<=30)
      results.push(await electron({origin:fixture.url,owner:fixture.username,
        ticket:grant.ticket,ca:tls.ca},env,attempt))
    }
    await ipc.logout()
    await assert.rejects(ipc.desktopMapGuestGrant(),()=>true,
      'Agent logout must refuse any new map grant')
    console.log('XDRIVE_REAL_AGENT_MAP_RESTART '+JSON.stringify({
      passed:true,actualGinPostgres:true,actualGoAgentIPC:true,
      actualElectronWebView:true,electronLaunches:results.length,
      maintainedNativeLogin:true,rememberedPassword:false,
      independentlyRedeemedTickets:true,postLogoutGrantDenied:true,
      syntheticMapPage:true,productionDesktopMainAndGalleryUI:false
    }))
  }finally{
    if(ipc)await ipc.shutdown().catch(()=>{})
    await stop(agent)
    if(server){
      fs.writeFileSync(path.join(temp,'stop'),'stop')
      const ended=await Promise.race([server.exit,sleep(5000).then(()=>null)])
      if(!ended)await stop(server)
    }
    fs.rmSync(temp,{recursive:true,force:true})
  }
}
main().catch(e=>{console.error('real Agent/Electron E2E FAILED: '+String(e?.stack||e));process.exitCode=1})
