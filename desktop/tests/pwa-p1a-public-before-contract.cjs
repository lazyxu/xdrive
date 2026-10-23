'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const code=fs.readFileSync(path.join(root,'desktop/scripts/pwa-p1a-public-before.cjs'),'utf8')
const ci=fs.readFileSync(path.join(root,'.github/workflows/pwa-p1a-public-before.yml'),'utf8')
test('P1A measures normal Vite manifest, not isolated performance harness',()=>{
 for(const k of ["'.vite/manifest.json'","manifest[key].imports","manifest[key].dynamicImports",
  "gzipSync","initialGzipBytes","pairedAfter:false","authenticated100k:false"])
  assert(code.includes(k),k)
})
test('P1A native Chrome 390/430/899/900/1280 n3 cold and warm',()=>{
 for(const k of ['WIDTHS=[390,430,899,900,1280]','N=3','chromium.launchPersistentContext',
  'Network.loadingFinished',"first-contentful-paint","samples.length,15",
  "fs.rmSync(profile,{force:true,recursive:true})"])assert(code.includes(k),k)
 assert(!code.includes('route.fulfill('))
})
test('P1A current-head CI and no user-private byte artifacts',()=>{
 for(const k of ['github.event.pull_request.head.sha',
  'node --check desktop/scripts/pwa-p1a-public-before.cjs',
  'node --test desktop/tests/pwa-p1a-public-before-contract.cjs',
  'playwright-core@1.56.1','XD_PR_HEAD','actions/upload-artifact@v4'])
  assert(ci.includes(k),k)
 assert(!ci.includes('continue-on-error:'))
 assert(!ci.includes('workflow_dispatch:'))
 assert(code.includes("uri.pathname.startsWith('/api/')"))
})
