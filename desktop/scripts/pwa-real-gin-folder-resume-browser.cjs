#!/usr/bin/env node
'use strict'
// B3B: real system Chrome folder chooser -> production shared Web/Mobile Files
// controller -> genuine Gin/PostgreSQL/CAS with test-only TCP failure on chunk 1.
// This is not an OS-installed Android or iOS Web App test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const match = /^--(ready|output-dir|mode)=(.+)$/.exec(value)
  assert(match, 'unsupported B3B argument')
  return [match[1], match[2]]
}))
assert(args.ready && args['output-dir'] && ['desktop', 'mobile'].includes(args.mode))
const ready = JSON.parse(fs.readFileSync(args.ready, 'utf8'))
assert.equal(ready.real_gin, true)
assert.equal(ready.postgresql, true)
assert.equal(ready.local_cas, true)
assert.equal(ready.pwa_s4b2_resume, true)
assert.equal(ready.pwa_s4b3_folder, true)
assert.equal(ready.pwa_s4b2_large_resume, false)
assert.equal(ready.intercepted_api, true)
assert.equal(ready.physical_device, false)
assert.equal(ready.upload_name, 'pwa-b3b-dynamic-child')
assert.equal(ready.upload_size_bytes, 17 * 1024 * 1024)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url))
const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE
assert(chrome && fs.existsSync(chrome), 'real system Chrome binary required')
const out = path.resolve(args['output-dir'])
fs.mkdirSync(out, {recursive:true})
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-pwa-b3b-'))
const folderName = 'pwa-b3b-album'
const folderPath = path.join(tmp, folderName)
const fileSpecs = [
  {name:'00-root-a.bin',relativePath:folderName+'/00-root-a.bin',seed:1},
  {name:'10-root-b.mov',relativePath:folderName+'/10-root-b.mov',seed:2},
  {name:'20-nested-c.bin',relativePath:folderName+'/nested/20-nested-c.bin',seed:3},
]
const pathByName = Object.fromEntries(fileSpecs.map(spec => [
  spec.name, path.join(tmp,spec.relativePath),
]))
const summary = {
  phase:'PWA-S4B2-B3B',
  mode: args.mode === 'mobile' ? 'Chrome Android UA/touch 390px emulation' : 'native Chrome desktop 1280px',
  physicalDevice:false, systemInstalled:false, realGin:true, realPostgreSQL:true,
  realLocalCAS:true, noApiMocks:true, simulatedNetworkDrop:true,
  sourceBytes: 17 * 1024 * 1024, sourceFiles:3, folderPicker:false,
  groupPartial:false, childFailedResume:false, completedSibling:false,
  cancelledSibling:false, nestedPathPresent:false, unstartedSiblingNotUploaded:false,
  hardReload:false, childReselected:false, firstChunkReused:false,
  originalParentRemainedPartial:false, finalTargetVerified:false,
  physicalCASVerified:false, onlyPublicOfflineCache:false,
  stage:'setup', passed:false, counters:null, observed:[],
}
const sessionKey = 'xdrive.web.transfer_history:' +
  encodeURIComponent(new URL(ready.url).origin + ':' + ready.username)
function snapshot(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]')
    .map(item => ({
      id:item.id, root_id:item.root_id, parent_id:item.parent_id, scope:item.scope,
      name:item.file_name, path:item.relative_path, state:item.state,
      cloudParent:item.cloud_parent_id, bytes:item.bytes_total,
      completed:item.items_completed, failed:item.items_failed,
      queued:item.items_queued, retryable:item.retryable === true,
      hasManifest:/^[a-f0-9]{64}$/.test(item.resume_manifest_sha256 || ''),
    })), sessionKey)
}
function makeFixture() {
  const hashes = {}
  for (const spec of fileSpecs) {
    const filename = pathByName[spec.name]
    fs.mkdirSync(path.dirname(filename), {recursive:true})
    const fd = fs.openSync(filename,'wx',0o600)
    const hash = crypto.createHash('sha256')
    const buf = Buffer.alloc(65536)
    try {
      for (let start=0;start<ready.upload_size_bytes;start+=buf.length) {
        for (let i=0;i<buf.length;i++) {
          const n = start+i
          buf[i] = (n*31+(n>>7)+spec.seed*13)%251
        }
        assert.equal(fs.writeSync(fd,buf),buf.length)
        hash.update(buf)
      }
      fs.fsyncSync(fd)
    } finally {fs.closeSync(fd)}
    assert.equal(fs.statSync(filename).size,ready.upload_size_bytes)
    hashes[spec.name]=hash.digest('hex')
  }
  return hashes
}
async function getStats() {
  const response = await fetch(ready.url + '/__test/pwa-s4b2/stats', {
    cache:'no-store', signal:AbortSignal.timeout(5000),
  })
  assert.equal(response.status, 200)
  return response.json()
}
async function run() {
  const expectedHashes = makeFixture()
  let browser, context, page
  try {
    browser = await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']})
    const mobile = args.mode === 'mobile'
    context = await browser.newContext({
      viewport: mobile ? {width:390,height:844} : {width:1280,height:800},
      isMobile:mobile, hasTouch:mobile, locale:'zh-CN', serviceWorkers:'allow',
      ...(mobile ? {userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36'} : {}),
    })
    page = await context.newPage()
    page.setDefaultTimeout(35000)
    const errors=[]
    page.on('pageerror', error => errors.push(error.name))
    const filesHash = '#/app/files?dir=' + ready.target_id
    const route = '/api/v1/nodes/' + ready.target_id
    const firstRead = page.waitForResponse(r => new URL(r.url()).pathname===route && r.status()===200)
    summary.stage='auth-deep-link'
    await page.goto(ready.url + '/' + filesHash,{waitUntil:'domcontentloaded'})
    await page.locator('#web-login-username').fill(ready.username)
    await page.locator('#web-login-password').fill('PwaRealGin-TestOnly_2026!')
    await page.getByRole('button',{name:'登录',exact:true}).click()
    await firstRead
    await page.locator(mobile ? '[data-xdrive-mobile-files]' : '[data-xdrive-file-explorer]').waitFor()
    const folderReady = ({id,name,mobile}) => mobile
      ? document.querySelector('[data-xdrive-mobile-files] [data-mobile-files-compact-title]')?.textContent?.trim()===name
      : document.querySelector('[data-xdrive-file-explorer] [data-xdrive-file-explorer-crumb][aria-current="page"]')
          ?.getAttribute('data-xdrive-file-explorer-crumb')==='number:'+String(id)
    await page.waitForFunction(folderReady,{id:ready.target_id,name:ready.target_name,mobile},{timeout:35000})
    assert.equal(new URL(page.url()).hash, filesHash)

    summary.stage='real-folder-chooser'
    if (mobile) await page.getByRole('button',{name:'文件操作菜单'}).click()
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      mobile
        ? page.getByRole('menuitem',{name:'上传文件夹',exact:true}).click()
        : page.getByRole('button',{name:'上传文件夹',exact:true}).first().click(),
    ])
    assert(await chooser.element().evaluate(el => el.hasAttribute('webkitdirectory')))
    // Playwright supplies an actual on-disk DIRECTORY to the genuine Chrome file input.
    // No request interception or synthetic /api response is permitted.
    await chooser.setFiles(folderPath)
    summary.folderPicker = true
    summary.stage='await-partial-group'
    let oldIDs
    await page.waitForFunction(({key,folderName}) => {
      const all = JSON.parse(localStorage.getItem(key) || '[]')
      const group = all.find(t => t.scope === 'group' && t.file_name === folderName &&
        t.state === 'partial' && t.items_total===3 &&
        t.items_completed===1 && t.items_failed===1 && t.items_queued===0)
      if (!group) return false
      const children = all.filter(t => t.parent_id===group.id)
      if (children.length!==3) return false
      const completed=children.filter(t => t.state==='completed')
      const interrupted=children.filter(t => t.state==='failed' && t.retryable===true &&
        /^[a-f0-9]{64}$/.test(t.resume_manifest_sha256||'') &&
        Number.isSafeInteger(t.cloud_parent_id) && t.cloud_parent_id>0)
      const cancelled=children.filter(t => t.state==='cancelled' && t.retryable!==true)
      return completed.length===1 && interrupted.length===1 && cancelled.length===1
    }, {key:sessionKey,folderName},{timeout:90000})
    const before=await snapshot(page)
    const group=before.find(t=>t.scope==='group' && t.name===folderName && t.state==='partial')
    assert(group)
    const children=before.filter(t=>t.parent_id===group.id)
    assert.equal(children.length,3)
    assert.deepEqual(children.map(t=>t.name).sort(),fileSpecs.map(s=>s.name).sort())
    for (const child of children) {
      const spec=fileSpecs.find(s=>s.name===child.name)
      assert(spec)
      assert.equal(child.path,spec.relativePath)
      assert.equal(child.bytes,ready.upload_size_bytes)
    }
    const completed=children.find(t=>t.state==='completed')
    const failure=children.find(t=>t.state==='failed' && t.retryable)
    const cancelled=children.find(t=>t.state==='cancelled')
    assert(completed && failure && cancelled)
    assert(failure.hasManifest)
    assert(Number.isSafeInteger(failure.cloudParent) && failure.cloudParent>0)
    assert.equal(cancelled.retryable,false)
    assert.equal(group.completed,1)
    assert.equal(group.failed,1)
    assert.equal(group.queued,0)
    const stats=await getStats()
    assert.equal(stats.session_posts,2)
    assert.equal(stats.chunk0_puts,2)
    assert.equal(stats.chunk2_puts,1)
    summary.groupPartial=true
    summary.childFailedResume=true
    summary.completedSibling=true
    summary.cancelledSibling=true
    summary.nestedPathPresent=children.some(t=>t.name==='20-nested-c.bin' &&
      t.path===folderName+'/nested/20-nested-c.bin')
    assert(summary.nestedPathPresent)
    summary.unstartedSiblingNotUploaded=true
    oldIDs={group:group.id,broken:failure.id,cloudParent:failure.cloudParent,
      name:failure.name,kept:completed.id,cancelled:cancelled.id}

    summary.stage='cold-reload'
    const reloadRead = page.waitForResponse(r => new URL(r.url()).pathname===route && r.status()===200)
    await page.reload({waitUntil:'domcontentloaded'})
    await reloadRead
    await page.waitForFunction(folderReady,{id:ready.target_id,name:ready.target_name,mobile},{timeout:35000})
    const after=await snapshot(page)
    assert.equal(after.find(t=>t.id===oldIDs.group)?.state,'partial')
    assert(after.some(t=>t.id===oldIDs.broken && t.state==='failed' && t.retryable && t.hasManifest))
    summary.hardReload=true
    assert.equal(new URL(page.url()).hash,filesHash)

    summary.stage='reselect-failed-folder-child'
    await page.locator('button[aria-label^="上传与下载"]').click()
    await page.getByRole('tab',{name:/历史记录/}).click()
    await page.getByRole('button',{name:'展开子任务'}).first().click()
    const action=page.getByRole('button',{name:'重新选择原文件',exact:true})
    await action.waitFor()
    const [again]=await Promise.all([page.waitForEvent('filechooser'),action.click()])
    const finalized=page.waitForResponse(r => r.request().method()==='POST' &&
      /\/api\/v1\/uploads\/[^/]+\/finalize$/.test(new URL(r.url()).pathname) &&
      r.status()===200,{timeout:100000})
    const failedSource=pathByName[oldIDs.name]
    assert(failedSource && fs.existsSync(failedSource))
    await again.setFiles(failedSource)
    const final=await (await finalized).json()
    assert.equal(final.result?.sha256,expectedHashes[oldIDs.name])
    assert.equal(final.result?.size,ready.upload_size_bytes)
    assert.equal(final.result?.parent_id,oldIDs.cloudParent)
    summary.finalTargetVerified=true
    await page.waitForFunction(({key,id}) => {
      const records=JSON.parse(localStorage.getItem(key)||'[]')
      return records.some(t=>t.id===id && t.retryable===false && !t.resume_manifest_sha256)
    },{key:sessionKey,id:oldIDs.broken},{timeout:35000})
    const finalHistory=await snapshot(page)
    assert.equal(finalHistory.find(t=>t.id===oldIDs.group)?.state,'partial')
    assert.equal(finalHistory.find(t=>t.id===oldIDs.broken)?.retryable,false)
    assert.equal(finalHistory.find(t=>t.id===oldIDs.group)?.completed,1)
    assert.equal(finalHistory.find(t=>t.id===oldIDs.kept)?.state,'completed')
    assert.equal(finalHistory.find(t=>t.id===oldIDs.cancelled)?.state,'cancelled')
    summary.originalParentRemainedPartial=true
    summary.childReselected=true

    summary.stage='gin-cas-postflight'
    summary.counters=await getStats()
    assert.equal(summary.counters.session_posts,3)
    assert.equal(summary.counters.chunk0_puts,2)
    assert.equal(summary.counters.chunk2_puts,2)
    assert(summary.counters.chunk1_puts>=3)
    assert.equal(summary.counters.tcp_drops,summary.counters.chunk1_puts-2)
    assert.equal(summary.counters.total_chunk_puts,
      summary.counters.chunk0_puts + summary.counters.chunk1_puts + summary.counters.chunk2_puts)
    summary.firstChunkReused=true
    const cache=await page.evaluate(async () => {
      const names=await caches.keys()
      const paths=[]
      for (const name of names) {
        const entries=await (await caches.open(name)).keys()
        for (const e of entries) paths.push(new URL(e.url).pathname)
      }
      return {names,paths}
    })
    assert.deepEqual(cache.names,['xdrive-pwa-public-offline-v1'])
    assert.deepEqual(cache.paths,['/offline.html'])
    summary.onlyPublicOfflineCache=true
    assert.deepEqual(errors,[])
    const stop=await fetch(ready.url+'/__test/pwa-s2b3/finish',{method:'POST'})
    assert.equal(stop.status,204)
    // Physical CAS verification is done independently by the Go fixture.
    // Only the workflow may mark this true AFTER the Go process exits 0.
    summary.passed=true
    summary.stage='complete'
  } catch (error) {
    try {summary.counters=await getStats()} catch {}
    if (page && !page.isClosed()) {
      try {
        const rows=await snapshot(page)
        const group=rows.find(t=>t.scope==='group' && t.name===folderName)
        summary.observed=group ? [{kind:'group',state:group.state,completed:group.completed,
          failed:group.failed,queued:group.queued},...rows.filter(t=>t.parent_id===group.id)
          .map(t=>({kind:'child',state:t.state,retryable:t.retryable,
            hasManifest:t.hasManifest,hasCloudParent:Number.isSafeInteger(t.cloudParent) && t.cloudParent>0}))] : []
      } catch {}
    }
    throw error
  } finally {
    await browser?.close()
    fs.rmSync(tmp,{recursive:true,force:true})
    fs.writeFileSync(path.join(out,'summary-'+args.mode+'.json'),JSON.stringify(summary,null,2)+'\n')
  }
}
run().catch(err=>{
  // Do not export passwords, JWT, URLs, CAS bytes or local source paths.
  console.error('PWA_B3B_FAILED stage='+summary.stage+' category='+(err?.name||'Error'))
  process.exitCode=1
})
