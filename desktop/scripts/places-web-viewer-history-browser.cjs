#!/usr/bin/env node
'use strict'
// Real Chromium / React integration of the production Web App History hook and
// scoped Viewer hook. Synthetic loopback range data; this is NOT live Gin or
// production Baidu/iOS Safari validation. It complements the real Gin P0-17.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const http=require('node:http')
const {createRequire}=require('node:module')
const root=path.resolve(__dirname,'../..')
const repoRequire=createRequire(path.join(root,'desktop/package.json'))
const esbuild=repoRequire('esbuild')
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const output=path.resolve(process.env.XDRIVE_PLACES_WEB_HISTORY_RESULTS ||
  path.join(os.tmpdir(),'xdrive-places-web-viewer-history-results'))
fs.mkdirSync(output,{recursive:true})
const summary={head:process.env.XD_PR_HEAD||null,realChromium:true,
  realWebHistoryHook:true,realWebViewerHook:true,
  realGin:false,realBaiduProvider:false,checks:[],passed:false,errors:[]}
const record=(label,value)=>{
  summary.checks.push({label,passed:Boolean(value)})
  assert(value,label)
}
const pageHTML='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'+
  '<body><div id="root"></div><script defer src="/bundle.js"></script></body></html>'
const media=(id)=>({node:{id,name:'owner-photo-'+id+'.png',type:'file',
  revision:2,size:256,created_at:'2026-01-01T00:00:00Z',
  updated_at:'2026-01-01T00:00:00Z'},
  metadata:{mime_type:'image/png',media_kind:'image'},favorite:false})
const send=(res,status,body,type='application/json')=>{
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'})
  res.end(type==='application/json'?JSON.stringify(body):body)
}
const fixture={revoked:false,count:2,delay:0,reads:0,denials:0,aborts:0}
let server=null,browser=null
const main=async()=>{
  const bundled=await esbuild.build({
    entryPoints:[path.join(__dirname,'places-web-viewer-history-browser.tsx')],
    bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"'},
    nodePaths:[path.join(root,'desktop/node_modules')],
    logLevel:'silent',
  })
  assert.equal(bundled.outputFiles.length,1,'one exact source browser bundle')
  const bundle=bundled.outputFiles[0].contents
  server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1')
    if(req.method==='GET'&&url.pathname==='/')return send(res,200,pageHTML,'text/html; charset=utf-8')
    if(req.method==='GET'&&url.pathname==='/bundle.js')return send(res,200,bundle,'text/javascript')
    if(req.method==='POST'&&url.pathname==='/fixture/control'){
      const op=url.searchParams.get('op')
      if(op==='reset'){fixture.revoked=false;fixture.count=2;fixture.delay=0}
      else if(op==='revoke')fixture.revoked=true
      else if(op==='restore')fixture.revoked=false
      else if(op==='count3')fixture.count=3
      else if(op==='delay')fixture.delay=1250
      else return send(res,400,{error:'unsupported control'})
      return send(res,200,{ok:true})
    }
    if(req.method==='GET'&&url.pathname==='/fixture/owner-range'){
      const kind=url.searchParams.get('kind')
      if(kind!=='cell'&&kind!=='viewport')return send(res,400,{error:'invalid kind'})
      fixture.reads++
      req.once('close',()=>{if(!res.writableEnded)fixture.aborts++})
      const respond=()=>{
        if(res.writableEnded||res.destroyed)return
        if(fixture.revoked){fixture.denials++;return send(res,403,{error:'OWNER_SCOPE_REVOKED'})}
        const count=fixture.count
        send(res,200,{total_count:count,items:Array.from({length:count},(_,i)=>media(101+i))})
      }
      if(fixture.delay)setTimeout(respond,fixture.delay)
      else respond()
      return
    }
    send(res,404,{error:'not found'})
  })
  await new Promise((resolve,reject)=>{
    server.once('error',reject)
    server.listen(0,'127.0.0.1',resolve)
  })
  const origin='http://127.0.0.1:'+server.address().port
  const control=async(op)=>{
    const r=await fetch(origin+'/fixture/control?op='+op,{method:'POST'})
    assert(r.ok,op+' control failed')
  }
  const waitServerRead=async(before)=>{
    for(let n=0;n<160&&fixture.reads<=before;n++)
      await new Promise(resolve=>setTimeout(resolve,10))
    assert(fixture.reads>before,'real loopback HTTP Owner read did not start')
  }
  const executablePath=process.env.XDRIVE_BROWSER_EXECUTABLE
  assert(executablePath&&fs.existsSync(executablePath),'an actual Chromium executable is required')
  browser=await chromium.launch({executablePath,headless:true,args:[
    '--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']})
  const context=await browser.newContext({viewport:{width:390,height:844},
    isMobile:true,hasTouch:true,serviceWorkers:'block'})
  const page=await context.newPage()
  const pageErrors=[]
  page.on('pageerror',error=>pageErrors.push(error.name))
  page.setDefaultTimeout(16000)
  const probe=()=>page.evaluate(()=>({...window.__scopeHistoryProbe}))
  const status=async(expected)=>{
    await page.waitForFunction(value=>document.querySelector(
      '[data-testid="viewer-status"]')?.textContent===value,expected)
  }
  try{
    await page.goto(origin+'/#/app/gallery?section=places',
      {waitUntil:'domcontentloaded'})
    await page.locator('[data-testid="gallery"]').waitFor()
    await page.getByRole('button',{name:'打开 Cell 地图照片'}).click()
    await status('authorized')
    let data=await probe()
    const privateHash=page.url()
    const parsed=new URL(privateHash)
    const routeContext=new URLSearchParams(parsed.hash.split('?')[1]).get('context')
    record('real SPA route minted authority-free map marker',
      /^map-[a-z0-9-]+$/.test(routeContext||''))
    record('first signed-scope path uses only Owner Cell Range',
      data.rangeStarts===1&&data.pointReads===0&&data.otherGalleryReads===0)
    record('private map context never enters browser sessionStorage',
      await page.evaluate(()=>Object.keys(sessionStorage).every(k=>
        !k.includes('map-'))))
    await page.goBack()
    await page.locator('[data-testid="gallery"]').waitFor()
    const beforeForward=(await probe()).rangeStarts
    await page.goForward()
    await status('authorized')
    data=await probe()
    record('real browser Back/Forward recreates an authorized Owner Range',
      data.rangeStarts===beforeForward+1&&data.pointReads===0)
    await control('revoke')
    await page.goBack()
    await page.locator('[data-testid="gallery"]').waitFor()
    await page.goForward()
    await status('error')
    data=await probe()
    record('revoked forward fails closed; no unrelated point or Gallery read',
      data.rangeDenials>=1&&data.pointReads===0&&data.otherGalleryReads===0&&
      !await page.locator('[data-testid="authorized-photo"]').count())
    await page.reload({waitUntil:'domcontentloaded'})
    await status('error')
    data=await probe()
    record('hard refresh of stale private URL denies BEFORE any range/point fetch',
      data.rangeStarts===0&&data.pointReads===0&&data.otherGalleryReads===0&&
      /地图照片范围已失效/.test(await page.locator('[data-testid="viewer-error"]').textContent()))
    await control('restore')
    await page.goBack()
    await page.locator('[data-testid="gallery"]').waitFor()
    await control('count3')
    await page.getByRole('button',{name:'打开 Viewport 地图照片'}).click()
    await status('error')
    data=await probe()
    record('viewport photo count drift denies before navigation/filmstrip cache',
      /地图照片范围已变化/.test(await page.locator('[data-testid="viewer-error"]').textContent())&&
      data.pointReads===0&&data.otherGalleryReads===0)
    await page.goBack()
    await page.locator('[data-testid="gallery"]').waitFor()
    await control('reset')
    await page.getByRole('button',{name:'普通直接打开照片'}).click()
    await status('authorized')
    data=await probe()
    record('a genuinely context-free direct photo retains point-read compatibility',
      data.pointReads===1&&data.otherGalleryReads===0)
    await page.goBack()
    await page.locator('[data-testid="gallery"]').waitFor()
    await page.goto(origin+'/#/app/media-viewer?node=101&context=legacy-missing-scope',
      {waitUntil:'domcontentloaded'})
    // Navigation inside one document preserves the earlier direct-link probe.
    // Reload to assert this legacy route from a genuine empty JS heap.
    await page.reload({waitUntil:'domcontentloaded'})
    await status('error')
    data=await probe()
    record('legacy missing context ID denies without fallback',
      /浏览范围已失效/.test(await page.locator('[data-testid="viewer-error"]').textContent())&&
      data.pointReads===0&&data.rangeStarts===0)
    await page.goto(origin+'/#/app/gallery?section=places',
      {waitUntil:'domcontentloaded'})
    await page.reload({waitUntil:'domcontentloaded'})
    await page.locator('[data-testid="gallery"]').waitFor()
    await control('delay')
    await page.getByRole('button',{name:'打开 Cell 地图照片'}).click()
    await page.waitForFunction(()=>window.__scopeHistoryProbe.rangeStarts>=1)
    await page.goBack()
    await page.locator('[data-testid="gallery"]').waitFor()
    await page.waitForFunction(()=>window.__scopeHistoryProbe.aborts>=1)
    data=await probe()
    record('real browser exit aborts stale private Owner fetch',data.aborts>=1)

    // Same Owner Cell: real Viewer neighbor navigation must retain the
    // authorized scope, not fall back to unscoped node/media API.
    await control('reset')
    await page.getByRole('button',{name:'打开 Cell 地图照片'}).click()
    await status('authorized')
    await page.waitForFunction(()=>!document.querySelector(
      'button[data-testid="viewer-next"]')?.disabled || Boolean(
      Array.from(document.querySelectorAll('button')).find(b=>
        b.textContent==='查看同 Cell 下一张照片'&&!b.disabled)))
    await page.getByRole('button',{name:'查看同 Cell 下一张照片'}).click()
    await page.getByText('Owner photo 102',{exact:true}).waitFor()
    data=await probe()
    record('same Cell Viewer next keeps exact Owner Range and no point fallback',
      data.pointReads===0&&data.otherGalleryReads===0&&
      !!await page.locator('[data-testid="authorized-photo"]').count())
    // An arbitrary route replacement is not a signed neighbor. It must deny
    // a Node outside the current Cell even though the filename is plausible.
    await page.getByRole('button',{name:'尝试打开非成员照片'}).click()
    await status('error')
    data=await probe()
    record('same-route forged nonmember fails closed without point fallback',
      data.pointReads===0&&data.otherGalleryReads===0&&
      !await page.locator('[data-testid="authorized-photo"]').count())
    await page.getByRole('button',{name:'返回地图'}).click()
    await page.locator('[data-testid="gallery"]').waitFor()

    // Replace a still-pending Cell range with the other map range WITHOUT
    // leaving the Viewer route. New scope preempts the old disposable read.
    await control('delay')
    const beforeSwitch=await probe()
    const serverReadsBeforeSwitch=fixture.reads
    await page.getByRole('button',{name:'打开 Cell 地图照片'}).click()
    await page.waitForFunction(before=>
      window.__scopeHistoryProbe.rangeStarts>before,beforeSwitch.rangeStarts)
    await waitServerRead(serverReadsBeforeSwitch)
    await page.getByRole('button',{name:'切换 Viewport 作用域'}).click()
    await page.waitForFunction(before=>
      window.__scopeHistoryProbe.rangeStarts>=before+2,beforeSwitch.rangeStarts)
    await status('authorized')
    data=await probe()
    record('same Viewer route changing map scope aborts old pending Cell read',
      data.aborts>beforeSwitch.aborts&&data.requests.at(-1)==='viewport')
    record('new Viewport scope alone authorizes current Viewer contents',
      data.pointReads===0&&data.otherGalleryReads===0&&
      !!await page.locator('[data-testid="authorized-photo"]').count())
    await page.getByRole('button',{name:'返回地图'}).click()
    await page.locator('[data-testid="gallery"]').waitFor()

    // Revoke an Owner while its HTTP response is genuinely in flight.
    // A late successful response must never be painted after revocation.
    await control('reset')
    await control('delay')
    const beforeRevoke=await probe()
    const serverReadsBeforeRevoke=fixture.reads
    await page.getByRole('button',{name:'打开 Cell 地图照片'}).click()
    await page.waitForFunction(before=>
      window.__scopeHistoryProbe.rangeStarts>before,beforeRevoke.rangeStarts)
    await waitServerRead(serverReadsBeforeRevoke)
    await control('revoke')
    await status('error')
    data=await probe()
    record('in-flight Owner revoke denies late Cell completion and fallback',
      data.rangeDenials>beforeRevoke.rangeDenials&&
      data.pointReads===0&&data.otherGalleryReads===0&&
      !await page.locator('[data-testid="authorized-photo"]').count())
    record('no browser page errors',pageErrors.length===0)
    summary.passed=true
  }finally{await context.close()}
}
main().catch(error=>{
  summary.errors.push(String(error?.message||error).slice(0,600))
  process.exitCode=1
}).finally(async()=>{
  if(browser)await browser.close()
  if(server)await new Promise(resolve=>server.close(resolve))
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2))
  console.log(JSON.stringify({passed:summary.passed,checks:summary.checks.length,
    errors:summary.errors},null,2))
})
