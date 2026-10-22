'use strict'
// P2-A2: two distinct REAL Chrome processes, same disk profile and Go/PG/CAS.
// Test-only CURRENT/BEFORE. Never persist private thumbnail blobs.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{performance}=require('node:perf_hooks');
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'web/dist');
const chrome=process.env.XDRIVE_BROWSER_EXECUTABLE,goBin=process.env.XD_GALLERY_WEB_PHYSICAL_GO_BINARY;
const out=path.resolve(process.env.XD_PWA_P2A2_RESULTS||path.join(root,'desktop/pwa-p2a2-results'));
const fractions=[0,0.5,0.95],timeout=25000,delay=ms=>new Promise(r=>setTimeout(r,ms));
assert.equal(process.env.XD_PWA_P2A2_BEFORE,'1','P2-A2 explicit test-only switch required');
assert(chrome&&fs.existsSync(chrome),'real native Chrome required');
assert(goBin&&fs.existsSync(goBin)&&process.env.XD_TEST_DATABASE_URL,'real Go/PG17 required');
assert(fs.existsSync(path.join(dist,'index.html')),'real Vite dist required');
fs.mkdirSync(out,{recursive:true});
function percentile(xs,p){assert(xs.length&&xs.every(x=>Number.isFinite(x)&&x>=0));
 const s=[...xs].sort((a,b)=>a-b),n=(s.length-1)*p,l=Math.floor(n),h=Math.ceil(n);
 return Number((s[l]+(s[h]-s[l])*(n-l)).toFixed(3))}
async function until(fn,ms,label){const t=performance.now();while(performance.now()-t<ms){
 const v=await fn();if(v)return v;await delay(50)}throw Error('timeout '+label)}
function rss(pid){const s=fs.readFileSync('/proc/'+pid+'/status','utf8').match(/^VmRSS:\s+(\d+) kB/m);
 assert(s,'real Go process RSS missing');return Number(s[1])*1024}
function browserPid(profile){let found=[];for(const p of fs.readdirSync('/proc')){
 if(!/^\d+$/.test(p))continue;let args=[];try{args=fs.readFileSync('/proc/'+p+'/cmdline').toString().split('\0').filter(Boolean)}catch{continue}
 if(args.includes('--user-data-dir='+profile)&&!args.some(a=>a.startsWith('--type='))&&
    /chrome|chromium/i.test(path.basename(args[0]||'')))found.push(Number(p))}
 assert.equal(found.length,1,'one distinct Chromium browser OS PID required');return found[0]}
async function exited(pid){await until(()=>{try{process.kill(pid,0);return false}
 catch(e){if(e.code==='ESRCH')return true;throw e}},15000,'browser PID exit')}
async function counters(origin){const r=await fetch(origin+'/__perf/physical-thumbnail-stats',{cache:'no-store'});
 assert.equal(r.status,200);return r.json()}
function delta(a,b){let requests=b.started-a.started,responseBodyBytes=b.response_bytes-a.response_bytes;
 assert(requests>=0&&responseBodyBytes>=0);return {requests,responseBodyBytes}}
async function fixture(sample,tmp){
 const ready=path.join(tmp,'ready-'+sample+'.json'),log=fs.createWriteStream(path.join(out,'native-go-'+sample+'.log'));
 const child=spawn(goBin,['-test.run=^TestGalleryRealWebColdFixture100K$','-test.count=1','-test.timeout=20m','-test.v'],
 {cwd:root,env:{...process.env,XD_GALLERY_REAL_WEB_COLD_PERF:'1',
 XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF:'1',XD_GALLERY_REAL_WEB_DIST:dist,
 XD_GALLERY_REAL_WEB_READY_FILE:ready},stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 const finished=new Promise(r=>child.once('exit',(code,signal)=>{log.end();r({code,signal})}));
 try{const info=await until(()=>{if(child.exitCode!==null)throw Error('native Go died before CAS seed');
 return fs.existsSync(ready)?JSON.parse(fs.readFileSync(ready,'utf8')):null},720000,'real 115k physical CAS seed');
 assert.equal(info.logical_assets,100000);assert.equal(info.physical_nodes,115000);
 assert.equal(info.physical_sources,115000);assert.equal(info.physical_verified,12);
 assert.equal(info.physical_mode,true);return {child,finished,info,initialRSS:rss(child.pid)}
 }catch(e){child.kill('SIGKILL');throw e}}
async function stop(g){try{await fetch(g.info.url+'/__perf/stop',{method:'POST'})}catch{}
 const end=await Promise.race([g.finished,delay(60000).then(()=>({code:'timeout'}))]);
 if(end.code!==0){g.child.kill('SIGKILL');throw Error('native fixture failed exit '+JSON.stringify(end))}}
async function publicOnly(page){return page.evaluate(async()=>{
 if(!('caches' in window))return null;let n=0;
 for(const name of await caches.keys()){let cache=await caches.open(name);
 for(const request of await cache.keys()){let url=new URL(request.url).pathname;
 if(url.startsWith('/api/')||/thumbnail|ticket|original|download/i.test(url))
 throw Error('private request in public CacheStorage');n++}}return n})}
async function launch(profile,origin){const started=performance.now();
 const ctx=await chromium.launchPersistentContext(profile,{executablePath:chrome,headless:true,
 viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,
 locale:'zh-CN',serviceWorkers:'allow',args:['--no-sandbox','--disable-dev-shm-usage']});
 const pid=browserPid(profile),page=ctx.pages()[0]||await ctx.newPage();
 page.setDefaultTimeout(timeout);
 await page.goto(origin+'/?xdriveGalleryRealCold=1&xdriveRealViewportCancel=1&xdriveMediaProgress=off',
 {waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>{let grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]');
 if(!grid)return false;let e=grid.parentElement;
 while(e){if(/(auto|scroll|overlay)/.test(getComputedStyle(e).overflowY)&&
 e.scrollHeight-e.clientHeight>10000)return true;e=e.parentElement}return false},null,{timeout});
 const width=await page.evaluate(()=>innerWidth);assert(width>=360&&width<=390,'actual Mobile Grid width');
 return {ctx,page,pid,launchMountedMs:performance.now()-started}}
async function position(page,fraction,required){const start=performance.now();
 assert(await page.evaluate(f=>{let g=document.querySelector('[data-xdrive-media-gallery-virtual-grid]');
 let h=g?.parentElement;while(h){if(/(auto|scroll|overlay)/.test(getComputedStyle(h).overflowY)&&
 h.scrollHeight-h.clientHeight>10000)break;h=h.parentElement}
 if(!h)return false;h.scrollTop=Math.floor(f*(h.scrollHeight-h.clientHeight));
 h.dispatchEvent(new Event('scroll'));return true},fraction),'Grid scroll required');
 const evaluateVisible=()=>{let g=document.querySelector('[data-xdrive-media-gallery-virtual-grid]');
 if(!g)return null;let h=g.parentElement;while(h){if(/(auto|scroll|overlay)/.test(getComputedStyle(h).overflowY)&&
 h.scrollHeight-h.clientHeight>10000)break;h=h.parentElement}if(!h)return null;
 let clip=h.getBoundingClientRect(),nodes=[...g.querySelectorAll('[data-xdrive-media-tile]')];
 if(nodes.length>=1000)return {error:'unbounded virtual Grid'};
 return {mounted:nodes.length,items:nodes.filter(n=>{let b=n.getBoundingClientRect(),img=n.querySelector('img');
 return b.bottom>clip.top&&b.top<clip.bottom&&img?.complete&&img.naturalWidth>0&&
 img.naturalHeight>0&&(img.currentSrc||img.src).startsWith('blob:')})
 .map(n=>({id:Number(n.getAttribute('data-xdrive-media-index'))}))}};
 await page.waitForFunction(({required})=>{let g=document.querySelector('[data-xdrive-media-gallery-virtual-grid]');
 if(!g)return false;let h=g.parentElement;while(h){if(/(auto|scroll|overlay)/.test(getComputedStyle(h).overflowY)&&
 h.scrollHeight-h.clientHeight>10000)break;h=h.parentElement}if(!h)return false;
 let c=h.getBoundingClientRect(),arr=[...g.querySelectorAll('[data-xdrive-media-tile]')];
 if(arr.length>=1000)return false;
 let ids=arr.filter(n=>{let b=n.getBoundingClientRect(),i=n.querySelector('img');
 return b.bottom>c.top&&b.top<c.bottom&&i?.complete&&i.naturalWidth>0&&i.naturalHeight>0&&
 (i.currentSrc||i.src).startsWith('blob:')}).map(n=>Number(n.getAttribute('data-xdrive-media-index')));
 return required?required.every(id=>ids.includes(id)):ids.length>=4},{required},{timeout,polling:50});
 const view=await page.evaluate(evaluateVisible);
 assert(view&&!view.error&&view.mounted<1000,'bounded visible physical Grid');
 const ids=required||view.items.slice(0,4).map(n=>n.id);
 assert.equal(ids.length,4);assert(ids.every(n=>Number.isSafeInteger(n)&&n>=0&&n<100000));
 assert(await page.evaluate(async ids=>{let arr=[...document.querySelectorAll('[data-xdrive-media-tile]')]
 .filter(n=>ids.includes(Number(n.getAttribute('data-xdrive-media-index'))));
 if(arr.length!==4)return false;let imgs=arr.map(n=>n.querySelector('img'));
 await Promise.all(imgs.map(i=>i.decode()));
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 return imgs.every(i=>i.complete&&i.naturalWidth>0)},ids),'4 real thumbnail decodes + two rAF');
 let ms=performance.now()-start;assert(ms<=timeout,'revisit 25s deadline');
 return {fraction,ids,ms:Number(ms.toFixed(3)),mounted:view.mounted}}
async function measure(sample,tmp){let g=await fixture(sample,tmp);
 let profile=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-p2a2-')),open=null;
 try{let beforeA=await counters(g.info.url);
 open=await launch(profile,g.info.url);let pidA=open.pid,launchA=open.launchMountedMs,first=[];
 for(const f of fractions)first.push(await position(open.page,f,null));
 let afterA=await counters(g.info.url),publicCacheA=await publicOnly(open.page);
 await open.ctx.close();open=null;await exited(pidA);
 assert(fs.existsSync(profile),'on-disk browser profile must survive exit');
 let beforeB=await counters(g.info.url);
 open=await launch(profile,g.info.url);let pidB=open.pid,launchB=open.launchMountedMs,restarted=[];
 assert.notEqual(pidA,pidB,'Chrome OS PID must change');
 for(let i=0;i<fractions.length;i++)restarted.push(await position(open.page,fractions[i],first[i].ids));
 let afterB=await counters(g.info.url),publicCacheB=await publicOnly(open.page);
 await open.ctx.close();open=null;await exited(pidB);
 assert.equal(afterB.failed,0);assert(afterB.max_active<=6,'Go handler concurrency');
 let growth=Math.max(0,rss(g.child.pid)-g.initialRSS);assert(growth<=256*1024*1024,'Go RSS');
 let pairs=first.map((a,i)=>({fraction:a.fraction,ids:a.ids,firstMs:a.ms,restartMs:restarted[i].ms}));
 let data={sample,pidA,pidB,profilePersisted:true,launchA,launchB,pairs,
 firstHTTP:delta(beforeA,afterA),restartedHTTP:delta(beforeB,afterB),
 publicCacheA,publicCacheB,goRSSGrowthBytes:growth,maxActive:afterB.max_active};
 fs.writeFileSync(path.join(out,'sample-'+sample+'.json'),JSON.stringify(data,null,2)+'\n');
 console.log('P2A2_PROCESS_SAMPLE '+JSON.stringify({sample,pidChanged:pidA!==pidB,
 firstHTTP:data.firstHTTP,restartedHTTP:data.restartedHTTP,pairs:pairs.map(x=>({fraction:x.fraction,firstMs:x.firstMs,restartMs:x.restartMs}))}));
 return data}finally{if(open)await open.ctx.close().catch(()=>{});
 try{await stop(g)}finally{fs.rmSync(profile,{recursive:true,force:true})}}}
async function main(){let tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-p2a2-go-'));
 try{let samples=[];for(let i=1;i<=3;i++)samples.push(await measure(i,tmp));
 let all=samples.flatMap(s=>s.pairs);
 const result={status:'P2-A2-GENUINE-CROSS-PROCESS-BEFORE',sha:process.env.XD_PR_HEAD||null,
 nativeChromium:true,physicalIOS:false,privatePersistentCache:false,n:3,pairs:9,
 logicalCount:100000,physicalCount:115000,
 firstP50:percentile(all.map(p=>p.firstMs),0.5),firstP95:percentile(all.map(p=>p.firstMs),0.95),
 restartedP50:percentile(all.map(p=>p.restartMs),0.5),restartedP95:percentile(all.map(p=>p.restartMs),0.95),
 firstRequests:samples.reduce((a,s)=>a+s.firstHTTP.requests,0),
 restartRequests:samples.reduce((a,s)=>a+s.restartedHTTP.requests,0),
 firstBodyBytes:samples.reduce((a,s)=>a+s.firstHTTP.responseBodyBytes,0),
 restartBodyBytes:samples.reduce((a,s)=>a+s.restartedHTTP.responseBodyBytes,0),
 maxGoRSSGrowth:Math.max(...samples.map(s=>s.goRSSGrowthBytes)),samples,after:null,
 accepted:samples.length===3&&all.length===9&&samples.every(s=>s.pidA!==s.pidB&&
 s.profilePersisted&&s.maxActive<=6&&s.pairs.every(p=>p.ids.length===4))};
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n');
 console.log('P2A2_PROCESS_SUMMARY '+JSON.stringify({sha:result.sha,accepted:result.accepted,
 n:result.n,pairs:result.pairs,firstP50:result.firstP50,firstP95:result.firstP95,
 restartedP50:result.restartedP50,restartedP95:result.restartedP95,
 firstRequests:result.firstRequests,restartRequests:result.restartRequests,
 firstBodyBytes:result.firstBodyBytes,restartBodyBytes:result.restartBodyBytes,after:result.after}));
 assert(result.accepted,'Native restart BEFORE incomplete')}finally{fs.rmSync(tmp,{recursive:true,force:true})}}
main().catch(e=>{console.error('P2A2_PROCESS_ERROR '+(e?.stack||String(e)));process.exitCode=1})