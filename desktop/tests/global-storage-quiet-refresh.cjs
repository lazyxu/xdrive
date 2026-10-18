const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const page = fs.readFileSync(path.join(root, 'ui/shared/src/mui/GlobalStorageStatsPage.tsx'), 'utf8')
const web = fs.readFileSync(path.join(root, 'web/src/StorageStatsPanel.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/App.tsx'), 'utf8')

test('cold Global Storage never claims zero or flashes immediate progress before response', () => {
  for (const token of [
    'const [loading, setLoading] = useState(true)',
    'const [loadGeneration, setLoadGeneration] = useState(0)',
    'useXDriveDeferredLoading(loading, loadGeneration)',
    'data-xdrive-storage-first-read',
    'minHeight: 180',
    'stats && showDeferredLoading ? (',
    'data-xdrive-storage-first-read-error',
    'aria-busy={loading || undefined}',
    "minHeight: 180, display: 'grid', placeItems: 'center'",
  ]) assert.ok(page.includes(token), token)
  const coldStart=page.indexOf('data-xdrive-storage-first-read\n              aria-busy')
  assert.ok(coldStart>0,'verify the actual pending slot, not error-slot prefix')
  const cold=page.slice(coldStart,coldStart+180)
  const terminal=page.slice(page.indexOf('data-xdrive-storage-first-read-error'),
    page.indexOf('data-xdrive-storage-first-read-error')+180)
  assert.ok(cold.includes('minHeight: 180'))
  assert.ok(terminal.includes('minHeight: 180'))
  assert.ok(terminal.includes('XDriveStatusAlert'),
    'genuine first-load error must be visible without shrinking the page')
  assert.equal(page.includes('正在加载存储统计…'), false,
    'an unverified Global Storage first GET must remain silent beyond 300ms')
  assert.ok(page.includes('if (active) setError('), 'real initial failure must remain visible')
})

test('same-scope refresh preserves accepted metrics and diagnostics and stable page chrome', () => {
  const start = page.indexOf('const sourceChanged = acceptedScopeRef.current?.api !== api')
  const end = page.indexOf("const request = scope === 'global' ? api.adminStorageStats()", start)
  assert.ok(start > 0 && end > start, 'refresh must retain prior accepted source')
  const refresh = page.slice(start, end)
  assert.ok(refresh.includes('if (sourceChanged) {'))
  for (const reset of ['setStats(null)', 'setHealth(null)', 'setStaging(null)', 'setCleanupRuns([])',
    'setLegacyPage(null)', 'setUnreferencedPage(null)']) {
    assert.ok(refresh.includes(reset), 'real source transition retains reset: ' + reset)
  }
  assert.ok(page.includes('disabled={loading}'))
  assert.ok(page.includes('onClick={() => setReloadKey((value) => value + 1)}'))
  assert.equal(page.includes('loadingLabel="正在刷新…"'), false)
  assert.ok(page.includes('stats && showDeferredLoading'))
  assert.ok(page.includes("position: 'absolute', top: 0, left: 0, right: 0"))
})

test('different accounts and scopes never paint prior storage numbers while REST is pending', () => {
  for (const token of [
    'statsSnapshot?.api === api && statsSnapshot.scope === scope',
    'previous?.api === api && previous.scope === scope',
    'acceptedScopeRef.current = { api, scope }',
    'if (!active) return',
    'return () => { active = false }',
    'scope === \'global\' ? api.adminStorageStats() : api.storageStats()',
  ]) assert.ok(page.includes(token), token)
  assert.ok(web.includes("XDriveGlobalStorageStatsPage as default"))
  assert.ok(desktop.includes('<XDriveGlobalStorageStatsPage'))
})

test('true storage reads, CAS maintenance and transfer ownership are unchanged', () => {
  for (const token of [
    'api.adminStorageHealth()', 'api.adminStagingCleanupRuns(20, 0)',
    'api.adminCleanupUploadStaging()', 'onRunStorageMaintenance(kind)',
    'loadUnreferencedPage', 'loadLegacyPage', 'loadStagingPage',
    'onOpenTaskCenter?.()', 'XDriveStorageInventorySection',
  ]) assert.ok(page.includes(token), token)
})
