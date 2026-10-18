const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(root, 'ui/shared/src/mui', file), 'utf8')

test('source overview must not claim no sources before its first authorized read', () => {
  const manager = read('SourceManager.tsx')
  const list = read('SourceManagerListPage.tsx')
  assert.ok(manager.includes('const [loading, setLoading] = useState(true)'))
  assert.ok(manager.includes('const [hasLoaded, setHasLoaded] = useState(false)'))
  assert.ok(manager.includes('const [loadError, setLoadError] = useState(false)'))
  assert.ok(manager.includes('useXDriveDeferredLoading(loading, loadRequestGeneration)'))
  assert.ok(manager.includes('setLoadRequestGeneration((n) => n + 1)'))
  assert.ok(manager.includes('setRows(next)') && manager.includes('setHasLoaded(true)'))
  assert.ok(list.includes('!hasLoaded && loading ? ('))
  assert.ok(list.includes('data-xdrive-source-overview-loading-slot'))
  assert.ok(list.includes('minHeight: 180'))
  assert.ok(list.includes('data-xdrive-source-overview-loading-slot'))
  assert.ok(list.includes('aria-busy="true"'))
  assert.ok(list.includes("minHeight: 180, display: 'grid', placeItems: 'center'"))
  assert.equal(list.includes('正在加载${sourceNoun}…'),false,
    'first Server read never mounts a timer-triggered intermediary caption')
  assert.ok(list.includes('data-xdrive-source-overview-verified-empty'))
  assert.ok(list.includes('data-xdrive-source-overview-first-read-error'))
  assert.ok(list.includes('rows.length === 0 ? ('))
  assert.ok(list.includes('message={`尚未添加${sourceNoun}`}'))
  assert.ok(manager.includes('showDelayedLoading={showDelayedLoading}'))
})

test('source refresh preserves confirmed rows and publishes failures without fake emptiness', () => {
  const manager = read('SourceManager.tsx')
  const list = read('SourceManagerListPage.tsx')
  assert.ok(manager.includes('if (!silent) setLoadError(false)'),
    'clear error only once the next overview succeeds')
  assert.ok(manager.includes('if (!silent) setLoadError(true)'),
    'failed fetch must publish an explicit failure')
  assert.ok(manager.includes('setSelected((current) => current'),
    'authorized selected source remains while next overview loads')
  assert.ok(list.includes('loadError && rows.length > 0 ? ('),
    'failed refresh keeps old rows visible')
  assert.ok(list.includes('loadError && rows.length === 0 ? ('),
    'first fetch failure must not claim an empty collection')
  assert.ok(list.includes('无法读取{sourceNoun}，请点击刷新重试。'))
  assert.ok(list.includes('disabled={loading}'))
  assert.ok(list.includes('loading={showDelayedLoading}'))
  assert.ok(list.includes('loadingLabel="刷新"'), 'no variable-width fast badge')
  assert.ok(!list.includes('loading && rows.length === 0 ? ('),
    'unverified zero rows cannot be shown as a transient spinner surface')
  assert.ok(!manager.includes('setRows([])'),
    'background refresh must not blank accepted source cards')
})
