#!/usr/bin/env node
// Optional M09 A1/A5 acceptance of the real built App, router, api.ts, WebMediaViewer,
// shared Preview Engine and shared Inspector. No application component copy.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const golden = require('./media-properties-fixtures.cjs');
const options = {};
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir|case)=(.+)$/.exec(argument);
  if (!match) throw new Error('Unknown argument: ' + argument);
  options[match[1]] = match[2];
}
assert(options['source-root'] && options['output-dir'], 'Supply --source-root and --output-dir');
assert(!options.case || ['all', 'still', 'video', 'live'].includes(options.case), 'Use --case=all|still|video|live');
const sourceRoot = path.resolve(options['source-root']);
const outputDir = path.resolve(options['output-dir']);
const distRoot = path.join(sourceRoot, 'web/dist');
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright');
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const imagePNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAIAAAABc2X6AAAAc0lEQVR4nO3PgQ0AEADAMPz/M1+Q1HrBNvf4y3odcFvDuoZ1Desa1jWsa1jXsK5hXcO6hnUN6xrWNaxrWNewrmFdw7qGdQ3rGtY1rGtY17CuYV3DuoZ1Desa1jWsa1jXsK5hXcO6hnUN6xrWNaxrWNew7gDdvwGf2GYUOgAAAABJRU5ErkJggg==', 'base64');
const videoPath = path.join(outputDir, 'fixture-video.mp4');
let videoBytes;
const itemsByID = new Map(Object.values(golden.items).map((item) => [item.node.id, item]));
const nodesByID = new Map([golden.rootNode, golden.parentNode, ...Object.values(golden.items).map((item) => item.node)].map((node) => [node.id, node]));
const result = { startedAt: new Date().toISOString(), sourceRoot, checks: [], errors: [], unknownRequests: [], requests: [], samples: {}, scope: 'Actual routed built Web App; controlled REST and valid tiny PNG/MP4 decode; Chromium emulation only.' };
let stage = 'setup';
function check(name, actual, expected = true) {
  try { assert.deepEqual(actual, expected); result.checks.push({ name, passed: true }); }
  catch { result.checks.push({ name, passed: false, actual, expected }); process.stdout.write('FAIL ' + name + ': ' + JSON.stringify(actual) + '\n'); }
}
function queryOnly(url, allowed) { for (const key of url.searchParams.keys()) assert(allowed.includes(key), 'Unknown query: ' + key + ' in ' + url.pathname); }
function integer(url, key, fallback, maximum) { const value = url.searchParams.has(key) ? Number(url.searchParams.get(key)) : fallback; assert(Number.isInteger(value) && value >= 0 && value <= maximum, 'Unbounded query: ' + key); return value; }
function recent(node) { const crumbs = [golden.rootNode, golden.parentNode, node]; return { node, crumbs, path: crumbs.map((value) => value.name).join('/'), accessed_at: golden.stamp }; }
function responseFor(request) {
  const url = new URL(request.url()), key = request.method() + ' ' + url.pathname;
  const json = (value) => ({ contentType: 'application/json', body: JSON.stringify(value) });
  const plain = (value) => { queryOnly(url, []); return json(value); };
  switch (key) {
    case 'GET /api/v1/version': return plain({ version: 'm09-routed-viewer-fixture', channel: 'master', commit: 'fixture', build_time: golden.stamp });
    case 'GET /api/v1/me': return plain({ id: 11, username: 'qa-user', role: 'user', must_change_password: false });
    case 'GET /api/v1/me/quota': return plain({ quota_bytes: 10737418240, physical_used_bytes: 1048576, reserved_bytes: 0, available_bytes: 10736369664, logical_file_bytes: 1048576, trash_bytes: 0, history_bytes: 0, over_quota: false });
    case 'GET /api/v1/nodes/root': return plain(golden.rootNode);
    case 'GET /api/v1/background-tasks/active-summary': return plain({ active_total: 0, file_operation: 0, sync_run: 0, archive_prepare: 0, scheduler: 0 });
    case 'GET /api/v1/background-tasks/page': queryOnly(url, ['limit']); integer(url, 'limit', 50, 200); return json({ current_items: [], history_items: [] });
    case 'GET /api/v1/file-operations': queryOnly(url, ['limit']); integer(url, 'limit', 100, 200); return json([]);
    case 'GET /api/v1/changes': queryOnly(url, ['after', 'limit']); integer(url, 'after', 0, 100); integer(url, 'limit', 200, 1000); return json({ changes: [], next_cursor: 1, latest_cursor: 1, has_more: false, reset_required: false });
    case 'GET /api/v1/file-quick-access': case 'GET /api/v1/file-tags': case 'GET /api/v1/file-saved-searches':
    case 'GET /api/v1/file-favorites': case 'GET /api/v1/sources': case 'GET /api/v1/media/albums': return plain([]);
    case 'GET /api/v1/file-recent': queryOnly(url, ['limit']); integer(url, 'limit', 20, 100); return json([]);
  }
  let match = /^GET \/api\/v1\/nodes\/(\d+)$/.exec(key);
  if (match && nodesByID.has(Number(match[1]))) return plain(nodesByID.get(Number(match[1])));
  match = /^POST \/api\/v1\/file-recent\/(\d+)$/.exec(key);
  if (match && itemsByID.has(Number(match[1]))) { assert.deepEqual(JSON.parse(request.postData() || '{}'), {}); return plain(recent(itemsByID.get(Number(match[1])).node)); }
  match = /^GET \/api\/v1\/nodes\/(1|5)\/children$/.exec(key);
  if (match) {
    queryOnly(url, ['offset', 'limit', 'sort', 'order', 'folders_first', 'group_by', 'include_total_count', 'include_groups']);
    const nodes = match[1] === '1' ? [golden.parentNode] : Object.values(golden.items).map((item) => item.node);
    const offset = integer(url, 'offset', 0, 3), limit = integer(url, 'limit', 200, 500), sort = url.searchParams.get('sort') || 'name', order = url.searchParams.get('order') || 'asc';
    assert.equal(sort, 'name'); assert.equal(order, 'asc');
    return json(url.searchParams.has('offset') ? { items: nodes.slice(offset, offset + limit), total_count: nodes.length, total_count_included: true, offset, limit, sort, order } : { items: nodes, has_more: false, sort, order });
  }
  match = /^GET \/api\/v1\/media\/items\/(\d+)$/.exec(key);
  if (match && itemsByID.has(Number(match[1]))) return plain(itemsByID.get(Number(match[1])));
  match = /^GET \/api\/v1\/media\/items\/(\d+)\/thumbnail$/.exec(key);
  if (match && itemsByID.has(Number(match[1]))) { queryOnly(url, ['v']); assert.equal(url.searchParams.get('v'), '3'); return { contentType: 'image/png', body: imagePNG }; }
  match = /^POST \/api\/v1\/files\/(101|202)\/preview-ticket$/.exec(key);
  if (match) { queryOnly(url, []); assert.equal(request.postData(), null); const kind = match[1] === '202' ? 'video' : 'image'; return json({ url: '/api/v1/file-preview/m09-' + match[1], expires_at: '2099-01-01T00:00:00Z', kind, mime_type: kind === 'video' ? 'video/mp4' : 'image/png' }); }
  match = /^POST \/api\/v1\/media\/items\/303\/live-photo-(still|motion)-ticket$/.exec(key);
  if (match) { queryOnly(url, []); assert.equal(request.postData(), null); const motion = match[1] === 'motion'; return json({ url: '/api/v1/media-live-photo-' + match[1] + '/m09-303', expires_at: '2099-01-01T00:00:00Z', kind: motion ? 'video' : 'image', mime_type: motion ? 'video/mp4' : 'image/png' }); }
  if (['GET /api/v1/file-preview/m09-101', 'GET /api/v1/media-live-photo-still/m09-303'].includes(key)) { queryOnly(url, []); return { contentType: 'image/png', body: imagePNG }; }
  if (['GET /api/v1/file-preview/m09-202', 'GET /api/v1/media-live-photo-motion/m09-303'].includes(key)) {
    queryOnly(url, []);
    const range = request.headers().range;
    if (!range) return { contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' }, body: videoBytes };
    const parsed = /^bytes=(\d+)-(\d*)$/.exec(range); assert(parsed, 'Unsupported video byte range');
    const start = Number(parsed[1]), end = Math.min(parsed[2] ? Number(parsed[2]) : videoBytes.length - 1, videoBytes.length - 1);
    assert(start >= 0 && start <= end && end < videoBytes.length, 'Invalid video byte range');
    return { status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${videoBytes.length}` }, body: videoBytes.subarray(start, end + 1) };
  }
  throw new Error('Unrecognized API: ' + key + url.search);
}
const settle = (page) => page.evaluate(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const animations = document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity);
  await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  await new Promise((resolve) => requestAnimationFrame(resolve));
});
function mediaRequests(label) { return result.requests.filter((request) => request.case === label && /thumbnail|preview-ticket|file-preview\/|live-photo-(still|motion)/.test(request.path)); }
async function rows(section) { return section.evaluate((element) => Array.from(element.querySelectorAll('*')).filter((candidate) => getComputedStyle(candidate).display === 'grid' && candidate.children.length === 2).map((row) => Array.from(row.children).map((cell) => cell.textContent.trim()))); }
async function geometry(locator) { return locator.evaluate((element) => {
  const r = element.getBoundingClientRect(), rect = { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right), top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom), opacity = 1, pointer = true;
  for (let parent = element; parent; parent = parent.parentElement) { const css = getComputedStyle(parent); opacity *= Number(css.opacity); if (css.pointerEvents === 'none') pointer = false; const bounds = parent.getBoundingClientRect(); if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); } if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); } }
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  return { rect, clippedWidth: Math.max(0, right - left), clippedHeight: Math.max(0, bottom - top), opacity, pointer, hittable: Boolean(hit && (element === hit || element.contains(hit))), focused: document.activeElement === element };
}); }
async function wheelTo(page, target) {
  for (let step = 0; step < 14; step++) {
    const g = await geometry(target);
    if (g.clippedHeight >= Math.min(g.rect.height, 24) - 1 && g.clippedWidth >= g.rect.width - 1 && g.hittable) return g;
    const viewport = await target.evaluate((element) => { let candidate = element.parentElement; while (candidate) { const css = getComputedStyle(candidate); if (/(auto|scroll)/.test(css.overflowY) && candidate.scrollHeight > candidate.clientHeight + 1) { const r = candidate.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, targetY: element.getBoundingClientRect().y }; } candidate = candidate.parentElement; } return null; });
    if (!viewport) return g;
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await page.mouse.wheel(0, viewport.targetY < viewport.y ? -500 : 500);
    await settle(page);
  }
  return geometry(target);
}
async function rememberViewer(page) { return page.evaluate(() => {
  const viewer = document.querySelector('[data-xdrive-web-viewer]'), preview = viewer?.querySelector('[data-xdrive-file-preview-kind]');
  window.__m09Viewer = { viewer, preview, images: Array.from(viewer.querySelectorAll('img')), videos: Array.from(viewer.querySelectorAll('video')), route: location.hash };
  return { route: location.hash, kind: preview?.getAttribute('data-xdrive-file-preview-kind'), images: window.__m09Viewer.images.length, videos: window.__m09Viewer.videos.length, player: window.__m09Viewer.videos.map((video) => ({ currentTime: video.currentTime, paused: video.paused, volume: video.volume, playbackRate: video.playbackRate, currentSrc: video.currentSrc })) };
}); }
async function viewerState(page) { return page.evaluate(() => {
  const saved = window.__m09Viewer, viewer = document.querySelector('[data-xdrive-web-viewer]'), images = Array.from(viewer?.querySelectorAll('img') || []), videos = Array.from(viewer?.querySelectorAll('video') || []);
  return { route: location.hash, sameViewer: Boolean(saved.viewer.isConnected && saved.viewer === viewer), samePreview: Boolean(saved.preview.isConnected && viewer.querySelector('[data-xdrive-file-preview-kind]') === saved.preview), sameImages: saved.images.length === images.length && saved.images.every((image, index) => image.isConnected && image === images[index]), sameVideos: saved.videos.length === videos.length && saved.videos.every((video, index) => video.isConnected && video === videos[index]), images: images.length, videos: videos.length, player: videos.map((video) => ({ currentTime: video.currentTime, paused: video.paused, volume: video.volume, playbackRate: video.playbackRate, currentSrc: video.currentSrc })), inspectorPlayers: document.querySelectorAll('[data-xdrive-media-details-drawer] video, [data-xdrive-media-details-drawer] audio').length, inspectorPreviews: document.querySelectorAll('[data-xdrive-media-details-drawer] [data-xdrive-file-preview-kind]').length, focused: { tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') } };
}); }
async function acceptance(page, kind, viewport) {
  const item = golden.items[kind], expected = golden.expected[kind], label = `${kind}-${viewport.width}x${viewport.height}`;
  stage = label + ':ready';
  const viewer = page.locator('[data-xdrive-web-viewer]');
  await viewer.waitFor({ timeout: 15000 });
  const preview = viewer.locator('[data-xdrive-file-preview-kind]');
  await preview.waitFor();
  if (kind === 'video') {
    await page.waitForFunction(() => { const video = document.querySelector('[data-xdrive-web-viewer] video'); return video && video.readyState >= 2 && Number.isFinite(video.duration); });
    await viewer.locator('video').evaluate((video) => { video.pause(); video.currentTime = 1.25; video.volume = 0.35; video.playbackRate = 0.75; });
    await page.waitForFunction(() => { const video = document.querySelector('[data-xdrive-web-viewer] video'); return video && !video.seeking && Math.abs(video.currentTime - 1.25) < 0.01; });
  } else await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-xdrive-web-viewer] img')).some((image) => image.complete && image.naturalWidth > 0));
  await settle(page);
  if (kind === 'live' && viewport.height < 500) {
    stage = label + ':load-motion-before-properties';
    const live = viewer.getByRole('button', { name: /按住播放，松开停止/ });
    await live.focus(); await page.keyboard.down('Space');
    await page.waitForFunction(() => { const video = document.querySelector('[data-xdrive-web-viewer] video'); return video && video.readyState >= 2 && !video.paused; });
    await page.keyboard.up('Space'); await settle(page);
  }
  // Keyboard activity restores Viewer chrome without changing media state.
  await viewer.focus(); await page.keyboard.press('Shift');
  const trigger = viewer.getByRole('button', { name: '查看属性', exact: true });
  await trigger.waitFor();
  const before = await rememberViewer(page), requestsBefore = mediaRequests(label).length;
  check(label + ': actual routed Viewer renders the selected media kind', before.kind, kind === 'still' ? 'image' : kind === 'live' ? 'live_photo' : 'video');
  check(label + ': route identifies the selected Node', before.route, '#/app/media-viewer?node=' + item.node.id);
  stage = label + ':properties-open';
  await trigger.click();
  const drawer = page.locator('[data-xdrive-media-details-drawer]');
  await drawer.waitFor(); await settle(page);
  const opened = await viewerState(page);
  check(label + ': opening Properties keeps the exact mounted Viewer and preview', opened.sameViewer && opened.samePreview);
  check(label + ': opening Properties keeps exact existing image and player elements', opened.sameImages && opened.sameVideos);
  check(label + ': Properties mounts no second preview or player', [opened.inspectorPreviews, opened.inspectorPlayers], [0, 0]);
  check(label + ': opening Properties requests no new original, still, thumbnail or motion', mediaRequests(label).length, requestsBefore);
  check(label + ': opening Properties preserves playback state', opened.player, before.player);
  const sections = await drawer.locator('section').evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')));
  check(label + ': canonical section order', sections, ['照片信息', '整理', '文件与资源']);
  const info = await rows(drawer.locator('[data-xdrive-media-details-info]'));
  check(label + ': rich canonical capture and technical facts', info, expected.info);
  const files = await rows(drawer.locator('[data-xdrive-media-details-file-resources]'));
  check(label + ': selected Node facts and independent resource facts', files, [...expected.files, ...expected.resources]);
  check(label + ': existing organization values are retained in editable Viewer fields', await Promise.all(['标签', '人物', '描述'].map((name) => drawer.getByRole('textbox', { name, exact: true }).inputValue())), [item.tags.join(', '), item.people.join(', '), item.description]);
  const fileName = drawer.locator('[data-xdrive-media-details-file-resources]').getByText(item.node.name, { exact: true }).first();
  const fileGeometry = await wheelTo(page, fileName);
  check(label + ': native wheel reaches selected filename without clipping', fileGeometry.hittable && fileGeometry.clippedHeight >= Math.min(fileGeometry.rect.height, 24) - 1 && fileGeometry.clippedWidth >= fileGeometry.rect.width - 1);
  const finalValue = expected.resources.length ? expected.resources.at(-1)[1] : expected.files.at(-1)[1];
  const lastRow = drawer.locator('[data-xdrive-media-details-file-resources]').getByText(finalValue, { exact: true });
  const lastGeometry = await wheelTo(page, lastRow);
  check(label + ': native wheel reaches final file/resource row without horizontal clipping', lastGeometry.hittable && lastGeometry.clippedHeight >= Math.min(lastGeometry.rect.height, 24) - 1 && lastGeometry.clippedWidth >= lastGeometry.rect.width - 1);
  const close = drawer.getByRole('button', { name: '关闭属性', exact: true });
  const closeGeometry = await geometry(close);
  check(label + ': Properties close remains visible and hittable after content scroll', closeGeometry.hittable && closeGeometry.opacity > 0.9 && closeGeometry.clippedHeight >= closeGeometry.rect.height - 1);
  check(label + ': compact Properties close has an actual44px hit target', closeGeometry.rect.width >= 44 && closeGeometry.rect.height >= 44);
  result.samples[label] = { before, opened, info, files, fileGeometry, lastGeometry, closeGeometry, requestsBefore };
  result.samples[label].viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, coarsePointer: matchMedia('(pointer:coarse)').matches }));
  await page.screenshot({ path: path.join(outputDir, label + '-properties-bottom.png') });
  // Reading Properties can outlast the underlying immersive Viewer's chrome
  // auto-hide timer. Close must return to a visible, usable focus target then.
  // Other cases keep the ordinary fast-close order as controls.
  if (kind === 'still' && viewport.width === 390) await page.waitForTimeout(2600);
  stage = label + ':close-button';
  await close.click(); await drawer.waitFor({ state: 'hidden' }); await settle(page);
  const closed = await viewerState(page), triggerAfterClose = await geometry(trigger);
  await page.screenshot({ path: path.join(outputDir, label + '-close-focus.png') });
  check(label + ': Close dismisses only Properties and retains the selected Viewer', closed.sameViewer && closed.samePreview && closed.route === before.route);
  check(label + ': Close restores native focus to the invoking Properties control', triggerAfterClose.focused);
  check(label + ': restored Properties trigger is visibly reachable', triggerAfterClose.hittable && triggerAfterClose.pointer && triggerAfterClose.opacity > 0.9);
  // A focus assertion above does not depend on this explicit subsequent user key.
  await viewer.focus(); await page.keyboard.press('Shift'); await trigger.click(); await drawer.waitFor(); await settle(page);
  stage = label + ':escape';
  await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' }); await settle(page);
  const escaped = await viewerState(page), triggerAfterEscape = await geometry(trigger);
  check(label + ': Escape dismisses only Properties, preserving mounted media and playback', escaped.sameViewer && escaped.samePreview && escaped.sameImages && escaped.sameVideos && escaped.route === before.route && JSON.stringify(escaped.player) === JSON.stringify(before.player));
  check(label + ': Escape restores native focus to Properties control', triggerAfterEscape.focused);
  check(label + ': full Properties interaction adds no original or motion work', mediaRequests(label).length, requestsBefore);
  Object.assign(result.samples[label], { closed, escaped, triggerAfterClose, triggerAfterEscape, mediaRequests: mediaRequests(label) });
  await page.screenshot({ path: path.join(outputDir, label + '-viewer-return.png') });
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  // A valid tiny local MP4 exercises native media decode. Its decoded size is
  // independent from the authoritative API metadata this presentation checks.
  execFileSync(process.env.XDRIVE_FFMPEG_EXECUTABLE || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=steelblue:s=160x90:r=15:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath]);
  videoBytes = fs.readFileSync(videoPath);
  assert(fs.existsSync(path.join(distRoot, 'index.html')), 'Use the parent-provided integrated Web build; do not rebuild here');
  result.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  const sourceFiles = ['web/src/App.tsx', 'web/src/WebFileViewerApps.tsx', 'web/src/api.ts', 'web/src/mediaGalleryAdapter.ts', 'ui/shared/src/models.ts', 'ui/shared/src/mui/MediaGalleryDetails.tsx', 'ui/shared/src/mui/MediaGalleryInspector.tsx', 'ui/shared/src/mui/MediaViewerContent.tsx', 'ui/shared/src/mui/FilePreviewSurface.tsx', 'ui/shared/src/mui/LivePhotoSurface.tsx'];
  result.sourceHashes = Object.fromEntries(sourceFiles.map((name) => [name, hash(path.join(sourceRoot, name))]));
  result.fixtureHashes = {};
  for (const file of [__filename, require.resolve('./media-properties-fixtures.cjs'), videoPath]) { result.fixtureHashes[path.basename(file)] = hash(file); if (path.resolve(file) !== path.join(outputDir, path.basename(file))) fs.copyFileSync(file, path.join(outputDir, path.basename(file))); }
  result.builtWebSHA256 = Object.fromEntries(['index.html', ...fs.readdirSync(path.join(distRoot, 'assets')).filter((name) => /\.(js|css)$/.test(name)).sort().map((name) => 'assets/' + name)].map((name) => [name, hash(path.join(distRoot, name))]));
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
  const server = http.createServer((request, response) => { const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), file = path.resolve(distRoot, '.' + (pathname === '/' ? '/index.html' : pathname)); response.setHeader('Cache-Control', 'no-store'); if (!file.startsWith(distRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; } response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); response.end(fs.readFileSync(file)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const kind of Object.keys(golden.items).filter((kind) => !options.case || options.case === 'all' || options.case === kind)) for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, ...(kind === 'still' ? [{ width: 700, height: 780, finePointer: true }, { width: 899, height: 780, finePointer: true }] : [])]) {
      const label = `${kind}-${viewport.width}x${viewport.height}`;
      let browser, page;
      try {
        stage = label + ':startup';
        browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args: process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined });
        result.browserVersion = browser.version();
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: !viewport.finePointer, isMobile: !viewport.finePointer, deviceScaleFactor: 1, timezoneId: 'UTC', serviceWorkers: 'block' });
        await context.addInitScript((origin) => { if (location.origin !== origin) return; localStorage.setItem('xdrive.access_token', 'local-browser-qa-token'); localStorage.setItem('xdrive.access_expires_at', String(Date.now() + 86400000)); localStorage.setItem('xdrive.username', 'qa-user'); localStorage.setItem('xdrive.gallery.time-zone.v1', 'UTC'); }, origin);
        await context.route('**/*', async (route) => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
          const trace = { case: label, stage, method: request.method(), path: url.pathname + url.search, range: request.headers().range };
          result.requests.push(trace);
          try { assert.equal(url.origin, origin, 'Unexpected external request'); await route.fulfill({ status: 200, ...responseFor(request) }); }
          catch (error) { result.unknownRequests.push({ ...trace, error: error.message }); await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: error.message }) }).catch(() => undefined); }
        });
        page = await context.newPage(); page.setDefaultTimeout(12000);
        page.on('pageerror', (error) => result.errors.push({ case: label, stage, type: 'pageerror', message: error.message }));
        page.on('console', (message) => { if (message.type() === 'error') result.errors.push({ case: label, stage, type: 'console', message: message.text() }); });
        await page.goto(origin + '/#/app/media-viewer?node=' + golden.items[kind].node.id, { waitUntil: 'domcontentloaded' });
        await acceptance(page, kind, viewport);
      } catch (error) {
        result.errors.push({ case: label, stage, type: 'harness-or-product', message: error.message, stack: error.stack });
        if (page && !page.isClosed()) { await page.screenshot({ path: path.join(outputDir, label + '-failure.png') }).catch(() => undefined); result.samples[label + '-failure'] = { text: await page.locator('body').innerText().catch(() => ''), aria: await page.locator('body').ariaSnapshot().catch(() => '') }; }
      } finally { if (browser) await browser.close(); }
    }
    check('All API activity is bounded and recognized', result.unknownRequests.length, 0);
    check('No application or harness errors', result.errors.length, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  result.sourceHashChangesAtCompletion = Object.keys(result.sourceHashes).filter((name) => hash(path.join(sourceRoot, name)) !== result.sourceHashes[name]);
  result.builtHashChangesAtCompletion = Object.keys(result.builtWebSHA256).filter((name) => hash(path.join(distRoot, name)) !== result.builtWebSHA256[name]);
  result.finishedAt = new Date().toISOString(); result.passed = result.checks.every((check) => check.passed) && result.errors.length === 0 && result.unknownRequests.length === 0;
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ passed: result.passed, checks: result.checks.length, failed: result.checks.filter((check) => !check.passed).length, errors: result.errors.length, unknownRequests: result.unknownRequests.length, outputDir }, null, 2) + '\n');
  process.exitCode = result.passed ? 0 : 1;
}
main().catch((error) => { fs.mkdirSync(outputDir, { recursive: true }); result.errors.push({ stage, message: error.message, stack: error.stack }); fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(result, null, 2) + '\n'); process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
