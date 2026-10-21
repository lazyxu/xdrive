'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
test('P0-C3 genuinely restarts a persistent Chromium profile while origin is down',()=>{
  const source=read('desktop/scripts/pwa-p0c3-persistent-restart.cjs')
  for(const text of [
    'chromium.launchPersistentContext(profile','const profile=fs.mkdtempSync(',
    'await ctx.close();ctx=null','transportDown=true',
    "await page.goto(address,{waitUntil:'domcontentloaded',timeout:30000})",
    "Network.emulateNetworkConditions","latency:450,downloadThroughput:16384",
    "fetch('/api/v1/readyz',{credentials:'omit',cache:'no-store'})",
    'assertXDrivePublicShellCache(snapshot)','n<=3',
    "fcpP95Ms:percentile(","installedHomeScreen:false",
    'realWAN:false,actual100k:false,privateCache:false',
    'afterOptimization:null','speedupClaim:null',
  ])assert(source.includes(text),'missing true persistent benchmark contract: '+text)
  const sw=read('assets/icon/web/sw.js')
  assert(sw.includes("if (request.method !== 'GET') return"))
  assert(sw.includes('if (url.origin !== self.location.origin) return'))
  assert(sw.includes('if (!SHELL_PATHS.has(url.pathname)'))
  assert(!sw.includes('self.skipWaiting('))
  assert(!source.includes('indexedDB.open('))
})
test('P0-C3 CI always requires original production SW, exact HEAD and numeric n3',()=>{
  const wf=read('.github/workflows/pwa-p0c3-persistent-restart-before.yml')
  for(const marker of [
    'pull_request:','playwright-core@1.56.1',
    'npm --prefix web run build','node --check desktop/scripts/pwa-p0c3-persistent-restart.cjs',
    'XD_PWA_P0C3_RESULT_DIR','github.event.pull_request.head.sha',
    'r.samples.length!==3','r.physicalIOS!==false',
    'r.phases.offline.fcpP95Ms>0','retention-days: 21',
  ])assert(wf.includes(marker),'missing exact-head native Chromium gate '+marker)
})
