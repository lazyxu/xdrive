'use strict'
const fs=require('node:fs')
const path=require('node:path')
const assert=require('node:assert/strict')
const {performance}=require('node:perf_hooks')
const {app,dialog}=require('electron')
const desktopRoot=path.resolve(__dirname,'..')
assert.equal(path.resolve(app.getAppPath()),desktopRoot,'authentic Desktop app required')
const mode=process.env.XD_DESKTOP_CAS_MODE
const sourceFile=process.env.XD_DESKTOP_CAS_SOURCE_PATH
const destinationFile=process.env.XD_DESKTOP_CAS_DESTINATION
const parentID=Number(process.env.XD_DESKTOP_CAS_ROOT_ID)
const nodeID=Number(process.env.XD_DESKTOP_CAS_NODE_ID)
const size=1073741824
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
if(!['upload','download'].includes(mode))throw Error('Desktop performance mode invalid')
if((mode==='upload'&&(!sourceFile||!fs.existsSync(sourceFile)))||
   (mode==='download'&&(!destinationFile||!Number.isSafeInteger(nodeID)))||
   !Number.isSafeInteger(parentID)||parentID<=0)throw Error('native Desktop performance file and root missing')

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('enable-precise-memory-info')

if(mode==='download'){
  // Test-only bypass of the OS dialog; the production Main/Agent download is intact.
  dialog.showSaveDialog=async()=>({canceled:false,filePath:destinationFile})
}
async function until(check,ms,label){
  const started=performance.now()
  while(performance.now()-started<ms){
    const value=await check()
    if(value)return value
    await sleep(50)
  }
  throw Error('timeout waiting for real Desktop '+label)
}
function rendererRSSKiB(){
  const found=app.getAppMetrics().find(x=>x.type==='Tab')||
    app.getAppMetrics().find(x=>x.type==='Renderer')
  return found?.memory?.workingSetSize??null
}
async function run(win){
  try{
    await until(async()=>{
      if(win.isDestroyed())throw Error('Desktop window destroyed')
      const v=await win.webContents.executeJavaScript(
        '({renderer: Boolean(document.querySelector("nav[aria-label=\\"桌面版功能区\\"]")), preload: Boolean(window.xdriveDesktop?.agent)})',
        true
      ).catch(()=>({renderer:false,preload:false}))
      return v.renderer&&v.preload
    },45000,'Renderer and production Preload')
    const rootResult=await win.webContents.executeJavaScript(
      '(async()=>await window.xdriveDesktop.agent.cloudRoot())()',true)
    assert(rootResult.ok===true&&rootResult.data.id===parentID,
      'real Desktop authentication/root lookup failed: '+JSON.stringify(rootResult))
    if(mode==='upload'){
      await win.webContents.executeJavaScript(
        '(()=>{const input=document.createElement("input");input.id="xdrive-actual-desktop-upload";input.type="file";input.hidden=true;document.body.appendChild(input);return true})()',true)
      win.webContents.debugger.attach('1.3')
      try{
        const d=await win.webContents.debugger.sendCommand('DOM.getDocument',{depth:1})
        const t=await win.webContents.debugger.sendCommand('DOM.querySelector',{
          nodeId:d.root.nodeId,selector:'#xdrive-actual-desktop-upload'
        })
        assert(t.nodeId,'real CDP file input unavailable')
        await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{
          nodeId:t.nodeId,files:[sourceFile]
        })
      }finally{win.webContents.debugger.detach()}
    }
    const rssStart=rendererRSSKiB()
    assert(rssStart&&rssStart>0,'actual Electron Renderer RSS unavailable')
    let rssPeak=rssStart
    const poll=setInterval(()=>{
      const v=rendererRSSKiB()
      if(v&&v>rssPeak)rssPeak=v
    },25)
    const cpuBefore=process.cpuUsage()
    const started=performance.now()
    let reply
    try{
      if(mode==='upload'){
        reply=await win.webContents.executeJavaScript(
          '(async()=>{'+
          'const input=document.getElementById("xdrive-actual-desktop-upload");'+
          'if(!input?.files||input.files.length!==1||input.files[0].size!=='+size+
          ')throw Error("Desktop source File missing or wrong size");'+
          'return window.xdriveDesktop.agent.cloudUploadDroppedFiles('+parentID+
          ',Array.from(input.files));'+
          '})()',true)
      }else{
        reply=await win.webContents.executeJavaScript(
          '(async()=>window.xdriveDesktop.agent.cloudDownload('+
          nodeID+','+JSON.stringify(path.basename(destinationFile))+'))()',true)
      }
    }finally{clearInterval(poll)}
    const elapsed=performance.now()-started
    const cpu=process.cpuUsage(cpuBefore)
    const rssEnd=rendererRSSKiB()
    if(rssEnd&&rssEnd>rssPeak)rssPeak=rssEnd
    if(!reply?.ok)throw Error('real Preload/Main/Agent IPC failed: '+JSON.stringify(reply))
    if(mode==='upload'){
      assert.equal(reply.data?.failures?.length,0,'native Desktop upload errors')
      assert.equal(reply.data?.uploaded?.length,1,'Desktop upload missing one node')
      assert(reply.data.uploaded[0].id>0&&reply.data.uploaded[0].size===size)
    }else assert(reply.data?.saved===true,'native Desktop save dialog failed')
    const row={
      scenario:mode,
      scope:'authentic Electron Renderer -> Preload -> Main -> Go Agent IPC -> genuine Gin/PG17/CAS',
      nodeID:mode==='upload'?reply.data.uploaded[0].id:nodeID,
      bytes:size,
      elapsedMs:elapsed,
      throughputMiBps:1024/(elapsed/1000),
      rendererWorkingSetStartKiB:rssStart,
      rendererWorkingSetPeakKiB:rssPeak,
      rendererWorkingSetGrowthKiB:rssPeak-rssStart,
      electronMainCPUUserMs:cpu.user/1000,
      electronMainCPUSystemMs:cpu.system/1000,
      ...(mode==='download'?{destination:destinationFile}:{})
    }
    console.log('REAL_DESKTOP_TO_CAS_TRANSFER '+JSON.stringify(row))
    if(row.rendererWorkingSetGrowthKiB>256*1024||elapsed>240000)
      throw Error('Desktop to CAS resource budget exceeded')
    app.exit(0)
  }catch(error){
    console.error('REAL_DESKTOP_TO_CAS_ERROR '+(error?.stack||String(error)))
    app.exit(1)
  }
}
let hooked=false
app.on('browser-window-created',(_ev,win)=>{
  if(hooked)return
  hooked=true
  win.webContents.once('did-finish-load',()=>{void run(win)})
})
require('../dist/main/index.cjs')
