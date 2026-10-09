const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const repoRoot = path.resolve(__dirname, '../..')
const repo = path.resolve(arg('source-root', repoRoot))
const out = path.resolve(arg('output-dir', path.join(require('node:os').tmpdir(), 'xdrive-gallery-panels')))
const fixture = path.join(__dirname, 'gallery-panels-browser.tsx')
const dependencyRoot = repoRoot
const requireRepo = createRequire(path.join(dependencyRoot, 'desktop/package.json'))
const { build } = requireRepo('esbuild')
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sourceFiles = ['MediaGallery.tsx', 'MediaGalleryFilters.tsx', 'MediaGalleryNavigation.tsx', 'WorkspaceContent.tsx', 'WorkspaceSurface.tsx', 'AppearanceThemeProvider.tsx', 'theme.ts', 'useMobilePanelViewport.ts'].filter(file => fs.existsSync(path.join(repo, 'ui/shared/src/mui', file)))
const result = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(),
  sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, hash(path.join(repo, 'ui/shared/src/mui', file))])),
  fixtureHashes: { cjs: hash(__filename), tsx: hash(fixture) }, checks: [], errors: [], samples: {},
  boundary: 'M11 shared renderer acceptance: real GalleryPage + real filter/navigation + real responsive WorkspaceContent/MUI; raw media/facet transport only is controlled. Viewport resize is not a physical software-keyboard or visual-only overlay emulation.',
}
const check = (name, actual, expected = true) => { try { assert.deepEqual(actual, expected); result.checks.push({ name, passed: true, actual }) } catch { result.checks.push({ name, passed: false, actual, expected }) } }
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function geometry(locator) { return locator.evaluate(element => {
  const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
  let left = 0, top = 0, right = innerWidth, bottom = innerHeight
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
  }
  return { width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    clipping: { left, top, right, bottom }, visibleWidth: Math.max(0, Math.min(right, rect.right) - Math.max(left, rect.left)),
    visibleHeight: Math.max(0, Math.min(bottom, rect.bottom) - Math.max(top, rect.top)), hit: Boolean(hit && element.contains(hit)) }
}) }
const fullyVisible = box => box.visibleWidth >= box.width - .5 && box.visibleHeight >= box.height - .5 && box.hit
async function main() {
 fs.mkdirSync(out, { recursive: true })
 await build({ entryPoints: [fixture], bundle: true, outfile: path.join(out, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(dependencyRoot, 'desktop/node_modules')],
  alias: { '@probe/gallery': path.join(repo, 'ui/shared/src/mui/MediaGallery.tsx'), '@probe/content': path.join(repo, 'ui/shared/src/mui/WorkspaceContent.tsx'), '@probe/theme': path.join(repo, 'ui/shared/src/mui/AppearanceThemeProvider.tsx') },
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
 result.bundleHash = hash(path.join(out, 'bundle.js'))
 const server = http.createServer((request,response) => {
  if (new URL(request.url,'http://localhost').pathname === '/bundle.js') { response.setHeader('Content-Type','text/javascript'); response.end(fs.readFileSync(path.join(out,'bundle.js'))) }
  else { response.setHeader('Content-Type','text/html'); response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>') }
 })
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
 const browser = await chromium.launch({ headless:true, executablePath:process.env.XDRIVE_BROWSER_EXECUTABLE || '/tmp/chromium', args:JSON.parse(process.env.XDRIVE_BROWSER_ARGS || '["--no-sandbox","--single-process","--no-zygote"]') })
 result.browserVersion = browser.version()
 const url = `http://127.0.0.1:${server.address().port}/`
 for (const profile of [
  { name:'landscape-touch', width:844, height:390, touch:true },
  { name:'short-fine-700', width:700, height:390, touch:false },
  { name:'short-fine-899', width:899, height:390, touch:false },
  { name:'focused-resize', width:390, height:844, touch:true, resize:260 },
  { name:'short-text-200', width:360, height:390, touch:true, font:2 },
  { name:'short-field-200', width:844, height:200, touch:true, font:2, fieldProbe:true },
 ]) {
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},hasTouch:profile.touch,isMobile:profile.touch,timezoneId:'UTC'})
  const page=await context.newPage();page.setDefaultTimeout(4500)
  page.on('pageerror',error=>result.errors.push({profile:profile.name,kind:'page',message:error.message}))
  page.on('console',message=>{if(message.type()==='error')result.errors.push({profile:profile.name,kind:'console',message:message.text()})})
  page.on('requestfailed',request=>result.errors.push({profile:profile.name,kind:'request',message:request.failure()?.errorText}))
  try {
   await page.goto(url+'?case='+profile.name)
   await page.locator('[data-xdrive-media-tile]').first().waitFor()
   if(profile.font){await page.evaluate(font=>{document.documentElement.style.fontSize=`${16*font}px`},profile.font);await settle(page)}
   const trigger=page.getByRole('button',{name:/^(?:筛选(?: · \d+)?|图库筛选(?:，\d+ 个条件)?)$/})
   await trigger.scrollIntoViewIfNeeded()
   if (profile.fieldProbe) {
    // The original 53 cases above remain unchanged. This one measured risk is
    // the same very-short/text-enlargement shape that exposed Files' 24px body.
    // A real search draft enables Clear/Save; disabled controls do not have a
    // clickable hit target and are not a valid action-reachability fixture.
    await page.getByPlaceholder('搜索照片、对象、场景或文字').fill('已有搜索草稿')
    await trigger.click()
    const panel=page.getByRole('dialog',{name:'图库筛选',exact:true})
    await panel.waitFor()
    await page.waitForFunction(()=>{const p=document.querySelector('.MuiDrawer-paper[aria-label="图库筛选"]');if(!p)return false;const t=new DOMMatrix(getComputedStyle(p).transform);return Math.abs(t.e)<.01&&Math.abs(t.f)<.01})
    const close=panel.getByRole('button',{name:'关闭图库筛选',exact:true})
    const closeGeometry=await geometry(close)
    check('short-field-200: Close keeps a visible 44px target',closeGeometry.width>=44&&closeGeometry.height>=44&&fullyVisible(closeGeometry))
    const field=await panel.getByRole('textbox',{name:'标签',exact:true}).evaluate(input=>{
      const box=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom}}
      const owner=input.closest('.MuiInputBase-root')
      let scroller=owner.parentElement
      while(scroller&&!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))scroller=scroller.parentElement
      const panel=input.closest('[role="dialog"]')
      const apply=[...panel.querySelectorAll('button')].find(button=>button.textContent.trim()==='应用')
      const footer=apply.parentElement,field=box(owner),scroll=box(scroller),actions=box(footer)
      const visibleTop=Math.max(field.top,scroll.top),visibleBottom=Math.min(field.bottom,scroll.bottom,actions.top)
      const height=Math.max(0,visibleBottom-visibleTop),point={x:field.x+field.width/2,y:visibleTop+height/2}
      return{field,scroll,actions,footerPosition:getComputedStyle(footer).position,visibleHeight:height,visibleHit:height>0&&owner.contains(document.elementFromPoint(point.x,point.y))}
    })
    check('short-field-200: the first field has at least 44px visible editable area',field.visibleHeight>=44&&field.visibleHit)
    await page.screenshot({path:path.join(out,'short-field-200-first-field.png'),fullPage:true})
    await page.mouse.move(420,100);await page.mouse.wheel(0,1600);await page.waitForTimeout(100);await settle(page)
    const actions={}
    for(const label of ['应用','清除','保存为智能相册'])actions[label]=await geometry(panel.getByRole('button',{name:label,exact:true}))
    check('short-field-200: native scrolling reaches all actions while Close stays visible',Object.values(actions).every(box=>box.width>=44&&box.height>=44&&fullyVisible(box))&&fullyVisible(await geometry(close)))
    await page.screenshot({path:path.join(out,'short-field-200-actions.png'),fullPage:true})
    await close.click();await panel.waitFor({state:'detached'})
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-haspopup')==='dialog')
    check('short-field-200: explicit Close returns focus without applying a query',await page.evaluate(()=>({focused:document.activeElement?.getAttribute('aria-label'),ranges:window.galleryPanelsProbe.calls.filter(call=>call.kind==='range').length,viewers:window.galleryPanelsProbe.viewers})),{focused:'图库筛选',ranges:1,viewers:[]})
    result.samples[profile.name]={field,close:closeGeometry,actions}
    continue
   }
   const triggerGeometry=await geometry(trigger)
   const nav=page.getByRole('navigation',{name:'图库导航',exact:true})
   const navGeometry=await nav.locator('button').evaluateAll(elements=>elements.map(element=>({name:element.textContent,height:element.getBoundingClientRect().height,width:element.getBoundingClientRect().width})))
   check(`${profile.name}: filter trigger is a visible 44px target`,triggerGeometry.height>=44 && triggerGeometry.width>=44 && fullyVisible(triggerGeometry))
   check(`${profile.name}: Gallery navigation controls retain 44px targets`,navGeometry.every(box=>box.height>=44 && box.width>=44))
   check(`${profile.name}: initial collection does not request facets`,await page.evaluate(()=>window.galleryPanelsProbe.calls.filter(call=>call.kind==='facets').length),0)
   await trigger.click()
   const paper=page.locator('.MuiPopover-paper, .MuiDrawer-paper[role="dialog"][aria-label="图库筛选"]').first()
   await paper.waitFor()
   await page.waitForFunction(()=>{const p=document.querySelector('.MuiPopover-paper, .MuiDrawer-paper[role="dialog"][aria-label="图库筛选"]');if(!p)return false;const s=getComputedStyle(p),t=new DOMMatrix(s.transform);return Number(s.opacity)>=.999&&t.a>=.9999&&t.d>=.9999&&Math.abs(t.e)<.01&&Math.abs(t.f)<.01})
   check(`${profile.name}: advertised filter dialog has an accessible name`,await page.getByRole('dialog',{name:/筛选|图库/}).count()>0)
   check(`${profile.name}: a visible explicit Close action exists inside filters`,await paper.getByRole('button',{name:/关闭|取消筛选/}).count()>0)
   const tag=paper.getByRole('textbox',{name:'标签',exact:true})
   await tag.click();await tag.fill(' 保留输入草稿 ')
   const originalTag=await tag.elementHandle()
   if(profile.resize){await page.setViewportSize({width:profile.width,height:profile.resize});await settle(page)}
   const inputGeometry=await geometry(tag.locator('..'))
   const viewport=await page.evaluate(()=>({innerWidth,innerHeight,visualViewport:visualViewport&&{width:visualViewport.width,height:visualViewport.height,offsetTop:visualViewport.offsetTop},focusedTag:document.activeElement?.getAttribute('placeholder')}))
   check(`${profile.name}: focused tag draft survives the same mounted panel and viewport`,{value:await tag.inputValue(),same:await tag.evaluate((element,original)=>element===original,originalTag),focus:await tag.evaluate(element=>element===document.activeElement)},
    {value:' 保留输入草稿 ',same:true,focus:true})
   const beforeScroll=await geometry(paper.getByRole('button',{name:'应用',exact:true}))
   const box=await paper.boundingBox()
   await page.mouse.move(box.x+box.width/2,Math.min(viewport.innerHeight-20,box.y+box.height/2))
   await page.mouse.wheel(0,1500);await page.waitForTimeout(100);await settle(page)
   const actions={}
   for(const label of ['应用','清除','保存为智能相册']){
    const action=paper.getByRole('button',{name:label,exact:true})
    actions[label]=await geometry(action)
   }
   check(`${profile.name}: native panel scrolling reaches all three actions`,Object.values(actions).every(fullyVisible))
   check(`${profile.name}: filter actions are at least 44px`,Object.values(actions).every(box=>box.height>=44&&box.width>=44))
   await page.screenshot({path:path.join(out,`${profile.name}-filter-actions.png`),fullPage:true})
   await paper.getByRole('button',{name:'应用',exact:true}).click()
   await paper.waitFor({state:'detached'})
   await page.waitForFunction(()=>window.galleryPanelsProbe.calls.some(call=>call.kind==='range'&&call.query.tag==='保留输入草稿'))
   check(`${profile.name}: native Apply keeps the real complete query path`,await page.evaluate(()=>({tags:window.galleryPanelsProbe.calls.filter(call=>call.kind==='range'&&call.query.tag).map(call=>call.query.tag),viewers:window.galleryPanelsProbe.viewers})),{tags:['保留输入草稿'],viewers:[]})
   await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-haspopup')==='dialog')
   check(`${profile.name}: Apply returns focus to the visible trigger`,await trigger.evaluate(element=>element===document.activeElement))
   if(profile.name==='short-fine-700'){
    const first=nav.getByRole('button',{name:'图库',exact:true});await first.focus()
    for(let index=0;index<8;index++)await page.keyboard.press('Tab')
    const end=nav.getByRole('button',{name:'回收站',exact:true})
    check('navigation-keyboard: natural focus scroll reaches the last destination',await end.evaluate(element=>element===document.activeElement && element.getBoundingClientRect().right<=innerWidth))
    await page.keyboard.press('Enter');await settle(page)
    check('navigation-keyboard: actual Gallery route changes to Trash',await page.evaluate(()=>window.galleryPanelsProbe.routes.at(-1)),'trash')
    for(let index=0;index<8;index++)await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter');await settle(page)
    check('navigation-keyboard: native return reaches Library with current-page semantics',await nav.getByRole('button',{name:'图库',exact:true}).getAttribute('aria-current'),'page')
   }
   result.samples[profile.name]={trigger:triggerGeometry,navigation:navGeometry,input:inputGeometry,viewport,applyBeforeScroll:beforeScroll,actions}
  }catch(error){result.errors.push({profile:profile.name,kind:'scenario',message:String(error)})}
  finally{
   result.samples[profile.name+'-layout']=await page.evaluate(()=>{
    const rect=element=>{if(!element)return null;const r=element.getBoundingClientRect();return {tag:element.tagName,role:element.getAttribute('role'),name:element.getAttribute('aria-label'),text:element.textContent?.slice(0,90),x:r.x,y:r.y,width:r.width,height:r.height,scrollTop:element.scrollTop,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,overflowY:getComputedStyle(element).overflowY}}
    const panel=document.querySelector('.MuiPopover-paper, .MuiDrawer-paper[role="dialog"][aria-label="图库筛选"]')
    const input=panel?.querySelector('input[placeholder="精确标签"]')
    const ancestors=[];for(let parent=input?.parentElement;parent;parent=parent.parentElement){ancestors.push(rect(parent));if(parent===panel)break}
    return {panel:rect(panel),header:rect(document.querySelector('[data-xdrive-gallery-mobile-filters-header]')),body:rect(document.querySelector('[data-xdrive-gallery-mobile-filters]')),input:rect(input),ancestors,actions:panel?[...panel.querySelectorAll('button')].map(rect):[],active:rect(document.activeElement)}
   }).catch(()=>null)
   result.samples[profile.name+'-transport']=await page.evaluate(()=>window.galleryPanelsProbe).catch(()=>null);await page.screenshot({path:path.join(out,`${profile.name}-final.png`),fullPage:true}).catch(()=>{});await page.close()}
 }
 await browser.close();await new Promise(resolve=>server.close(resolve))
 result.finishedAt=new Date().toISOString();result.passed=result.checks.filter(check=>check.passed).length;result.failed=result.checks.filter(check=>!check.passed).length
 result.sourceHashMatch=sourceFiles.every(file=>hash(path.join(repo,'ui/shared/src/mui',file))===result.sourceHashes[file])
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({out,passed:result.passed,failed:result.failed,errors:result.errors,sourceHashMatch:result.sourceHashMatch},null,2))
 if(result.failed||result.errors.length||!result.sourceHashMatch)process.exitCode=1
}
main().catch(error=>{console.error(error);process.exitCode=1})
