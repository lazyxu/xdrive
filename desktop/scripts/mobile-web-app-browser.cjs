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
if (options.scenario && !['smoke', 'all', 'inherited-columns', 'fullscreen', 'search-return', 'files-operations', 'files-organization', 'files-touch-drag', 'mobile-panels', 'gallery-selection', 'gallery-ios27-chrome', 'files-ios27-chrome'].includes(options.scenario)) throw new Error('Use --scenario=smoke, all, inherited-columns, fullscreen, search-return, files-operations, files-organization, files-touch-drag, mobile-panels, gallery-selection, gallery-ios27-chrome, or files-ios27-chrome.');
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
const filesOperationsScenario = options.scenario === 'files-operations';
const filesOrganizationScenario = options.scenario === 'files-organization';
const filesTouchDragScenario = options.scenario === 'files-touch-drag';
if (filesTouchDragScenario) rootChildren.push(makeNode(3, '触控目标甲', 1, 'dir'), makeNode(4, '触控目标乙', 1, 'dir'));
const touchFixture = { quickOrder: [2, 3, 4], savedOrder: [17, 18, 19], quickWrites: [], savedWrites: [] };
const mobilePanelsScenario = options.scenario === 'mobile-panels';
const gallerySelectionScenario = options.scenario === 'gallery-selection';
const galleryIos27ChromeScenario = options.scenario === 'gallery-ios27-chrome';
const filesIos27ChromeScenario = options.scenario === 'files-ios27-chrome';
const filesIos27Fixture = { accepted: [], operations: [] };
const gallerySelectionFixture = {
  albums: [...Array.from({ length: 24 }, (_, index) => ({
    id: `qa-album-${index + 1}`, name: index === 0 ? '验收家庭相册' : `验收相册 ${String(index + 1).padStart(2, '0')} 长名称仍应完整可读`,
    kind: 'manual', revision: index + 7, item_count: index + 2, created_at: stamp, updated_at: stamp,
  })), { id: 'qa-smart-album', name: '验收智能相册', kind: 'smart', revision: 4, item_count: 12, query: { favorite: true }, created_at: stamp, updated_at: stamp }],
  attempts: [], accepted: [], rejectNext: true,
};
let operationFixture = { operations: [], creates: [], renames: [], continuations: [], cancellations: [], rejectRename: true };
const organizationFixture = { tags: [], savedSearches: [], tagCreates: [], savedCreates: [], assignments: [], tagQueries: [], assignedNodeIDs: new Set(), rejectTagRead: true };
const mediaItems = Array.from({ length: searchReturnScenario ? 1024 : (filesOrganizationScenario || gallerySelectionScenario) ? 24 : 240 }, (_, index) => ({
  node: makeNode(1000 + index, `photo-${String(index + 1).padStart(searchReturnScenario ? 4 : 3, '0')}.png`, searchReturnScenario || filesOrganizationScenario ? 2 : 1),
  metadata: { media_kind: 'image', mime_type: 'image/png', width: 80, height: 80, captured_at: stamp,
    index_state: 'ready', has_thumbnail: true, thumbnail_mime_type: 'image/png', thumbnail_width: 80, thumbnail_height: 80 },
  favorite: false, tags: [], people: [],
}));
const mediaByID = new Map(mediaItems.map((item) => [item.node.id, item]));
// One image in the real Files API enables the actual Quick Look caller route.
if (options.scenario === 'fullscreen') rootChildren.push(mediaItems[0].node);
if (searchReturnScenario || filesOrganizationScenario) folderChildren.push(...mediaItems.map((item) => item.node));
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
      queryOnly(url, ['limit']); integerQuery(url, 'limit', 100, 200); return filesIos27ChromeScenario ? filesIos27Fixture.operations : filesOperationsScenario || filesTouchDragScenario ? operationFixture.operations : [];
    case 'POST /api/v1/file-operations': {
      if (filesIos27ChromeScenario) {
        queryOnly(url, []);
        const body = jsonBody(request);
        assert.deepEqual(Object.keys(body).sort(), ['items', 'parent_id', 'type']);
        assert.equal(body.type, 'copy');
        assert.equal(body.parent_id, 1, 'both viewports paste into the same authenticated cloud root');
        assert.deepEqual(body.items, [{ id: 100, revision: 1 }]);
        filesIos27Fixture.accepted.push(body);
        const operation = {
          id: `qa-files-copy-${filesIos27Fixture.accepted.length}`,
          type: 'copy', parent_id: 1, status: 'queued', conflict_policy: 'fail',
          total_items: 1, processed_items: 0, total_bytes: 4096, processed_bytes: 0,
          percent: 0, retryable: false, created_at: stamp, updated_at: stamp,
        };
        filesIos27Fixture.operations.unshift(operation);
        return operation;
      }
      assert(filesOperationsScenario || filesTouchDragScenario, 'File-operation writes belong to the explicit operation/drag scenarios');
      queryOnly(url, []);
      const body = jsonBody(request);
      assert.deepEqual(Object.keys(body).sort(), ['items', 'parent_id', 'type']);
      assert.equal(body.type, filesTouchDragScenario ? 'move' : 'copy');
      assert.equal(body.parent_id, 2);
      assert.deepEqual(body.items, [{ id: 100, revision: filesTouchDragScenario ? 1 : 2 }, { id: 101, revision: 1 }]);
      operationFixture.creates.push(body);
      const operation = { id: filesTouchDragScenario ? 'qa-touch-move-1' : 'qa-copy-1', type: body.type, parent_id: body.parent_id, status: 'queued',
        conflict_policy: 'fail', total_items: body.items.length, processed_items: 0, total_bytes: 8192,
        processed_bytes: 0, percent: 0, retryable: false, created_at: stamp, updated_at: stamp };
      operationFixture.operations = [operation];
      return operation;
    }
    case 'GET /api/v1/changes':
      queryOnly(url, ['after', 'limit']); integerQuery(url, 'after', 0, 100); integerQuery(url, 'limit', 200, 1000);
      return { changes: [], next_cursor: 1, latest_cursor: 1, has_more: false, reset_required: false };
    case 'GET /api/v1/file-quick-access': return plain(filesTouchDragScenario ? touchFixture.quickOrder.map((id, position) => ({ node: allNodes.get(id), path: `我的文件/${allNodes.get(id).name}`, crumbs: [rootNode, allNodes.get(id)], position, created_at: stamp, updated_at: stamp })) : []);
    case 'PUT /api/v1/file-quick-access/order': {
      assert(filesTouchDragScenario); queryOnly(url, []);
      const body = jsonBody(request); assert.deepEqual(Object.keys(body), ['node_ids']);
      assert.deepEqual([...body.node_ids].sort((a, b) => a - b), [2, 3, 4]);
      touchFixture.quickWrites.push(body); touchFixture.quickOrder = [...body.node_ids]; return {};
    }
    case 'GET /api/v1/file-tags':
      if (filesOrganizationScenario) {
        queryOnly(url, []);
        if (organizationFixture.rejectTagRead) return { __fixtureStatus: 503, __fixturePurpose: 'organization read fails before explicit retry', __fixtureBody: { error: '标签目录暂时不可用，请重试。' } };
        return organizationFixture.tags;
      }
      return plain([]);
    case 'POST /api/v1/file-tags': {
      assert(filesOrganizationScenario, 'Tag writes belong to the organization scenario');
      queryOnly(url, []);
      const body = jsonBody(request);
      assert.deepEqual(Object.keys(body).sort(), ['color', 'name']);
      assert.equal(body.name, '旅行'); assert.equal(body.color, '#6B7280');
      organizationFixture.tagCreates.push(body);
      const tag = { id: 7, ...body, item_count: 0, created_at: stamp, updated_at: stamp };
      organizationFixture.tags = [tag];
      return tag;
    }
    case 'GET /api/v1/file-saved-searches': return plain(filesTouchDragScenario ? touchFixture.savedOrder.map((id, position) => ({ id, name: `触控搜索${id}`, query: `document-${id}`, filters: {}, position, created_at: stamp, updated_at: stamp })) : filesOrganizationScenario ? organizationFixture.savedSearches : []);
    case 'PUT /api/v1/file-saved-searches/order': {
      assert(filesTouchDragScenario); queryOnly(url, []);
      const body = jsonBody(request); assert.deepEqual(Object.keys(body), ['ids']);
      assert.deepEqual([...body.ids].sort((a, b) => a - b), [17, 18, 19]);
      touchFixture.savedWrites.push(body); touchFixture.savedOrder = [...body.ids]; return {};
    }
    case 'POST /api/v1/file-saved-searches': {
      assert(filesOrganizationScenario, 'Saved-search writes belong to the organization scenario');
      queryOnly(url, []);
      const body = jsonBody(request);
      assert.deepEqual(body, { name: '图片搜索', query: 'photo', filters: { kind: 'image' } });
      organizationFixture.savedCreates.push(body);
      const saved = { id: 17, ...body, position: 0, created_at: stamp, updated_at: stamp };
      organizationFixture.savedSearches = [saved];
      return saved;
    }
    case 'PUT /api/v1/file-tags/7/nodes':
    case 'DELETE /api/v1/file-tags/7/nodes': {
      assert(filesOrganizationScenario, 'Assignments belong to the organization scenario');
      queryOnly(url, []);
      const body = jsonBody(request);
      assert.deepEqual(body, { node_ids: [100] });
      const assigned = request.method() === 'PUT';
      if (assigned) organizationFixture.assignedNodeIDs.add(100);
      else organizationFixture.assignedNodeIDs.delete(100);
      organizationFixture.tags[0].item_count = organizationFixture.assignedNodeIDs.size;
      organizationFixture.assignments.push({ assigned, nodeIDs: body.node_ids });
      return { updated: 1 };
    }
    case 'GET /api/v1/file-favorites': return plain([]);
    case 'GET /api/v1/trash': {
      assert(filesOrganizationScenario, 'Trash inspection belongs to the explicit organization scenario');
      queryOnly(url, ['range', 'offset', 'limit', 'sort', 'order', 'include_count']);
      assert.equal(url.searchParams.get('range'), 'true');
      assert.equal(url.searchParams.get('sort'), 'name'); assert.equal(url.searchParams.get('order'), 'asc');
      const offset = integerQuery(url, 'offset', 0, 0);
      const limit = integerQuery(url, 'limit', 200, 500);
      return { items: [], total_count: 0, offset, limit, sort: 'name', order: 'asc' };
    }
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
      if (filesOrganizationScenario || mobilePanelsScenario) {
        queryOnly(url, ['q', 'offset', 'limit', 'sort', 'order', 'kind', 'tag_id', 'group', 'folders_first']);
        const query = url.searchParams.get('q') || '';
        assert(['photo', 'invoice', ''].includes(query));
        assert.equal(url.searchParams.get('sort'), 'name'); assert.equal(url.searchParams.get('order'), 'asc');
        assert([null, 'image'].includes(url.searchParams.get('kind')));
        assert([null, '7'].includes(url.searchParams.get('tag_id')));
        const nodes = query === 'photo' ? mediaItems.map(({ node }) => node) : [];
        const offset = integerQuery(url, 'offset', 0, nodes.length);
        const limit = integerQuery(url, 'limit', 200, 200);
        assert(limit > 0);
        return { items: nodes.slice(offset, offset + limit).map((node) => ({ node, path: `/验收目录/${node.name}`, breadcrumbs: [rootNode, childFolder] })), total_count: nodes.length, offset, limit, sort: 'name', order: 'asc', groups: [] };
      }
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
      if (filesOrganizationScenario) {
        organizationFixture.tagQueries.push(body.node_ids);
        return body.node_ids.map((nodeID) => ({ node_id: nodeID, tags: organizationFixture.assignedNodeIDs.has(nodeID) ? organizationFixture.tags : null }));
      }
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
      queryOnly(url, [
        'range', 'limit', 'offset', 'sort_by', 'sort_dir', 'time_zone',
        ...(mobilePanelsScenario ? ['tag'] : []),
        ...(galleryIos27ChromeScenario ? ['initial_position', 'unknown_first', 'anchor_node_id'] : []),
      ]);
      if (mobilePanelsScenario && url.searchParams.has('tag')) assert.equal(url.searchParams.get('tag'), '面板验收');
      assert.equal(url.searchParams.get('sort_by') || 'captured', 'captured');
      if (galleryIos27ChromeScenario) {
        // Current Mobile Library defaults to ascending captured time with the
        // newest range initially at the bottom; this is not legacy desktop desc.
        const direction = url.searchParams.get('sort_dir') || 'asc';
        assert(['asc', 'desc'].includes(direction),
          'mobile and wide Web share the Server sort direction contract');
        if (url.searchParams.has('initial_position')) {
          assert.equal(direction, 'asc', 'latest-at-bottom requires ascending sort');
        }
        if (url.searchParams.has('unknown_first')) {
          assert.equal(url.searchParams.get('unknown_first'), 'true');
        }
      } else {
        assert.equal(url.searchParams.get('sort_dir') || 'desc', 'desc');
      }
      assert.equal(url.searchParams.get('time_zone') || 'UTC', 'UTC');
      const limit = integerQuery(url, 'limit', 200, 500);
      const latest = galleryIos27ChromeScenario && url.searchParams.has('initial_position');
      if (latest) assert.equal(url.searchParams.get('initial_position'), 'latest');
      const anchorRaw = galleryIos27ChromeScenario ? url.searchParams.get('anchor_node_id') : null;
      let anchorIndex = null;
      if (anchorRaw !== null) {
        assert.match(anchorRaw, /^[1-9]\d*$/, 'explicit anchor must be a positive canonical Node ID');
        anchorIndex = mediaItems.findIndex(item => item.node.id === Number(anchorRaw));
        assert(anchorIndex >= 0, 'anchor must resolve within the authorized fixture range');
        assert(!latest, 'initial_position and explicit anchor cannot both choose the initial position');
      }
      // P0-B Server range uses the final page-aligned offset and an absolute
      // last-index anchor, rather than walking all preceding sparse pages.
      const offset = latest && mediaItems.length
        ? Math.floor((mediaItems.length - 1) / limit) * limit
        : integerQuery(url, 'offset', 0, mediaItems.length);
      const items = mediaItems.slice(offset, offset + limit);
      if (!url.searchParams.has('range')) return items;
      assert.equal(url.searchParams.get('range'), 'true');
      const group = (key) => [{ key, item_count: mediaItems.length, start_index: 0 }];
      return { items, total_count: mediaItems.length, offset, limit,
        ...(latest ? { anchor_index: mediaItems.length - 1 }
          : anchorIndex !== null ? { anchor_index: anchorIndex } : {}),
        timeline_group_sets: { year: group('2026'), month: group('2026-10'), day: group('2026-10-08') } };
    }
    case 'GET /api/v1/media/facets':
      queryOnly(url, mobilePanelsScenario ? ['tag'] : []);
      if (mobilePanelsScenario && url.searchParams.has('tag')) assert.equal(url.searchParams.get('tag'), '面板验收');
      return { cameras: [], formats: [{ value: 'png', label: 'PNG', item_count: mediaItems.length }] };
    case 'GET /api/v1/media/memories': {
      assert(galleryIos27ChromeScenario, 'Memories preview belongs to iOS27 Collections fixture');
      queryOnly(url, ['limit', 'time_zone', 'anchor_date']);
      assert.equal(integerQuery(url, 'limit', 8, 100), 8);
      assert.equal(url.searchParams.get('time_zone'), 'UTC');
      assert.match(url.searchParams.get('anchor_date') || '', /^\d{4}-\d{2}-\d{2}$/);
      return [];
    }
    case 'GET /api/v1/media/sync-folders':
      assert(galleryIos27ChromeScenario, 'Sync folder overview belongs to iOS27 Collections fixture');
      return plain([]);
    case 'GET /api/v1/media/albums': return plain(gallerySelectionScenario ? gallerySelectionFixture.albums : []);
    case 'GET /api/v1/media/pets': return plain([]);
    case 'GET /api/v1/media/places':
      queryOnly(url, ['limit']); integerQuery(url, 'limit', 24, 1000); return [];
    case 'GET /api/v1/media/people/suggestions':
      queryOnly(url, ['include_reviewed', 'limit']); assert.equal(url.searchParams.get('include_reviewed'), 'true'); integerQuery(url, 'limit', 100, 100); return [];
    case 'GET /api/v1/media/people/identities':
      queryOnly(url, ['include_hidden', 'offset', 'limit']); assert.equal(url.searchParams.get('include_hidden'), 'true');
      integerQuery(url, 'offset', 0, 0); integerQuery(url, 'limit', 100, 100); return [];
  }
  if (gallerySelectionScenario && key === 'POST /api/v1/media/albums/qa-album-24/items') {
    queryOnly(url, []);
    const album = gallerySelectionFixture.albums.find((item) => item.id === 'qa-album-24');
    const body = jsonBody(request);
    assert.deepEqual(Object.keys(body), ['node_ids']);
    assert.deepEqual(body.node_ids, [1000, 1001, 1002]);
    assert.equal(request.headers()['if-match'], `"${album.revision}"`);
    const attempt = { albumID: album.id, node_ids: body.node_ids, ifMatch: request.headers()['if-match'], status: gallerySelectionFixture.rejectNext ? 403 : 200 };
    gallerySelectionFixture.attempts.push(attempt);
    if (gallerySelectionFixture.rejectNext) {
      gallerySelectionFixture.rejectNext = false;
      return { __fixtureStatus: 403, __fixturePurpose: 'one actual album assignment is refused before explicit retry', __fixtureBody: { error: '验收：相册暂时不可写，请重试。' } };
    }
    gallerySelectionFixture.accepted.push(attempt);
    Object.assign(album, { revision: album.revision + 1, item_count: album.item_count + body.node_ids.length });
    return album;
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
  if (filesOperationsScenario && key === 'PATCH /api/v1/nodes/100') {
    queryOnly(url, []);
    const body = jsonBody(request), node = allNodes.get(100);
    assert.deepEqual(Object.keys(body), ['name']);
    assert.equal(request.headers()['if-match'], `"${node.revision}"`);
    operationFixture.renames.push({ ...body, ifMatch: request.headers()['if-match'] });
    if (operationFixture.rejectRename) {
      operationFixture.rejectRename = false;
      return { __fixtureStatus: 409, __fixtureBody: { error: '验收：此名称已存在，请更改名称后重试。' } };
    }
    Object.assign(node, { name: body.name, revision: node.revision + 1 });
    return node;
  }
  match = /^GET \/api\/v1\/file-operations\/(qa-files-copy-\d+)$/.exec(key);
  if (filesIos27ChromeScenario && match) {
    queryOnly(url, []);
    const found = filesIos27Fixture.operations.find(operation => operation.id === match[1]);
    assert(found, 'Read must use a real accepted Files operation ID');
    return found;
  }
  match = /^GET \/api\/v1\/file-operations\/(qa-copy-\d+)$/.exec(key);
  if (filesOperationsScenario && match) {
    queryOnly(url, []);
    const operation = operationFixture.operations.find((candidate) => candidate.id === match[1]);
    assert(operation, 'Read must reference an actually accepted operation');
    return operation;
  }
  match = /^POST \/api\/v1\/file-operations\/(qa-copy-\d+)\/(resolve|cancel)$/.exec(key);
  if (filesOperationsScenario && match) {
    queryOnly(url, []);
    const operation = operationFixture.operations.find((candidate) => candidate.id === match[1]);
    assert(operation, 'Action must reference an actually accepted operation');
    if (match[2] === 'resolve') {
      assert.equal(operation.status, 'failed');
      assert.equal(operation.failure_code, 'name_conflict');
      assert.deepEqual(jsonBody(request), { conflict_policy: 'keep_both' });
      operationFixture.continuations.push({ id: operation.id, ...jsonBody(request) });
      const continuation = { ...operation, id: 'qa-copy-2', status: 'queued', conflict_policy: 'keep_both', retry_of_id: operation.id,
        error: undefined, failure_code: undefined, failed_item_id: undefined, current_item: undefined };
      operationFixture.operations = [continuation, ...operationFixture.operations];
      return continuation;
    }
    assert.deepEqual(jsonBody(request), {});
    operationFixture.cancellations.push(operation.id);
    Object.assign(operation, { status: 'cancel_requested', cancel_requested_at: stamp });
    return operation;
  }
  match = /^GET \/api\/v1\/nodes\/(\d+)$/.exec(key);
  if (match && allNodes.has(Number(match[1]))) return plain(allNodes.get(Number(match[1])));
  match = /^POST \/api\/v1\/file-recent\/(\d+)$/.exec(key);
  if (match && allNodes.has(Number(match[1]))) { queryOnly(url, []); assert.deepEqual(jsonBody(request), {}); return recentItem(allNodes.get(Number(match[1]))); }
  match = /^GET \/api\/v1\/media\/items\/(\d+)$/.exec(key);
  if (match && mediaByID.has(Number(match[1]))) return plain(mediaByID.get(Number(match[1])));
  match = /^GET \/api\/v1\/media\/items\/(\d+)\/thumbnail$/.exec(key);
  if (match && mediaByID.has(Number(match[1]))) {
    queryOnly(url, galleryIos27ChromeScenario ? ['v', 'revision'] : ['v']);
    // The real Go Server selects transparent-capable PNG v4 cache keys,
    // while ordinary JPEG retains v3. Do not resurrect a stale global v3
    // fixture or waive unknown-request auditing to make Chrome appear green.
    const sourceMIME = mediaByID.get(Number(match[1])).metadata.mime_type;
    const expectedVersion = sourceMIME === 'image/png' ? '4' : '3';
    assert.equal(url.searchParams.get('v'), expectedVersion,
      'thumbnail URL version must match the fixture source MIME');
    if (url.searchParams.has('revision')) {
      assert.equal(url.searchParams.get('revision'),
        String(mediaByID.get(Number(match[1])).node.revision),
        'thumbnail revision must match the fixture node revision');
    }
    return imagePNG;
  }
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
  if (!passed && (options.scenario === 'fullscreen' || searchReturnScenario || filesOperationsScenario || filesOrganizationScenario || filesTouchDragScenario || mobilePanelsScenario || gallerySelectionScenario || galleryIos27ChromeScenario || filesIos27ChromeScenario)) {
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
      appFrame: bounds(document.querySelector('[data-xdrive-mobile-app-frame]')),
      appHeader: bounds(document.querySelector('[data-xdrive-mobile-app-header]')),
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
    check(`${name}: app Frame fills the entire viewport`, sample.appFrame && Math.abs(sample.appFrame.x) <= 1 && Math.abs(sample.appFrame.y) <= 1 && Math.abs(sample.appFrame.width - sample.viewport.width) <= 1 && Math.abs(sample.appFrame.height - sample.viewport.height) <= 1, sample.appFrame);
    check(`${name}: App title is in flow above main`, sample.appHeader && Math.abs(sample.appHeader.y) <= 1 && Math.abs(sample.main.y - sample.appHeader.bottom) <= 1 && Math.abs(sample.main.bottom - sample.viewport.height) <= 1 && sample.appHeader.height >= 52, { header: sample.appHeader, main: sample.main });
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
    if (expectedConsoleURLs.has(entry.url) && /Failed to load resource:.*(?:403|404|409|503)/.test(entry.message)) result.expectedConsoleErrors.push(entry);
    else result.consoleErrors.push(entry);
  });
  await page.goto(`${origin}/#/app/files`, { waitUntil: 'domcontentloaded' });
  // Mobile Files now has an independent presentation without the wide tile's
  // data selector. Gallery-only acceptance needs to wait for visible data, not
  // assert a Files-specific DOM implementation detail.
  if (filesIos27ChromeScenario) {
    await page.locator('[data-xdrive-mobile-files]').waitFor();
  } else if (galleryIos27ChromeScenario) {
    await page.getByText('document-001.txt', { exact: true }).first().waitFor();
  } else {
    await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'document-001.txt' }).waitFor();
  }
  await settle();
}
async function longPressItem(locator) {
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const options = { bubbles: true, cancelable: true, pointerId: 701, pointerType: 'touch',
    isPrimary: true, button: 0, clientX: point.x, clientY: point.y };
  await locator.dispatchEvent('pointerdown', options);
  await page.waitForTimeout(500);
  await locator.dispatchEvent('pointerup', options);
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
    else if (portal === 'transfers') {
      await page.getByRole('button', { name: '关闭应用导航', exact: true }).click();
      await page.getByRole('button', { name: /^上传与下载/ }).click();
    }
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
  check(`${activeStage}: no per-item More`, await page.locator('[data-xdrive-file-explorer-item-more]').count() === 0);
  await longPressItem(folder);
  await page.locator('[data-xdrive-file-explorer-touch-action-sheet]').waitFor();
  check(`${activeStage}: item opens action sheet`, await page.getByRole('button', { name: '关闭文件操作', exact: true }).isVisible());
  await page.getByRole('button', { name: '关闭文件操作', exact: true }).tap();
  await page.locator('[data-xdrive-file-explorer-touch-action-sheet]').waitFor({ state: 'hidden' });
  const rootURL = page.url();
  await page.getByRole('button', { name: '选择', exact: true }).tap();
  await folder.tap();
  await firstFile.tap();
  check(`${activeStage}: taps select two without opening`, page.url() === rootURL && await page.locator('[data-xdrive-file-explorer-item][aria-selected="true"]').count() === 2 && await page.getByRole('button', { name: '复制所选项目', exact: true }).isEnabled());
  await page.getByRole('button', { name: '完成选择', exact: true }).tap();
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

// Actual built Web adapter and App composition, including the real REST payloads
// and Task Center route. The controlled service never writes user data.
async function filesOperationsAcceptance(role) {
  activeStage = `${role}-operations-setup`;
  if (role === 'admin') {
    await navigateWorkspace('全局任务', 'tasks');
    check(`${activeStage}: administrator starts from global task scope`, /scope=global/.test(page.url()));
    await navigateWorkspace('文件', 'files');
  }
  const firstName = 'document-001.txt';
  await longPressItem(page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: firstName }));
  await page.getByRole('button', { name: '重命名', exact: true }).tap();
  const rename = page.getByRole('dialog', { name: /^重命名/ });
  await rename.waitFor();
  activeStage = `${role}-operations-rename-error-retry`;
  await rename.getByRole('textbox').fill('重命名验收.txt');
  await rename.getByRole('button', { name: '保存', exact: true }).tap();
  await rename.getByText('验收：此名称已存在，请更改名称后重试。', { exact: true }).waitFor();
  check(`${activeStage}: actual API rejection retains the entered name`, await rename.getByRole('textbox').inputValue() === '重命名验收.txt');
  check(`${activeStage}: rename submits the original revision`, operationFixture.renames.length === 1 && operationFixture.renames[0].ifMatch === '"1"', operationFixture.renames);
  await rename.getByRole('button', { name: '保存', exact: true }).tap();
  await rename.waitFor({ state: 'hidden' });
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '重命名验收.txt' }).waitFor();
  check(`${activeStage}: retry uses one request and refreshes the real Files row`, operationFixture.renames.length === 2 && allNodes.get(100).revision === 2, operationFixture.renames);
  const finish = page.getByRole('button', { name: '完成选择', exact: true });
  if (await finish.isVisible()) await finish.tap();
  await page.getByRole('button', { name: '选择', exact: true }).tap();
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '重命名验收.txt' }).tap();
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'document-002.txt' }).tap();
  await page.getByText('已选择 2 项', { exact: true }).waitFor();
  const sourceURL = page.url(), sourceHistory = await page.evaluate(() => history.length);
  await page.evaluate(() => { window.__mobileQaOperationIdentity = { files: document.querySelector('[data-xdrive-file-explorer]'), scroll: document.querySelector('[data-xdrive-file-explorer-scroll-host]') }; });
  const sourceUnchanged = () => page.evaluate(({ sourceURL, sourceHistory }) =>
    location.href === sourceURL && history.length === sourceHistory &&
    window.__mobileQaOperationIdentity.files === document.querySelector('[data-xdrive-file-explorer]') &&
    window.__mobileQaOperationIdentity.scroll === document.querySelector('[data-xdrive-file-explorer-scroll-host]'), { sourceURL, sourceHistory });
  activeStage = `${role}-operations-move-cancel`;
  await page.getByRole('button', { name: '移动到…', exact: true }).tap();
  const move = page.getByRole('dialog', { name: /^移动到文件夹/ });
  await move.getByRole('button', { name: '打开文件夹 验收目录', exact: true }).waitFor();
  check(`${activeStage}: same-parent move is explained and blocked`, await move.getByRole('button', { name: '移动到这里', exact: true }).isDisabled() && /已在此文件夹/.test(await move.innerText()));
  await move.getByRole('button', { name: '取消', exact: true }).tap();
  await move.waitFor({ state: 'hidden' });
  check(`${activeStage}: cancelling does not submit or navigate Files`, operationFixture.creates.length === 0 && await sourceUnchanged());

  activeStage = `${role}-operations-copy-target`;
  await page.getByRole('button', { name: '复制到…', exact: true }).tap();
  const copy = page.getByRole('dialog', { name: /^复制到文件夹/ });
  await copy.getByRole('button', { name: '打开文件夹 验收目录', exact: true }).tap();
  await copy.getByText('此位置没有子文件夹。', { exact: true }).waitFor();
  check(`${activeStage}: target path is authoritative`, /我的文件.*验收目录/.test(await copy.locator('[data-xdrive-file-explorer-destination-path]').innerText()));
  check(`${activeStage}: browsing target preserves Files URL, history and mounted scroll owner`, await sourceUnchanged());
  await copy.getByRole('button', { name: '复制到这里', exact: true }).tap();
  await copy.waitFor({ state: 'hidden' });
  check(`${activeStage}: submits the entire selected immutable revision snapshot once`, operationFixture.creates.length === 1, operationFixture.creates);
  const feedback = page.locator('[data-xdrive-file-explorer-action-feedback]');
  await feedback.getByRole('button', { name: '查看任务', exact: true }).waitFor();
  check(`${activeStage}: accepted task feedback remains inside Files`, /复制/.test(await feedback.innerText()) && await sourceUnchanged());

  activeStage = `${role}-operations-task-focus-and-conflict`;
  Object.assign(operationFixture.operations[0], { status: 'failed', failure_code: 'name_conflict',
    error: '目标已有同名文件，整个复制操作没有提交。', current_item: '重命名验收.txt', failed_item_id: 100,
    updated_at: '2026-10-08T12:00:01Z' });
  await feedback.getByRole('button', { name: '查看任务', exact: true }).tap();
  await page.waitForURL(/\/tasks\?scope=mine$/);
  const predecessor = page.locator('[data-xdrive-file-operation-id="qa-copy-1"]');
  await predecessor.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-xdrive-file-operation-id') === 'qa-copy-1');
  check(`${activeStage}: View Task opens owner scope and focuses its actual operation row`, /scope=mine/.test(page.url()) && await predecessor.evaluate((element) => document.activeElement === element));
  await predecessor.getByRole('button', { name: '保留两者', exact: true }).waitFor();
  await predecessor.getByRole('button', { name: '保留两者', exact: true }).tap();
  const continuation = page.locator('[data-xdrive-file-operation-id="qa-copy-2"]');
  await continuation.waitFor();
  check(`${activeStage}: conflict action uses the real continuation endpoint once`, operationFixture.continuations.length === 1 && operationFixture.continuations[0].conflict_policy === 'keep_both', operationFixture.continuations);
  check(`${activeStage}: predecessor cannot repeat conflict resolution`, await predecessor.getByRole('button', { name: '保留两者', exact: true }).count() === 0);
  activeStage = `${role}-operations-cancel-continuation`;
  await continuation.getByRole('button', { name: '取消', exact: true }).tap();
  await continuation.getByText('正在取消', { exact: true }).first().waitFor();
  check(`${activeStage}: cancellation refers to the continuation, not its predecessor`, JSON.stringify(operationFixture.cancellations) === JSON.stringify(['qa-copy-2']), operationFixture.cancellations);
  Object.assign(operationFixture.operations.find((operation) => operation.id === 'qa-copy-2'), { status: 'cancelled', updated_at: '2026-10-08T12:00:04Z' });
  await continuation.getByText('已取消', { exact: true }).first().waitFor();
  check(`${activeStage}: final cancelled status comes from the service`, true);
  await geometry(`${role}-operations-task-viewport`);
  await navigateWorkspace('文件', 'files');
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '重命名验收.txt' }).waitFor();
  check(`${activeStage}: returning reaches the source folder and refreshed file`, page.url() === sourceURL);
  await geometry(`${role}-operations-files-return`);
  activeStage = `${role}-operations-ordinary-task-reopen`;
  await page.evaluate(() => {
    window.__mobileQaOperationFocusEvents = [];
    window.__mobileQaOperationFocusListener = (event) => {
      const id = event.target?.getAttribute?.('data-xdrive-file-operation-id');
      if (id) window.__mobileQaOperationFocusEvents.push(id);
    };
    document.addEventListener('focusin', window.__mobileQaOperationFocusListener);
  });
  await navigateWorkspace('任务', 'tasks');
  await predecessor.waitFor();
  await settle();
  const replayedFocus = await page.evaluate(() => {
    document.removeEventListener('focusin', window.__mobileQaOperationFocusListener);
    return window.__mobileQaOperationFocusEvents;
  });
  check(`${activeStage}: ordinary navigation does not replay a consumed Files focus request`, replayedFocus.length === 0, replayedFocus);
  result.samples[`${role}-operation-payloads`] = JSON.parse(JSON.stringify(operationFixture));
}

async function filesTouchDragAcceptance() {
  const session = await page.context().newCDPSession(page);
  const send = (type, point) => session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : [] });
  const center = async (locator, fraction = 0.5) => {
    const rect = await locator.boundingBox();
    assert(rect && rect.width > 0 && rect.height > 0, 'The actual gesture target is laid out');
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height * fraction };
  };
  const drag = async (handle, target, hold) => {
    const start = await center(handle), end = await center(target, 0.25);
    await send('touchStart', start);
    for (let step = 1; step <= 8; step += 1) {
      await send('touchMove', { x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 });
      await settle();
    }
    await hold?.();
    await send('touchEnd'); await settle();
  };
  activeStage = 'user-touch-drag-files';
  const files = page.locator('[data-xdrive-file-explorer]');
  const sourceURL = page.url(), sourceHistory = await page.evaluate(() => history.length);
  await page.evaluate(() => { window.__touchDragCaller = { files: document.querySelector('[data-xdrive-file-explorer]'), scroll: document.querySelector('[data-xdrive-file-explorer-scroll-host]') }; });
  const callerRetained = () => page.evaluate(({ sourceURL, sourceHistory }) => location.href === sourceURL && history.length === sourceHistory && window.__touchDragCaller.files === document.querySelector('[data-xdrive-file-explorer]') && window.__touchDragCaller.scroll === document.querySelector('[data-xdrive-file-explorer-scroll-host]'), { sourceURL, sourceHistory });
  await page.getByRole('button', { name: '选择', exact: true }).tap();
  for (const name of ['document-001.txt', 'document-002.txt']) await files.locator('[data-xdrive-file-explorer-item]').filter({ hasText: name }).tap();
  await page.getByText('已选择 2 项', { exact: true }).waitFor();
  const handle = files.getByRole('button', { name: '拖动所选项目', exact: true });
  const hasHandle = await handle.count() === 1;
  check(`${activeStage}: actual App exposes the selected-items touch handle`, hasHandle);
  if (hasHandle) {
    const size = await handle.boundingBox();
    check(`${activeStage}: real handle target is at least44px`, size.width >= 44 && size.height >= 44, size);
    const folder = files.locator('[data-xdrive-file-explorer-item]').filter({ hasText: '验收目录' });
    const moved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/file-operations');
    await drag(handle, folder, async () => {
      check(`${activeStage}: actual accepted folder target is highlighted`, await files.locator('[data-xdrive-file-explorer-drop-target]').count() === 1);
    });
    check(`${activeStage}: the controlled operation endpoint accepts the actual write`, (await moved).status() === 200);
    await page.waitForFunction(() => document.querySelector('[data-xdrive-file-explorer-action-feedback]')?.textContent.includes('查看任务'));
    check(`${activeStage}: actual API receives one complete revision-preserving move`, operationFixture.creates.length === 1 && operationFixture.creates[0].type === 'move', operationFixture.creates);
    check(`${activeStage}: release retains Files history and mounted scroll owner`, await callerRetained());
    check(`${activeStage}: release creates no extra dialog or surviving drag target`, await page.getByRole('dialog').count() === 0 && await files.locator('[data-xdrive-file-explorer-drop-target]').count() === 0);
  }
  const finish = page.getByRole('button', { name: '完成选择', exact: true });
  if (await finish.isVisible()) await finish.tap();
  activeStage = 'user-touch-drag-sidebar';
  await page.getByRole('button', { name: '位置', exact: true }).tap();
  const drawer = page.locator('[data-xdrive-file-explorer-touch-navigation-drawer]');
  await drawer.waitFor();
  for (const entry of [
    { section: 'quickAccess', source: 4, first: 2, expected: [4, 2, 3], writes: 'quickWrites', order: 'quickOrder', field: 'node_ids' },
    { section: 'savedSearches', source: 18, first: 17, expected: [18, 17, 19], writes: 'savedWrites', order: 'savedOrder', field: 'ids' },
  ]) {
    const row = id => drawer.locator(`[data-xdrive-sidebar-order-section="${entry.section}"][data-xdrive-sidebar-order-id="${id}"]`);
    const source = row(entry.source).locator('[data-xdrive-sidebar-order-handle]');
    const present = await source.count() === 1;
    check(`${activeStage}-${entry.section}: actual adapter exposes a reorder handle`, present);
    if (!present) continue;
    await source.scrollIntoViewIfNeeded();
    // Both rows are adjacent or within the same visible section. Geometry is
    // sampled after scrolling, before trusted pointer input starts.
    await row(entry.first).scrollIntoViewIfNeeded();
    const orderPath = entry.section === 'quickAccess' ? '/api/v1/file-quick-access/order' : '/api/v1/file-saved-searches/order';
    const reordered = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === orderPath);
    await drag(source, row(entry.first), async () => {
      check(`${activeStage}-${entry.section}: one actual insertion target is shown`, await drawer.locator('[data-xdrive-sidebar-order-target]').count() === 1);
    });
    check(`${activeStage}-${entry.section}: the actual reorder endpoint accepts this gesture`, (await reordered).status() === 200);
    await page.waitForFunction(({ section, id }) => document.querySelector(`[data-xdrive-sidebar-order-section="${section}"]`)?.getAttribute('data-xdrive-sidebar-order-id') === String(id), { section: entry.section, id: entry.source });
    check(`${activeStage}-${entry.section}: one full ordered-ID write reaches the existing API`, touchFixture[entry.writes].length === 1 && JSON.stringify(touchFixture[entry.order]) === JSON.stringify(entry.expected), touchFixture[entry.writes]);
    check(`${activeStage}-${entry.section}: drag release does not open its tap menu or navigate`, await page.getByRole('menu').count() === 0 && await callerRetained());
    const menuHandle = row(entry.source).locator('[data-xdrive-sidebar-order-handle]');
    await menuHandle.tap();
    const down = page.getByRole('menuitem', { name: '下移', exact: true });
    await down.waitFor();
    const movedDown = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === orderPath);
    await down.tap();
    await movedDown;
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    const expectedDown = [entry.expected[1], entry.expected[0], ...entry.expected.slice(2)];
    check(`${activeStage}-${entry.section}: a new intentional tap opens Up/Down and persists one full order`, touchFixture[entry.writes].length === 2 && JSON.stringify(touchFixture[entry.writes][1][entry.field]) === JSON.stringify(expectedDown), touchFixture[entry.writes]);
    await row(entry.source).locator('[data-xdrive-sidebar-order-handle]').waitFor();
  }
  await drawer.getByRole('button', { name: '关闭位置', exact: true }).tap();
  await drawer.waitFor({ state: 'hidden' });
  check(`${activeStage}: closing returns to the same Files caller without global chrome`, await callerRetained());
  if (hasHandle) {
    activeStage = 'user-touch-drag-short-text-mixed-input';
    await page.getByRole('button', { name: '选择', exact: true }).tap();
    for (const name of ['document-001.txt', 'document-002.txt']) await files.locator('[data-xdrive-file-explorer-item]').filter({ hasText: name }).tap();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await settle();
    const hitTarget = locator => locator.evaluate(element => {
      const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        hittable: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && Boolean(hit && element.contains(hit)) };
    });
    const shortHandle = await hitTarget(handle);
    check(`${activeStage}: short landscape with200% root text retains a visible44px handle`, shortHandle.width >= 44 && shortHandle.height >= 44 && shortHandle.hittable, shortHandle);
    const start = await center(handle), writesBefore = operationFixture.creates.length;
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y); await settle();
    const cancel = page.getByRole('button', { name: '取消拖动', exact: true });
    const shortCancel = await hitTarget(cancel);
    check(`${activeStage}: an actual mouse gesture in the touch-capable App keeps Cancel reachable`, shortCancel.width >= 44 && shortCancel.height >= 44 && shortCancel.hittable, shortCancel);
    await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
    check(`${activeStage}: Escape and release submit no move and retain the caller`, operationFixture.creates.length === writesBefore && await callerRetained());
    await geometry('user-touch-drag-short-text');
    await page.getByRole('button', { name: '完成选择', exact: true }).tap();
    await page.getByRole('button', { name: '位置', exact: true }).tap();
    await drawer.waitFor();
    const close = drawer.getByRole('button', { name: '关闭位置', exact: true });
    const closeBounds = await hitTarget(close);
    check(`${activeStage}: short navigation panel keeps its44px close target visible`, closeBounds.width >= 44 && closeBounds.height >= 44 && closeBounds.hittable, closeBounds);
    const orderHandle = drawer.locator('[data-xdrive-sidebar-order-handle]').first();
    await orderHandle.scrollIntoViewIfNeeded();
    const orderBounds = await hitTarget(orderHandle);
    check(`${activeStage}: internal navigation scrolling reaches the44px order entry`, orderBounds.width >= 44 && orderBounds.height >= 44 && orderBounds.hittable, orderBounds);
    await page.screenshot({ path: path.join(outputDir, 'user-touch-drag-short-text-navigation.png') });
    await close.tap(); await drawer.waitFor({ state: 'hidden' });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize({ width: 390, height: 844 }); await settle();
    check(`${activeStage}: restoring the viewport keeps the mounted caller and history`, await callerRetained());
  }
  await geometry('user-touch-drag-final');
  result.samples['touch-drag-api-payloads'] = JSON.parse(JSON.stringify({ move: operationFixture.creates, ...touchFixture }));
}

async function filesOrganizationAcceptance() {
  const drawer = page.locator('[data-xdrive-file-explorer-touch-navigation-drawer]');
  const openNavigation = async () => {
    await page.getByRole('button', { name: '位置', exact: true }).tap();
    await drawer.waitFor();
  };
  const closeNavigation = async () => {
    if (await drawer.isVisible()) await drawer.getByRole('button', { name: '关闭位置', exact: true }).tap();
    await drawer.waitFor({ state: 'hidden' });
  };
  const query = async (value) => {
    await page.getByRole('button', { name: '搜索全部文件和文件夹', exact: true }).tap();
    const input = page.getByRole('textbox', { name: '搜索全部文件和文件夹', exact: true });
    await input.fill(value); await input.press('Enter');
    await page.waitForFunction((value) => document.querySelector('[data-xdrive-file-explorer-search-summary]')?.textContent.includes(`搜索：“${value}”`), value);
    // Each call changes the Search scope, which closes the compact editor.
    // Wait for that transition rather than tapping its departing close button.
    await input.waitFor({ state: 'hidden' });
  };
  const savedRow = () => drawer.getByRole('button', { name: '图片搜索', exact: true });
  activeStage = 'user-organization-read-retry';
  await page.evaluate(() => { window.__organizationCaller = { main: document.querySelector('main'), files: document.querySelector('[data-xdrive-file-explorer]'), scroll: document.querySelector('[data-xdrive-file-explorer-scroll-host]') }; });
  await openNavigation();
  const tagsSection = drawer.getByRole('navigation', { name: '标签', exact: true });
  await tagsSection.getByRole('button', { name: '重新加载标签', exact: true }).waitFor();
  check(`${activeStage}: failed definitions are not a false empty state`, !(await tagsSection.innerText()).includes('暂无标签'));
  organizationFixture.rejectTagRead = false;
  await tagsSection.getByRole('button', { name: '重新加载标签', exact: true }).tap();
  await tagsSection.getByText('暂无标签', { exact: true }).waitFor();
  check(`${activeStage}: actual retry restores a confirmed empty list`, (await tagsSection.innerText()).includes('暂无标签'));

  activeStage = 'user-organization-management';
  const beforeQueries = organizationFixture.tagQueries.length;
  await tagsSection.getByRole('button', { name: '管理标签', exact: true }).tap();
  const management = page.getByRole('dialog', { name: /^管理标签/ });
  await management.waitFor();
  check(`${activeStage}: management opens with no selected file`, organizationFixture.tagQueries.length === beforeQueries && organizationFixture.assignments.length === 0);
  await management.getByRole('textbox', { name: '新标签', exact: true }).fill('旅行');
  await management.getByRole('button', { name: '添加', exact: true }).tap();
  await management.getByRole('button', { name: '编辑标签 旅行', exact: true }).waitFor();
  check(`${activeStage}: creating a definition makes one exact write and no assignment`, organizationFixture.tagCreates.length === 1 && organizationFixture.assignments.length === 0 && organizationFixture.tagQueries.length === beforeQueries, organizationFixture.tagCreates);
  await management.getByRole('button', { name: '完成', exact: true }).tap();
  await management.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '管理标签');
  check(`${activeStage}: management returns focus to its navigation entry`, await tagsSection.getByRole('button', { name: '管理标签', exact: true }).evaluate((element) => element === document.activeElement));
  check(`${activeStage}: confirmed zero global count is visible`, (await tagsSection.innerText()).includes('共 0 项'));
  await closeNavigation();

  activeStage = 'user-organization-save-rules';
  await query('photo');
  await page.getByRole('button', { name: '筛选文件', exact: true }).tap();
  const filters = page.getByRole('dialog', { name: '文件筛选', exact: true });
  await filters.getByRole('button', { name: '类型', exact: true }).tap();
  await page.getByRole('menuitem', { name: '图片', exact: true }).tap();
  await page.getByRole('button', { name: '关闭筛选', exact: true }).tap();
  await filters.waitFor({ state: 'hidden' });
  await openNavigation();
  await drawer.getByRole('button', { name: '保存当前搜索', exact: true }).tap();
  const save = page.getByRole('dialog', { name: /^保存搜索/ });
  await save.getByRole('textbox', { name: '智能文件夹名称', exact: true }).fill('图片搜索');
  await save.getByRole('button', { name: '保存', exact: true }).tap();
  await save.waitFor({ state: 'hidden' });
  await savedRow().waitFor();
  check(`${activeStage}: one saved rule contains the actual query and filters`, organizationFixture.savedCreates.length === 1, organizationFixture.savedCreates);
  const ruleText = await drawer.locator('[data-xdrive-saved-search-rule="17"]').innerText();
  check(`${activeStage}: query and image predicate are readable in navigation`, ruleText.includes('photo') && ruleText.includes('类型：图片'), ruleText);
  check(`${activeStage}: saved rule matches actual Search`, await savedRow().getAttribute('aria-current') === 'page');
  await page.screenshot({ path: path.join(outputDir, 'user-organization-saved-rule.png') });
  await drawer.getByRole('navigation', { name: '回收站', exact: true }).getByRole('button', { name: '回收站', exact: true }).tap();
  await page.waitForFunction(() => document.querySelector('[data-xdrive-file-explorer]')?.textContent.includes('回收站为空'));
  await drawer.waitFor({ state: 'hidden' });
  await openNavigation();
  check(`${activeStage}: Trash does not claim the retained background Search as active`, await savedRow().getAttribute('aria-current') === null && await drawer.getByRole('button', { name: '保存当前搜索', exact: true }).isDisabled());
  await savedRow().tap();
  await page.waitForFunction(() => document.querySelector('[data-xdrive-file-explorer-search-summary]')?.textContent.includes('搜索：“photo”'));
  await drawer.waitFor({ state: 'hidden' });
  await openNavigation();
  check(`${activeStage}: saved activation leaves Trash and restores the matching Search`, await savedRow().getAttribute('aria-current') === 'page');
  await closeNavigation();

  activeStage = 'user-organization-search-matching';
  await query('invoice');
  await openNavigation();
  check(`${activeStage}: changed query removes the old active marker`, await savedRow().getAttribute('aria-current') === null);
  check(`${activeStage}: changed rule remains readable`, (await drawer.locator('[data-xdrive-saved-search-rule="17"]').innerText()).includes('photo'));
  await savedRow().tap();
  await page.waitForFunction(() => document.querySelector('[data-xdrive-file-explorer-search-summary]')?.textContent.includes('搜索：“photo”'));
  await drawer.waitFor({ state: 'hidden' });
  await openNavigation();
  check(`${activeStage}: saved activation restores the actual rule`, await savedRow().getAttribute('aria-current') === 'page');
  await closeNavigation();
  await longPressItem(page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'photo-001.png' }));
  await page.getByText('显示所在文件夹', { exact: true }).tap();
  await page.waitForURL(/\/files\?dir=2$/);
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'nested-001.txt' }).waitFor();
  await openNavigation();
  check(`${activeStage}: directory navigation clears the saved active marker`, await savedRow().getAttribute('aria-current') === null);
  await closeNavigation();
  await query('invoice');
  await page.getByRole('button', { name: '后退', exact: true }).tap();
  await page.waitForURL(/\/files\?dir=1$/);
  await page.waitForFunction(() => document.querySelector('[data-xdrive-file-explorer-search-summary]')?.textContent.includes('搜索：“photo”'));
  await openNavigation();
  check(`${activeStage}: history restores the saved marker from restored Search`, await savedRow().getAttribute('aria-current') === 'page');
  await closeNavigation();
  await page.getByRole('button', { name: '清除搜索与筛选', exact: true }).tap();

  activeStage = 'user-organization-assignment';
  await longPressItem(page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'document-001.txt' }));
  await page.getByText('标签…', { exact: true }).tap();
  const assignment = page.getByRole('dialog', { name: /^设置标签/ });
  const add = assignment.getByRole('button', { name: '为当前选择添加标签 旅行', exact: true });
  await add.waitFor();
  check(`${activeStage}: actual untagged null wire value is readable`, await add.isEnabled() && organizationFixture.tagQueries.some((ids) => ids.length === 1 && ids[0] === 100), organizationFixture.tagQueries);
  await add.tap();
  const remove = assignment.getByRole('button', { name: '从当前选择移除标签 旅行', exact: true });
  await remove.waitFor();
  check(`${activeStage}: assignment submits one complete selected identity`, organizationFixture.assignments.length === 1 && organizationFixture.assignments[0].assigned, organizationFixture.assignments);
  await remove.tap();
  await add.waitFor();
  check(`${activeStage}: removing assignment preserves the tag definition`, organizationFixture.assignments.length === 2 && !organizationFixture.assignments[1].assigned && organizationFixture.tags.length === 1, organizationFixture.assignments);
  await assignment.getByRole('button', { name: '完成', exact: true }).tap();
  await assignment.waitFor({ state: 'hidden' });
  check(`${activeStage}: actual Files owner remains mounted throughout`, await page.evaluate(() => window.__organizationCaller.main === document.querySelector('main') && window.__organizationCaller.files === document.querySelector('[data-xdrive-file-explorer]') && window.__organizationCaller.scroll === document.querySelector('[data-xdrive-file-explorer-scroll-host]')));
  await geometry('user-organization-files-return');
  result.samples['user-organization-payloads'] = { ...organizationFixture, assignedNodeIDs: [...organizationFixture.assignedNodeIDs] };
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
  await longPressItem(item);
  await page.locator('[data-xdrive-file-explorer-touch-action-sheet]').waitFor();
  await page.getByText('显示所在文件夹', { exact: true }).tap();
  await page.waitForURL(/\/files\?dir=2$/);
  await page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'nested-001.txt' }).waitFor();
  check(`${activeStage}: real adapter uses authoritative search-result parent`, new URL(page.url()).hash === '#/app/files?dir=2' && await summary.count() === 0);
  await page.getByRole('button', { name: '后退', exact: true }).tap();
  await page.waitForURL(callerURL);
  await page.waitForFunction((count) => document.querySelector('[data-xdrive-file-explorer-search-summary]')?.textContent.includes(`${count} 个结果`), mediaItems.length);
  await page.waitForFunction(() => Math.abs(document.querySelector('[data-xdrive-file-explorer-scroll-host]').scrollTop - window.__searchReturnCaller.scrollTop) <= 1).catch(() => {});
  // Scroll restoration precedes virtual row rendering; wait for data readiness,
  // then independently assert the retained selection without scrolling it.
  await item.waitFor({ state: 'attached', timeout: 5000 });
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
  check(`${activeStage}: actual Files status text is below title bar and does not overlap app navigation`, statusGeometry.visibleNavigation && statusGeometry.navigation?.bottom <= statusGeometry.status?.top && statusGeometry.textRects.length > 0 && statusGeometry.overlaps.length === 0, statusGeometry);
  await page.screenshot({ path: path.join(outputDir, 'user-search-return.png') });
}


async function gallerySelectionAcceptance() {
  activeStage = 'user-gallery-selection';
  page.setDefaultTimeout(5000);
  await navigateWorkspace('图库', 'gallery');
  await page.locator('[data-xdrive-media-tile]').first().waitFor();
  const galleryURL = page.url();
  await geometry('user-gallery-selection-initial');
  await page.evaluate(() => { window.__m12GalleryCaller = { main: document.querySelector('main'), header: document.querySelector('[data-xdrive-gallery-header]') }; });
  const galleryToolbar = page.locator('[data-xdrive-gallery-toolbar]');
  await galleryToolbar.getByRole('button', { name: '选择', exact: true }).tap();
  for (const index of [0, 1, 2]) {
    const tile = page.locator(`[data-xdrive-media-tile][data-xdrive-media-index="${index}"]`);
    await tile.getByRole('checkbox').tap();
  }
  const selection = page.locator('[data-xdrive-gallery-selection-toolbar]');
  const count = async () => (await selection.getByRole('status', { includeHidden: true }).textContent()).replace(/\s/g, '');
  check('Gallery native three-tile selection shows its real count', await count() === '已选择3项', await count());
  check('Gallery selection keeps the real caller mounted and does not open Viewer', await page.evaluate(() => {
    const caller = window.__m12GalleryCaller;
    return caller.main === document.querySelector('main') && caller.header === document.querySelector('[data-xdrive-gallery-header]') && !location.hash.includes('media-viewer');
  }));
  const selectedIndexes = () => page.locator('[data-xdrive-media-tile] input:checked').evaluateAll(inputs => inputs.map(input => Number(input.closest('[data-xdrive-media-tile]').dataset.xdriveMediaIndex)).sort((a,b) => a-b));
  check('Gallery selection uses the observed first three media rows', JSON.stringify(await selectedIndexes()) === '[0,1,2]', await selectedIndexes());
  const join = selection.getByRole('button', { name: '加入相册', exact: true });
  const picker = page.getByRole('dialog', { name: '选择手动相册', exact: true });
  const search = picker.getByRole('textbox', { name: '搜索相册', exact: true });
  const lastAlbum = picker.getByRole('button', { name: /^验收相册 24 / });
  const finishTransition = async () => {
    await settle();
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  };
  const focus = () => page.evaluate(() => {
    const active = document.activeElement;
    return { tag: active?.tagName, role: active?.getAttribute('role'), name: active?.getAttribute('aria-label') || active?.textContent?.trim().slice(0,80),
      connected: Boolean(active?.isConnected), insideMain: Boolean(document.querySelector('main')?.contains(active)) };
  });
  const rect = locator => locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    let left = Math.max(0,r.left), right = Math.min(innerWidth,r.right), top = Math.max(0,r.top), bottom = Math.min(innerHeight,r.bottom);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), p = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left,p.left); right = Math.min(right,p.right); }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top,p.top); bottom = Math.min(bottom,p.bottom); }
    }
    const visibleWidth = Math.max(0,right-left), visibleHeight = Math.max(0,bottom-top);
    const hit = visibleWidth && visibleHeight ? document.elementFromPoint((left+right)/2,(top+bottom)/2) : null;
    return { ...r.toJSON(), visibleWidth, visibleHeight, hit: Boolean(hit && element.contains(hit)) };
  });
  const target44 = r => r.visibleWidth >= 43.9 && r.visibleHeight >= 43.9 && r.hit;
  await join.tap(); await picker.waitFor(); await finishTransition();
  check('Gallery album picker uses the real manual-only catalog', await picker.locator('[data-xdrive-gallery-album-picker]').getByRole('button').count() === 24 && await picker.getByText('验收智能相册', { exact: true }).count() === 0);
  await search.fill('验收相册 24');
  check('Gallery album search narrows the actual catalog without submitting', await picker.locator('[data-xdrive-gallery-album-picker]').getByRole('button').count() === 1 && gallerySelectionFixture.attempts.length === 0);
  await lastAlbum.tap();
  check('Choosing an album does not submit before confirmation', gallerySelectionFixture.attempts.length === 0);
  await picker.getByRole('button', { name: '取消', exact: true }).tap(); await picker.waitFor({ state: 'hidden' }); await settle();
  result.samples['gallery-selection-cancel-focus'] = await focus();
  check('Gallery album Cancel preserves selection and sends no mutation', await count() === '已选择3项' && gallerySelectionFixture.attempts.length === 0);
  check('Gallery album Cancel restores the live initiating trigger', await join.evaluate(element => element === document.activeElement), result.samples['gallery-selection-cancel-focus']);
  await join.tap(); await picker.waitFor(); await finishTransition();
  await page.setViewportSize({ width: 844, height: 200 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; }); await settle();
  const firstRow = await rect(picker.getByRole('button', { name: /^验收家庭相册/ }));
  const close = picker.getByRole('button', { name: '关闭相册选择', exact: true });
  const initialClose = await rect(close);
  result.samples['gallery-selection-short-initial'] = { row: firstRow, close: initialClose };
  check('Built Gallery short200 with200percent text exposes a full album choice', target44(firstRow) && firstRow.visibleHeight >= firstRow.height - .5, firstRow);
  check('Built Gallery short picker keeps the44px Close visible', target44(initialClose), initialClose);
  const content = picker.locator('[data-xdrive-gallery-album-picker-content]');
  const scrollToActions = async () => {
    const box = await content.boundingBox();
    // The real App Snackbar occupies the lower right after a refused mutation.
    // Keep native wheel input over the measured, uncovered left of this scroller.
    const point = { x: box.x+Math.min(24,box.width/2), y: box.y+box.height/2 };
    const readScrollTarget = () => page.evaluate(({x,y}) => {
      const element = document.querySelector('[data-xdrive-gallery-album-picker-content]');
      const hit = document.elementFromPoint(x,y);
      return { point:{x,y}, scrollTop:element.scrollTop,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,
        hitTag:hit?.tagName,hitText:hit?.textContent?.trim().slice(0,100),hitInContent:Boolean(hit && element.contains(hit)),
        alerts:[...document.querySelectorAll('[role=alert]')].map(alert=>({text:alert.textContent,rect:alert.getBoundingClientRect().toJSON()})) };
    },point);
    result.samples[`${activeStage}-scroll-before`] = await readScrollTarget();
    await page.mouse.move(point.x,point.y); await page.mouse.wheel(0,10000);
    try { await page.waitForFunction(() => { const element = document.querySelector('[data-xdrive-gallery-album-picker-content]'); return element && element.scrollTop+element.clientHeight >= element.scrollHeight-2; }); }
    finally { result.samples[`${activeStage}-scroll-after`] = await readScrollTarget(); }
    await settle();
  };
  await scrollToActions();
  const lastRow = await rect(lastAlbum);
  check('Built Gallery native content scrolling exposes the final complete album row', target44(lastRow) && lastRow.visibleHeight >= lastRow.height-.5,lastRow);
  await lastAlbum.tap();
  const add = picker.getByRole('button', { name: '添加到相册', exact: true });
  const actionRects = { add: await rect(add), cancel: await rect(picker.getByRole('button', { name: '取消', exact: true })), close: await rect(close) };
  result.samples['gallery-selection-short-actions'] = { ...actionRects, content: await content.evaluate(element => ({ height: element.clientHeight, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight })) };
  check('Built Gallery native scrolling reaches complete Add and Cancel targets', [actionRects.add,actionRects.cancel].every(r => target44(r) && r.visibleHeight >= r.height-.5), actionRects);
  check('Built Gallery Close remains44px at the end of the album list',target44(actionRects.close),actionRects.close);
  await page.screenshot({ path: path.join(outputDir,'gallery-selection-short-actions.png') });
  activeStage = 'user-gallery-selection-refused';
  await add.tap();
  await picker.getByRole('alert').waitFor(); await scrollToActions();
  result.samples['gallery-selection-refused-focus'] = await focus();
  result.samples['gallery-selection-refused-actions'] = { add:await rect(add),close:await rect(close) };
  check('Actual album POST carries complete node IDs and the quoted revision', JSON.stringify(gallerySelectionFixture.attempts) === JSON.stringify([{ albumID:'qa-album-24',node_ids:[1000,1001,1002],ifMatch:'"30"',status:403 }]),gallerySelectionFixture.attempts);
  check('Actual403 remains readable and retains the current three-item selection', (await picker.getByRole('alert').textContent()).trim() === '验收：相册暂时不可写，请重试。' && await count() === '已选择3项' && await add.isEnabled(), { error:await picker.getByRole('alert').textContent(),count:await count() });
  await page.screenshot({ path:path.join(outputDir,'gallery-selection-error-retry.png') });
  activeStage = 'user-gallery-selection-retry-success';
  await add.tap();
  await selection.waitFor({ state:'hidden' }); await picker.waitFor({ state:'hidden' }); await settle();
  const selectAgain = galleryToolbar.getByRole('button',{name:'选择',exact:true});
  await selectAgain.waitFor();
  result.samples['gallery-selection-success-focus'] = await focus();
  check('Retry sends one new actual request for the retained album and unchanged selection', JSON.stringify(gallerySelectionFixture.attempts) === JSON.stringify([
    {albumID:'qa-album-24',node_ids:[1000,1001,1002],ifMatch:'"30"',status:403},
    {albumID:'qa-album-24',node_ids:[1000,1001,1002],ifMatch:'"30"',status:200},
  ]),gallerySelectionFixture.attempts);
  check('Successful Add clears the real Gallery selection once', await selection.count() === 0 && (await selectedIndexes()).length === 0 && gallerySelectionFixture.accepted.length === 1);
  check('Successful Add returns focus to the remaining Gallery selection control',await selectAgain.evaluate(element => element === document.activeElement),result.samples['gallery-selection-success-focus']);
  check('Picker return keeps the same Gallery caller and route', page.url() === galleryURL && await page.evaluate(() => window.__m12GalleryCaller.main === document.querySelector('main') && window.__m12GalleryCaller.header === document.querySelector('[data-xdrive-gallery-header]')));
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; }); await page.setViewportSize({width:390,height:844});
  await geometry('user-gallery-selection-return');
  await page.screenshot({path:path.join(outputDir,'gallery-selection-return.png')});
  result.samples['gallery-selection-transport'] = {attempts:gallerySelectionFixture.attempts,accepted:gallerySelectionFixture.accepted,album:gallerySelectionFixture.albums.find(album=>album.id==='qa-album-24')};
}

async function mobilePanelsAcceptance() {
  activeStage = 'user-mobile-panels';
  const rect = async (locator) => locator.evaluate((element) => {
    const r = element.getBoundingClientRect();
    let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
    let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    for (let p = element.parentElement; p; p = p.parentElement) {
      const css = getComputedStyle(p), pr = p.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom); }
    }
    return { ...r.toJSON(), visibleWidth: Math.max(0, right-left), visibleHeight: Math.max(0, bottom-top),
      viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport?.height, visualOffset: visualViewport?.offsetTop } };
  });
  const target = async (name, locator) => {
    await locator.scrollIntoViewIfNeeded(); await settle();
    const r = await rect(locator); result.samples[name] = r;
    check(`${name}: at least44px visible target`, r.visibleWidth >= 43.9 && r.visibleHeight >= 43.9, r);
  };
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => { window.__panelsMain = document.querySelector('main'); window.__panelsFiles = document.querySelector('[data-xdrive-file-explorer]'); });
  const filesTrigger = page.getByRole('button', { name: '筛选文件', exact: true });
  await filesTrigger.tap();
  const files = page.getByRole('dialog', { name: '文件筛选', exact: true });
  await files.waitFor(); await files.getByRole('button', { name: '类型', exact: true }).tap();
  await page.getByRole('menuitem', { name: '图片', exact: true }).tap();
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 844, height: 200 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await target('files-short200-type', files.getByRole('button', { name: '类型：图片', exact: true }));
  await target('files-short200-close', files.getByRole('button', { name: '关闭筛选', exact: true }));
  await target('files-short200-save', files.getByRole('button', { name: '保存搜索', exact: true }));
  await target('files-short200-clear', files.getByRole('button', { name: '清除全部', exact: true }));
  await page.screenshot({ path: path.join(outputDir, 'files-panels-short200.png') });
  await files.getByRole('button', { name: '清除全部', exact: true }).tap();
  check('Files clears actual applied conditions without leaving its panel', await files.isVisible() && await files.getByRole('button', { name: '清除全部', exact: true }).isDisabled());
  await files.getByRole('button', { name: '关闭筛选', exact: true }).tap();
  await files.waitFor({ state: 'hidden' });
  check('Files close restores trigger focus', await filesTrigger.evaluate((e) => document.activeElement === e));
  await page.getByRole('button', { name: '位置', exact: true }).tap();
  const navigation = page.locator('[data-xdrive-file-explorer-touch-navigation-drawer]');
  await navigation.waitFor();
  await target('files-short200-location-close', navigation.getByRole('button', { name: '关闭位置', exact: true }));
  await navigation.getByRole('button', { name: '关闭位置', exact: true }).tap();
  await navigation.waitFor({ state: 'hidden' });
  check('Location close preserves mounted Files and main', await page.evaluate(() => Boolean(window.__panelsMain && window.__panelsFiles) && window.__panelsMain === document.querySelector('main') && window.__panelsFiles === document.querySelector('[data-xdrive-file-explorer]')));
  check('Location close returns focus to its trigger', await page.getByRole('button', { name: '位置', exact: true }).evaluate((e) => document.activeElement === e));
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.setViewportSize({ width: 390, height: 844 });
  await navigateWorkspace('图库', 'gallery');
  await page.locator('[data-xdrive-media-tile]').first().waitFor();
  const nav = await page.locator('[data-xdrive-gallery-section]').evaluateAll((elements) => elements.map(e => ({ section: e.dataset.xdriveGallerySection, ...e.getBoundingClientRect().toJSON() })));
  result.samples['gallery-navigation-targets'] = nav;
  check('Gallery all nine compact navigation targets are44px', nav.length === 9 && nav.every(r => r.width >= 44 && r.height >= 44), nav);
  const galleryTrigger = page.getByRole('button', { name: /^图库筛选/ });
  await target('gallery-filter-trigger', galleryTrigger);
  await galleryTrigger.tap();
  const gallery = page.getByRole('dialog', { name: '图库筛选', exact: true });
  await gallery.waitFor();
  const tag = gallery.getByRole('textbox', { name: '标签', exact: true });
  await tag.fill('  面板验收  ');
  await tag.evaluate(e => { window.__panelTag = e; });
  await page.setViewportSize({ width: 390, height: 260 }); await settle();
  check('Focused Gallery draft survives reduced layout viewport in the same input', await tag.evaluate(e => e === window.__panelTag && document.activeElement === e && e.value === '  面板验收  '));
  await target('gallery-reduced-close', gallery.getByRole('button', { name: '关闭图库筛选', exact: true }));
  await target('gallery-reduced-apply', gallery.getByRole('button', { name: '应用', exact: true }));
  await target('gallery-reduced-clear', gallery.getByRole('button', { name: '清除', exact: true }));
  await target('gallery-reduced-save', gallery.getByRole('button', { name: '保存为智能相册', exact: true }));
  await page.screenshot({ path: path.join(outputDir, 'gallery-panels-reduced.png') });
  await gallery.getByRole('button', { name: '应用', exact: true }).tap();
  await gallery.waitFor({ state: 'hidden' }); await settle();
  check('Gallery Apply reaches its actual query with trimmed tag', Object.keys(result.requests).some(key => key.includes(' GET /api/v1/media/items?') && new URLSearchParams(key.split('?')[1]).get('tag') === '面板验收'));
  check('Gallery Apply restores filter-trigger focus', await galleryTrigger.evaluate(e => document.activeElement === e));
  check('Filter Apply never opens Viewer', !page.url().includes('/media-viewer'));
  await page.setViewportSize({ width: 844, height: 390 });
  await galleryTrigger.tap(); await gallery.waitFor();
  check('Reopened Gallery filter retains committed condition', (await gallery.getByRole('textbox', { name: '标签', exact: true }).inputValue()).trim() === '面板验收');
  await page.setViewportSize({ width: 844, height: 200 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await target('gallery-short200-tag', gallery.getByRole('textbox', { name: '标签', exact: true }));
  await target('gallery-short200-save', gallery.getByRole('button', { name: '保存为智能相册', exact: true }));
  await target('gallery-short200-close', gallery.getByRole('button', { name: '关闭图库筛选', exact: true }));
  await page.screenshot({ path: path.join(outputDir, 'gallery-panels-short200.png') });
  await page.keyboard.press('Escape'); await gallery.waitFor({ state: 'hidden' });
  check('Gallery Escape returns focus without a navigation change', await galleryTrigger.evaluate(e => document.activeElement === e) && page.url().includes('/gallery'));
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.setViewportSize({ width: 844, height: 390 });
  const final = await geometry('user-mobile-panels-final');
  check('Panels leave the App Frame occupying the full compact viewport', final.appFrame.x === 0 && final.appFrame.y === 0 && final.appFrame.width === 844 && final.appFrame.height === 390 && final.main.y >= 52, { frame: final.appFrame, main: final.main });
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
  activeStage = `${role}-files-item-hold-entry`;
  await page.setViewportSize({ width: 360, height: 780 });
  await settle();
  const target = page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'photo-001.png' });
  await target.waitFor();
  await target.scrollIntoViewIfNeeded();
  check(`${activeStage}: no per-file More button`,
    await page.locator('[data-xdrive-file-explorer-item-more]').count() === 0);
  const lastStatus = await page.evaluate(() => {
    const status = document.querySelector('[data-xdrive-file-explorer-status-bar]');
    const header = document.querySelector('[data-xdrive-mobile-app-header]');
    const sr = status?.getBoundingClientRect(), hr = header?.getBoundingClientRect();
    return { status: sr?.toJSON(), header: hr?.toJSON(),
      fits: !!sr && !!hr && hr.bottom <= sr.top && sr.bottom <= innerHeight };
  });
  result.samples[`${role}-files-status-not-covered`] = lastStatus;
  check(`${activeStage}: status is visible and unobstructed`, lastStatus.fits, lastStatus);
  await longPressItem(target);
  const sheet = page.locator('[data-xdrive-file-explorer-touch-action-sheet]');
  await sheet.waitFor();
  check(`${activeStage}: hold opens file actions, not Viewer`, await sheet.isVisible() && !page.url().includes('/media-viewer'));
  await page.screenshot({ path: path.join(outputDir, `${role}-files-item-hold-actions.png`) });
  await page.getByRole('button', { name: '关闭文件操作', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
}

async function galleryOverlayAcceptance(role, density = 144) {
  activeStage = `${role}-gallery-clean-tiles-${density}`;
  await page.setViewportSize({ width: 360, height: 780 });
  await settle();
  await page.locator('main').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const tile = page.locator('[data-xdrive-media-index="239"]');
  await tile.waitFor();
  await tile.scrollIntoViewIfNeeded();
  const geometry = await tile.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const header = document.querySelector('[data-xdrive-mobile-app-header]')?.getBoundingClientRect();
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    return { tile: rect.toJSON(), header: header?.toJSON() || null,
      visible: rect.top >= (header?.bottom ?? 0) && rect.bottom <= innerHeight,
      hit: !!hit && (hit === element || element.contains(hit)),
      overlayActions: element.querySelectorAll('button[aria-label="收藏"], button[aria-label="查看属性"], [data-xdrive-gallery-touch-info]').length };
  });
  result.samples[`${role}-gallery-last-tile-${density}`] = geometry;
  check(`${activeStage}: last tile is visible below app title`, geometry.visible && geometry.hit, geometry);
  check(`${activeStage}: thumbnail has no overlaid action buttons`, geometry.overlayActions === 0, geometry);
  await longPressItem(tile);
  await page.locator('[data-xdrive-gallery-media-context-menu]').waitFor();
  check(`${activeStage}: stationary hold opens Gallery actions without opening Viewer`,
    !page.url().includes('/media-viewer'));
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(outputDir, `${role}-gallery-last-tile-${density}.png`) });
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

async function galleryIos27ChromeAcceptance() {
  activeStage = 'user-gallery-ios27-chrome';
  await navigateWorkspace('图库', 'gallery');
  await page.locator('[data-xdrive-media-tile]').first().waitFor();
  await page.evaluate(() => {
    window.__iosGalleryMain = document.querySelector('main');
    window.__iosGalleryRoot = document.querySelector('#xdrive-mobile-gallery-main');
  });

  // P1-1b: Wide Web's advanced-filter trigger calls the Server facet list.
  // Both Mobile entry points must reach that identical authenticated REST
  // DataSource without a second mobile facet query or duplicate open requests.
  const facetResponses = () => Object.entries(result.requests)
    .filter(([key]) => key.includes(' GET /api/v1/media/facets'))
    .reduce((total, [, count]) => total + count, 0);
  activeStage = 'user-gallery-ios27-filter-facets';
  const beforeFilter = facetResponses();
  await page.locator('[data-xdrive-mobile-gallery-sort-filter]').tap();
  check('Opening mobile Sort & Filter alone does not fetch advanced Server facets',
    facetResponses() === beforeFilter);
  const [filterResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/media/facets'),
    page.locator('[data-xdrive-mobile-gallery-filter]').tap(),
  ]);
  await page.locator('[data-xdrive-mobile-gallery-filter-panel]').waitFor();
  const facetPayload = await filterResponse.json();
  check('Mobile advanced filter fetches real shared Server facets with current scope',
    filterResponse.status() === 200 &&
    facetPayload?.formats?.[0]?.value === 'png' &&
    facetResponses() === beforeFilter + 1 &&
    new URL(filterResponse.url()).search === '',
    { url: filterResponse.url(), facetPayload, requests: facetResponses() });
  await page.getByRole('button', {name:'完成', exact:true}).tap();
  await page.locator('[data-xdrive-mobile-gallery-filter-panel]').waitFor({state:'hidden'});

  const measure = () => page.evaluate(() => {
    const bounds = element => element?.getBoundingClientRect().toJSON() ?? null;
    const main = document.querySelector('main');
    const header = document.querySelector('[data-xdrive-mobile-app-header]');
    const time = document.querySelector('[data-xdrive-mobile-gallery-time-scale]');
    const dock = document.querySelector('[data-xdrive-mobile-gallery-bottom]');
    const grid = document.querySelector('[data-xdrive-media-gallery-virtual-grid] > div');
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length : null;
    const buttons = [...(time?.querySelectorAll('[data-xdrive-mobile-gallery-scale]') ?? [])].map(element => {
      const r = element.getBoundingClientRect();
      const target = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
      return { scale: element.getAttribute('data-xdrive-mobile-gallery-scale'),
        bounds: bounds(element), pressed: element.getAttribute('aria-pressed'),
        hit: !!target && (target === element || element.contains(target)) };
    });
    return { viewport: { width: innerWidth, height: innerHeight },
      header: bounds(header), main: bounds(main), time: bounds(time), dock: bounds(dock),
      columns, buttons,
      mainRetained: main === window.__iosGalleryMain,
      galleryRetained: document.querySelector('#xdrive-mobile-gallery-main') === window.__iosGalleryRoot };
  });

  for (const vp of [{width:360,height:780},{width:390,height:844},
    {width:430,height:932},{width:844,height:390},
    {width:899,height:700},{width:900,height:700},{width:390,height:844}]) {
    activeStage = 'user-gallery-ios27-' + vp.width + 'x' + vp.height;
    await page.setViewportSize(vp);
    await page.locator('main').evaluate(e => { e.scrollTop = 0; });
    await page.locator('[data-xdrive-media-tile]').first().waitFor();
    await settle();
    const s = await measure();
    result.samples[activeStage] = s;
    await page.screenshot({path:path.join(outputDir, activeStage+'.png')});
    check(activeStage+': same mounted Gallery and scroll host', s.galleryRetained && s.mainRetained, s);
    if (vp.width < 900) {
      check(activeStage+': 52px App Header above shared main', s.header && s.main
        && s.header.height >= 52 && Math.abs(s.main.top-s.header.bottom) <= 1, s);
      check(activeStage+': bottom time controls and Gallery-only dock both mounted', !!s.time && !!s.dock, s);
      check(activeStage+': no mobile dock overlap, clipping or header interception', s.time && s.dock && s.header
        && s.time.top >= s.header.bottom+2 && s.time.bottom <= s.dock.top+1
        && s.time.left >= -1 && s.time.right <= vp.width+1
        && s.dock.bottom <= vp.height+1, s);
      check(activeStage+': year/month/all have actual 44px touch hit targets',
        JSON.stringify(s.buttons.map(x=>x.scale)) === '["year","month","all"]'
        && s.buttons.every(x=>x.bounds?.width>=44 && x.bounds?.height>=44 && x.hit), s.buttons);
      const expectedColumns = Math.max(3, Math.floor(vp.width/144));
      check(activeStage+': shared KFS responsive columns',
        s.columns === expectedColumns, { actual:s.columns, expected:expectedColumns });
    } else {
      check(activeStage+': wide Web has no Mobile-only bottom controls',
        !s.time && !s.dock, s);
    }
  }

  activeStage = 'user-gallery-ios27-last-tile';
  await page.locator('main').evaluate(e => {e.scrollTop = e.scrollHeight;});
  await page.waitForFunction(() => !!document.querySelector('[data-xdrive-media-index="239"]'));
  await settle();
  const last = await page.evaluate(() => {
    const tile = document.querySelector('[data-xdrive-media-index="239"]');
    const time = document.querySelector('[data-xdrive-mobile-gallery-time-scale]');
    const header = document.querySelector('[data-xdrive-mobile-app-header]');
    const bounds = el => el?.getBoundingClientRect().toJSON() ?? null;
    const r = tile?.getBoundingClientRect();
    const hit = r && document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return { tile:bounds(tile), time:bounds(time), header:bounds(header),
      index:tile?.getAttribute('data-xdrive-media-index'), hit:!!hit && (hit===tile||tile.contains(hit)),
      scrollTop:document.querySelector('main')?.scrollTop };
  });
  result.samples[activeStage] = last;
  await page.screenshot({path:path.join(outputDir,activeStage+'.png')});
  check('P0-4a last of 240 actual tiles is fully clickable above floating docks',
    last.index==='239' && last.hit && last.tile && last.time && last.header
    && last.tile.top >= last.header.bottom-1 && last.tile.bottom <= last.time.top-2, last);

  activeStage = 'user-gallery-ios27-actions';
  await page.locator('[data-xdrive-mobile-gallery-select]').tap();
  await settle();
  const selected = await measure();
  check('Selection hides both Gallery floating docks', !selected.time && !selected.dock, selected);
  await page.locator('[data-xdrive-mobile-gallery-select]').tap();
  await settle();
  await page.locator('[data-xdrive-mobile-gallery-scale="month"]').tap();
  await settle();
  check('Month uses the same onTimeScale state',
    await page.locator('[data-xdrive-mobile-gallery-scale="month"]').getAttribute('aria-pressed') === 'true');
  await page.locator('[data-xdrive-mobile-gallery-scale="all"]').tap();
  await settle();
  await page.locator('[data-xdrive-mobile-gallery-tab="collections"]').tap();
  await settle();
  check('Collections hides Year/Month/All without unmounting shared Gallery',
    await page.locator('[data-xdrive-mobile-gallery-time-scale]').count() === 0
    && await page.evaluate(() => document.querySelector('#xdrive-mobile-gallery-main') === window.__iosGalleryRoot));

  // P1-1a: exercise the actual built Web Gallery's original multi-file picker,
  // not a second mobile upload callback or an invented successful transfer.
  activeStage = 'user-gallery-ios27-collections-upload';
  const more = page.locator('[data-xdrive-mobile-gallery-more]');
  await more.waitFor();
  const moreTarget = await more.boundingBox();
  check('Collections overview has a 44px More target for authorized Gallery actions',
    !!moreTarget && moreTarget.width >= 43.9 && moreTarget.height >= 43.9, moreTarget);
  await more.tap();
  const morePanel = page.locator('[data-xdrive-mobile-gallery-more-panel]');
  await morePanel.waitFor();
  const upload = morePanel.locator('[data-xdrive-gallery-upload]');
  await upload.waitFor();
  check('Collections More hides Library-only density, fold and query-wide selection controls',
    await morePanel.locator('[aria-label="移动图库缩略图密度"]').count() === 0
    && await morePanel.getByText('照片墙最少列数', {exact:false}).count() === 0
    && await morePanel.getByText('折叠重复副本',{exact:false}).count() === 0);
  check('Collections More exposes the exact shared Gallery upload action',
    await upload.count() === 1
    && await page.locator('[data-xdrive-gallery-upload-picker][multiple]').count() === 1);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), upload.tap()]);
  check('Collections upload opens the existing native multi-file chooser',
    chooser.isMultiple() === true);
  await page.screenshot({path:path.join(outputDir,'user-gallery-ios27-collections-upload.png')});
  await page.getByRole('button',{name:'完成',exact:true}).tap();
  await morePanel.waitFor({state:'hidden'});
  await page.locator('[data-xdrive-mobile-gallery-tab="library"]').tap();
  await page.locator('[data-xdrive-mobile-gallery-time-scale]').waitFor();
  check('Returning Library restores exactly one bottom time dock',
    await page.locator('[data-xdrive-mobile-gallery-time-scale]').count() === 1);
  await page.screenshot({path:path.join(outputDir,'user-gallery-ios27-actions.png')});
  // After Collections -> Search, the owning Gallery Page changes back to
  // Library before its deferred mobile-filter open reads Server facets.
  activeStage = 'user-gallery-ios27-collections-search-facets';
  await page.locator('[data-xdrive-mobile-gallery-tab="collections"]').tap();
  await settle();
  const beforeSearch = facetResponses();
  const [searchResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/media/facets'),
    page.locator('[data-xdrive-mobile-gallery-search]').tap(),
  ]);
  await page.locator('[data-xdrive-mobile-gallery-filter-panel]').waitFor();
  check('Collections Search opens shared Library filter and fetches exactly one Server facet set',
    searchResponse.status() === 200 && facetResponses() === beforeSearch + 1 &&
    !await page.locator('[data-xdrive-mobile-gallery-tab="collections"][aria-selected="true"]').count() &&
    await page.evaluate(() => document.querySelector('#xdrive-mobile-gallery-main') === window.__iosGalleryRoot),
    {url:searchResponse.url(), count:facetResponses()});
  await page.getByRole('button', {name:'完成', exact:true}).tap();
  await page.locator('[data-xdrive-mobile-gallery-filter-panel]').waitFor({state:'hidden'});
}


async function filesIos27ChromeAcceptance(origin) {
  // Authentic built React/Chromium at both responsive owners. The local
  // request router supplies deterministic authorized-looking Server payloads;
  // it is explicitly NOT a physical iOS/Safari or live-Go acceptance claim.
  const viewports = [
    { width: 375, height: 812 }, { width: 390, height: 844 },
    { width: 899, height: 700 }, { width: 900, height: 700 },
  ];
  for (const viewport of viewports) {
    const narrow = viewport.width < 900;
    activeStage = `user-files-ios27-${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    // A direct, real Files deep link avoids mistaking Browse-home navigation
    // differences for different Node/count/permission business contracts.
    await page.goto(`${origin}/#/app/files?dir=1`, { waitUntil: 'domcontentloaded' });
    const row = narrow
      ? page.locator('[data-mobile-files-item]').filter({ hasText: 'document-001.txt' })
      : page.locator('[data-xdrive-file-explorer-item]').filter({ hasText: 'document-001.txt' });
    await row.first().waitFor();
    await settle();
    const sample = await geometry(activeStage);
    const visibleRows = await page.locator(narrow ? '[data-mobile-files-item]' : '[data-xdrive-file-explorer-item]').count();
    const scrollHosts = await page.locator('[data-xdrive-file-explorer-scroll-host]').count();
    const initial = {
      viewport, narrow, renderedRows: visibleRows, scrollHosts,
      fullAppFrame: sample.appFrame, appHeader: sample.appHeader,
      scroll: sample.filesScroll, URL: page.url(),
    };
    result.samples[`${activeStage}-initial`] = initial;
    check(`${activeStage}: real responsive FileExplorer owner`,
      narrow ? await page.locator('[data-xdrive-mobile-files]').count() === 1
        && await page.locator('[data-xdrive-file-explorer]').count() === 0
        : await page.locator('[data-xdrive-file-explorer]').count() === 1
          && await page.locator('[data-xdrive-mobile-files]').count() === 0, initial);
    check(`${activeStage}: exactly one shared virtual scroll owner`,
      scrollHosts === 1 && visibleRows > 0 && visibleRows < rootChildren.length, initial);
    const before = filesIos27Fixture.accepted.length;

    if (narrow) {
      await row.first().click({ button: 'right' });
      const actions = ['cut', 'copy', 'move-to', 'copy-to'];
      const sampleAction = async (action) => {
        const option = page.locator(`[data-mobile-files-context-selection-action="${action}"]`);
        await option.waitFor();
        const metrics = await option.evaluate(element => {
          const style = getComputedStyle(element);
          const paper = element.closest('.MuiPopover-paper');
          const paperStyle = paper ? getComputedStyle(paper) : null;
          return {
            boxHeight: element.getBoundingClientRect().height,
            cssHeight: style.height,
            cssMinHeight: style.minHeight,
            paperTransform: paperStyle?.transform ?? null,
          };
        });
        return { count: await option.count(), enabled: await option.isEnabled(), ...metrics };
      };
      // MUI Menu uses Grow: bounding boxes during its entering transform can
      // be 20-26px despite a real 44px CSS minimum. Record both states, but
      // judge hit targets only after the transition has actually settled.
      const opening = {};
      for (const action of actions) opening[action] = await sampleAction(action);
      await page.waitForTimeout(400);
      await settle();
      const settled = {};
      for (const action of actions) settled[action] = await sampleAction(action);
      result.samples[`${activeStage}-context`] = { opening, settled };
      check(`${activeStage}: exact four shared clipboard/destination operations with >=44px touch targets`,
        actions.every(action => settled[action].count === 1 && settled[action].enabled
          && settled[action].boxHeight >= 43.5 && parseFloat(settled[action].cssMinHeight) >= 44),
        { opening, settled });
      await page.screenshot({ path: path.join(outputDir, `${activeStage}-context.png`) });
      await page.locator('[data-mobile-files-context-selection-action="copy"]').click();
      await page.getByRole('button', { name: '文件操作菜单', exact: true }).click();
      const paste = page.getByRole('menuitem', { name: '粘贴', exact: true });
      await paste.waitFor();
      check(`${activeStage}: copied real Node enables the existing Web paste command`,
        await paste.isEnabled());
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/file-operations'
          && response.request().method() === 'POST'),
        paste.click(),
      ]);
    } else {
      // At the 900px boundary Mobile's presentation is replaced by wide Web,
      // but Node IDs and Server copy operation must remain identical.
      await row.first().click();
      await page.keyboard.press('Control+c');
      await settle();
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/file-operations'
          && response.request().method() === 'POST'),
        page.keyboard.press('Control+v'),
      ]);
    }

    await settle();
    check(`${activeStage}: one authentic Web operation submission`,
      filesIos27Fixture.accepted.length === before + 1,
      filesIos27Fixture.accepted.slice(before));
    check(`${activeStage}: same Node ID/Revision/method/parent from both layouts`,
      filesIos27Fixture.accepted.at(-1)?.type === 'copy' &&
      filesIos27Fixture.accepted.at(-1)?.parent_id === 1 &&
      JSON.stringify(filesIos27Fixture.accepted.at(-1)?.items) === JSON.stringify([{ id: 100, revision: 1 }]),
      filesIos27Fixture.accepted.at(-1));
    check(`${activeStage}: actual Server directory range transport used`,
      Object.keys(result.requests).some(key => key.includes(' GET /api/v1/nodes/1/children')));
    check(`${activeStage}: FileExplorer route preserved after queued Server operation`,
      /\/files\?dir=1$/.test(page.url()), page.url());
    await page.screenshot({ path: path.join(outputDir, `${activeStage}-copy.png`) });
  }

  check('Files iOS27 375/390/899/900 use identical authorized copy payloads',
    filesIos27Fixture.accepted.length === viewports.length &&
      filesIos27Fixture.accepted.every(submission =>
        JSON.stringify(submission) === JSON.stringify(filesIos27Fixture.accepted[0])),
    filesIos27Fixture.accepted);
  result.samples['files-ios27-transport-parity'] = {
    fixtureBounded: true, realChromium: true, physicalIphone: false,
    liveGoServer: false, accepted: filesIos27Fixture.accepted,
    distinctPaths: [...new Set(Object.keys(result.requests)
      .map(key => key.slice(key.indexOf(' /api/'))).filter(Boolean))].sort(),
  };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  assert(fs.existsSync(path.join(distRoot, 'index.html')), `Build the real Web App first: ${distRoot}/index.html missing`);
  if (searchReturnScenario || filesOperationsScenario || filesOrganizationScenario || filesTouchDragScenario || mobilePanelsScenario || gallerySelectionScenario || galleryIos27ChromeScenario || filesIos27ChromeScenario) {
    const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    result.runnerSHA256 = hash(__filename);
    result.builtWebSHA256 = {
      'index.html': hash(path.join(distRoot, 'index.html')),
      ...Object.fromEntries(fs.readdirSync(path.join(distRoot, 'assets')).filter((name) => /\.(js|css)$/.test(name)).sort().map((name) => [`assets/${name}`, hash(path.join(distRoot, 'assets', name))])),
    };
    if (filesIos27ChromeScenario) {
      fs.copyFileSync(__filename, path.join(outputDir, path.basename(__filename)));
      result.fixture.filesIos27Chrome = { physicalIphone: false, liveServer: false, fixtureNodes: rootChildren.length,
        viewports: [375, 390, 899, 900] };
      result.sourceHashes = Object.fromEntries([
        'web/src/App.tsx', 'web/src/WebFileExplorer.tsx', 'web/src/MobileFiles.tsx',
        'web/src/api.ts', 'ui/shared/src/mui/FileExplorer.tsx',
        'ui/shared/src/mui/VirtualCollectionController.ts', 'ui/shared/src/mui/MobileAppHeader.tsx',
      ].map(file => [file, hash(path.join(sourceRoot, file))]));
    }
    if (galleryIos27ChromeScenario) {
      fs.copyFileSync(__filename, path.join(outputDir, path.basename(__filename)));
      result.fixture.ios27 = { logicalItems: mediaItems.length, physicalDevice: false };
      result.sourceHashes = Object.fromEntries([
        'web/src/App.tsx', 'web/src/mediaGalleryAdapter.ts',
        'ui/shared/src/mui/MediaGallery.tsx', 'ui/shared/src/mui/MobileGalleryChrome.tsx',
        'ui/shared/src/mui/MediaGalleryVirtualGrid.ts', 'ui/shared/src/mui/MediaGalleryVirtualTimeline.ts',
        'ui/shared/src/mui/MobileAppHeader.tsx',
      ].map(file => [file, hash(path.join(sourceRoot, file))]));
    }
    if (gallerySelectionScenario) {
      fs.copyFileSync(__filename,path.join(outputDir,path.basename(__filename)));
      result.fixture.gallerySelection = { selectedNodeIDs: [1000, 1001, 1002], manualAlbums: 24, smartAlbums: 1, targetAlbumID: 'qa-album-24', initialRevision: 30, refusalStatus: 403 };
      result.sourceHashes = Object.fromEntries([
        'web/src/App.tsx', 'web/src/api.ts', 'web/src/mediaGalleryAdapter.ts',
        'ui/shared/src/mui/MediaGallery.tsx', 'ui/shared/src/mui/MediaGallerySelectionToolbar.tsx',
        'ui/shared/src/mui/useMobilePanelViewport.ts', 'ui/shared/src/mui/AppearanceThemeProvider.tsx', 'ui/shared/src/mui/theme.ts',
      ].map((file) => [file, hash(path.join(sourceRoot, file))]));
    }
    if (searchReturnScenario) {
      result.fixture.searchItems = mediaItems.length;
      result.fixture.searchDefinition = { query: 'photo', filters: { kind: 'image' }, sort: 'name', order: 'asc', group: 'none', foldersFirst: true, parentID: 2 };
    }
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
    const cases = options.scenario === 'smoke' || searchReturnScenario || filesOrganizationScenario || filesTouchDragScenario || mobilePanelsScenario || gallerySelectionScenario || galleryIos27ChromeScenario || filesIos27ChromeScenario ? [{ role: 'user' }]
      : filesOperationsScenario ? [{ role: 'user' }, { role: 'admin' }]
      : options.scenario === 'inherited-columns' ? [{ role: 'user', viewMode: 'columns' }]
        : options.scenario === 'fullscreen' ? [{ role: 'user' }, { role: 'admin' }, { role: 'user', galleryDensity: 96 }, { role: 'user', galleryDensity: 240 }]
          : [{ role: 'user' }, { role: 'admin' }, { role: 'user', viewMode: 'columns' }];
    for (const { role, viewMode, galleryDensity } of cases) {
      if (filesOperationsScenario || filesTouchDragScenario) {
        operationFixture = { operations: [], creates: [], renames: [], continuations: [], cancellations: [], rejectRename: true };
        Object.assign(allNodes.get(100), { name: 'document-001.txt', revision: 1 });
      }
      const scenarioLabel = viewMode ? `${role}-inherited-${viewMode}` : galleryDensity ? `${role}-gallery-density-${galleryDensity}` : role;
      activeStage = `${scenarioLabel}-startup`;
      // A new process also supports single-process portable Chromium, which
      // cannot reliably create a second context after its first context closes.
      browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args,
        env: process.env.XDRIVE_BROWSER_FONTCONFIG ? { ...process.env, FONTCONFIG_PATH: process.env.XDRIVE_BROWSER_FONTCONFIG } : process.env });
      result.browserVersion = browser.version();
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, timezoneId: 'UTC', serviceWorkers: 'block' });
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
          if (body?.__fixtureStatus) {
            expectedConsoleURLs.add(request.url());
            result.expectedApiErrors.push({ request: key, status: body.__fixtureStatus, purpose: body.__fixturePurpose || 'actual rename rejected by the controlled API' });
            await route.fulfill({ status: body.__fixtureStatus, contentType: 'application/json', body: JSON.stringify(body.__fixtureBody) });
            return;
          }
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
      else if (filesOperationsScenario) await filesOperationsAcceptance(role);
      else if (filesTouchDragScenario) await filesTouchDragAcceptance();
      else if (filesOrganizationScenario) await filesOrganizationAcceptance();
      else if (mobilePanelsScenario) await mobilePanelsAcceptance();
      else if (gallerySelectionScenario) await gallerySelectionAcceptance();
      else if (galleryIos27ChromeScenario) await galleryIos27ChromeAcceptance();
      else if (filesIos27ChromeScenario) await filesIos27ChromeAcceptance(origin);
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
