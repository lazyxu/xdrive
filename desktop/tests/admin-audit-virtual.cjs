const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const auditPage = read('web', 'src', 'AdminAudit.tsx')
const webApi = read('web', 'src', 'api.ts')
const models = read('ui', 'shared', 'src', 'models.ts')
const virtualCollection = read('ui', 'shared', 'src', 'virtual-collection.ts')
const tableSurface = read('ui', 'shared', 'src', 'mui', 'TableSurface.tsx')
const auditAPI = read('internal', 'api', 'audit.go')

test('AdminAudit uses a snapshot-bound sparse VirtualCollection', () => {
  for (const token of [
    'useXDriveVirtualCollection<AuditEvent>',
    'xDriveVirtualCollectionFixedRowWindow({',
    'snapshotMaxIDRef',
    'api.adminAuditRange({',
    'snapshot_max_id: snapshotMaxID',
    'virtualCollection.primePage({',
    'virtualCollection.ensureViewport(',
    'virtualCollection.loadedItems.get(index)',
    'data-xdrive-admin-audit-placeholder',
    'stickyHeader',
    'aria-rowcount={totalCount + 1}',
  ]) {
    assert.ok(auditPage.includes(token), `AdminAudit virtualization missing: ${token}`)
  }
  assert.equal(auditPage.includes('加载更早记录'), false, 'AdminAudit must not expose manual append pagination')
  assert.equal(auditPage.includes('setHasMore'), false, 'AdminAudit must not retain append hasMore state')
  assert.equal(auditPage.includes('before_id:'), false, 'AdminAudit page must not use the legacy cursor endpoint')
})

test('AdminAudit range transport preserves one stable snapshot across viewport reads', () => {
  for (const token of [
    'export interface AuditEventRange',
    'snapshot_max_id: number',
  ]) {
    assert.ok(models.includes(token), `shared audit range model missing: ${token}`)
  }
  for (const token of [
    'adminAuditRange(params:',
    "query.set('range', 'true')",
    "query.set('offset', String(params.offset))",
    "query.set('snapshot_max_id', String(params.snapshot_max_id))",
    'this.request<AuditEventRange>',
  ]) {
    assert.ok(webApi.includes(token), `Web audit range transport missing: ${token}`)
  }
})

test('Server audit range contract snapshots max id before offset paging', () => {
  for (const token of [
    'type auditEventRangeDTO struct',
    'SnapshotMaxID uint64',
    'auditEventRangeRequested',
    'auditEventListWindow',
    'COALESCE(MAX(id), 0) AS max_id',
    'bounded = bounded.Where("id <= ?", snapshotMaxID)',
    'Count(&totalCount)',
    'Offset(offset)',
    'SnapshotMaxID: snapshotMaxID',
    'before_id is not supported with range=true',
  ]) {
    assert.ok(auditAPI.includes(token), `Server audit range contract missing: ${token}`)
  }
})

test('shared fixed-row window and table surface support virtual admin tables', () => {
  assert.ok(
    virtualCollection.includes('export function xDriveVirtualCollectionFixedRowWindow'),
    'shared VirtualCollection fixed-row window helper is missing',
  )
  assert.ok(
    virtualCollection.includes('before: start * row'),
    'fixed-row window must expose leading spacer height',
  )
  assert.ok(
    virtualCollection.includes('after: Math.max(0, (count - end) * row)'),
    'fixed-row window must expose trailing spacer height',
  )
  assert.ok(tableSurface.includes('containerRef?: Ref<HTMLDivElement>'), 'table surface must expose its scroll host ref')
  assert.ok(tableSurface.includes('onScroll?: UIEventHandler<HTMLDivElement>'), 'table surface must expose scroll events')
  assert.ok(tableSurface.includes('ref={containerRef}'), 'table surface must attach the provided scroll host ref')
})
