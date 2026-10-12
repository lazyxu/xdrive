#!/usr/bin/env node
// UI-D7b2: authentic built Web App, shared MUI service editor and App Frame.
// The API is a STRICT local fixture. This does not verify a production host,
// actual Baidu credentials, real DNS, Desktop Electron or physical devices.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright');

const args = process.argv.slice(2);
assert(args.length === 1 && args[0].startsWith('--output-dir='), 'Pass --output-dir=PATH');
const outputDir = path.resolve(args[0].slice('--output-dir='.length));
fs.mkdirSync(outputDir, { recursive: true });
const dist = path.resolve(__dirname, '../../web/dist');
assert(fs.existsSync(path.join(dist, 'index.html')), 'Build the real web/dist before browser acceptance');
const stamp = '2026-10-12T10:00:00Z';
const specs = [
  ['database','core','PostgreSQL','ready','ready','verified'],
  ['storage','core','文件存储','ready','ready','verified'],
  ['background-worker','core','后台 Worker','unknown','unknown','pending'],
  ['caddy','core','Caddy / HTTPS 网关','unknown','not-checked','deployment-only'],
  ['media-worker','media','FFmpeg Media Worker','ready','ready','verified'],
  ['photo-face','intelligence','人脸检测与人物聚类','disabled','unknown','deployment-only'],
  ['photo-smart','intelligence','动物／物体识别与 OCR','disabled','unknown','deployment-only'],
  ['photo-semantic','intelligence','图片语义搜索','disabled','unknown','deployment-only'],
  ['photo-creative','intelligence','照片创作处理','disabled','unknown','deployment-only'],
  ['baidu-map','location','百度地图 Server API','unknown','not-checked','local-effective'],
  ['geonames','location','GeoNames 离线地名','ready','ready','verified'],
];
const result = {
  testedHead: process.env.XD_PR_HEAD || null, browserVersion: '', source: 'built Web App; strict API fixtures',
  viewportSamples: [], checks: [], requests: {}, unknownRequests: [], errors: [], screenshots: [], failures: [],
};
const state = { mode:'full', inventoryReads:0, baiduConfigReads:0, baiduVerifies:0, writes:0 };
let stage = 'startup';

function check(name, pass, evidence) {
  result.checks.push({ name, passed:Boolean(pass), ...(evidence === undefined ? {} : {evidence}) });
  if (!pass) result.failures.push({ stage, name, evidence });
}
function snapshot() {
  let services = specs.map(([id,group,label,status,health,activation]) => ({
    id, group, label, status, health_state:health, activation_state:activation,
    configuration_state:id === 'baidu-map' ? 'configured' : 'unknown',
    installation_state:id === 'database' || id === 'baidu-map' ? 'external' : 'unknown',
    config_mode:id === 'baidu-map' ? 'in-app' : 'deployment',
    apply_mode:id === 'baidu-map' ? 'immediate' : 'not-available',
    detail:'测试夹具状态，不是服务实际生效证明', config_hint:'此环境不提供真实宿主控制',
  }));
  if (state.mode === 'partial') {
    services = services.filter(x => !['caddy','geonames'].includes(x.id));
    services.push({ ...services.find(x => x.id === 'storage') });
    services.push({ id:'yike',group:'core',status:'ready',health_state:'ready',
      label:'用户来源',detail:'FORBIDDEN_SECRET_STRING' });
  }
  return { checked_at:stamp, services };
}
function apiReply(request) {
  const u = new URL(request.url()), verb = request.method();
  // Shared App Frame also reads the owner Files/Changes summaries in the
  // background. Explicitly allow those harmless GETs; reject every mutation,
  // arbitrary query, unknown route and external origin.
  const queryKeys = {
    '/api/v1/file-operations': ['limit'],
    '/api/v1/changes': ['after', 'limit'],
    '/api/v1/nodes/1/children': ['offset', 'limit', 'sort', 'order'],
  };
  assert([...u.searchParams.keys()].every(k => (queryKeys[u.pathname] || []).includes(k)),
    'Unexpected API parameters: ' + u.pathname + u.search);
  const key = verb + ' ' + u.pathname;
  if (verb !== 'GET' && key !== 'POST /api/v1/admin/services/baidu-map/verify') state.writes++;
  switch (key) {
    case 'GET /api/v1/version':
      return { version:'browser-qa',channel:'master',commit:'fixture',build_time:stamp };
    case 'GET /api/v1/me':
      return { id:10,username:'qa-admin',role:'admin',must_change_password:false };
    case 'GET /api/v1/me/quota':
      return { quota_bytes:10737418240,physical_used_bytes:1048576,reserved_bytes:0,
        available_bytes:10736369664,logical_file_bytes:1048576,trash_bytes:0,history_bytes:0,over_quota:false };
    case 'GET /api/v1/nodes/root':
      return { id:1,name:'我的文件',type:'dir',size:0,revision:1,created_at:stamp,updated_at:stamp };
    case 'GET /api/v1/background-tasks/active-summary':
      return { active_total:0,file_operation:0,sync_run:0,archive_prepare:0,scheduler:0 };
    case 'GET /api/v1/file-operations': return [];
    case 'GET /api/v1/changes': {
      // App Frame first checks for changes with (after=0, limit=1), then
      // subscribes from the returned cursor (after=1, limit=200). Both are
      // bounded, read-only. Reject any other cursor or limit.
      const after = u.searchParams.get('after'), limit = u.searchParams.get('limit');
      assert((after === '0' && limit === '1') || (after === '1' && limit === '200'),
        'Unexpected changes cursor/limit: ' + u.search);
      return { changes:[],next_cursor:1,latest_cursor:1,has_more:false,reset_required:false };
    }
    case 'GET /api/v1/nodes/1/children':
      assert.equal(u.searchParams.get('sort'), 'name');
      assert.equal(u.searchParams.get('order'), 'asc');
      return { items:[],total_count:0,total_count_included:true,
        offset:Number(u.searchParams.get('offset') || 0),
        limit:Number(u.searchParams.get('limit') || 200),sort:'name',order:'asc' };
    case 'GET /api/v1/admin/services':
      state.inventoryReads++;
      return state.mode === 'unavailable'
        ? { __status:503, error:'QA simulated inventory failure' } : snapshot();
    case 'GET /api/v1/admin/services/baidu-map':
      state.baiduConfigReads++;
      return { enabled:true,configured:true,source:'saved',editable:true,
        requires_restart:false,revision:7,updated_at:stamp };
    case 'POST /api/v1/admin/services/baidu-map/verify':
      assert.deepEqual(JSON.parse(request.postData() || '{}'), {revision:7});
      state.baiduVerifies++;
      return { state:'verified',image_verified:true,revision:7,checked_at:stamp,
        detail:'Browser fixture only. No external Baidu network request.' };
    default: throw new Error('Unknown API request: ' + key);
  }
}
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml',
  '.png':'image/png','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2',
  '.webp':'image/webp','.webmanifest':'application/manifest+json' };
const httpServer = http.createServer((req,res) => {
  res.setHeader('Cache-Control','no-store');
  const route = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file = path.resolve(dist,'.' + (route === '/' ? '/index.html' : route));
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
let browser, page;
async function settle() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function visit(origin, name, mobile) {
  state.mode = 'full';
  const widths = mobile ? [375,390,899] : [900,1280,2560];
  const configReadsBefore = state.baiduConfigReads, verifiesBefore = state.baiduVerifies;
  const columns = {375:1,390:1,899:2,900:2,1280:3,2560:4};
  const cards = '[data-xdrive-system-dependency-overview-card], [data-xdrive-system-dependency-unreported-card]';
  const context = await browser.newContext({ viewport:mobile ? {width:375,height:812}:{width:1280,height:800},
    isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,serviceWorkers:'block',timezoneId:'UTC' });
  await context.addInitScript(({origin,theme}) => {
    if (location.origin !== origin) return;
    localStorage.setItem('xdrive.access_token','fixture-only-qa-token');
    localStorage.setItem('xdrive.access_expires_at',String(Date.now() + 86400000));
    localStorage.setItem('xdrive.username','qa-admin');
    localStorage.setItem('xdrive.appearance',theme);
  },{origin,theme:mobile?'dark':'light'});
  await context.route('**/*', async route => {
    const req = route.request(),url = new URL(req.url());
    if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
    const key = req.method() + ' ' + url.pathname + url.search;
    result.requests[key] = (result.requests[key] || 0) + 1;
    try {
      assert.equal(url.origin,origin,'External network is forbidden in fixture');
      const reply = apiReply(req),status = reply.__status || 200;
      await route.fulfill({ status,contentType:'application/json',
        body:JSON.stringify(status === 200 ? reply : {error:reply.error}) });
    } catch(e) {
      result.unknownRequests.push({ stage,request:key,error:e.message });
      await route.fulfill({status:501,contentType:'application/json',body:JSON.stringify({error:e.message})});
    }
  });
  page = await context.newPage();
  page.setDefaultTimeout(16000);
  page.on('pageerror', e => result.errors.push({stage,type:'page',message:e.message}));
  page.on('console',m => {
    if (m.type() === 'error' && !/Failed to load resource:.*503/.test(m.text()))
      result.errors.push({stage,type:'console',message:m.text()});
  });
  await page.goto(origin + '/#/app/admin-services',{waitUntil:'domcontentloaded'});
  await page.locator('[data-xdrive-system-dependencies-overview]').waitFor();
  await settle();
  check(name + ': direct route uses admin-services',new URL(page.url()).hash === '#/app/admin-services');
  check(name + ': overview did not fetch credentials/perform paid verification',
    state.baiduConfigReads === configReadsBefore && state.baiduVerifies === verifiesBefore && state.writes === 0);

  for (const width of widths) {
    const height = width === 2560 ? 1440 : width === 1280 ? 800 : width === 900 ? 700 : width === 899 ? 844 : 812;
    stage = name + '-' + width + 'x' + height;
    await page.setViewportSize({width,height});
    await settle();
    const sample = await page.evaluate(() => {
      const main = document.querySelector('main'),html = document.documentElement;
      const cards = [...document.querySelectorAll('[data-xdrive-system-dependency-overview-card], [data-xdrive-system-dependency-unreported-card]')];
      const core = [...document.querySelectorAll('section[aria-label="基础服务"] [data-xdrive-system-dependency-overview-card]')];
      const nav = document.querySelector('nav[aria-label="系统依赖页内导航"]');
      const appHeader = document.querySelector('[data-xdrive-mobile-app-header]');
      const appFrame = document.querySelector('[data-xdrive-mobile-app-frame]');
      const globalHeader = document.querySelector('[data-xdrive-workspace-background] .MuiAppBar-root');
      const bound = el => { if (!el) return null; const r = el.getBoundingClientRect();
        return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
      return {
        width:innerWidth,height:innerHeight,cardCount:cards.length,
        columns:new Set(core.map(el => Math.round(el.getBoundingClientRect().left))).size,
        clipped:cards.filter(el => { const r=el.getBoundingClientRect();return r.width < 175 || r.left < -1 || r.right > innerWidth + 1; }).length,
        horizontalOverflow:html.scrollWidth > innerWidth+1 || main.scrollWidth > main.clientWidth+1,
        main:bound(main),appFrame:bound(appFrame),appHeader:bound(appHeader),globalHeader:bound(globalHeader),
        navVisible:!!nav && getComputedStyle(nav).display !== 'none',
        theme:html.dataset.xdriveTheme,
        safetyNotes:document.querySelectorAll('[data-xdrive-system-dependencies-safety-note]').length,
        countText:document.querySelector('[data-xdrive-system-dependencies-metric-value="系统服务"]')?.textContent?.trim(),
      };
    });
    result.viewportSamples.push({stage,...sample});
    check(stage+': real viewport',sample.width === width && sample.height === height,sample);
    check(stage+': 11 fixed service cards',sample.cardCount === 11,sample);
    check(stage+': expected grid columns',sample.columns === columns[width],sample);
    check(stage+': no clipped cards or horizontal overflow',!sample.clipped && !sample.horizontalOverflow,sample);
    check(stage+': correct page-local navigation breakpoint',sample.navVisible === (width >= 900),sample);
    check(stage+': single safety note',sample.safetyNotes === 1,sample);
    check(stage+': actual saved dark/light theme',sample.theme === (mobile?'dark':'light'),sample);
    check(stage+': reported 11, not 11 proven healthy',sample.countText === '11 / 11',sample);
    if (width < 900) check(stage+': real full-height 52px mobile App Frame',
      sample.appFrame && Math.abs(sample.appFrame.height-height) <= 1 && sample.appHeader?.height >= 52 &&
      Math.abs(sample.appHeader.bottom-sample.main.y) <= 1,sample);
    else check(stage+': global titlebar and left workspace',sample.globalHeader?.height > 0 && sample.main?.x > 0,sample);
    const selector = page.getByRole('combobox',{name:'选择系统依赖'});
    check(stage+': responsive selector visibility',(await selector.isVisible()) === (width < 900));
    if (width < 900) check(stage+': selector minimum 44px',
      await selector.evaluate(el => el.closest('.MuiInputBase-root').getBoundingClientRect().height >= 44));
    const img = stage + '.png';
    await page.screenshot({path:path.join(outputDir,img)});
    result.screenshots.push(img);
  }
  stage = name + '-navigation';
  await page.setViewportSize(mobile ? {width:390,height:844}:{width:1280,height:800});
  await page.locator('[data-xdrive-system-dependency-overview-card="baidu-map"]').click();
  await page.locator('[data-xdrive-system-dependency-detail]').waitFor();
  check(name+': actual routed Baidu detail',page.url().includes('service=baidu-map'));
  check(name+': status tab never loads private config',state.baiduConfigReads === configReadsBefore);
  await page.getByRole('tab',{name:'配置'}).click();
  const ak = page.getByLabel('Server AK',{exact:true});
  await ak.waitFor();
  check(name+': configuration is lazily fetched',state.baiduConfigReads > configReadsBefore);
  await ak.fill('UNSAVED-QA-NOT-TO-BE-SENT');
  await page.getByRole('button',{name:'返回总览'}).click();
  const dialog = page.getByRole('dialog',{name:/离开未保存的系统依赖配置/});
  await dialog.waitFor();
  check(name+': unsaved draft cannot silently exit',page.url().includes('service=baidu-map'));
  await dialog.getByRole('button',{name:'取消'}).click();
  check(name+': cancelled exit retains draft',(await ak.inputValue()) === 'UNSAVED-QA-NOT-TO-BE-SENT');
  await page.getByRole('button',{name:'返回总览'}).click();
  await dialog.getByRole('button',{name:'放弃修改并切换'}).click();
  await page.locator('[data-xdrive-system-dependencies-overview]').waitFor();
  check(name+': discard does not issue writes',state.writes === 0);
  await page.locator('[data-xdrive-system-dependency-overview-card="baidu-map"]').click();
  await page.getByRole('tab',{name:'检测'}).click();
  const verify = page.getByRole('button',{name:'验证当前 AK 在线生效'});
  await verify.waitFor();
  check(name+': no automatic credential verification',state.baiduVerifies === verifiesBefore);
  await verify.waitFor({state:'visible'});
  check(name+': map verify action enabled only for a saved configured revision',await verify.isEnabled());
  await verify.click();
  await page.getByText(/本次检测：当前 Server 的 AK 修订/).waitFor();
  check(name+': only explicit click triggers fixture verification',state.baiduVerifies === verifiesBefore + 1);
  await page.getByRole('button',{name:'返回总览'}).click();
  await page.locator('[data-xdrive-system-dependencies-overview]').waitFor();
  state.mode = 'partial';
  await page.getByRole('button',{name:'刷新状态'}).click();
  await page.locator('[data-xdrive-system-dependency-unreported-card="caddy"]').waitFor();
  check(name+': partial inventory projects all 11 safe cards',await page.locator(cards).count() === 11);
  check(name+': duplicate/omitted IDs are three missing cards',await page.locator('[data-xdrive-system-dependency-unreported-card]').count() === 3);
  check(name+': status count stays 8/11 and excludes per-user secret',
    (await page.locator('[data-xdrive-system-dependencies-metric-value="系统服务"]').innerText()).trim() === '8 / 11' &&
    !(await page.locator('body').innerText()).includes('FORBIDDEN_SECRET_STRING'));
  await page.locator('[data-xdrive-system-dependency-unreported-card="caddy"]').click();
  await page.locator('[data-xdrive-system-dependency-unreported]').waitFor();
  check(name+': missing row opens read-only retry without config tab',
    await page.getByRole('tab',{name:'配置'}).count() === 0 &&
    await page.getByRole('button',{name:'重新检测状态'}).count() === 1);
  await page.getByRole('button',{name:'返回总览'}).click();
  state.mode = 'unavailable';
  await page.getByRole('button',{name:'刷新状态'}).click();
  await page.getByText(/刷新失败，当前显示上次成功检测的快照/).waitFor();
  check(name+': failed refresh retains snapshot',await page.locator(cards).count() === 11 &&
    await page.locator('[data-xdrive-system-dependency-unreported-card]').count() === 3);
  check(name+': never writes credentials/host commands',state.writes === 0);
  await context.close();
}
async function main() {
  await new Promise((resolve,reject) => {httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve)});
  const origin = 'http://127.0.0.1:' + httpServer.address().port;
  try {
    const chrome = process.env.XDRIVE_BROWSER_EXECUTABLE;
    assert(chrome,'Provide native Chrome through XDRIVE_BROWSER_EXECUTABLE');
    browser = await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
    result.browserVersion = browser.version();
    await visit(origin,'light-desktop',false);
    await visit(origin,'dark-mobile-touch',true);
    check('strict network and no unknown requests',result.unknownRequests.length === 0,result.unknownRequests);
    check('no uncaught browser errors',result.errors.length === 0,result.errors);
  } catch(e) {
    result.failures.push({stage,message:e.message,stack:e.stack});
    if (page && !page.isClosed()) await page.screenshot({path:path.join(outputDir,'failure.png')}).catch(()=>{});
  } finally {
    if (browser) await browser.close().catch(()=>{});
    await new Promise(resolve=>httpServer.close(resolve));
    result.finishedAt = new Date().toISOString();
    result.passed = result.failures.length === 0;
    fs.writeFileSync(path.join(outputDir,'results.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,
      failures:result.failures,unknownRequests:result.unknownRequests,outputDir},null,2));
    if (!result.passed) process.exitCode = 1;
  }
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
