#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const options = {};
for (const argument of process.argv.slice(2)) { const match = /^--(repo-root|source-root|output-dir|case)=(.+)$/.exec(argument); if (!match) throw new Error('Unknown argument: ' + argument); options[match[1]] = match[2]; }
if (options.case && !['baseline', 'all'].includes(options.case)) throw new Error('Unknown case: ' + options.case);
for (const name of ['repo-root', 'source-root', 'output-dir']) assert(options[name], 'Supply --' + name);
const repoRoot = path.resolve(options['repo-root']), sourceRoot = path.resolve(options['source-root']), outputDir = path.resolve(options['output-dir']);
const dependency = createRequire(path.join(repoRoot, 'desktop/package.json')), esbuild = dependency('esbuild');
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || dependency.resolve('playwright'));
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result = { sourceRoot, startedAt: new Date().toISOString(), checks: [], errors: [], samples: {}, case: options.case || 'all', scope: 'M10; real shared composition and trusted Chromium touch/native mouse input; not native-device certification.' };
function check(name, actual, expected = true) { try { assert.deepEqual(actual, expected); result.checks.push({ name, passed: true }); } catch { result.checks.push({ name, passed: false, actual, expected }); process.stdout.write('FAIL ' + name + ': ' + JSON.stringify(actual) + '\n'); } }
const settle = (page) => page.evaluate(async () => { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); const animations = document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity); await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))); });
const state = (page) => page.evaluate(() => ({ ...window.touchDragHarness.state, selectedIDs: [...(window.touchDragHarness.state.controlledIDs ?? window.touchDragHarness.selectedIDs)], events: window.touchDragHarness.events, requests: window.touchDragHarness.requests, errors: window.touchDragHarness.errors, input: window.m10InputTrace }));
const row = (page, name) => page.locator('[data-xdrive-file-explorer-item]').filter({ has: page.getByText(name, { exact: true }) });
async function geometry(locator) { return locator.evaluate((element) => { const r = element.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { x: r.x, y: r.y, width: r.width, height: r.height, draggable: element.draggable, touchAction: getComputedStyle(element).touchAction, hittable: Boolean(hit && (element === hit || element.contains(hit))) }; }); }
async function trace(page) { await page.evaluate(() => { window.m10InputTrace = []; for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click', 'dragstart', 'drop', 'gotpointercapture', 'lostpointercapture']) document.addEventListener(type, (event) => window.m10InputTrace.push({ type, trusted: event.isTrusted, pointerType: event.pointerType, pointerID: event.pointerId, target: event.target?.closest?.('[data-xdrive-file-explorer-item]')?.textContent?.slice(0, 50), element: event.target?.tagName, button: event.target?.closest?.('button')?.getAttribute('aria-label') || event.target?.closest?.('button')?.textContent, x: event.clientX ?? event.changedTouches?.[0]?.clientX, y: event.clientY ?? event.changedTouches?.[0]?.clientY, hit: Number.isFinite(event.clientX) ? document.elementFromPoint(event.clientX, event.clientY)?.closest('button, [data-xdrive-file-explorer-item]')?.textContent?.slice(0, 80) : null, time: Math.round(performance.now()) }), { capture: true, passive: true }); window.m10ScrollOwner = document.querySelector('[data-xdrive-file-explorer-scroll-host]'); }); }
async function capture(page, name) { result.samples[name] = await state(page); result.samples[name].geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, coarse: matchMedia('(pointer:coarse)').matches, sameScrollOwner: window.m10ScrollOwner === document.querySelector('[data-xdrive-file-explorer-scroll-host]'), scrollTop: document.querySelector('[data-xdrive-file-explorer-scroll-host]')?.scrollTop, rows: Array.from(document.querySelectorAll('[data-xdrive-file-explorer-item]')).slice(0, 15).map((element) => { const r = element.getBoundingClientRect(); return { text: element.textContent.slice(0, 50), x: r.x, y: r.y, width: r.width, height: r.height, draggable: element.draggable }; }), buttons: Array.from(document.querySelectorAll('button')).filter((element) => element.getBoundingClientRect().height > 0).map((element) => ({ label: element.getAttribute('aria-label') || element.textContent, draggable: element.draggable, rect: { x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height } })) })); await page.screenshot({ path: path.join(outputDir, name + '.png') }); }
async function touch(cdp, type, x, y, id = 17) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id, radiusX: 3, radiusY: 3, force: 1 }] }); }
const dragHandle = (page) => page.getByRole('button', { name: '拖动所选项目', exact: true });
const center = (bounds) => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
async function dragPresentation(page) {
  return page.evaluate(() => {
    const owner = document.querySelector('[data-xdrive-file-explorer]');
    const ids = [...new Set(window.m10InputTrace.map((event) => event.pointerID).filter(Number.isFinite))];
    return {
      active: document.querySelector('[data-xdrive-file-explorer-touch-drag-status]')?.getAttribute('data-xdrive-file-explorer-touch-drag-status') === 'active',
      captured: ids.filter((id) => owner?.hasPointerCapture(id)),
      targets: Array.from(document.querySelectorAll('[data-xdrive-file-explorer-drop-target]')).map((element) => ({
        type: element.getAttribute('data-xdrive-file-explorer-drop-target'),
        id: element.getAttribute('data-xdrive-file-explorer-item-id') ?? element.getAttribute('data-xdrive-file-explorer-crumb'),
        outline: getComputedStyle(element).outlineStyle,
        outlineWidth: parseFloat(getComputedStyle(element).outlineWidth),
      })),
    };
  });
}
async function selectTouchSources(page, ready, name, mode = 'details') {
  await ready(name);
  if (mode === 'grid') {
    await page.getByRole('button', { name: /^视图，/ }).tap();
    await page.getByRole('menuitem', { name: /网格/ }).tap();
    await settle(page);
  }
  await page.getByRole('button', { name: '选择', exact: true }).tap();
  await row(page, '000-源一.txt').tap();
  await row(page, '001-源二.txt').tap();
  await settle(page);
  check(name + ': real compact selection has both source IDs', (await state(page)).selectedIDs.map(Number).sort((a, b) => a - b), [201, 202]);
}
async function beginTouchDrag(page, cdp, id = 31) {
  const point = center(await geometry(dragHandle(page)));
  await touch(cdp, 'touchStart', point.x, point.y, id);
  await touch(cdp, 'touchMove', point.x, point.y + 12, id);
  await settle(page);
  return point;
}
async function moveTouchTo(page, cdp, target, id = 31) {
  const point = center(await geometry(target));
  await touch(cdp, 'touchMove', point.x, point.y, id);
  await settle(page);
  return point;
}
function operationPlans(snapshot) { return snapshot.requests.filter((request) => request.type === 'operation-submit').map((request) => request.plan); }
function expectedMove(parentID) { return [{ operation: 'move', parentID, items: [{ id: 201, revision: 501 }, { id: 202, revision: 502 }], count: 2 }]; }
async function runTouchDrops(page, cdp, ready) {
  for (const { name, mode, kind, targetID } of [
    { name: 'touch-details-folder', mode: 'details', kind: 'folder', targetID: 30 },
    { name: 'touch-details-crumb', mode: 'details', kind: 'crumb', targetID: 1 },
    { name: 'touch-grid-folder', mode: 'grid', kind: 'folder', targetID: 30 },
  ]) {
    await selectTouchSources(page, ready, name, mode);
    await beginTouchDrag(page, cdp);
    const target = kind === 'folder' ? row(page, '002-目标目录') : page.locator('[data-xdrive-file-explorer-crumb]').filter({ has: page.getByText('我的文件', { exact: true }) });
    await moveTouchTo(page, cdp, target);
    const active = await dragPresentation(page);
    result.samples[name + '-presentation'] = active;
    check(name + ': persistent owner holds native pointer capture', active.active && active.captured.length === 1);
    check(name + ': mounted accepted target has a visible highlight', active.targets.length === 1 && active.targets[0].type === kind && active.targets[0].id === 'number:' + targetID && active.targets[0].outline === 'solid' && active.targets[0].outlineWidth >= 2);
    const cancelBounds = await geometry(page.getByRole('button', { name: '取消拖动', exact: true }));
    check(name + ': visible cancel has a reachable44px target', cancelBounds.width >= 44 && cancelBounds.height >= 44 && cancelBounds.hittable);
    await capture(page, name + '-active');
    await touch(cdp, 'touchEnd');
    await settle(page);
    const end = await state(page), after = await dragPresentation(page);
    check(name + ': existing controller receives the complete immutable move plan once', operationPlans(end), expectedMove(targetID));
    check(name + ': exactly one appropriate drop callback fires', end.events.filter((event) => event.type === 'drop-' + kind).length, 1);
    check(name + ': release clears pointer capture and target highlight', !after.active && after.captured.length === 0 && after.targets.length === 0);
    check(name + ': release creates no trailing file or path activation', end.destination === null && !end.events.some((event) => ['open-item', 'file-open', 'navigate'].includes(event.type)));
    check(name + ': same mounted sparse Files owner and selection survive', end.selectedIDs.join(',') === '201,202' && await page.evaluate(() => window.m10ScrollOwner === document.querySelector('[data-xdrive-file-explorer-scroll-host]')));
    await capture(page, name + '-released');
  }
}
async function runTouchCancellation(page, cdp, ready) {
  for (const action of ['invalid-file', 'self-folder', 'current-crumb', 'escape', 'cancel-button', 'pointercancel', 'second-pointer', 'lost-capture', 'source-change', 'session-change', 'unmount']) {
    const name = 'touch-cancel-' + action;
    await selectTouchSources(page, ready, name);
    if (action === 'self-folder') { await row(page, '002-目标目录').tap(); await settle(page); }
    await beginTouchDrag(page, cdp, 41);
    const target = action === 'invalid-file' ? row(page, '003-普通文件.txt')
      : action === 'current-crumb' ? page.locator('[data-xdrive-file-explorer-crumb]').filter({ has: page.getByText('当前目录', { exact: true }) })
      : row(page, '002-目标目录');
    let point = await moveTouchTo(page, cdp, target, 41);
    if (['invalid-file', 'self-folder', 'current-crumb'].includes(action)) {
      check(name + ': unaccepted destination is not highlighted', (await dragPresentation(page)).targets, []);
    } else if (action === 'escape') {
      await page.keyboard.press('Escape');
    } else if (action === 'cancel-button') {
      await page.getByRole('button', { name: '取消拖动', exact: true }).focus();
      await page.keyboard.press('Enter');
    } else if (action === 'pointercancel') {
      await touch(cdp, 'touchCancel');
    } else if (action === 'second-pointer') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
        { id: 41, x: point.x, y: point.y, radiusX: 3, radiusY: 3, force: 1 },
        { id: 42, x: 355, y: 245, radiusX: 3, radiusY: 3, force: 1 },
      ] });
    } else if (action === 'lost-capture') {
      await page.evaluate(() => {
        const owner = document.querySelector('[data-xdrive-file-explorer]');
        const event = [...window.m10InputTrace].reverse().find((entry) => entry.type === 'pointermove');
        owner.releasePointerCapture(event.pointerID);
      });
      await touch(cdp, 'touchMove', point.x + 1, point.y, 41);
    } else if (action === 'source-change') {
      await page.evaluate(() => window.touchDragHarness.setControlledIDs([201]));
    } else if (action === 'session-change') {
      await page.evaluate(() => window.touchDragHarness.changeSession());
    } else if (action === 'unmount') {
      await page.evaluate(() => window.touchDragHarness.hideExplorer());
    }
    await settle(page);
    if (!['invalid-file', 'self-folder', 'current-crumb'].includes(action)) {
      const cancelled = await dragPresentation(page);
      check(name + ': cancellation clears active state capture and highlight before release', !cancelled.active && cancelled.captured.length === 0 && cancelled.targets.length === 0);
    }
    if (action !== 'pointercancel') await touch(cdp, 'touchEnd');
    await settle(page);
    const end = await state(page), after = await dragPresentation(page);
    check(name + ': release never submits a partial or cancelled move', operationPlans(end), []);
    check(name + ': release leaves no capture or accepted target', !after.active && after.captured.length === 0 && after.targets.length === 0);
    check(name + ': cancelled gesture cannot open a file path or destination dialog', end.destination === null && !end.events.some((event) => ['open-item', 'file-open', 'navigate'].includes(event.type)));
    await capture(page, name + '-released');
  }
}
async function runTouchAutoscroll(page, cdp, ready) {
  const name = 'touch-autoscroll';
  await selectTouchSources(page, ready, name);
  check(name + ': later destination is initially unmounted', await row(page, '240-后续目标目录').count(), 0);
  await beginTouchDrag(page, cdp, 51);
  const host = page.locator('[data-xdrive-file-explorer-scroll-host]');
  const bounds = await geometry(host);
  await touch(cdp, 'touchMove', bounds.x + bounds.width / 2, bounds.y + bounds.height - 3, 51);
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]');
    const target = document.querySelector('[data-xdrive-file-explorer-item-id="number:40"]');
    if (!host || !target) return false;
    const r = target.getBoundingClientRect(), h = host.getBoundingClientRect();
    return r.top >= h.top + 65 && r.top <= h.top + h.height / 2;
  }, undefined, { timeout: 25000 });
  // Move into the center to stop edge scrolling, then resolve the current
  // mounted target again. No direct scrollTop writes or synthetic drop events.
  const currentHost = await geometry(host);
  await touch(cdp, 'touchMove', currentHost.x + currentHost.width - 12, currentHost.y + currentHost.height / 2, 51);
  await settle(page);
  const target = row(page, '240-后续目标目录');
  await moveTouchTo(page, cdp, target, 51);
  const active = await dragPresentation(page), before = await state(page);
  check(name + ': same real scroll host moved beyond the initial virtual window', await page.evaluate(() => window.m10ScrollOwner === document.querySelector('[data-xdrive-file-explorer-scroll-host]') && window.m10ScrollOwner.scrollTop > 10000));
  check(name + ': old source row was evicted and the new destination is highlighted', await row(page, '000-源一.txt').count() === 0 && active.targets.some((target) => target.id === 'number:40'));
  check(name + ': later bounded transport ranges actually loaded', before.requests.some((request) => request.type === 'directory-range' && request.offset >= 400) && before.requests.filter((request) => request.type === 'directory-range').every((request) => request.limit <= 200));
  await capture(page, name + '-active-new-target');
  await touch(cdp, 'touchEnd');
  await settle(page);
  const end = await state(page);
  check(name + ': real controller retains both off-window raw revisions for the move', operationPlans(end), expectedMove(40));
  check(name + ': newly mounted target receives one drop without trailing activation', end.events.filter((event) => event.type === 'drop-folder').length === 1 && !end.events.some((event) => ['open-item', 'file-open', 'navigate'].includes(event.type)));
  await capture(page, name + '-released');
}
async function runSelectionRefusal(page, cdp, ready) {
  for (const kind of ['unavailable', 'over-limit']) {
    const name = 'touch-selection-' + kind;
    await selectTouchSources(page, ready, name);
    const ids = kind === 'unavailable' ? [201, 999999]
      : Array.from({ length: 201 }, (_, index) => index === 0 ? 201 : index === 1 ? 202 : index === 2 ? 30 : 1000 + index);
    await page.evaluate((ids) => window.touchDragHarness.setControlledIDs(ids), ids);
    await settle(page);
    check(name + ': the complete identity count remains selected', (await state(page)).selectedIDs, ids);
    const metadataComplete = await page.evaluate(() => window.touchDragHarness.state.controlledIDs.every((id) => window.touchDragHarness.workspace.nodeByID.has(id)));
    check(name + ': actual workspace metadata has the intended availability', metadataComplete, kind !== 'unavailable');
    check(name + ': shared eligibility disables the drag entry', await dragHandle(page).isDisabled());
    const explanation = await page.locator('[data-xdrive-file-explorer-touch-drag-status]').innerText();
    check(name + ': the disabled reason is visible in Files', kind === 'unavailable' ? /部分所选项目/.test(explanation) : /200/.test(explanation));
    const start = center(await geometry(dragHandle(page))), target = center(await geometry(row(page, '002-目标目录')));
    await touch(cdp, 'touchStart', start.x, start.y, 61);
    await touch(cdp, 'touchMove', target.x, target.y, 61);
    await touch(cdp, 'touchEnd');
    await settle(page);
    const end = await state(page), presentation = await dragPresentation(page);
    check(name + ': trusted input cannot submit a loaded or capped subset', operationPlans(end).length === 0 && !presentation.active && presentation.captured.length === 0 && presentation.targets.length === 0);
    await capture(page, name + '-refused');
  }
}
async function runStationaryTarget(page, cdp, ready) {
  const name = 'stationary-late-target';
  await selectTouchSources(page, ready, name);
  await beginTouchDrag(page, cdp, 71);
  const host = page.locator('[data-xdrive-file-explorer-scroll-host]');
  const bounds = await geometry(host);
  await touch(cdp, 'touchMove', bounds.x + bounds.width / 2, bounds.y + bounds.height - 3, 71);
  await page.waitForFunction(() => document.querySelector('[data-xdrive-file-explorer-scroll-host]').scrollTop > 11200, undefined, { timeout: 25000 });
  const currentBounds = await geometry(host);
  const point = { x: currentBounds.x + currentBounds.width / 2, y: currentBounds.y + currentBounds.height / 2 };
  await touch(cdp, 'touchMove', point.x, point.y, 71);
  await settle(page);
  const under = () => page.evaluate(point => {
    const element = document.elementFromPoint(point.x, point.y);
    const item = element?.closest('[data-xdrive-file-explorer-item-id]');
    return { point, placeholder: Boolean(element?.closest('[data-xdrive-file-explorer-placeholder]')), id: item?.getAttribute('data-xdrive-file-explorer-item-id'), highlight: item?.getAttribute('data-xdrive-file-explorer-drop-target'), status: document.querySelector('[data-xdrive-file-explorer-touch-drag-status]')?.textContent, scrollTop: document.querySelector('[data-xdrive-file-explorer-scroll-host]').scrollTop, moves: window.m10InputTrace.filter(event => event.type === 'pointermove').length };
  }, point);
  const before = await under();
  result.samples[name + '-before-load'] = before;
  check(name + ': actual unloaded placeholder is under the stationary pointer', before.placeholder);
  check(name + ': no unloaded placeholder is highlighted as a destination', (await dragPresentation(page)).targets, []);
  await page.evaluate(() => window.touchDragHarness.releaseHeldRanges());
  await page.waitForFunction(point => Boolean(document.elementFromPoint(point.x, point.y)?.closest('[data-xdrive-file-explorer-item-id]')), point);
  await settle(page);
  await page.waitForTimeout(150);
  const after = await under();
  result.samples[name + '-after-load'] = after;
  await capture(page, name + '-loaded');
  check(name + ': late range completion mounts a real destination beneath the same pointer', Boolean(after.id));
  check(name + ': no new pointer movement occurs while the destination materializes', after.moves, before.moves);
  check(name + ': the existing scroll owner stays stationary during completion', after.scrollTop, before.scrollTop);
  check(name + ': the late mounted destination gains accepted highlight before release', after.highlight, 'folder');
  const targetID = Number(after.id?.split(':')[1]);
  await touch(cdp, 'touchEnd');
  await settle(page);
  const end = await state(page), presentation = await dragPresentation(page);
  check(name + ': final release re-hit-tests and submits the complete move to the actual mounted target', operationPlans(end), expectedMove(targetID));
  check(name + ': release leaves no captured pointer or target', !presentation.active && presentation.targets.length === 0);
  await capture(page, name + '-released');
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  result.sourceCommit = fs.existsSync(path.join(sourceRoot, 'source-revision.txt')) ? fs.readFileSync(path.join(sourceRoot, 'source-revision.txt'), 'utf8').trim() : execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sources = { __EXPLORER__: 'mui/FileExplorer.tsx', __WORKSPACE__: 'mui/FileExplorerWorkspaceController.ts', __VIRTUAL__: 'mui/VirtualCollectionController.ts', __OPERATIONS__: 'mui/FileExplorerOperationController.ts', __DESTINATION__: 'mui/FileExplorerDestinationDialog.tsx', __THEME__: 'mui/AppearanceThemeProvider.tsx', __MODEL__: 'file-explorer-controller.ts' };
  const sourceNames = [...Object.values(sources)];
  if (fs.existsSync(path.join(sourceRoot, 'ui/shared/src/mui/usePointerDrag.ts'))) sourceNames.push('mui/usePointerDrag.ts');
  result.sourceHashes = Object.fromEntries(sourceNames.map((name) => [name, hash(path.join(sourceRoot, 'ui/shared/src', name))]));
  result.fixtureHashes = {};
  for (const name of ['file-explorer-touch-drag-browser.cjs', 'file-explorer-touch-drag-browser.tsx']) { result.fixtureHashes[name] = hash(path.join(__dirname, name)); fs.copyFileSync(path.join(__dirname, name), path.join(outputDir, name)); }
  await esbuild.build({ entryPoints: [path.join(__dirname, 'file-explorer-touch-drag-browser.tsx')], bundle: true, jsx: 'automatic', outfile: path.join(outputDir, 'bundle.js'), nodePaths: [path.join(repoRoot, 'desktop/node_modules')], alias: Object.fromEntries(Object.entries(sources).map(([key, name]) => [key, path.join(sourceRoot, 'ui/shared/src', name)])), define: { 'process.env.NODE_ENV': '"production"' } });
  result.bundleHash = hash(path.join(outputDir, 'bundle.js'));
  const server = http.createServer((request, response) => { const route = new URL(request.url, 'http://localhost').pathname; response.setHeader('Cache-Control', 'no-store'); if (route === '/') { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end('<!doctype html><html style="height:100%"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;height:100%"><div id="root" style="height:100%;min-height:0"></div><script src="/bundle.js"></script></body></html>'); } else if (route === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(path.join(outputDir, 'bundle.js'))); } else if (route === '/favicon.ico') { response.statusCode = 204; response.end(); } else { result.errors.push('Unknown request ' + route); response.statusCode = 404; response.end(); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const input of ['touch', 'mouse']) {
      let browser, page;
      try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE, args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined }); result.browserVersion = browser.version();
        const context = await browser.newContext({ viewport: { width: input === 'touch' ? 390 : 900, height: 844 }, hasTouch: input === 'touch', isMobile: input === 'touch', deviceScaleFactor: 1 });
        page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', (error) => result.errors.push({ input, type: 'pageerror', message: error.message })); page.on('console', (message) => { if (message.type() === 'error') result.errors.push({ input, type: 'console', message: message.text() }); });
        const ready = async (fixtureName = '') => { await page.goto(origin + (fixtureName ? '/?fixture=' + encodeURIComponent(fixtureName) : ''), { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.touchDragHarness?.state.count === 1024); await row(page, '000-源一.txt').waitFor(); await settle(page); await trace(page); };
        await ready();
        if (input === 'touch') {
          const cdp = await context.newCDPSession(page), host = page.locator('[data-xdrive-file-explorer-scroll-host]');
          const panRow = await geometry(row(page, '007-普通文件.txt'));
          await touch(cdp, 'touchStart', panRow.x + 100, panRow.y + panRow.height / 2);
          for (let step = 1; step <= 8; step++) { await touch(cdp, 'touchMove', panRow.x + 100, panRow.y + panRow.height / 2 - step * 28); await page.waitForTimeout(24); }
          await touch(cdp, 'touchEnd'); await page.waitForTimeout(180); await settle(page);
          const pan = await state(page), scrolled = await host.evaluate((element) => element.scrollTop);
          check('Touch input is trusted native Chromium input', pan.input.some((event) => event.type === 'pointerdown' && event.pointerType === 'touch' && event.trusted));
          check('Ordinary row touch pan scrolls the actual Files host', scrolled > 60);
          check('Ordinary row pan cancels long press and opens no item', pan.selectedIDs.length === 0 && !pan.events.some((event) => ['open-item', 'file-open', 'drop-folder', 'drop-crumb'].includes(event.type)));
          check('Pan preserves the same mounted scroll owner', await page.evaluate(() => window.m10ScrollOwner === document.querySelector('[data-xdrive-file-explorer-scroll-host]')));
          await capture(page, 'touch-natural-pan');
          await ready();
          const first = row(page, '000-源一.txt'), firstBounds = await geometry(first);
          result.samples.longPressInitial = { bounds: firstBounds, point: { x: firstBounds.x + 100, y: firstBounds.y + firstBounds.height / 2 } };
          await touch(cdp, 'touchStart', firstBounds.x + 100, firstBounds.y + firstBounds.height / 2, 19); await page.waitForTimeout(650);
          await capture(page, 'touch-long-press-before-release');
          await touch(cdp, 'touchEnd'); await settle(page);
          await page.waitForFunction(() => window.touchDragHarness.selectedIDs.length === 1);
          const afterLongPress = await state(page);
          check('Real long press opens the context menu without opening a file', afterLongPress.events.every((event) => !['open-item', 'file-open'].includes(event.type)) && await page.locator('[data-xdrive-file-explorer-touch-action-sheet]').isVisible());
          check('Long press release does not activate a newly shifted action control', afterLongPress.destination === null);
          await capture(page, 'touch-long-press-after-release');
          // Recover explicitly from an observed unintended dialog so the independent
          // missing-handle and direct-alternative probes can still run.
          if (afterLongPress.destination) { await page.getByRole('button', { name: '取消', exact: true }).tap(); await page.locator('[data-xdrive-file-explorer-destination-dialog]').waitFor({ state: 'hidden' }); await settle(page); }
          await page.getByRole('button', { name: '关闭文件操作', exact: true }).tap();
          await page.getByRole('button', { name: '选择', exact: true }).tap();
          await first.tap({ position: { x: 100, y: 24 } });
          await row(page, '001-源二.txt').tap({ position: { x: 100, y: 24 } }); await settle(page);
          const selected = await state(page);
          check('Touch selection contains both complete source IDs', selected.selectedIDs.map(Number).sort((a, b) => a - b), [201, 202]);
          check('Compact touch keeps ordinary native HTML row dragging disabled', await first.evaluate((element) => element.draggable), false);
          check('A sparse logical collection is actually in use', selected.count === 1024 && selected.loadedIndexes.length < 1024 && selected.requests.filter((request) => request.type === 'directory-range').every((request) => request.limit <= 200));
          const handle = page.getByRole('button', { name: /拖动所选项目|拖动已选项目|拖拽所选项目/ });
          const handleCount = await handle.count();
          check('Selected Files exposes one persistent touch drag handle', handleCount, 1);
          if (handleCount === 1) { const bounds = await geometry(handle); check('Touch drag handle has a44px actual hit target', bounds.width >= 44 && bounds.height >= 44 && bounds.hittable); }
          await capture(page, 'touch-selected-first-red');
          for (const [name, operation] of [['移动到…', 'move'], ['复制到…', 'copy']]) {
            const trigger = page.getByRole('button', { name, exact: true }); const bounds = await geometry(trigger);
            check(name + ' direct alternative remains a reachable44px control', bounds.width >= 44 && bounds.height >= 44 && bounds.hittable);
            await trigger.tap(); await page.locator('[data-xdrive-file-explorer-destination-dialog][aria-label="' + (operation === 'move' ? '移动到文件夹' : '复制到文件夹') + '"]').waitFor(); await settle(page);
            const opened = await state(page);
            check(name + ' opens the real destination controller with complete immutable source refs', opened.destination.sources.map((source) => [source.id, source.revision]), [[201, 501], [202, 502]]);
            await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).tap(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await settle(page);
          }
          const end = await state(page);
          check('Cancelling direct alternatives makes no operation request', end.requests.filter((request) => request.type === 'operation-submit').length, 0);
          check('Direct alternatives preserve selected IDs and the mounted Files scroll host', end.selectedIDs.map(Number).sort((a, b) => a - b).join(',') === '201,202' && await page.evaluate(() => window.m10ScrollOwner === document.querySelector('[data-xdrive-file-explorer-scroll-host]')));
          await capture(page, 'touch-fallbacks-return');
          if (result.case !== 'baseline') {
            await runTouchDrops(page, cdp, ready);
            await runTouchCancellation(page, cdp, ready);
            await runTouchAutoscroll(page, cdp, ready);
            await runSelectionRefusal(page, cdp, ready);
            await runStationaryTarget(page, cdp, ready);
          }
        } else {
          const first = row(page, '000-源一.txt'), second = row(page, '001-源二.txt'), target = row(page, '002-目标目录');
          await first.click({ position: { x: 100, y: 18 } }); await second.click({ modifiers: ['Control'], position: { x: 100, y: 18 } }); await settle(page);
          check('Wide mouse control selects both source IDs', (await state(page)).selectedIDs.map(Number).sort((a, b) => a - b), [201, 202]);
          check('Wide mouse keeps native HTML row dragging enabled', await first.evaluate((element) => element.draggable));
          await first.dragTo(target, { sourcePosition: { x: 100, y: 18 }, targetPosition: { x: 100, y: 18 } }); await settle(page);
          await page.waitForFunction(() => window.touchDragHarness.requests.some((request) => request.type === 'operation-submit'));
          const end = await state(page), drops = end.events.filter((event) => event.type === 'drop-folder'), operations = end.requests.filter((request) => request.type === 'operation-submit');
          check('Native mouse drop delivers exactly one existing folder callback', drops.length, 1);
          check('Native drop keeps complete selected source refs and correct target', drops[0].value, { items: [{ id: 201, revision: 501 }, { id: 202, revision: 502 }], targetID: 30, operation: 'move' });
          check('Real operation controller emits one complete queued plan', operations.map((request) => request.plan), [{ operation: 'move', parentID: 30, items: [{ id: 201, revision: 501 }, { id: 202, revision: 502 }], count: 2 }]);
          check('Native mouse drag creates no trailing item open', !end.events.some((event) => ['open-item', 'file-open'].includes(event.type)));
          await capture(page, 'wide-native-drop-control');
        }
      } catch (error) { result.errors.push({ input, type: 'scenario', message: error.message, stack: error.stack }); if (page) { await capture(page, input + '-failure').catch(() => undefined); } }
      finally { if (browser) await browser.close(); }
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
  check('No controlled range or operation callback error', Object.values(result.samples).flatMap((sample) => sample.errors ?? []), []);
  check('No renderer, transport, or scenario error', result.errors.length, 0);
  result.sourceHashesAfter = Object.fromEntries(Object.keys(result.sourceHashes).map((name) => [name, hash(path.join(sourceRoot, 'ui/shared/src', name))]));
  result.sourceHashMatch = JSON.stringify(result.sourceHashes) === JSON.stringify(result.sourceHashesAfter);
  result.finishedAt = new Date().toISOString(); result.passed = result.checks.every((check) => check.passed) && result.errors.length === 0;
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ checks: result.checks.length, passed: result.checks.filter((check) => check.passed).length, failed: result.checks.filter((check) => !check.passed).length, errors: result.errors.length, outputDir }, null, 2) + '\n'); process.exitCode = result.passed ? 0 : 1;
}
main().catch((error) => { fs.mkdirSync(outputDir, { recursive: true }); result.errors.push({ type: 'fatal', message: error.message, stack: error.stack }); fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(result, null, 2) + '\n'); process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
