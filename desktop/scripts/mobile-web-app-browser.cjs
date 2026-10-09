#!/usr/bin/env node
// Optional renderer acceptance of the built, real Web App. Build web/dist first.
// No application components are copied or bundled by this script. API fixtures
// are deliberately bounded, and every unrecognised request fails the run.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const options = {};
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir|scenario)=(.+)$/.exec(argument);
  if (!match) throw new Error(`Unknown argument: ${argument}`);
  options[match[1]] = match[2];
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for JSON and screenshots.');
if (options.scenario && !['smoke', 'all', 'inherited-columns', 'fullscreen', 'search-return'].includes(options.scenario)) throw new Error('Use --scenario=smoke, all, inherited-columns, fullscreen, or search-return.');
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
const searchReturnScenario = options.scenario === 'search-return';
const mediaItems = Array.from({ length: searchReturnScenario ? 1024 : 240 }, (_, index) => ({
  node: makeNode(1000 + index, `photo-${String(index + 1).padStart(searchReturnScenario ? 4 : 3, '0')}.png`, searchReturnScenario ? 2 : 1),
  metadata: { media_kind: 'image', mime_type: 'image/png', width: 80, height: 80, captured_at: stamp,
    index_state: 'ready', has_thumbnail: true, thumbnail_mime_type: 'image/png', thumbnail_width: 80, thumbnail_height: 80 },
  favorite: false, tags: [], people: [],
}));
const mediaByID = new Map(mediaItems.map((item) => [item.node.id, item]));
// One image in the real Files API enables the actual Quick Look caller route.
if (options.scenario === 'fullscreen') rootChildren.push(mediaItems[0].node);
if (searchReturnScenario) folderChildren.push(...mediaItems.map((item) => item.node));
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
    case 'GET /api/v1/sources/overview': return plain([]);
    case 'GET /api/v1/me/storage':
    case 'GET /api/v1/admin/storage':
      assert(!key.includes('/admin/') || role === 'admin', 'Ordinary user reached administrator API');
      return plain({ scope: key.includes('/admin/') ? 'global' : 'self', generated_at: stamp,
        file_count: rootChildren.length, logical_file_bytes: 1048576, file_buckets: [], buckets: [] });
    case 'GET /api/v1/admin/users':
      assert.equal(role, 'admin'); return plain([]);
    case 'GET /api/v1/admin/audit': {
      assert.equal(role, 'admin'); queryOnly(url, ['range', 'limit', 'offset']);
      assert.equal(url.searchParams.get('range'), 'true');
      const limit = integerQuery(url, 'limit', 100, 100);
      const offset = integerQuery(url, 'offset', 0, 0);
      return { items: [], total_count: 0, snapshot_max_id: 0, offset, limit };
    }
    case 'GET /api/v1/admin/storage/health':
      assert.equal(role, 'admin');
      return plain({ status: 'ok', healthy: true, ready_blobs: 0, deleting_blobs: 0,
        stale_deleting_blobs: 0, missing_metadata: 0, refcount_mismatches: 0, state_mismatches: 0,
        size_mismatches: 0, key_hash_mismatches: 0, invalid_states: 0, generated_at: stamp });
    case 'GET /api/v1/admin/storage/history':
      assert.equal(role, 'admin'); queryOnly(url, ['days']); integerQuery(url, 'days', 30, 30);
      return { samples: [], anomalies: [], sampling_interval_hours: 24, retention_days: 90,
        decision: { priority: 'collecting', confidence: 'low', sample_count: 0, span_hours: 0, window_hours: 168,
          average_small_lt64_kib_count_share: 0, average_small_lt256_kib_count_share: 0,
          average_large_ge16_mib_byte_share: 0, average_dedup_ratio: 1, reason_codes: [] } };
    case 'GET /api/v1/admin/storage/staging/cleanup-runs':
      assert.equal(role, 'admin'); queryOnly(url, ['limit', 'offset']);
      integerQuery(url, 'limit', 20, 20); integerQuery(url, 'offset', 0, 0); return [];
    case 'GET /api/v1/file-recent':
      queryOnly(url, ['limit']); integerQuery(url, 'limit', 16, 50); return [];
    case 'GET /api/v1/search': {
      assert(searchReturnScenario, 'Search transport belongs to the explicit search-return scenario');
      queryOnly(url, ['q', 'offset', 'limit', 'sort', 'order', 'kind', 'group', 'folders_first']);
      assert.equal(url.searchParams.get('q'), 'photo');
      assert.equal(url.searchParams.get('sort'), 'name');
      assert.equal(url.searchParams.get('order'), 'asc');
      assert.equal(url.searchParams.get('kind') || 'image', 'image');
      assert.equal(url.searchParams.get('group') || 'none', 'none');
      assert.equal(url.searchParams.get('folders_first') || 'true', 'true');
      const offset = integerQuery(url, 'offset', 0, mediaItems.length);
      const limit = integerQuery(url, 'limit', 200, 200);
      assert(limit > 0, 'Search range must be nonempty');
      return { items: mediaItems.slice(offset, offset + limit).map(({ node }) => ({
        node, path: `/验收目录/${node.name}`,
        // SearchResult uses breadcrumbs; api.searchRange converts it to crumbs.
        // A file result ends at its authoritative parent, not at the file itself.
        breadcrumbs: [{ id: rootNode.id, name: rootNode.name }, { id: childFolder.id, name: childFolder.name }],
      })), total_count: mediaItems.length, offset, limit, sort: 'name', order: 'asc', groups: [] };
    }
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
      queryOnly(url, ['range', 'limit', 'offset', 'sort_by', 'sort_dir']);
      // The shared Gallery already sends its persisted chronological sort.
      // This viewport fixture exercises the default captured/descending state.
      assert.equal(url.searchParams.get('sort_by') || 'captured', 'captured');
      assert.equal(url.searchParams.get('sort_dir') || 'desc', 'desc');
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
    const offset = integerQuery(url, 'offset', 0, searchReturnScenario ? nodes.length : 500);
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
  checks: [], samples: {}, requests: {}, unknownRequests: [], consoleErrors: [], expectedConsoleErrors: [], expectedApiErrors: [], pageErrors: [], failures: [],
};
let activeStage = 'startup';
let page;
let metadataGate;
const expectedConsoleURLs = new Set();
function check(name, passed, evidence) {
  result.checks.push({ name, passed: Boolean(passed), ...(evidence === undefined ? {} : { evidence }) });
  // Collect independent layout failures so a baseline records every viewport;
  // a failed contract still makes the command fail and appears in results.json.
  if (!passed && (options.scenario === 'fullscreen' || searchReturnScenario)) {
    result.failures.push({ stage: activeStage, message: name, evidence });
    process.exitCode = 1;
    return;
  }
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
        overflowX: getComputedStyle(element).overflowX, overflowY: getComputedStyle(element).overflowY,
        padding: ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(getComputedStyle(element)[`padding${side}`])),
        flexDirection: getComputedStyle(element).flexDirection, flexBasis: getComputedStyle(element).flexBasis };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, hash: location.hash,
      document: bounds(document.documentElement), body: bounds(document.body), main: bounds(document.querySelector('main')),
      files: bounds(document.querySelector('[data-xdrive-file-explorer]')),
      filesScroll: bounds(document.querySelector('[data-xdrive-file-explorer-scroll-host]')),
      workspacePage: bounds([...document.querySelector('main').children].find((element) => {
        const rect = element.getBoundingClientRect();
        return element.tagName !== 'STYLE' && rect.width > 0 && rect.height > 0;
      })),
      galleryHeader: bounds(document.querySelector('[data-xdrive-gallery-header]')),
      galleryTitle: bounds(document.querySelector('[data-xdrive-gallery-header] > :not(style)')),
      navigation: bounds(document.querySelector('nav[aria-label="网页端功能区导航"]')),
      globalHeader: bounds(document.querySelector('[data-xdrive-workspace-background] .MuiAppBar-root')),
      floatingNavigation: bounds(document.querySelector('button[aria-label="打开应用导航"]')),
      bottomNavigation: bounds(document.querySelector('.MuiBottomNavigation-root')),
      coarse: matchMedia('(pointer: coarse)').matches, compact: matchMedia('(max-width:899.95px)').matches,
    };
  });
  result.samples[name] = sample;
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
  check(`${name}: requested CSS viewport`, sample.viewport.width === page.viewportSize().width && sample.viewport.height === page.viewportSize().height, sample.viewport);
  check(`${name}: no document overflow`, sample.document.scrollWidth <= sample.viewport.width + 1 && sample.document.scrollHeight <= sample.viewport.height + 1, sample.document);
  check(`${name}: workspace within viewport`, sample.main && sample.main.width > 0 && sample.main.height > 0 && sample.main.right <= sample.viewport.width + 1 && sample.main.bottom <= sample.viewport.height + 1, sample.main);
  check(`${name}: correct navigation breakpoint`, sample.compact === (sample.viewport.width < 900));
  if (sample.compact) {
    check(`${name}: mobile main fills the entire viewport`, Math.abs(sample.main.x) <= 1 && Math.abs(sample.main.y) <= 1 && Math.abs(sample.main.width - sample.viewport.width) <= 1 && Math.abs(sample.main.height - sample.viewport.height) <= 1, sample.main);
    check(`${name}: global chrome does not reserve viewport space`, (!sample.globalHeader || sample.globalHeader.height === 0) && (!sample.bottomNavigation || sample.bottomNavigation.height === 0), { header: sample.globalHeader, bottomNavigation: sample.bottomNavigation });
  } else check(`${name}: desktop header and sidebar are retained`, sample.globalHeader && sample.globalHeader.height > 0 && sample.main.x > 0 && Math.abs(sample.main.y - sample.globalHeader.bottom) <= 1, { header: sample.globalHeader, main: sample.main });
  if (sample.files) check(`${name}: Files fills available main`, Math.abs(sample.files.height - sample.main.height) <= 1 && Math.abs(sample.files.y - sample.main.y) <= 1 && sample.files.right <= sample.main.right + 1, sample.files);
  if (sample.filesScroll) check(`${name}: Files scroll viewport remains visible`, sample.filesScroll.height > 0 && sample.filesScroll.bottom <= sample.main.bottom + 1, sample.filesScroll);
  if (sample.compact) check(`${name}: mobile workspace has no outer padding`, sample.main.padding.every((value) => value === 0), sample.main);
  if (sample.compact && sample.workspacePage) check(`${name}: workspace page meets available edges`, Math.abs(sample.workspacePage.x - sample.main.x) <= 1 && Math.abs(sample.workspacePage.right - sample.main.right) <= 1 && Math.abs(sample.workspacePage.y + sample.main.scrollTop - sample.main.y) <= 1, sample.workspacePage);
  if (!sample.compact && !sample.files) check(`${name}: desktop page padding is retained`, Math.abs(sample.main.padding[0] - 32) <= 1 && Math.abs(sample.main.padding[2] - 32) <= 1 && Math.abs(sample.main.padding[1] - Math.min(56, Math.max(16, sample.viewport.width * 0.04))) <= 1, sample.main.padding);
  if (sample.galleryHeader && sample.compact) check(`${name}: Gallery title does not reserve a 320px column`, sample.galleryTitle.height < 100, sample.galleryTitle);
  return sample;
}
async function loadFiles(context, origin, role) {
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => result.pageErrors.push({ role, stage: activeStage, message: error.message }));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const entry = { role, stage: activeStage, message: message.text(), url: message.location().url };
    if (expectedConsoleURLs.has(entry.url) && /Failed to load resource:.*404/.test(entry.message)) result.expectedConsoleErrors.push(entry);
    else result.consoleErrors.push(entry);
  });
  await page.goto(`${origin}/#/app/files`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'document-001.txt' }).waitFor();
  await settle();
}
async function moreDismissals(role) {
  const more = page.getByRole('button', { name: '打开应用导航', exact: true });
  const dialog = page.getByRole('dialog', { name: '应用导航', exact: true });
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
    const targets = await dialog.getByRole('button').evaluateAll((elements) => elements.map((element) => ({
      label: element.getAttribute('aria-label') || element.textContent,
      height: element.getBoundingClientRect().height,
    })));
    check(`${activeStage}: targets at least 44px`, targets.every((target) => target.height >= 44), targets);
    if (method === 'button') await page.getByRole('button', { name: '关闭应用导航' }).click();
    else if (method === 'escape') await page.keyboard.press('Escape');
    else await page.locator('.MuiDrawer-root .MuiBackdrop-root').click({ position: { x: 8, y: 8 } });
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '打开应用导航');
    check(`${activeStage}: focus returns to application navigation`, await more.evaluate((element) => document.activeElement === element));
    check(`${activeStage}: no navigation`, page.url() === initialURL && await page.evaluate(() => history.length) === initialHistory);
  }
}
async function moreLifecycle(role) {
  activeStage = `${role}-more-lifecycle`;
  const more = page.getByRole('button', { name: '打开应用导航', exact: true });
  const dialog = page.getByRole('dialog', { name: '应用导航', exact: true });
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
  await navigateWorkspace('图库', 'gallery');
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
    await page.getByRole('button', { name: '打开应用导航', exact: true }).click();
    if (portal === 'more') await page.getByRole('dialog', { name: '应用导航', exact: true }).waitFor();
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
    await page.getByRole(portal === 'account' ? 'menu' : 'dialog').first().waitFor();
    await page.goForward();
    await page.waitForURL(viewerURL);
    await returnButton.waitFor();
    await page.getByRole('dialog').first().waitFor({ state: 'hidden' });
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

// Actual built WebFileExplorer -> App media-viewer route -> caller return.
// This intentionally does not substitute an onOpenFile callback or Viewer.
async function searchReturnAcceptance() {
  activeStage = 'user-search-return-setup';
  await page.getByRole('button', { name: '搜索全部文件和文件夹', exact: true }).tap();
  const input = page.getByRole('textbox', { name: '搜索全部文件和文件夹', exact: true });
  await input.fill('photo');
  await input.press('Enter');
  const summary = page.locator('[data-xdrive-file-explorer-search-summary]');
  await page.waitForFunction((count) => document.querySelector('[data-xdrive-file-explorer-search-summary]')?.textContent.includes(`${count} 个结果`), mediaItems.length);
  const closeSearch = page.getByRole('button', { name: '关闭搜索框', exact: true });
  // A committed new search may already collapse the compact input.
  if (await closeSearch.isVisible()) await closeSearch.tap();
  await page.getByRole('button', { name: '筛选文件', exact: true }).tap();
  const filters = page.getByRole('dialog', { name: '文件筛选', exact: true });
  await filters.getByRole('button', { name: '类型', exact: true }).tap();
  await page.getByRole('menuitem', { name: '图片', exact: true }).tap();
  await page.getByRole('button', { name: '关闭筛选', exact: true }).tap();
  await filters.waitFor({ state: 'hidden' });
  await page.waitForFunction((count) => {
    const text = document.querySelector('[data-xdrive-file-explorer-search-summary]')?.textContent || '';
    return text.includes(`${count} 个结果`) && text.includes('类型：图片');
  }, mediaItems.length);
  check(`${activeStage}: committed query and condition are readable`, (await summary.innerText()).includes('搜索：“photo”') && (await summary.innerText()).includes('类型：图片'));
  check(`${activeStage}: Search keeps the all-files scope`, (await summary.innerText()).includes('范围：全部文件'));

  const scroll = page.locator('[data-xdrive-file-explorer-scroll-host]');
  await scroll.evaluate((element) => { element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) * 0.61); });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-xdrive-file-explorer-item]')].some((element) => {
    const match = /photo-(\d+)\.png/.exec(element.textContent);
    return match && Number(match[1]) > 500;
  }));
  await settle();
  const name = await scroll.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const row = [...element.querySelectorAll('[data-xdrive-file-explorer-item]')].find((item) => {
      const rect = item.getBoundingClientRect();
      return /photo-\d+\.png/.test(item.textContent) && rect.top >= bounds.top + 32 && rect.bottom <= bounds.bottom;
    });
    return /photo-\d+\.png/.exec(row?.textContent || '')?.[0];
  });
  assert(name, 'The real search viewport must expose a loaded media result');
  const item = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: name });
  // Mouse selection followed by ordinary touch activation verifies the retained
  // single selection as well as the mobile media-open path.
  await item.click();
  await page.waitForFunction((name) => [...document.querySelectorAll('[data-xdrive-file-explorer-item][aria-selected="true"]')].some((element) => element.textContent.includes(name)), name);
  const logicalIndex = mediaItems.findIndex((media) => media.node.name === name);
  const nodeID = mediaItems[logicalIndex].node.id;
  check(`${activeStage}: selected result is beyond the first search page`, logicalIndex > 500, { name, logicalIndex, nodeID });
  await item.evaluate((element) => {
    const scrollElement = document.querySelector('[data-xdrive-file-explorer-scroll-host]');
    window.__searchReturnCaller = {
      main: document.querySelector('main'), files: document.querySelector('[data-xdrive-file-explorer]'),
      background: document.querySelector('[data-xdrive-workspace-background]'),
      scrollElement, item: element, scrollTop: scrollElement.scrollTop, url: location.href,
      selected: [...scrollElement.querySelectorAll('[data-xdrive-file-explorer-item][aria-selected="true"]')].map((row) => /photo-\d+\.png/.exec(row.textContent)?.[0]),
      summary: document.querySelector('[data-xdrive-file-explorer-search-summary]').textContent,
    };
  });
  const callerURL = page.url();
  const callerState = () => page.evaluate(() => {
    const saved = window.__searchReturnCaller;
    const currentScroll = document.querySelector('[data-xdrive-file-explorer-scroll-host]');
    const selected = [...currentScroll.querySelectorAll('[data-xdrive-file-explorer-item][aria-selected="true"]')].map((row) => /photo-\d+\.png/.exec(row.textContent)?.[0]);
    return {
      sameMain: saved.main === document.querySelector('main'), sameFiles: saved.files === document.querySelector('[data-xdrive-file-explorer]'),
      sameScroll: saved.scrollElement === currentScroll, sameBackground: saved.background === document.querySelector('[data-xdrive-workspace-background]'),
      itemConnected: saved.item.isConnected, expectedScroll: saved.scrollTop, actualScroll: currentScroll.scrollTop,
      expectedSelected: saved.selected, selected,
      expectedSummary: saved.summary, summary: document.querySelector('[data-xdrive-file-explorer-search-summary]')?.textContent,
      inert: saved.background.inert, ariaHidden: saved.background.getAttribute('aria-hidden'),
    };
  });
  const verifyCaller = async (phase, behindViewer, requireSameRow = true) => {
    const state = await callerState();
    result.samples[phase] = state;
    check(`${phase}: same mounted Files caller and scroll host`, state.sameMain && state.sameFiles && state.sameScroll && state.sameBackground && (!requireSameRow || state.itemConnected), state);
    check(`${phase}: exact search scroll retained`, state.actualScroll === state.expectedScroll, state);
    check(`${phase}: stable selected result retained`, JSON.stringify(state.selected) === JSON.stringify(state.expectedSelected), state);
    check(`${phase}: query, condition and authoritative count retained`, state.summary === state.expectedSummary, state);
    check(`${phase}: caller input ownership`, behindViewer ? state.inert && state.ariaHidden === 'true' : !state.inert && state.ariaHidden === null, state);
  };
  await geometry('user-search-results-390');

  activeStage = 'user-search-result-media-viewer';
  await item.tap();
  await page.waitForURL(/\/media-viewer\?node=/);
  await page.locator('[data-xdrive-web-viewer]').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-xdrive-web-viewer] [data-xdrive-file-preview-kind] img')].some((image) => image.complete && image.naturalWidth === 80));
  const viewerURL = page.url();
  const browse = await page.evaluate(() => {
    const params = new URLSearchParams(location.hash.split('?')[1]);
    const session = JSON.parse(sessionStorage.getItem(`xdrive.web_app.session.v1:${params.get('context')}`));
    return { node: Number(params.get('node')), context: session.context, version: session.version };
  });
  result.samples['user-search-viewer-browse-context'] = browse;
  check(`${activeStage}: ordinary activation launches the real media Viewer`, browse.node === nodeID && page.url().includes('/media-viewer?'), browse);
  check(`${activeStage}: Viewer carries the owner-wide Search definition`, browse.version === 1 && browse.context.kind === 'search' && browse.context.query === 'photo' && browse.context.filters.kind === 'image', browse);
  check(`${activeStage}: Viewer carries source ordering and grouping`, browse.context.sort.key === 'name' && browse.context.sort.direction === 'asc' && browse.context.grouping.groupBy === 'none' && browse.context.grouping.foldersFirst === true, browse);
  check(`${activeStage}: Viewer carries the exact logical search index`, browse.context.activeIndex === logicalIndex, browse);
  await verifyCaller('user-search-behind-viewer', true);
  await page.screenshot({ path: path.join(outputDir, 'user-search-media-viewer.png') });
  // The real immersive frame may have hidden chrome during screenshot work.
  // A harmless navigation key shows it through the actual frame key handler.
  await page.locator('[data-xdrive-web-viewer]').press('ArrowUp');
  await page.getByRole('button', { name: '返回', exact: true }).tap();
  await page.waitForURL(callerURL);
  await page.locator('[data-xdrive-web-viewer]').waitFor({ state: 'hidden' });
  await settle();
  await verifyCaller('user-search-viewer-close', false);

  activeStage = 'user-search-viewer-browser-history';
  await page.goForward();
  await page.waitForURL(viewerURL);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-xdrive-web-viewer] [data-xdrive-file-preview-kind] img')].some((image) => image.complete && image.naturalWidth === 80));
  await verifyCaller('user-search-viewer-forward', true);
  await page.goBack();
  await page.waitForURL(callerURL);
  await page.locator('[data-xdrive-web-viewer]').waitFor({ state: 'hidden' });
  await settle();
  await verifyCaller('user-search-viewer-browser-back', false);

  activeStage = 'user-search-containing-folder';
  await page.getByRole('button', { name: `更多操作：${name}`, exact: true }).tap();
  await page.locator('[data-xdrive-file-explorer-touch-action-sheet]').waitFor();
  await page.getByText('显示所在文件夹', { exact: true }).tap();
  await page.waitForURL(/\/files\?dir=2$/);
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'nested-001.txt' }).waitFor();
  check(`${activeStage}: real adapter uses authoritative search-result parent`, new URL(page.url()).hash === '#/app/files?dir=2' && await summary.count() === 0);
  await page.getByRole('button', { name: '后退', exact: true }).tap();
  await page.waitForURL(callerURL);
  await page.waitForFunction((count) => document.querySelector('[data-xdrive-file-explorer-search-summary]')?.textContent.includes(`${count} 个结果`), mediaItems.length);
  await page.waitForFunction(() => Math.abs(document.querySelector('[data-xdrive-file-explorer-scroll-host]').scrollTop - window.__searchReturnCaller.scrollTop) <= 1).catch(() => {});
  await verifyCaller('user-search-containing-folder-back', false, false);
  const searchRequests = Object.entries(result.requests).filter(([key]) => key.includes(' GET /api/v1/search?'));
  result.samples['user-search-range-requests'] = searchRequests;
  check(`${activeStage}: real Viewer resolves a bounded page in the retained Search`, searchRequests.some(([key]) => {
    const params = new URLSearchParams(key.split('?')[1]);
    return params.get('kind') === 'image' && params.get('limit') === '128' && Number(params.get('offset')) >= 512;
  }), searchRequests);
  activeStage = 'user-search-status-navigation';
  const statusGeometry = await page.evaluate(() => {
    const status = document.querySelector('[data-xdrive-file-explorer-status-bar]');
    const navigation = document.querySelector('button[aria-label="打开应用导航"]');
    const navigationRect = navigation?.getBoundingClientRect();
    const visibleNavigation = navigationRect && navigationRect.width > 0 && navigationRect.height > 0
      && getComputedStyle(navigation).visibility !== 'hidden' && +getComputedStyle(navigation).opacity > 0;
    const textRects = [];
    if (status) {
      const walker = document.createTreeWalker(status, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) textRects.push({ text: text.textContent, rect: rect.toJSON() });
        }
      }
    }
    const overlaps = visibleNavigation ? textRects.filter(({ rect }) =>
      Math.min(rect.right, navigationRect.right) > Math.max(rect.left, navigationRect.left)
      && Math.min(rect.bottom, navigationRect.bottom) > Math.max(rect.top, navigationRect.top)) : [];
    return { status: status?.getBoundingClientRect().toJSON() ?? null,
      navigation: navigationRect?.toJSON() ?? null, visibleNavigation: Boolean(visibleNavigation), textRects, overlaps };
  });
  result.samples[activeStage] = statusGeometry;
  await page.screenshot({ path: path.join(outputDir, `${activeStage}.png`) });
  check(`${activeStage}: actual Files status text does not overlap app navigation`, statusGeometry.visibleNavigation && statusGeometry.textRects.length > 0 && statusGeometry.overlaps.length === 0, statusGeometry);
  await page.screenshot({ path: path.join(outputDir, 'user-search-return.png') });
}

async function navigateWorkspace(label, app) {
  await settle();
  let button = page.getByRole('button', { name: label, exact: true });
  if (!await button.isVisible()) {
    const floating = page.getByRole('button', { name: '打开应用导航', exact: true });
    await (await floating.isVisible() ? floating : page.getByRole('button', { name: '更多', exact: true })).click();
    button = page.getByRole('dialog').getByRole('button', { name: label, exact: true });
  }
  await button.click();
  await page.waitForURL((url) => url.hash === `#/app/${app}` || url.hash.startsWith(`#/app/${app}?`));
  // Wait for the real Drawer exit transition before measuring/clicking the
  // destination. A still visible backdrop makes Playwright scroll/retry taps.
  await page.locator('.MuiDrawer-root').waitFor({ state: 'hidden' });
  await settle();
}

async function viewerGeometry(name) {
  await settle();
  const sample = await page.evaluate(() => {
    const rect = (element) => element ? element.getBoundingClientRect().toJSON() : null;
    const viewer = document.querySelector('[data-xdrive-web-viewer]');
    const header = [...viewer.children].find((element) => element.querySelector('button[aria-label="返回"]'));
    const surface = viewer.querySelector('[data-xdrive-file-preview-kind]');
    const zoom = viewer.querySelector('[data-xdrive-preview-zoom]');
    const returnButton = header.querySelector('button[aria-label="返回"]');
    const buttonRect = returnButton.getBoundingClientRect();
    const hit = document.elementFromPoint(buttonRect.x + buttonRect.width / 2, buttonRect.y + buttonRect.height / 2);
    return { viewport: { width: innerWidth, height: innerHeight }, hash: location.hash,
      viewer: rect(viewer), content: rect(surface), zoom: rect(zoom), header: rect(header),
      headerPosition: getComputedStyle(header).position, headerOpacity: +getComputedStyle(header).opacity,
      headerPointerEvents: getComputedStyle(header).pointerEvents,
      returnHit: !!hit && (hit === returnButton || returnButton.contains(hit)),
      imageDecoded: [...viewer.querySelectorAll('img')].some((image) => image.complete && image.naturalWidth === 80),
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    };
  });
  result.samples[name] = sample;
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
  for (const part of ['viewer', 'content', 'zoom']) {
    const rect = sample[part];
    check(`${name}: ${part} uses the entire viewport`, rect && Math.abs(rect.x) <= 1 && Math.abs(rect.y) <= 1 && Math.abs(rect.width - sample.viewport.width) <= 1 && Math.abs(rect.height - sample.viewport.height) <= 1, rect);
  }
  check(`${name}: chrome overlays the media`, ['absolute', 'fixed'].includes(sample.headerPosition), { position: sample.headerPosition, header: sample.header });
  check(`${name}: real image decoded`, sample.imageDecoded);
  check(`${name}: no document overflow`, sample.document.width <= sample.viewport.width + 1 && sample.document.height <= sample.viewport.height + 1, sample.document);
  return sample;
}

async function immersiveGeometryAcceptance(role, kind) {
  activeStage = `${role}-${kind}-fullscreen`;
  await page.waitForURL((url) => url.hash.startsWith(`#/app/${kind}?node=`));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-xdrive-file-preview-kind] img')].some((image) => image.complete && image.naturalWidth === 80));
  const retained = async (phase) => {
    const state = await page.evaluate(() => {
      const saved = window.__fullscreenCaller;
      const mainRect = saved.main.getBoundingClientRect();
      const visibleAnchor = [...document.querySelectorAll('[data-xdrive-media-tile]')].map((tile) => ({
        index: Number(tile.getAttribute('data-xdrive-media-index')), rect: tile.getBoundingClientRect().toJSON(),
      })).find((tile) => tile.rect.bottom > mainRect.y && tile.rect.y < mainRect.bottom);
      return { sameMain: saved.main === document.querySelector('main'), itemConnected: saved.element.isConnected,
        sameBackground: saved.background === document.querySelector('[data-xdrive-workspace-background]'),
        expectedScroll: saved.scroll, actualScroll: saved.scrollElement.scrollTop,
        currentURL: location.href, callerURL: saved.url,
        visibleGalleryAnchor: visibleAnchor ?? null,
        savedItemRect: saved.itemRect, currentItemRect: saved.element.getBoundingClientRect().toJSON() };
    });
    result.samples[`${role}-${kind}-caller-${phase}`] = state;
    return state;
  };
  const isRetained = (state, expectedScroll = state.expectedScroll) => state.sameMain && state.itemConnected && state.sameBackground && expectedScroll === state.actualScroll;
  const behind = await retained('behind');
  check(`${activeStage}: caller DOM and scroll retained behind viewer`, isRetained(behind), behind);
  check(`${activeStage}: caller is inert`, await page.locator('[data-xdrive-workspace-background]').evaluate((element) => element.inert && element.getAttribute('aria-hidden') === 'true'));
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await settle();
    const resized = await retained(`resize-${viewport.width}`);
    check(`${activeStage}-${viewport.width}: caller remains mounted during resize`, resized.sameMain && resized.itemConnected && resized.sameBackground, resized);
    const name = `${role}-${kind}-${viewport.width}x${viewport.height}`;
    // This is the actual auto-hide timer. No style or component substitution.
    const visible = await viewerGeometry(`${name}-visible`);
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-xdrive-web-viewer] button[aria-label="返回"]');
      return button && getComputedStyle(button.parentElement).opacity === '0';
    });
    const hidden = await viewerGeometry(`${name}-hidden`);
    check(`${name}: hidden chrome releases pointer input`, hidden.headerPointerEvents === 'none' && hidden.headerOpacity === 0);
    for (const part of ['viewer', 'content', 'zoom']) check(`${name}: ${part} geometry stable after chrome hides`, ['x', 'y', 'width', 'height'].every((key) => Math.abs(visible[part][key] - hidden[part][key]) <= 1), { visible: visible[part], hidden: hidden[part] });
    await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-xdrive-web-viewer] button[aria-label="返回"]').parentElement).opacity === '1');
    const shown = await viewerGeometry(`${name}-reshown`);
    check(`${name}: overlay return button receives input`, shown.returnHit && shown.headerPointerEvents === 'auto');
    if (viewport.width === 390) {
      const viewerURL = page.url();
      const callerURL = await page.evaluate(() => window.__fullscreenCaller.url);
      await page.getByRole('button', { name: '返回', exact: true }).click();
      await page.waitForURL(callerURL);
      await settle();
      const fixedReturn = await retained('fixed-viewport-return');
      check(`${activeStage}: fixed viewport return preserves exact caller scroll`, isRetained(fixedReturn), fixedReturn);
      await page.goForward();
      await page.waitForURL(viewerURL);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-xdrive-file-preview-kind] img')].some((image) => image.complete && image.naturalWidth === 80));
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  const beforeReturn = await retained('before-return');
  const callerURL = await page.evaluate(() => window.__fullscreenCaller.url);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.waitForURL(callerURL);
  await settle();
  const returned = await retained('returned');
  // A responsive Gallery may reflow and browser scroll anchoring may adjust
  // its offset during rotation. Closing must preserve that exact live offset.
  check(`${activeStage}: return restores caller DOM and scroll`, isRetained(returned, beforeReturn.actualScroll), { before: beforeReturn, after: returned });
  check(`${activeStage}: return restores caller input`, await page.locator('[data-xdrive-workspace-background]').evaluate((element) => !element.inert && !element.hasAttribute('aria-hidden')));
}

async function rememberCaller(element, scrollSelector) {
  await element.evaluate((node, selector) => {
    const scrollElement = document.querySelector(selector);
    window.__fullscreenCaller = { main: document.querySelector('main'), element: node,
      background: document.querySelector('[data-xdrive-workspace-background]'),
      scrollElement, scroll: scrollElement.scrollTop, url: location.href,
      itemRect: node.getBoundingClientRect().toJSON() };
  }, scrollSelector);
}

async function viewerMetadataAcceptance(role, app, loadingMessage) {
  activeStage = `${role}-${app}-metadata`;
  const paths = app === 'media-viewer' ? ['/api/v1/media/items/1000']
    : app === 'text-viewer' ? ['/api/v1/nodes/1000', '/api/v1/files/1000/preview/text']
      : ['/api/v1/nodes/1000'];
  let release;
  metadataGate = { paths, hits: 0, wait: new Promise((resolve) => { release = resolve; }) };
  await page.evaluate(() => { window.__metadataCaller = { main: document.querySelector('main'), files: document.querySelector('[data-xdrive-file-explorer]') }; });
  // Real standalone routes intentionally have no browse context, so the actual
  // metadata boundary remains pending instead of using a cached directory row.
  await page.evaluate((hash) => { location.hash = hash; }, `#/app/${app}?node=1000`);
  await page.waitForURL((url) => url.hash === `#/app/${app}?node=1000`);
  const stateGeometry = async (state, message) => {
    const text = page.getByText(message, { exact: true });
    await text.waitFor();
    await settle();
    const sample = await text.evaluate((element) => {
      const viewer = element.closest('[data-xdrive-web-viewer]');
      const button = viewer?.querySelector('button[aria-label="返回"]');
      const header = viewer && [...viewer.children].find((child) => child.contains(button));
      const buttonRect = button?.getBoundingClientRect();
      const hit = buttonRect && document.elementFromPoint(buttonRect.x + buttonRect.width / 2, buttonRect.y + buttonRect.height / 2);
      return { viewport: { width: innerWidth, height: innerHeight }, viewer: viewer?.getBoundingClientRect().toJSON() ?? null,
        message: element.getBoundingClientRect().toJSON(), header: header?.getBoundingClientRect().toJSON() ?? null,
        returnVisible: !!header && +getComputedStyle(header).opacity === 1 && !!hit && (hit === button || button.contains(hit)) };
    });
    result.samples[`${role}-${app}-${state}`] = sample;
    await page.screenshot({ path: path.join(outputDir, `${role}-${app}-${state}.png`) });
    check(`${activeStage}-${state}: frame fills viewport`, sample.viewer && sample.viewer.x === 0 && sample.viewer.y === 0 && sample.viewer.width === sample.viewport.width && sample.viewer.height === sample.viewport.height, sample);
    check(`${activeStage}-${state}: return remains visible and receives input`, sample.returnVisible, sample);
    check(`${activeStage}-${state}: status message is below overlay header and inside viewport`, sample.header && sample.message.y >= sample.header.bottom && sample.message.bottom <= sample.viewport.height && sample.message.x >= 0 && sample.message.right <= sample.viewport.width, sample);
  };
  try {
    await stateGeometry('loading', loadingMessage);
    check(`${activeStage}: loading is held at the real metadata API`, metadataGate.hits === paths.length, { endpoints: paths, requests: metadataGate.hits });
    release();
    await stateGeometry('error', 'QA metadata unavailable');
    const back = page.getByRole('button', { name: '返回', exact: true });
    if (await back.isVisible()) await back.click();
    else await page.goBack(); // Allows an unframed baseline to record every route.
    await page.waitForURL(/\/files(?:\?dir=1)?$/);
    check(`${activeStage}: error return restores mounted Files`, await page.evaluate(() => window.__metadataCaller.main === document.querySelector('main') && window.__metadataCaller.files === document.querySelector('[data-xdrive-file-explorer]')));
  } finally {
    release();
    metadataGate = undefined;
  }
}

async function filesOverlayAcceptance(role) {
  activeStage = `${role}-files-floating-entry`;
  await page.setViewportSize({ width: 360, height: 780 });
  await settle();
  await page.locator('[data-xdrive-file-explorer-scroll-host]').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const more = page.getByRole('button', { name: '更多操作：photo-001.png', exact: true });
  await more.waitFor();
  await settle();
  const target = await more.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    return { rect: rect.toJSON(), point, receivesInput: !!hit && (hit === element || element.contains(hit)),
      hitLabel: hit?.closest('button')?.getAttribute('aria-label'),
      scroll: document.querySelector('[data-xdrive-file-explorer-scroll-host]').scrollTop };
  });
  result.samples[`${role}-files-last-row-more`] = target;
  check(`${activeStage}: last row More center is not covered by application navigation`, target.receivesInput, target);
  await page.touchscreen.tap(target.point.x, target.point.y);
  await settle();
  const closeActions = page.getByRole('button', { name: '关闭文件操作', exact: true });
  const opened = await closeActions.isVisible();
  check(`${activeStage}: physical tap opens last row actions`, opened);
  await page.screenshot({ path: path.join(outputDir, `${role}-files-last-row-actions.png`) });
  if (opened) await closeActions.tap();
  else if (await page.getByRole('button', { name: '关闭应用导航', exact: true }).isVisible()) await page.getByRole('button', { name: '关闭应用导航', exact: true }).tap();
  await page.locator('[data-xdrive-file-explorer-touch-action-sheet]').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
}

async function galleryOverlayAcceptance(role, density = 144) {
  activeStage = `${role}-gallery-floating-entry-${density}`;
  await page.setViewportSize({ width: 360, height: 780 });
  await settle();
  await page.locator('main').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const info = page.locator('[data-xdrive-media-index="239"] [data-xdrive-gallery-touch-info]');
  await info.waitFor();
  await settle();
  const target = await info.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    const navigation = document.querySelector('button[aria-label="打开应用导航"]');
    const navRect = navigation?.getBoundingClientRect();
    const overlap = navRect ? { width: Math.max(0, Math.min(rect.right, navRect.right) - Math.max(rect.left, navRect.left)),
      height: Math.max(0, Math.min(rect.bottom, navRect.bottom) - Math.max(rect.top, navRect.top)) } : { width: 0, height: 0 };
    // Include edge midpoints as well as inset corners: two round controls can
    // overlap through their middle edges while all four corners remain clear.
    const probes = [
      ['top-left', rect.left + 1, rect.top + 1], ['top-right', rect.right - 1, rect.top + 1],
      ['bottom-left', rect.left + 1, rect.bottom - 1], ['bottom-right', rect.right - 1, rect.bottom - 1],
      ['left', rect.left + 1, point.y], ['right', rect.right - 1, point.y],
      ['top', point.x, rect.top + 1], ['bottom', point.x, rect.bottom - 1],
    ].map(([label, x, y]) => {
      const top = document.elementFromPoint(x, y);
      return { label, x, y, interceptedByNavigation: !!navigation && !!top && (top === navigation || navigation.contains(top)),
        hitLabel: top?.closest('button')?.getAttribute('aria-label') };
    });
    return { rect: rect.toJSON(), point, receivesInput: !!hit && (hit === element || element.contains(hit)),
      hitLabel: hit?.closest('button')?.getAttribute('aria-label'), scroll: document.querySelector('main').scrollTop,
      navigation: navRect?.toJSON() ?? null, overlap, probes };
  });
  result.samples[`${role}-gallery-last-row-info-${density}`] = target;
  check(`${activeStage}: last Gallery Info center is not covered by application navigation`, target.receivesInput, target);
  check(`${activeStage}: last Gallery Info 44px target does not overlap application navigation`, target.overlap.width * target.overlap.height === 0 && target.probes.every((probe) => !probe.interceptedByNavigation), target);
  await page.screenshot({ path: path.join(outputDir, `${role}-gallery-last-row-info-${density}.png`) });
}

async function fullscreenAcceptance(role) {
  await page.evaluate(() => { window.__fullscreenMain = document.querySelector('main'); });
  const workspaces = [
    { label: '文件', app: 'files' }, { label: '图库', app: 'gallery' },
    { label: '主页', app: 'overview' }, { label: '同步文件夹', app: 'sync-folders' },
    { label: '任务', app: 'tasks' }, { label: '本地存储', app: 'local-storage' },
    { label: '云端存储', app: 'cloud-storage' },
    ...(role === 'admin' ? [
      { label: '全局任务', app: 'tasks?scope=global' }, { label: '用户管理', app: 'admin-users' },
      { label: '审计日志', app: 'admin-audit' }, { label: '全局存储', app: 'admin-storage' },
    ] : []),
  ];
  for (const workspace of workspaces) {
    activeStage = `${role}-fullscreen-${workspace.app}`;
    if (workspace.app !== 'files') await navigateWorkspace(workspace.label, workspace.app);
    if (workspace.app === 'gallery') await page.locator('[data-xdrive-media-tile]').first().waitFor();
    else if (workspace.app !== 'files') await page.waitForFunction(() => document.querySelector('main')?.innerText.trim() && !document.querySelector('main').innerText.includes('正在切换工作区'));
    await page.locator('main').evaluate((element) => { element.scrollTop = 0; });
    const viewports = workspace.app === 'files' || workspace.app === 'gallery'
      ? [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 899, height: 700 }, { width: 900, height: 700 }, { width: 1280, height: 800 }, { width: 844, height: 390 }]
      : [{ width: 390, height: 844 }, { width: 899, height: 700 }, { width: 900, height: 700 }];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const sample = await geometry(`${role}-fullscreen-${workspace.app.replace('?', '-')}-${viewport.width}x${viewport.height}`);
      check(`${activeStage}-${viewport.width}: one mounted main across apps and breakpoints`, await page.evaluate(() => window.__fullscreenMain === document.querySelector('main')));
      if (workspace.app === 'files') check(`${activeStage}-${viewport.width}: Files owns internal scroll`, sample.filesScroll && ['auto', 'scroll'].includes(sample.filesScroll.overflowY) && sample.filesScroll.scrollHeight > sample.filesScroll.clientHeight + 200 && sample.main.scrollHeight <= sample.main.clientHeight + 1, sample.filesScroll);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await navigateWorkspace('图库', 'gallery');
  await page.locator('[data-xdrive-media-tile]').first().waitFor();
  await page.locator('main').evaluate((element) => { element.scrollTop = 620; });
  await settle();
  const index = await page.locator('[data-xdrive-media-tile]').evaluateAll((tiles) => tiles.findIndex((tile) => {
    const rect = tile.getBoundingClientRect();
    return rect.y >= 100 && rect.bottom <= innerHeight - 100;
  }));
  assert(index >= 0, 'Fixture must expose a real Gallery tile');
  const tile = page.locator('[data-xdrive-media-tile]').nth(index);
  await rememberCaller(tile, 'main');
  await tile.tap();
  await immersiveGeometryAcceptance(role, 'media-viewer');
  await navigateWorkspace('文件', 'files');
  await filesOverlayAcceptance(role);
  const filesScroll = page.locator('[data-xdrive-file-explorer-scroll-host]');
  await filesScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const image = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'photo-001.png' });
  await image.waitFor();
  await rememberCaller(image, '[data-xdrive-file-explorer-scroll-host]');
  await image.press('Space');
  await immersiveGeometryAcceptance(role, 'preview');
  if (role === 'user') for (const [app, message] of [
    ['preview', '正在打开预览…'], ['media-viewer', '正在打开媒体…'],
    ['text-viewer', '正在加载文本…'], ['pdf-viewer', '正在打开文件…'], ['audio-player', '正在打开文件…'],
  ]) await viewerMetadataAcceptance(role, app, message);
  await navigateWorkspace('图库', 'gallery');
  await page.locator('[data-xdrive-media-tile]').first().waitFor();
  await galleryOverlayAcceptance(role);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  assert(fs.existsSync(path.join(distRoot, 'index.html')), `Build the real Web App first: ${distRoot}/index.html missing`);
  if (searchReturnScenario) {
    const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    result.runnerSHA256 = hash(__filename);
    result.builtWebSHA256 = {
      'index.html': hash(path.join(distRoot, 'index.html')),
      ...Object.fromEntries(fs.readdirSync(path.join(distRoot, 'assets')).filter((name) => /\.(js|css)$/.test(name)).sort().map((name) => [`assets/${name}`, hash(path.join(distRoot, 'assets', name))])),
    };
    result.fixture.searchItems = mediaItems.length;
    result.fixture.searchDefinition = { query: 'photo', filters: { kind: 'image' }, sort: 'name', order: 'asc', group: 'none', foldersFirst: true, parentID: 2 };
  }
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
    const cases = options.scenario === 'smoke' || searchReturnScenario ? [{ role: 'user' }]
      : options.scenario === 'inherited-columns' ? [{ role: 'user', viewMode: 'columns' }]
        : options.scenario === 'fullscreen' ? [{ role: 'user' }, { role: 'admin' }, { role: 'user', galleryDensity: 96 }, { role: 'user', galleryDensity: 240 }]
          : [{ role: 'user' }, { role: 'admin' }, { role: 'user', viewMode: 'columns' }];
    for (const { role, viewMode, galleryDensity } of cases) {
      const scenarioLabel = viewMode ? `${role}-inherited-${viewMode}` : galleryDensity ? `${role}-gallery-density-${galleryDensity}` : role;
      activeStage = `${scenarioLabel}-startup`;
      // A new process also supports single-process portable Chromium, which
      // cannot reliably create a second context after its first context closes.
      browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args,
        env: process.env.XDRIVE_BROWSER_FONTCONFIG ? { ...process.env, FONTCONFIG_PATH: process.env.XDRIVE_BROWSER_FONTCONFIG } : process.env });
      result.browserVersion = browser.version();
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
      await context.addInitScript(({ role, origin, viewMode, galleryDensity }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('xdrive.access_token', 'local-browser-qa-token');
        localStorage.setItem('xdrive.access_expires_at', String(Date.now() + 86400000));
        localStorage.setItem('xdrive.username', `qa-${role}`);
        if (viewMode) localStorage.setItem('xdrive.files.view_mode', viewMode);
        if (galleryDensity) localStorage.setItem('xdrive.gallery.view-preferences.v1', JSON.stringify({ timeScale: 'all', densityByScale: { all: galleryDensity } }));
      }, { role, origin, viewMode, galleryDensity });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
        const key = `${scenarioLabel} ${request.method()} ${url.pathname}${url.search}`;
        result.requests[key] = (result.requests[key] || 0) + 1;
        try {
          assert.equal(url.origin, origin, 'App attempted an external network request');
          if (metadataGate && request.method() === 'GET' && metadataGate.paths.includes(url.pathname)) {
            const gate = metadataGate;
            queryOnly(url, []);
            gate.hits += 1;
            await gate.wait;
            expectedConsoleURLs.add(request.url());
            result.expectedApiErrors.push({ request: key, status: 404, purpose: 'viewer metadata loading/error layout' });
            await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'QA metadata unavailable' }) });
            return;
          }
          const body = fixtureFor(request, role);
          await route.fulfill({ status: 200, contentType: Buffer.isBuffer(body) ? 'image/png' : 'application/json', body: Buffer.isBuffer(body) ? body : JSON.stringify(body) });
        } catch (error) {
          result.unknownRequests.push({ stage: activeStage, request: key, message: error.message });
          await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: error.message }) });
        }
      });
      await loadFiles(context, origin, role);
      if (galleryDensity) {
        await navigateWorkspace('图库', 'gallery');
        await page.locator('[data-xdrive-media-tile]').first().waitFor();
        await galleryOverlayAcceptance(role, galleryDensity);
      } else if (options.scenario === 'fullscreen') await fullscreenAcceptance(role);
      else if (searchReturnScenario) await searchReturnAcceptance();
      else if (viewMode) await inheritedColumnsAcceptance();
      else {
        await filesAcceptance(role);
        if (options.scenario !== 'smoke') {
          await moreLifecycle(role);
          await galleryAcceptance(role);
        }
      }
      // Each case owns a browser. Closing it also closes the context, without
      // the separate context-disposal stall in portable single-process Chromium.
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
    console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, failures: result.failures.map(({ stage, message }) => ({ stage, message })), unknownRequests: result.unknownRequests, outputDir }, null, 2));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
