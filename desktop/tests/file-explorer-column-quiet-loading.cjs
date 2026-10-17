const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'ui/shared/src/mui/FileExplorerColumnView.tsx'), 'utf8')
const web = fs.readFileSync(path.join(__dirname, '..', '..', 'web/src/WebFileExplorer.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(__dirname, '..', '..', 'desktop/src/renderer/DesktopFileExplorer.tsx'), 'utf8')

test('FileExplorer columns never mount a momentary in-flow spinner on fast GET', () => {
  assert.ok(source.includes('useXDriveDeferredLoading(loading, generation)'))
  assert.ok(source.includes('<ColumnNetworkFeedback loading={state.loading} generation={state.generation} />'))
  assert.ok(source.includes("position: 'absolute', right: 8, bottom: 8"))
  assert.equal(source.includes("py: 1.5, display: 'grid'"), false)
  assert.ok(source.includes('generationRef.current.set(key, generation)'))
  assert.ok(source.includes('controllersRef.current.get(key)?.abort()'))
  assert.ok(source.includes('controller.signal.aborted || generationRef.current.get(key) !== generation'))
})

test('unconfirmed or failed first column read never claims a true empty folder', () => {
  assert.ok(source.includes('loaded: false'))
  assert.ok(source.includes('error: false'))
  assert.ok(source.includes('loaded: true,\n            error: false'))
  assert.ok(source.includes('loading: false, error: true, generation'))
  assert.ok(source.includes('state.loaded && !state.error && state.items.length === 0'))
  assert.ok(source.includes('!state?.loaded && !state?.loading && !state?.error'))
  assert.ok(source.includes('data-xdrive-column-error'))
  assert.ok(source.includes('文件夹读取失败'))
  assert.ok(source.includes('state.loaded && Boolean(state.nextCursor)'))
})

test('session changes cannot expose stale columns on their first render', () => {
  assert.ok(source.includes('const ownerCurrent = lifecycleKeyRef.current === lifecycleKey'))
  assert.ok(source.includes('const displayColumns = ownerCurrent ? columns : {}'))
  assert.ok(source.includes('displayColumns[String(crumb.id)] ?? emptyColumn()'))
  assert.ok(source.includes('controllersRef.current.clear()'))
  assert.ok(web.includes('interactionLifecycleKey={navigationSessionStorageKey ?? \'\'}'))
  assert.ok(desktop.includes('interactionLifecycleKey={navigationSessionStorageKey ?? \'\'}'))
})
