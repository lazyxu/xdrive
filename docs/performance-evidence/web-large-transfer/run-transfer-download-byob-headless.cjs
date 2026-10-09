const fs=require('node:fs'); const vm=require('node:vm'); const path=require('node:path'); const os=require('node:os');
const {chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const scenario=process.argv[2]||'upload'; const sample=process.argv[3]||'sample-1'; const root='/workspace/scratch/4fa175e5d1c9/xdrive-transfer';
const outputDir=process.env.XD_HEADLESS_TRANSFER_OUTPUT||'/workspace/scratch/4fa175e5d1c9/transfer-baseline-headless';
const launcherPath=root+'/desktop/scripts/large-transfer-performance-main.cjs';
const launcher=fs.readFileSync(launcherPath,'utf8').split('\napp.whenReady()')[0];
const noop=()=>{};
const ctx={require(name){return name==='electron'?{app:{setPath:noop,commandLine:{appendSwitch:noop}}}:require(name)},process:{argv:['node',launcherPath,scenario,sample]},console,__dirname:path.dirname(launcherPath),Buffer,URL,setTimeout,clearTimeout};
vm.createContext(ctx);vm.runInContext(launcher+'\nglobalThis.fixture={server,serverStats,userData,uploadFixture};',ctx);
const fixture=ctx.fixture; let browser; let timer; let rendererPID; let peakRSS=0;
function rss(pid){return Number(fs.readFileSync(`/proc/${pid}/status`,'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1]||0)}
(async()=>{ const lambda=(await import('/workspace/scratch/306c23476509/browser-tools/node_modules/@sparticuz/chromium/build/index.js')).default;
await new Promise(r=>fixture.server.listen(0,'127.0.0.1',r));
const launchOptions={headless:true,executablePath:'/workspace/scratch/306c23476509/browser-tools/runtime/chromium',args:lambda.args.filter(x=>x!=='--single-process').concat(['--enable-precise-memory-info','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']),env:{...process.env,FONTCONFIG_PATH:'/workspace/scratch/306c23476509/browser-tools/runtime/fonts'}};
let persistent; if(scenario==='download'){persistent=await chromium.launchPersistentContext(fixture.userData,launchOptions);browser=persistent.browser();}else{browser=await chromium.launch(launchOptions);}
const page=persistent?(persistent.pages()[0]||await persistent.newPage()):await browser.newPage();page.on('pageerror',e=>console.error(e));
await page.goto(`http://127.0.0.1:${fixture.server.address().port}/?xdriveLargeTransferPerf=${scenario}&xdriveLargeTransferSample=${sample}`);
if(scenario==='upload') await page.locator('[data-xdrive-large-transfer-upload-file]').setInputFiles(fixture.uploadFixture);
await page.waitForFunction(()=>window.__xdriveLargeTransferPerfReady||window.__xdriveLargeTransferPerfError,{},{timeout:35000});
const err=await page.evaluate(()=>window.__xdriveLargeTransferPerfError);if(err)throw new Error(err);
const browserCDP=await browser.newBrowserCDPSession(); const ps=await browserCDP.send('SystemInfo.getProcessInfo');
const rs=ps.processInfo.filter(x=>x.type==='renderer');if(rs.length!==1)throw new Error('expected one renderer: '+JSON.stringify(ps));rendererPID=rs[0].id; {const pidns=fs.readlinkSync('/proc/self/ns/pid'); rendererPID=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).find(pid=>{try{return fs.readlinkSync(`/proc/${pid}/ns/pid`)===pidns && fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').includes('--type=renderer') && Number(fs.readFileSync(`/proc/${pid}/status`,'utf8').match(/^NSpid:\s+(.+)/m)?.[1]?.trim().split(/\s+/).at(-1))===rs[0].id}catch{return false}});if(!rendererPID)throw new Error('renderer PID cannot be mapped out of process namespace');}
const rendererRSSStartKiB=rss(rendererPID);peakRSS=rendererRSSStartKiB;
const cdp=await page.context().newCDPSession(page);const heapBefore=await cdp.send('Runtime.getHeapUsage');
timer=setInterval(()=>{try{peakRSS=Math.max(peakRSS,rss(rendererPID))}catch{}},25);
await page.evaluate(()=>window.__xdriveLargeTransferPerfStart=true);
await page.waitForFunction(()=>window.__xdriveLargeTransferPerfResult||window.__xdriveLargeTransferPerfError,{},{timeout:300000});
clearInterval(timer);peakRSS=Math.max(peakRSS,rss(rendererPID));
const result=await page.evaluate(()=>({result:window.__xdriveLargeTransferPerfResult,error:window.__xdriveLargeTransferPerfError}));if(result.error)throw new Error(result.error);
const heapAfter=await cdp.send('Runtime.getHeapUsage');const heapAfterGC=null;
const metrics={...result.result,context:scenario==='download'?'persistent':'off-record',environment:'local Chromium 153 headless, multiprocess, Linux overlayfs; same production API and 1 GiB sparse fixture; separate from Electron CI',rendererRSSStartKiB,rendererRSSPeakKiB:peakRSS,rendererRSSDeltaKiB:peakRSS-rendererRSSStartKiB,heapBefore,heapAfter,heapAfterGC,server:fixture.serverStats};
fs.mkdirSync(outputDir,{recursive:true});fs.writeFileSync(`${outputDir}/web-${scenario}-${sample}.json`,JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{clearInterval(timer);if(browser)await browser.close();await new Promise(r=>fixture.server.close(r));fs.rmSync(fixture.userData,{recursive:true,force:true});});
