#!/usr/bin/env node
// Optional renderer acceptance of the built, real Web App. Build web/dist first.
// No application components are copied or bundled by this script. API fixtures
// are deliberately bounded, and every unrecognised request fails the run.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const options = {};
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir|scenario)=(.+)$/.exec(argument);
  if (!match) throw new Error(`Unknown argument: ${argument}`);
  options[match[1]] = match[2];
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for JSON and screenshots.');
if (options.scenario && !['smoke', 'all', 'inherited-columns'].includes(options.scenario)) throw new Error('Use --scenario=smoke, all, or inherited-columns.');
const sourceRoot = path.resolve(options['source-root'] || path.resolve(__dirname, '../..'));
const outputDir = path.resolve(options['output-dir']);
const distRoot = path.join(sourceRoot, 'web/dist');
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright');
const stamp = '2026-10-08T12:00:00Z';
const makeNode = (id, name, parentID, type = 'file') => ({
  id, name, ...(parentID ? { parent_id: parentID } : {}), type,
  size: type === 'dir' ? 0 : 4096, revision: 1, created_at: stamp, updated_at: stamp,
});
const rootNode = makeNode(1, '我的文件', undefined, 'dir');
const childFolder = makeNode(2, '验收目录', 1, 'dir');
const rootChildren = [childFolder, ...Array.from({ length: 96 }, (_, index) =>
  makeNode(100 + index, `document-${String(index + 1).padStart(3, '0')}.txt`, 1))];
const folderChildren = Array.from({ length: 64 }, (_, index) =>
  makeNode(300 + index, `nested-${String(index + 1).padStart(3, '0')}.txt`, 2));
const mediaItems = Array.from({ length: 240 }, (_, index) => ({
  node: makeNode(1000 + index, `photo-${String(index + 1).padStart(3, '0')}.png`, 1),
  metadata: { media_kind: 'image', mime_type: 'image/png', width: 80, height: 80, captured_at: stamp,
    index_state: 'ready', has_thumbnail: true, thumbnail_mime_type: 'image/png', thumbnail_width: 80, thumbnail_height: 80 },
  favorite: false, tags: [], people: [],
}));
const mediaByID = new Map(mediaItems.map((item) => [item.node.id, item]));
const allNodes = new Map([rootNode, ...rootChildren, ...folderChildren, ...mediaItems.map((item) => item.node)].map((node) => [node.id, node]));
// A small, valid 80x80 PNG exercises the real thumbnail/preview decode path.
const imagePNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAIAAAABc2X6AAAAc0lEQVR4nO3PgQ0AEADAMPz/M1+Q1HrBNvf4y3odcFvDuoZ1Desa1jWsa1jXsK5hXcO6hnUN6xrWNaxrWNewrmFdw7qGdQ3rGtY1rGtY17CuYV3DuoZ1Desa1jWsa1jXsK5hXcO6hnUN6xrWNaxrWNew7gDdvwGf2GYUOgAAAABJRU5ErkJggg==', 'base64');

function queryOnly(url, allowed) {
  for (const key of url.searchParams.keys()) assert(allowed.includes(key), `Unexpected query ${key} in ${url.pathname}`);
}
function integerQuery(url, name, fallback, max) {
  const raw = url.searchParams.get(name);
  const value = raw === null ? fallback : Number(raw);
  assert(Number.isInteger(value) && value >= 0 && value <= max, `Invalid ${name} in ${url}`);
  return value;
}
function jsonBody(request) {
  return JSON.parse(request.postData() || '{}');
}
function recentItem(node) {
  const crumbs = node.id === 1 ? [rootNode] : node.parent_id === 2 ? [rootNode, childFolder, node] : [rootNode, node];
  return { node, path: crumbs.map((crumb) => crumb.name).join('/'), crumbs, accessed_at: stamp };
}
function fixtureFor(request, role) {
  const url = new URL(request.url());
  const key = `${request.method()} ${url.pathname}`;
  const plain = (data) => { queryOnly(url, []); return data; };
  switch (key) {
    case 'GET /api/v1/version': return plain({ version: 'browser-qa-fixture', channel: 'master', commit: 'fixture', build_time: stamp });
    case 'GET /api/v1/me': return plain({ id: role === 'admin' ? 10 : 11, username: `qa-${role}`, role, must_change_password: false });
    case 'GET /api/v1/me/quota': return plain({ quota_bytes: 10737418240, physical_used_bytes: 1048576, reserved_bytes: 0, available_bytes: 10736369664, logical_file_bytes: 1048576, trash_bytes: 0, history_bytes: 0, over_quota: false });
    case 'GET /api/v1/nodes/root': return plain(rootNode);
    case 'GET /api/v1/background-tasks/active-summary': return plain({ active_total: 0, file_operation: 0, sync_run: 0, archive_prepare: 0, scheduler: 0 });
    case 'GET /api/v1/file-operations':
      queryOnly(url, ['limit']); integerQuery(url, 'limit', 100, 200); return [];
    case 'GET /api/v1/changes':
      queryOnly(url, ['after', 'limit']); integerQuery(url, 'after', 0, 100); integerQuery(url, 'limit', 200, 1000);
      return { changes: [], next_cursor: 1, latest_cursor: 1, has_more: false, reset_required: false };
    case 'GET /api/v1/file-quick-access': return plain([]);
    case 'GET /api/v1/file-tags': return plain([]);
    case 'GET /api/v1/file-saved-searches': return plain([]);
    case 'GET /api/v1/file-favorites': return plain([]);
    case 'GET /api/v1/sources': return plain([]);
    case 'GET /api/v1/file-recent':
      queryOnly(url, ['limit']); integerQuery(url, 'limit', 16, 50); return [];
    case 'POST /api/v1/nodes/tags/query': {
      queryOnly(url, []);
      const body = jsonBody(request);
      assert.deepEqual(Object.keys(body), ['node_ids']);
      assert(Array.isArray(body.node_ids) && body.node_ids.every((id) => allNodes.has(id)), 'Unknown tag query node');
      return body.node_ids.map((nodeID) => ({ node_id: nodeID, tags: [] }));
    }
    case 'GET /api/v1/background-tasks/page':
    case 'GET /api/v1/admin/background-tasks/page':
      assert(!key.includes('/admin/') || role === 'admin', 'Ordinary user reached administrator API');
      queryOnly(url, ['limit']); integerQuery(url, 'limit', 50, 200);
      return { current_items: [], history_items: [] };
    case 'GET /api/v1/admin/update':
      assert.equal(role, 'admin');
      return plain({ supported: true, state: 'idle', source: 'github', channel: 'master', backup_file_data: false });
    case 'GET /api/v1/media/items': {
      queryOnly(url, ['range', 'limit', 'offset']);
      const offset = integerQuery(url, 'offset', 0, mediaItems.length);
      const limit = integerQuery(url, 'limit', 200, 500);
      const items = mediaItems.slice(offset, offset + limit);
      if (!url.searchParams.has('range')) return items;
      assert.equal(url.searchParams.get('range'), 'true');
      const group = (key) => [{ key, item_count: mediaItems.length, start_index: 0 }];
      return { items, total_count: mediaItems.length, offset, limit,
        timeline_group_sets: { year: group('2026'), month: group('2026-10'), day: group('2026-10-08') } };
    }
    case 'GET /api/v1/media/facets': return plain({ cameras: [], formats: [{ value: 'png', label: 'PNG', item_count: mediaItems.length }] });
    case 'GET /api/v1/media/albums': return plain([]);
    case 'GET /api/v1/media/pets': return plain([]);
    case 'GET /api/v1/media/places':
      queryOnly(url, ['limit']); integerQuery(url, 'limit', 24, 1000); return [];
    case 'GET /api/v1/media/people/suggestions':
      queryOnly(url, ['include_reviewed', 'limit']); assert.equal(url.searchParams.get('include_reviewed'), 'true'); integerQuery(url, 'limit', 100, 100); return [];
    case 'GET /api/v1/media/people/identities':
      queryOnly(url, ['include_hidden', 'offset', 'limit']); assert.equal(url.searchParams.get('include_hidden'), 'true');
      integerQuery(url, 'offset', 0, 0); integerQuery(url, 'limit', 100, 100); return [];
  }
  let match = /^GET \/api\/v1\/nodes\/(1|2)\/children$/.exec(key);
  if (match) {
    queryOnly(url, ['limit', 'offset', 'sort', 'order', 'include_count', 'name', 'name_ci']);
    const nodes = match[1] === '1' ? rootChildren : folderChildren;
    const sort = url.searchParams.get('sort') || 'name';
    const order = url.searchParams.get('order') || 'asc';
    assert.equal(sort, 'name'); assert.equal(order, 'asc');
    const name = url.searchParams.get('name');
    const nameCI = url.searchParams.get('name_ci');
    const filtered = nodes.filter((node) => (!name || node.name === name) && (!nameCI || node.name.toLowerCase() === nameCI.toLowerCase()));
    if (!url.search) return filtered;
    const limit = integerQuery(url, 'limit', 200, 500);
    const offset = integerQuery(url, 'offset', 0, 500);
    return url.searchParams.has('offset')
      ? { items: filtered.slice(offset, offset + limit), total_count: filtered.length, total_count_included: true, offset, limit, sort, order }
      : { items: filtered.slice(0, limit), has_more: false, sort, order };
  }
  match = /^GET \/api\/v1\/nodes\/(\d+)$/.exec(key);
  if (match && allNodes.has(Number(match[1]))) return plain(allNodes.get(Number(match[1])));
  match = /^POST \/api\/v1\/file-recent\/(\d+)$/.exec(key);
  if (match && allNodes.has(Number(match[1]))) { queryOnly(url, []); assert.deepEqual(jsonBody(request), {}); return recentItem(allNodes.get(Number(match[1]))); }
  match = /^GET \/api\/v1\/media\/items\/(\d+)$/.exec(key);
  if (match && mediaByID.has(Number(match[1]))) return plain(mediaByID.get(Number(match[1])));
  match = /^GET \/api\/v1\/media\/items\/(\d+)\/thumbnail$/.exec(key);
  if (match && mediaByID.has(Number(match[1]))) { queryOnly(url, ['v']); assert.equal(url.searchParams.get('v'), '3'); return imagePNG; }
  match = /^POST \/api\/v1\/files\/(\d+)\/preview-ticket$/.exec(key);
  if (match && mediaByID.has(Number(match[1]))) return plain({ url: `/api/v1/file-preview/qa-${match[1]}`, expires_at: '2099-01-01T00:00:00Z', kind: 'image', mime_type: 'image/png' });
  match = /^GET \/api\/v1\/file-preview\/qa-(\d+)$/.exec(key);
  if (match && mediaByID.has(Number(match[1]))) return plain(imagePNG);
  throw new Error(`Unrecognised API fixture: ${key}${url.search}`);
}

const result = {
  sourceRoot, distRoot, startedAt: new Date().toISOString(), scenario: options.scenario || 'all',
  fixture: { rootItems: rootChildren.length, nestedItems: folderChildren.length, galleryItems: mediaItems.length, network: 'local bounded fixtures only' },
  checks: [], samples: {}, requests: {}, unknownRequests: [], consoleErrors: [], pageErrors: [], failures: [],
};
let activeStage = 'startup';
let page;
function check(name, passed, evidence) {
  result.checks.push({ name, passed: Boolean(passed), ...(evidence === undefined ? {} : { evidence }) });
  assert(passed, name);
}
async function settle() {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function geometry(name) {
  await settle();
  const sample = await page.evaluate(() => {
    const bounds = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom,
        clientWidth: element.clientWidth, clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop,
        overflowX: getComputedStyle(element).overflowX, overflowY: getComputedStyle(element).overflowY };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, hash: location.hash,
      document: bounds(document.documentElement), body: bounds(document.body), main: bounds(document.querySelector('main')),
      files: bounds(document.querySelector('[data-xdrive-file-explorer]')),
      filesScroll: bounds(document.querySelector('[data-xdrive-file-explorer-scroll-host]')),
      navigation: bounds(document.querySelector('nav[aria-label="网页端功能区导航"]')),
      coarse: matchMedia('(pointer: coarse)').matches, compact: !!document.querySelector('.MuiBottomNavigation-root'),
    };
  });
  result.samples[name] = sample;
  check(`${name}: requested CSS viewport`, sample.viewport.width === page.viewportSize().width && sample.viewport.height === page.viewportSize().height, sample.viewport);
  check(`${name}: no document overflow`, sample.document.scrollWidth <= sample.viewport.width + 1 && sample.document.scrollHeight <= sample.viewport.height + 1, sample.document);
  check(`${name}: workspace within viewport`, sample.main && sample.main.width > 0 && sample.main.height > 0 && sample.main.right <= sample.viewport.width + 1 && sample.main.bottom <= sample.viewport.height + 1, sample.main);
  check(`${name}: correct navigation breakpoint`, sample.compact === (sample.viewport.width < 900));
  if (sample.compact) check(`${name}: bottom navigation outside content`, sample.navigation.y >= sample.main.bottom - 1 && sample.navigation.bottom <= sample.viewport.height + 1);
  if (sample.files) check(`${name}: Files fills available main`, Math.abs(sample.files.height - sample.main.height) <= 1 && Math.abs(sample.files.y - sample.main.y) <= 1 && sample.files.right <= sample.main.right + 1, sample.files);
  if (sample.filesScroll) check(`${name}: Files scroll viewport remains visible`, sample.filesScroll.height > 0 && sample.filesScroll.bottom <= sample.main.bottom + 1, sample.filesScroll);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
  return sample;
}
async function loadFiles(context, origin, role) {
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => result.pageErrors.push({ role, stage: activeStage, message: error.message }));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push({ role, stage: activeStage, message: message.text() }); });
  await page.goto(`${origin}/#/app/files`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'document-001.txt' }).waitFor();
  await settle();
}
async function moreDismissals(role) {
  const more = page.getByRole('button', { name: '更多', exact: true });
  const dialog = page.getByRole('dialog', { name: '更多', exact: true });
  const initialURL = page.url();
  const initialHistory = await page.evaluate(() => history.length);
  for (const method of ['button', 'escape', 'backdrop']) {
    activeStage = `${role}-more-${method}`;
    await more.click();
    await dialog.waitFor();
    check(`${activeStage}: focus enters drawer`, await dialog.evaluate((element) => element.contains(document.activeElement)));
    const labels = await dialog.getByRole('button').allTextContents();
    result.samples[`${role}-more-labels`] = labels;
    for (const label of ['全局任务', '用户管理', '审计日志', '全局存储']) {
      check(`${activeStage}: ${label} role gate`, (await dialog.getByRole('button', { name: label, exact: true }).count() > 0) === (role === 'admin'));
    }
    check(`${activeStage}: targets at least 44px`, await dialog.getByRole('button').evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().height >= 44)));
    if (method === 'button') await page.getByRole('button', { name: '关闭更多导航' }).click();
    else if (method === 'escape') await page.keyboard.press('Escape');
    else await page.locator('.MuiDrawer-root .MuiBackdrop-root').click({ position: { x: 8, y: 8 } });
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-haspopup') === 'dialog' && document.activeElement?.textContent === '更多');
    check(`${activeStage}: focus returns to More`, await more.evaluate((element) => document.activeElement === element));
    check(`${activeStage}: no navigation`, page.url() === initialURL && await page.evaluate(() => history.length) === initialHistory);
  }
}
async function moreLifecycle(role) {
  activeStage = `${role}-more-lifecycle`;
  const more = page.getByRole('button', { name: '更多', exact: true });
  const dialog = page.getByRole('dialog', { name: '更多', exact: true });
  const initialURL = page.url();
  await more.click();
  await dialog.waitFor();
  await page.screenshot({ path: path.join(outputDir, `${role}-more.png`) });
  await page.setViewportSize({ width: 900, height: 700 });
  await dialog.waitFor({ state: 'hidden' });
  for (const label of ['全局任务', '用户管理', '审计日志', '全局存储']) {
    check(`${activeStage}: wide ${label} role gate`, (await page.getByRole('button', { name: label, exact: true }).count() > 0) === (role === 'admin'));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await more.waitFor();
  check(`${activeStage}: breakpoint does not reopen More`, !await dialog.isVisible() && page.url() === initialURL);
  await more.click();
  const historyLength = await page.evaluate(() => history.length);
  const label = role === 'admin' ? '全局任务' : '本地存储';
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForURL(role === 'admin' ? /\/tasks\?scope=global$/ : /\/local-storage$/);
  check(`${activeStage}: destination navigates exactly once`, await page.evaluate(() => history.length) === historyLength + 1);
}

async function galleryAcceptance(role) {
  activeStage = `${role}-gallery`;
  await page.getByRole('button', { name: '图库', exact: true }).click();
  await page.waitForURL(/\/gallery(?:\?section=library)?$/);
  await page.locator('[data-xdrive-media-tile]').first().waitFor();
  const initial = await geometry(`${role}-gallery-390`);
  check(`${role}-gallery: main is scrollable`, initial.main.overflowY === 'auto' && initial.main.scrollHeight > initial.main.clientHeight + 500);
  check(`${role}-gallery: same workspace main after navigation`, await page.evaluate(() => window.__mobileQaIdentity.main === document.querySelector('main')));
  check(`${role}-gallery: tile scroll ancestor is main`, await page.locator('[data-xdrive-media-tile]').first().evaluate((tile) => {
    for (let parent = tile.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent === document.querySelector('main');
    }
    return false;
  }));
  await page.evaluate(() => { window.__galleryQa = { main: document.querySelector('main'), header: document.querySelector('[data-xdrive-gallery-header]') }; });
  for (const viewport of [{ width: 900, height: 700 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await geometry(`${role}-gallery-${viewport.width}x${viewport.height}`);
    check(`${role}-gallery-${viewport.width}: mounted main and Gallery`, await page.evaluate(() => window.__galleryQa.main === document.querySelector('main') && window.__galleryQa.header === document.querySelector('[data-xdrive-gallery-header]')));
  }
  const main = page.locator('main');
  await main.evaluate((element) => { element.scrollTop = 620; });
  await page.waitForFunction(() => document.querySelector('main').scrollTop >= 600);
  await settle();
  const tileIndex = await page.locator('[data-xdrive-media-tile]').evaluateAll((tiles) => tiles.findIndex((tile) => {
    const rect = tile.getBoundingClientRect();
    const mainRect = document.querySelector('main').getBoundingClientRect();
    return rect.top >= mainRect.top && rect.bottom <= mainRect.bottom && rect.left >= 0 && rect.right <= innerWidth;
  }));
  check(`${role}-gallery: visible tile after scrolling`, tileIndex >= 0);
  const tile = page.locator('[data-xdrive-media-tile]').nth(tileIndex);
  await tile.evaluate((element) => {
    window.__galleryQa.tile = element;
    window.__galleryQa.scrollTop = document.querySelector('main').scrollTop;
    window.__galleryQa.url = location.href;
    window.__galleryQa.background = document.querySelector('[data-xdrive-workspace-background]');
  });
  activeStage = `${role}-viewer-open`;
  await tile.tap();
  await page.waitForURL(/\/media-viewer\?node=/);
  const returnButton = page.getByRole('button', { name: '返回', exact: true });
  await returnButton.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-xdrive-file-preview-kind] img')].some((image) => image.complete && image.naturalWidth === 80));
  const viewerURL = page.url();
  const galleryURL = await page.evaluate(() => window.__galleryQa.url);
  const backgroundRetained = () => page.evaluate(() => {
    const saved = window.__galleryQa;
    return saved.main === document.querySelector('main') && saved.header === document.querySelector('[data-xdrive-gallery-header]') && saved.tile.isConnected
      && saved.background === document.querySelector('[data-xdrive-workspace-background]') && Math.abs(saved.main.scrollTop - saved.scrollTop) <= 1;
  });
  check(`${role}-viewer: background DOM and scroll retained`, await backgroundRetained());
  check(`${role}-viewer: background inert`, await page.locator('[data-xdrive-workspace-background]').evaluate((element) => element.inert && element.getAttribute('aria-hidden') === 'true'));
  await page.screenshot({ path: path.join(outputDir, `${role}-viewer.png`) });
  await returnButton.click();
  await page.waitForURL(galleryURL);
  check(`${role}-viewer: return restores Gallery DOM and scroll`, await backgroundRetained());
  check(`${role}-viewer: return enables background`, await page.locator('[data-xdrive-workspace-background]').evaluate((element) => !element.inert && !element.hasAttribute('aria-hidden')));

  // Browser Forward is the route into Viewer while a background portal is open.
  // No update/account mutation fixture exists: an accidental action fails closed.
  for (const portal of ['more', 'account', 'settings', 'transfers', ...(role === 'admin' ? ['update-confirmation'] : [])]) {
    activeStage = `${role}-viewer-forward-${portal}`;
    if (portal === 'more') await page.getByRole('button', { name: '更多', exact: true }).click();
    else if (portal === 'transfers') await page.getByRole('button', { name: /^上传与下载/ }).click();
    else {
      await page.getByRole('button', { name: '账户菜单', exact: true }).click();
      if (portal === 'settings' || portal === 'update-confirmation') {
        await page.getByRole('menuitem', { name: '设置', exact: true }).click();
        await page.getByRole('dialog', { name: /^设置/ }).waitFor();
        if (portal === 'update-confirmation') {
          await page.getByRole('button', { name: '更新服务端', exact: true }).click();
          await page.getByRole('dialog', { name: /^确认更新服务端？/ }).waitFor();
          check(`${activeStage}: update confirmation opened`, await page.getByRole('dialog', { name: /^确认更新服务端？/ }).getByText('确认更新服务端？', { exact: true }).isVisible());
        }
      }
    }
    await page.getByRole(portal === 'account' ? 'menu' : 'dialog').waitFor();
    await page.goForward();
    await page.waitForURL(viewerURL);
    await returnButton.waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    check(`${activeStage}: portal closed in Viewer`, await backgroundRetained());
    await page.goBack();
    await page.waitForURL(galleryURL);
    check(`${activeStage}: return keeps background and closed portals`, await backgroundRetained() && await page.getByRole('dialog').count() === 0 && await page.getByRole('menu').count() === 0);
  }
  await page.screenshot({ path: path.join(outputDir, `${role}-gallery-return.png`) });
}
async function inheritedColumnsAcceptance() {
  activeStage = 'user-inherited-columns';
  await geometry(activeStage);
  check(`${activeStage}: inherited columns projects to touch list`, await page.getByRole('table', { name: '文件列表' }).count() === 1 && await page.locator('[data-xdrive-file-explorer-column-view]').count() === 0);
  const folder = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '验收目录' });
  const firstFile = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'document-001.txt' });
  const folderMore = page.getByRole('button', { name: '更多操作：验收目录', exact: true });
  check(`${activeStage}: item has 44px More target`, await folderMore.evaluate((element) => element.getBoundingClientRect().height >= 44));
  await folderMore.tap();
  await page.locator('[data-xdrive-file-explorer-touch-action-sheet]').waitFor();
  check(`${activeStage}: item opens action sheet`, await page.getByRole('button', { name: '关闭文件操作', exact: true }).isVisible());
  await page.getByRole('button', { name: '关闭文件操作', exact: true }).tap();
  await page.locator('[data-xdrive-file-explorer-touch-action-sheet]').waitFor({ state: 'hidden' });
  const rootURL = page.url();
  await page.getByRole('button', { name: '选择', exact: true }).tap();
  await folder.tap();
  await firstFile.tap();
  check(`${activeStage}: taps select two without opening`, page.url() === rootURL && await page.locator('[data-xdrive-file-explorer-item][aria-selected="true"]').count() === 2 && await page.getByRole('button', { name: '复制所选项目', exact: true }).isEnabled());
  await page.getByRole('button', { name: '完成', exact: true }).tap();
  check(`${activeStage}: Done clears selection`, await page.locator('[data-xdrive-file-explorer-item][aria-selected="true"]').count() === 0);
  await folder.tap();
  await page.waitForURL(/\/files\?dir=2$/);
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'nested-001.txt' }).waitFor();
  check(`${activeStage}: touch opens folder`, true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('[data-xdrive-file-explorer-column-view]').waitFor();
  await geometry('user-inherited-columns-wide');
  check(`${activeStage}: desktop preference retained`, await page.evaluate(() => localStorage.getItem('xdrive.files.view_mode') === 'columns'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('table', { name: '文件列表' }).waitFor();
  await geometry('user-inherited-columns-return');
  check(`${activeStage}: return restores touch list and directory`, /\/files\?dir=2$/.test(page.url()) && await page.locator('[data-xdrive-file-explorer-column-view]').count() === 0);
}
async function filesAcceptance(role) {
  activeStage = `${role}-files-390`;
  const initial = await geometry(activeStage);
  check(`${activeStage}: coarse pointer fixture active`, initial.coarse);
  check(`${activeStage}: Files owns internal scroll`, initial.filesScroll && ['auto', 'scroll'].includes(initial.filesScroll.overflowY) && initial.filesScroll.scrollHeight > initial.filesScroll.clientHeight + 200 && initial.main.scrollHeight <= initial.main.clientHeight + 1);
  await page.locator('[data-xdrive-file-explorer-scroll-host]').evaluate((element) => { element.scrollTop = 420; });
  await page.waitForFunction(() => document.querySelector('[data-xdrive-file-explorer-scroll-host]')?.scrollTop >= 400);
  check(`${activeStage}: internal scroll moves without document`, await page.evaluate(() => document.documentElement.scrollTop === 0 && document.querySelector('main').scrollTop === 0));
  await page.locator('[data-xdrive-file-explorer-scroll-host]').evaluate((element) => { element.scrollTop = 0; });
  await moreDismissals(role);
  if (options.scenario === 'smoke') return;
  activeStage = `${role}-open-directory`;
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '验收目录' }).tap();
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'nested-001.txt' }).waitFor();
  await page.waitForURL(/\/files\?dir=2$/);
  await page.evaluate(() => { window.__mobileQaIdentity = { main: document.querySelector('main'), files: document.querySelector('[data-xdrive-file-explorer]'), scroll: document.querySelector('[data-xdrive-file-explorer-scroll-host]') }; });
  const directoryURL = page.url();
  for (const viewport of [{ width: 360, height: 780 }, { width: 430, height: 932 }, { width: 899, height: 700 }, { width: 900, height: 700 }, { width: 1280, height: 800 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    activeStage = `${role}-files-${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await geometry(activeStage);
    check(`${activeStage}: mounted content identity`, await page.evaluate(() => window.__mobileQaIdentity.main === document.querySelector('main') && window.__mobileQaIdentity.files === document.querySelector('[data-xdrive-file-explorer]') && window.__mobileQaIdentity.scroll === document.querySelector('[data-xdrive-file-explorer-scroll-host]')));
    check(`${activeStage}: directory retained`, page.url() === directoryURL && await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'nested-001.txt' }).count() > 0);
  }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  assert(fs.existsSync(path.join(distRoot, 'index.html')), `Build the real Web App first: ${distRoot}/index.html missing`);
  const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(distRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${distRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', mimeTypes[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const args = process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined;
    if (args) assert(Array.isArray(args) && args.every((arg) => typeof arg === 'string'), 'XDRIVE_BROWSER_ARGS must be a JSON string array');
    const cases = options.scenario === 'smoke' ? [{ role: 'user' }]
      : options.scenario === 'inherited-columns' ? [{ role: 'user', viewMode: 'columns' }]
        : [{ role: 'user' }, { role: 'admin' }, { role: 'user', viewMode: 'columns' }];
    for (const { role, viewMode } of cases) {
      const scenarioLabel = viewMode ? `${role}-inherited-${viewMode}` : role;
      activeStage = `${scenarioLabel}-startup`;
      // A new process also supports single-process portable Chromium, which
      // cannot reliably create a second context after its first context closes.
      browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args,
        env: process.env.XDRIVE_BROWSER_FONTCONFIG ? { ...process.env, FONTCONFIG_PATH: process.env.XDRIVE_BROWSER_FONTCONFIG } : process.env });
      result.browserVersion = browser.version();
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
      await context.addInitScript(({ role, origin, viewMode }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('xdrive.access_token', 'local-browser-qa-token');
        localStorage.setItem('xdrive.access_expires_at', String(Date.now() + 86400000));
        localStorage.setItem('xdrive.username', `qa-${role}`);
        if (viewMode) localStorage.setItem('xdrive.files.view_mode', viewMode);
      }, { role, origin, viewMode });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
        const key = `${scenarioLabel} ${request.method()} ${url.pathname}${url.search}`;
        result.requests[key] = (result.requests[key] || 0) + 1;
        try {
          assert.equal(url.origin, origin, 'App attempted an external network request');
          const body = fixtureFor(request, role);
          await route.fulfill({ status: 200, contentType: Buffer.isBuffer(body) ? 'image/png' : 'application/json', body: Buffer.isBuffer(body) ? body : JSON.stringify(body) });
        } catch (error) {
          result.unknownRequests.push({ stage: activeStage, request: key, message: error.message });
          await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: error.message }) });
        }
      });
      await loadFiles(context, origin, role);
      if (viewMode) await inheritedColumnsAcceptance();
      else {
        await filesAcceptance(role);
        if (options.scenario !== 'smoke') {
          await moreLifecycle(role);
          await galleryAcceptance(role);
        }
      }
      await context.close();
      await browser.close();
      browser = undefined;
    }
    check('no unknown API or external requests', result.unknownRequests.length === 0, result.unknownRequests);
    check('no application page errors', result.pageErrors.length === 0, result.pageErrors);
    check('no browser console errors', result.consoleErrors.length === 0, result.consoleErrors);
  } catch (error) {
    result.failures.push({ stage: activeStage, message: error.message, stack: error.stack });
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(outputDir, 'failure.png') }).catch(() => {});
      result.failureDOM = await page.locator('body').innerText().catch(() => 'unavailable');
      result.failureAccessibility = await page.locator('body').ariaSnapshot().catch(() => 'unavailable');
    }
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    result.finishedAt = new Date().toISOString();
    result.passed = result.failures.length === 0 && result.unknownRequests.length === 0 && result.pageErrors.length === 0 && result.consoleErrors.length === 0;
    fs.writeFileSync(path.join(outputDir, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, failures: result.failures, unknownRequests: result.unknownRequests, outputDir }, null, 2));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
