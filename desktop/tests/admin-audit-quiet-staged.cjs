const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const view = fs.readFileSync(path.join(root, 'ui/shared/src/mui/AdminAuditPage.tsx'), 'utf8')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/mui/VirtualCollectionController.ts'), 'utf8')
const web = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/App.tsx'), 'utf8')

test('cold audit first page has a fixed-height quiet slot and no immediate fake empty/spinner', () => {
  for (const token of [
    'useXDriveDeferredLoading(loading && totalCount !== null, requestGeneration)',
    'data-xdrive-admin-audit-first-read',
    'minHeight: 180',
    'aria-busy={loading || !error || undefined}',
    '审计日志读取失败，请重试。',
    'acceptedSource === api ? virtualCollection.totalCount : null',
    'setAcceptedSource(api)',
  ]) assert.ok(view.includes(token), token)
  assert.equal(view.includes('正在加载审计日志…'), false, 'cold audit GET must never spawn a delayed spinner')
  assert.ok(view.includes('totalCount === null || totalCount === 0 ? 180 : undefined'),
    'verified zero must retain the exact cold height')
  assert.ok(view.includes('loading={false}') === false)
})

test('filter first page is fetched and validated before replacing accepted sparse rows', () => {
  const stage = view.slice(view.indexOf('const applyFilters = useCallback'), view.indexOf('const visibleRows:'))
  const get = stage.indexOf('void api.adminAuditRange({')
  const guard = stage.indexOf('Number.isSafeInteger(page.total_count)')
  const reset = stage.indexOf('virtualCollection.reset(nextKey)')
  const prime = stage.indexOf('virtualCollection.primePage({')
  const commit = stage.indexOf('setAppliedFilters(nextFilters)')
  assert.ok(get >= 0 && guard > get && reset > guard && prime > reset && commit > prime,
    'do not clear sparse collection until a valid matching owner first Range is available')
  assert.ok(stage.includes('page.snapshot_max_id'))
  assert.ok(stage.includes('page.offset !== 0'))
  assert.ok(stage.includes('page.items.length > page.total_count'))
  assert.ok(stage.includes('stagedQueryKeyRef.current = nextKey'))
  assert.ok(view.includes('if (stagedQueryKeyRef.current === queryKey)'), 'no duplicate first-range request')
  assert.ok(source.includes('const reset = useCallback'), 'reuse shared canonical virtualizer generation')
  assert.ok(source.includes('const primePage = useCallback'), 'prime one authoritative counted Range')
})

test('stale/failed or source-switched filter cannot overwrite previous audit rows or scroll', () => {
  const stage = view.slice(view.indexOf('const applyFilters = useCallback'), view.indexOf('const visibleRows:'))
  for (const token of [
    'pendingFilterRef.current?.abort()',
    'initialReadRef.current?.abort()',
    'controller.signal.aborted',
    'pendingFilterRef.current !== controller',
    'activeApiRef.current !== api',
    'handleRangeError(nextError)',
    'setLoading(false)',
    'setRequestGeneration((value) => value + 1)',
  ]) assert.ok(stage.includes(token), token)
  assert.ok(view.includes('sourceScopeRef.current.serial + 1'), 'account switch isolates query keys')
  assert.ok(view.includes('errorSnapshot?.source === api'), 'old account errors cannot render')
  assert.ok(view.includes('useLayoutEffect(() => {'), 'accepted scope scroll resets before paint')
  assert.ok(view.includes('}, [queryKey])'), 'pending filter does not reset scroll')
  assert.equal(stage.includes('setScrollTop(0)'), false)
  assert.equal(stage.includes('setAppliedFilters(normalizeAuditFilters(filters))'), false)
})

test('filter buttons and update feedback never push a virtualized audit table down', () => {
  assert.ok(view.includes('disabled={loading}'))
  assert.ok(view.includes('onClick={() => applyFilters({ action, result, actor })}'))
  assert.ok(view.includes('data-xdrive-admin-audit-content'))
  assert.ok(view.includes('totalCount !== null && delayedLoading'))
  assert.ok(view.includes('!loading && error ? ('), 'preserve true error/retry')
  assert.ok(view.includes("position: 'absolute', top: 0, left: 0, right: 0"))
  assert.equal(view.includes('loadingLabel="正在加载…"'), false)
  assert.ok(view.includes('data-xdrive-admin-audit-mobile-list'))
  assert.ok(view.includes('virtualCollection.loadedItems.get(index)'))
  assert.ok(view.includes('snapshot_max_id: snapshotMaxID'), 'range continuation stays snapshot-bound')
  assert.ok(web.includes('<AdminAuditPanel api={api} />'))
  assert.ok(desktop.includes('<XDriveAdminAuditPage'))
})
