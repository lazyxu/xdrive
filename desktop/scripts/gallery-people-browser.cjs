const fs=require('node:fs'),path=require('node:path'),http=require('node:http')
const {createRequire}=require('node:module'),{createHash}=require('node:crypto')
const {execFileSync}=require('node:child_process')
const option=(name,fallback)=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)||fallback
const root=__dirname,source=path.resolve(option('source-root',path.join(__dirname,'../..')))
const out=path.resolve(option('output-dir',process.env.XDRIVE_PEOPLE_PROBE_OUT||path.join(require('node:os').tmpdir(),'xdrive-gallery-people')))
const deps=path.join(path.resolve(option('dependency-root',source)),'desktop')
const esbuild=createRequire(path.join(deps,'package.json'))('esbuild')
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright')
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sourceFiles=['MediaGallery.tsx','MediaGalleryPets.tsx','DialogTitle.tsx','DialogContent.tsx','AppearanceThemeProvider.tsx','theme.ts']
const result={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),scenario:option('scenario','all'),startedAt:new Date().toISOString(),checks:[],samples:{},errors:[],
  sourceHashes:Object.fromEntries(sourceFiles.map(file=>[file,hash(path.join(source,'ui/shared/src/mui',file))])),
  fixtureHashes:{cjs:hash(__filename),tsx:hash(path.join(root,'gallery-people-browser.tsx'))},
  boundary:'Real shared Gallery Page/virtual collection/Gallery/MUI identity controls; only source transport is controlled. No live Server mutation or physical keyboard claim.'}
const check=(name,passed,evidence)=>result.checks.push({name,passed,evidence})
let browser,server,page
async function main(){
 fs.mkdirSync(out,{recursive:true});fs.copyFileSync(__filename,path.join(out,'probe.cjs'));fs.copyFileSync(path.join(root,'gallery-people-browser.tsx'),path.join(out,'probe.tsx'))
 await esbuild.build({entryPoints:[path.join(root,'gallery-people-browser.tsx')],bundle:true,outfile:path.join(out,'bundle.js'),jsx:'automatic',
  nodePaths:[path.join(deps,'node_modules')],alias:{'@probe/gallery':path.join(source,'ui/shared/src/mui/MediaGallery.tsx'),'@probe/theme':path.join(source,'ui/shared/src/mui/AppearanceThemeProvider.tsx')},
  define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
 result.bundleSHA256=hash(path.join(out,'bundle.js'))
 server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(out,'bundle.js')))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%}</style><div id="root"></div><script src="/bundle.js"></script>')}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 browser=await chromium.launch({headless:true,executablePath:process.env.XDRIVE_BROWSER_EXECUTABLE||undefined,args:JSON.parse(process.env.XDRIVE_BROWSER_ARGS||'[]')})
 result.browserVersion=browser.version()
 page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'UTC'});page.setDefaultTimeout(4000)
 page.on('pageerror',e=>result.errors.push({kind:'page',message:e.message}));page.on('console',m=>{if(m.type()==='error')result.errors.push({kind:'console',message:m.text()})})
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const viewport=async(short)=>{await page.setViewportSize(short?{width:844,height:200}:{width:390,height:844});await page.evaluate(short=>{document.documentElement.style.fontSize=short?'200%':''},short);await settle()}
 const rect=(locator,edge)=>locator.evaluate((element,edge)=>{
  let r=element.getBoundingClientRect()
  if(edge){const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),nodes=[];let node;while(node=walker.nextNode())if(node.textContent.length)nodes.push(node);const text=edge==='start'?nodes[0]:nodes.at(-1);if(text){const range=document.createRange(),offset=edge==='start'?0:text.textContent.length-1;range.setStart(text,offset);range.setEnd(text,offset+1);r=range.getBoundingClientRect()}}
  let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom)
  for(let p=element.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),pr=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(c.overflowX)){left=Math.max(left,pr.left);right=Math.min(right,pr.right)}if(/auto|scroll|hidden|clip/.test(c.overflowY)){top=Math.max(top,pr.top);bottom=Math.min(bottom,pr.bottom)}}
  const width=Math.max(0,right-left),height=Math.max(0,bottom-top),hit=width&&height?document.elementFromPoint((left+right)/2,(top+bottom)/2):null
  return{...r.toJSON(),visibleWidth:width,visibleHeight:height,hit:Boolean(hit&&element.contains(hit))}
 },edge)
 // Reveal through actual scrollable ancestors. A clipped/non-scrollable body
 // cannot be rescued by programmatic scrollIntoView or a forced click.
 const reveal=async(locator,edge)=>{
  for(let attempt=0;attempt<4;attempt++){
   const next=await locator.evaluate((element,edge)=>{
    let target=element.getBoundingClientRect()
    if(edge){const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),nodes=[];let node;while(node=walker.nextNode())if(node.textContent.length)nodes.push(node);const text=edge==='start'?nodes[0]:nodes.at(-1);if(text){const range=document.createRange(),offset=edge==='start'?0:text.textContent.length-1;range.setStart(text,offset);range.setEnd(text,offset+1);target=range.getBoundingClientRect()}}
    for(let host=element.parentElement;host;host=host.parentElement){
     if(!/(auto|scroll)/.test(getComputedStyle(host).overflowY)||host.scrollHeight<=host.clientHeight+1)continue
     const hr=host.getBoundingClientRect();let left=Math.max(0,hr.left),right=Math.min(innerWidth,hr.right),top=Math.max(0,hr.top),bottom=Math.min(innerHeight,hr.bottom)
     for(let parent=host.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent),pr=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(css.overflowY)){top=Math.max(top,pr.top);bottom=Math.min(bottom,pr.bottom)}if(/auto|scroll|hidden|clip/.test(css.overflowX)){left=Math.max(left,pr.left);right=Math.min(right,pr.right)}}
     if(right-left<44||bottom-top<44)return null
     if(target.top>=top-.5&&target.bottom<=bottom+.5)return null
     const x=left+Math.min(24,(right-left)/2),y=(top+bottom)/2,hit=document.elementFromPoint(x,y)
     if(!hit||!host.contains(hit))return null
     const delta=target.height>bottom-top?(target.top+target.bottom)/2-y:target.top<top?target.top-top:target.bottom-bottom
     if((delta<0&&host.scrollTop<=0)||(delta>0&&host.scrollTop+host.clientHeight>=host.scrollHeight-1))return null
     return{x,y,delta}
    }
    return null
   },edge)
   if(!next)return
   await page.mouse.move(next.x,next.y);await page.mouse.wheel(0,next.delta);await settle()
  }
 }
 const target=async(name,locator)=>{await reveal(locator);const r={...await rect(locator),disabled:await locator.isDisabled()};result.samples[name]=r;check(name+': visible target at least44px',r.visibleWidth>=43.9&&r.visibleHeight>=43.9&&(r.disabled||r.hit),r);return r}
 const calls=()=>page.evaluate(()=>window.peopleProbe.calls)
 const dialog=()=>page.getByRole('dialog')
 const header=()=>page.locator('[data-xdrive-gallery-header]')
 const close=()=>dialog().getByRole('button',{name:'关闭弹窗',exact:true})
 async function observeShort(label,field){
  await viewport(true)
  const paper=await rect(dialog());const closeRect=await rect(close())
  let body=dialog().locator('.MuiDialogContent-root'),b=await body.boundingBox()
  result.samples[label+'-short-shell']={paper,close:closeRect,bodyVisible:await rect(body),body:await body.evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),height:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop}))}
  await target(label+' short Close',close())
  if(b){const top=Math.max(0,b.y,paper.top),bottom=Math.min(200,b.y+b.height,paper.bottom);if(bottom>top){await page.mouse.move(b.x+Math.min(24,b.width/2),(top+bottom)/2);await page.mouse.wheel(0,-10000);await settle()}}
  await target(label+' short content',field)
  const actions=dialog().locator('.MuiDialogActions-root').getByRole('button');for(let i=0;i<await actions.count();i++){const button=actions.nth(i);await target(label+' short '+(await button.textContent()).trim(),button)}
  await page.screenshot({path:path.join(out,label+'-short.png')})
  await close().tap();await dialog().waitFor({state:'hidden'});await viewport(false)
 }
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('button',{name:/^人物甲 /}).waitFor()
 check('People retains existing cat and dog type collections',await page.locator('[data-xdrive-media-gallery-pets]').getByRole('button').count()===2 && (await page.locator('[data-xdrive-media-gallery-pets]').textContent()).includes('不区分单只宠物身份'))
 await page.getByRole('button',{name:/^人物甲 /}).tap();await header().getByRole('button',{name:'重命名',exact:true}).waitFor()
 check('Native person card opens the real Page-owned durable identity',await page.evaluate(()=>window.peopleProbe.ranges.some(r=>r.kind==='person'&&r.id==='person-1')))
 for(const name of ['返回上一级','重命名','合并','拆分'])await target('Person entry '+name,header().getByRole('button',{name,exact:true}))
 await header().getByRole('button',{name:'重命名',exact:true}).tap();await dialog().waitFor();await settle()
 const nameInput=dialog().getByRole('textbox',{name:'人物名称',exact:true})
 for(const name of ['取消','保存','关闭弹窗'])await target('Rename '+name,dialog().getByRole('button',{name,exact:true}))
 await nameInput.fill('人物改名');await dialog().getByRole('button',{name:'取消',exact:true}).tap();await dialog().waitFor({state:'hidden'})
 check('Rename cancel makes no identity mutation and retains original name',!(await calls()).length && (await header().textContent()).includes('人物甲'))
 await header().getByRole('button',{name:'重命名',exact:true}).tap();await nameInput.fill('人物改名');await page.evaluate(()=>{window.peopleProbe.rejectNext='update'})
 await dialog().getByRole('button',{name:'保存',exact:true}).tap();await dialog().getByRole('alert').waitFor()
 check('Refused rename preserves its draft and current identity revision',await nameInput.inputValue()==='人物改名' && JSON.stringify(await calls())===JSON.stringify([{kind:'update',args:['person-1',7,{name:'人物改名'}]}]),await calls())
 await dialog().getByRole('button',{name:'保存',exact:true}).tap();await dialog().waitFor({state:'hidden'})
 check('Explicit rename retry uses the same target and publishes the actual response',JSON.stringify(await calls())===JSON.stringify([{kind:'update',args:['person-1',7,{name:'人物改名'}]},{kind:'update',args:['person-1',7,{name:'人物改名'}]}])&&(await header().textContent()).includes('人物改名'),await calls())
 await header().getByRole('button',{name:'重命名',exact:true}).tap();await nameInput.waitFor();await observeShort('rename',nameInput.locator('..'))
 await header().getByRole('button',{name:'合并',exact:true}).tap();await dialog().waitFor();const mergeRow=dialog().getByRole('checkbox',{name:/^人物 02 /})
 await target('Merge first choice',mergeRow.locator('..').locator('..'))
 await mergeRow.check();check('Choosing a merge source does not write before confirmation',(await calls()).length===2)
 await dialog().getByRole('button',{name:'取消',exact:true}).tap();await dialog().waitFor({state:'hidden'})
 check('Merge cancel retains both identities without a mutation',(await calls()).length===2 && (await header().textContent()).includes('人物改名'))
 await header().getByRole('button',{name:'合并',exact:true}).tap();await observeShort('merge',dialog().getByRole('checkbox',{name:/^人物 02 /}).locator('..').locator('..'))
 await header().getByRole('button',{name:'拆分',exact:true}).tap();await dialog().waitFor()
 const splitChoices=dialog().getByRole('checkbox');for(let i=0;i<await splitChoices.count();i++)await splitChoices.nth(i).check()
 check('Split requires retaining at least one photo in the current identity',await dialog().getByRole('button',{name:'拆分',exact:true}).isDisabled())
 await splitChoices.nth(1).uncheck();await splitChoices.nth(2).uncheck();await splitChoices.nth(3).uncheck()
 check('Split selection is local until explicit confirmation',(await calls()).length===2 && await dialog().getByRole('button',{name:'拆分',exact:true}).isEnabled())
 await observeShort('split',dialog().getByRole('textbox',{name:'新人物名称',exact:true}).locator('..'))
 await header().getByRole('button',{name:'返回上一级',exact:true}).tap();await page.getByRole('button',{name:'保存为人物',exact:true}).waitFor()
 await page.mouse.move(190,740);await page.mouse.wheel(0,10000)
 await page.waitForFunction(()=>{const main=document.querySelector('main');return main.scrollTop+main.clientHeight>=main.scrollHeight-2});await settle()
 await target('Suggestion adopt entry',page.getByRole('button',{name:'保存为人物',exact:true}))
 await page.getByRole('button',{name:'保存为人物',exact:true}).tap();await dialog().getByRole('textbox',{name:'人物名称',exact:true}).fill('人物新')
 await observeShort('adopt',dialog().getByRole('textbox',{name:'人物名称',exact:true}).locator('..'))
 check('Adoption draft and cancel preserve the pending suggestion without a write',(await calls()).length===2 && await page.getByRole('button',{name:'保存为人物',exact:true}).count()===1)
 await page.getByRole('button',{name:'添加到已有人物',exact:true}).tap();await dialog().waitFor()
 const existing=dialog().getByRole('button',{name:/^人物改名 4 张$/});await target('Existing person assignment choice',existing)
 await observeShort('assign',existing)
 check('Opening and canceling existing-person selection sends no identity mutation',(await calls()).length===2)
 result.samples.transport=await page.evaluate(()=>({calls:window.peopleProbe.calls,ranges:window.peopleProbe.ranges,handledErrors:window.peopleProbe.errors}))
 if(result.scenario==='layout')return

 const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right)
 const focus=()=>page.evaluate(()=>{
  const element=document.activeElement
  return {tag:element?.tagName,role:element?.getAttribute('role'),label:element?.getAttribute('aria-label'),
   text:element===document.body?'':element?.textContent?.slice(0,100),connected:Boolean(element?.isConnected),insideMain:Boolean(element?.closest('main'))}
 })
 const transport=()=>page.evaluate(()=>({calls:window.peopleProbe.calls,ranges:window.peopleProbe.ranges,handledErrors:window.peopleProbe.errors}))
 const freshPeople=async()=>{
  await viewport(false);await page.reload();await page.getByRole('button',{name:/^人物甲 /}).waitFor();await settle()
 }
 const openSuggestion=async(name)=>{
  await page.mouse.move(190,740);await page.mouse.wheel(0,10000)
  await page.waitForFunction(()=>{const main=document.querySelector('main');return main.scrollTop+main.clientHeight>=main.scrollHeight-2})
  const entry=page.getByRole('button',{name,exact:true});await reveal(entry);await entry.tap();await dialog().waitFor();await settle()
 }
 const readableText=async(label,locator)=>{
  const samples=[]
  for(const edge of ['start','end']){await reveal(locator,edge);samples.push(await rect(locator,edge))}
  check(label+' remains fully readable by native scrolling',samples.every(r=>r.visibleWidth>=r.width-.5&&r.visibleHeight>=r.height-.5&&r.hit),samples)
 }
 const readableTitle=async(label)=>{
  const r=await rect(dialog().locator('.MuiDialogTitle-root .MuiTypography-h6'))
  check(label+' title remains visible with fixed Close',r.visibleHeight>=r.height-.5&&r.visibleWidth>=r.width-.5&&r.hit&&await close().isVisible(),r)
 }

 // Complete a named suggestion with native keyboard confirmation, including
 // the compact/wide transition of the same mounted input and caller.
 await freshPeople();await openSuggestion('保存为人物')
 const adoptedInput=dialog().getByRole('textbox',{name:'人物名称',exact:true})
 await adoptedInput.fill('  人物新建  ')
 const inputNode=await adoptedInput.elementHandle(),callerNode=await page.locator('main').elementHandle()
 await page.setViewportSize({width:899,height:700});await settle()
 await page.setViewportSize({width:900,height:700});await settle()
 check('Adoption draft, input focus and caller survive899 to900',await inputNode.evaluate(e=>e.isConnected&&e===document.activeElement)&&await adoptedInput.inputValue()==='  人物新建  '&&await callerNode.evaluate(e=>e===document.querySelector('main')))
 await page.keyboard.press('Tab');const cancelFocus=await focus()
 await page.keyboard.press('Tab');const saveFocus=await focus()
 check('Adoption native Tab reaches Cancel then Save',cancelFocus.text==='取消'&&saveFocus.text==='保存',{cancelFocus,saveFocus})
 await page.keyboard.press('Enter');await dialog().waitFor({state:'hidden'})
 await page.waitForFunction(()=>document.querySelector('[data-xdrive-gallery-header]')?.textContent.includes('人物新建'))
 check('Adoption submits the original suggestion ID and trimmed name',same(await calls(),[{kind:'adopt',args:['suggestion-a','人物新建']}]),await calls())
 check('Adoption displays the returned durable identity and loads its range',(await header().textContent()).includes('4 张照片 · 长期人物')&&await page.evaluate(()=>window.peopleProbe.ranges.some(r=>r.kind==='person'&&r.id==='person-created')))
 result.samples.adoptionSuccessFocus=await focus()
 check('Adoption success hands focus to its live person context',result.samples.adoptionSuccessFocus.connected&&result.samples.adoptionSuccessFocus.insideMain&&(result.samples.adoptionSuccessFocus.text==='人物新建'||result.samples.adoptionSuccessFocus.label==='返回上一级'),result.samples.adoptionSuccessFocus)
 await viewport(false);await header().getByRole('button',{name:'返回上一级',exact:true}).tap()
 await page.getByRole('button',{name:/^人物新建 /}).waitFor()
 check('Adopted identity replaces its pending suggestion on People',await page.getByRole('button',{name:'保存为人物',exact:true}).count()===0&&await page.getByRole('button',{name:/^人物新建 /}).count()===1)
 result.samples.adoption=await transport()

 // Assignment is the existing explicit person-choice action, not a second
 // local confirmation/planner. Observe the Page publishing the returned DTO.
 await freshPeople();await openSuggestion('添加到已有人物')
 const assignChoice=dialog().getByRole('button',{name:/^人物 02 4 张$/})
 await target('Assignment actual person choice',assignChoice);await assignChoice.tap();await dialog().waitFor({state:'hidden'})
 check('Assignment submits suggestion, target identity and target revision',same(await calls(),[{kind:'assign',args:['suggestion-a','person-2',8]}]),await calls())
 check('Assignment publishes updated count and removes the suggestion',await page.getByRole('button',{name:/^人物 02 .*8 张照片/}).count()===1&&await page.getByRole('button',{name:'保存为人物',exact:true}).count()===0)
 result.samples.assignmentSuccessFocus=await focus()
 check('Assignment success hands focus to its live People context',result.samples.assignmentSuccessFocus.connected&&result.samples.assignmentSuccessFocus.insideMain&&result.samples.assignmentSuccessFocus.text==='人物与宠物',result.samples.assignmentSuccessFocus)
 const assignedPerson=page.getByRole('button',{name:/^人物 02 /});await reveal(assignedPerson);await assignedPerson.tap()
 await header().getByRole('button',{name:'重命名',exact:true}).waitFor()
 check('Assigned identity opens with its returned count and original ID',(await header().textContent()).includes('人物 02')&&(await header().textContent()).includes('8 张照片 · 长期人物')&&await page.evaluate(()=>window.peopleProbe.ranges.some(r=>r.kind==='person'&&r.id==='person-2')))
 result.samples.assignment=await transport()

 // Reject then retry the exact immutable ID/revision/source-list values.
 // All mutations below still pass through the real Page-owned callbacks.
 await freshPeople();await page.getByRole('button',{name:/^人物甲 /}).tap()
 const workflowCaller=await page.locator('main').elementHandle()
 await header().getByRole('button',{name:'合并',exact:true}).tap();await dialog().waitFor()
 const mergeTwo=dialog().getByRole('checkbox',{name:/^人物 02 /}),mergeThree=dialog().getByRole('checkbox',{name:/^人物 03 /})
 await mergeTwo.tap();await mergeThree.tap();await viewport(true)
 await readableTitle('Merge short')
 await readableText('Merge explanation',dialog().locator('.MuiDialogContent-root').getByText('选中的人物会合并到当前人物；当前人物 ID 和名称会保留。',{exact:true}))
 const mergeSubmit=dialog().getByRole('button',{name:'合并',exact:true})
 await target('Merge short enabled confirmation',mergeSubmit)
 await page.evaluate(()=>{window.peopleProbe.rejectNext='merge'});await mergeSubmit.tap();await dialog().getByRole('alert').waitFor()
 await readableText('Merge refusal feedback',dialog().getByRole('alert'))
 const mergeRequest={kind:'merge',args:['person-1',7,['person-2','person-3']]}
 check('Merge refusal preserves both selected sources and current identity',await mergeTwo.isChecked()&&await mergeThree.isChecked()&&same(await calls(),[mergeRequest])&&(await header().textContent()).includes('人物甲'),await calls())
 await page.screenshot({path:path.join(out,'merge-short-refusal.png')})
 await reveal(mergeSubmit);await mergeSubmit.tap();await dialog().waitFor({state:'hidden'})
 result.samples.mergeSuccessFocus=await focus();await viewport(false)
 await page.waitForFunction(()=>document.querySelector('[data-xdrive-gallery-header]')?.textContent.includes('12 张照片'))
 check('Merge explicit retry submits the same complete source IDs and revision',same(await calls(),[mergeRequest,mergeRequest]),await calls())
 check('Merge retains target ID and name while publishing the returned total',(await header().textContent()).includes('人物甲')&&await page.evaluate(()=>window.peopleProbe.ranges.filter(r=>r.kind==='person').at(-1)?.id==='person-1'))
 await header().getByRole('button',{name:'返回上一级',exact:true}).tap();await page.getByRole('button',{name:/^人物甲 /}).waitFor()
 check('Merge removes only the selected source identities from People',await page.getByRole('button',{name:/^人物 02 /}).count()===0&&await page.getByRole('button',{name:/^人物 03 /}).count()===0&&await page.getByRole('button',{name:/^人物 04 /}).count()===1)

 // Split consumes that returned revision and explicit loaded node IDs. The
 // fixture returns the actual remaining/source collections to the same Page.
 await page.getByRole('button',{name:/^人物甲 /}).tap();await header().getByRole('button',{name:'拆分',exact:true}).tap();await dialog().waitFor()
 const splitInput=dialog().getByRole('textbox',{name:'新人物名称',exact:true})
 await splitInput.fill('  分出的人物  ')
 const splitOne=dialog().getByRole('checkbox',{name:'人物照片-1.jpg',exact:true}),splitTwo=dialog().getByRole('checkbox',{name:'人物照片-2.jpg',exact:true})
 await splitOne.tap();await splitTwo.tap();await viewport(true)
 await readableTitle('Split short')
 await readableText('Split explanation',dialog().locator('.MuiDialogContent-root').getByText('选择要移动到新人物的照片。至少要给当前人物保留一张照片。',{exact:true}))
 await target('Split short name input',splitInput.locator('..'))
 await target('Split short selected photo row',splitOne.locator('..').locator('..'))
 const splitSubmit=dialog().getByRole('button',{name:'拆分',exact:true});await reveal(splitSubmit)
 await page.evaluate(()=>{window.peopleProbe.rejectNext='split'});await splitSubmit.tap();await dialog().getByRole('alert').waitFor()
 await readableText('Split refusal feedback',dialog().getByRole('alert'))
 const splitRequest={kind:'split',args:['person-1',8,[100,101],'分出的人物']}
 check('Split refusal preserves name, selected node IDs and returned source revision',await splitInput.inputValue()==='  分出的人物  '&&await splitOne.isChecked()&&await splitTwo.isChecked()&&same((await calls()).filter(call=>call.kind==='split'),[splitRequest]),await calls())
 await page.screenshot({path:path.join(out,'split-short-refusal.png')})
 await reveal(splitSubmit);await splitSubmit.tap();await dialog().waitFor({state:'hidden'})
 result.samples.splitSuccessFocus=await focus();await viewport(false)
 await page.waitForFunction(()=>document.querySelector('[data-xdrive-gallery-header]')?.textContent.includes('10 张照片'))
 check('Split explicit retry submits the same node IDs, name and revision',same((await calls()).filter(call=>call.kind==='split'),[splitRequest,splitRequest]),await calls())
 check('Split keeps the source identity current with the returned remaining count',(await header().textContent()).includes('人物甲')&&await page.evaluate(()=>window.peopleProbe.ranges.filter(r=>r.kind==='person').at(-1)?.id==='person-1'))
 await header().getByRole('button',{name:'返回上一级',exact:true}).tap();await page.getByRole('button',{name:/^分出的人物 /}).waitFor()
 check('Split publishes both remaining and new identities on People',await page.getByRole('button',{name:/^人物甲 .*10 张照片/}).count()===1&&await page.getByRole('button',{name:/^分出的人物 .*2 张照片/}).count()===1)
 const newPerson=page.getByRole('button',{name:/^分出的人物 /});await reveal(newPerson);await newPerson.tap()
 await header().getByRole('button',{name:'重命名',exact:true}).waitFor()
 check('Split-created person opens its own returned ID and count',(await header().textContent()).includes('分出的人物')&&(await header().textContent()).includes('2 张照片 · 长期人物')&&await page.evaluate(()=>window.peopleProbe.ranges.filter(r=>r.kind==='person').at(-1)?.id==='split-person'))
 check('Complete person workflows retain the same mounted caller',await workflowCaller.evaluate(e=>e.isConnected&&e===document.querySelector('main')))
 result.samples.mergeAndSplit=await transport()
}
main().catch(async e=>{result.errors.push({kind:'scenario',message:e.stack});if(page){result.failureAccessibility=await page.locator('body').ariaSnapshot().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})}}).finally(async()=>{
 if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve))
 result.finishedAt=new Date().toISOString();result.passed=result.checks.filter(c=>c.passed).length;result.failed=result.checks.filter(c=>!c.passed).length
 result.sourceHashMatch=sourceFiles.every(file=>result.sourceHashes[file]===hash(path.join(source,'ui/shared/src/mui',file)))
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,failed:result.failed,errors:result.errors,out},null,2));if(result.failed||result.errors.length)process.exitCode=1
})
