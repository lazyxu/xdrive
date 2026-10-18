const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(repo, p), 'utf8')
const pane = read('ui/shared/src/mui/FileExplorerNavigationPane.tsx')
const hook = read('ui/shared/src/mui/useDeferredLoading.ts')
const web = read('web/src/WebFileExplorer.tsx')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')

test('organization first read and refresh do not insert an immediate in-flow loading row', () => {
  const start = pane.indexOf('const organizationReadState =')
  const end = pane.indexOf('  return (\n    <Box', start)
  assert.ok(start > 0 && end > start, 'real shared pane has an organization state presenter')
  const status = pane.slice(start, end)
  assert.ok(status.includes('!organizationLoading && organizationError ? ('))
  assert.equal(status.includes('organizationLoading ? ('), false)
  assert.equal(status.includes('CircularProgress'), false, 'no eager in-flow ring')
  assert.equal(status.includes('正在更新'), false, 'no transient in-flow status label')
  assert.ok(status.includes('role="alert"'), 'real read failure is visible')
  assert.ok(status.includes('onRetryOrganization'), 'retry remains accessible')
  assert.ok(status.includes('以下显示上次成功读取的内容。'), 'old successful entries remain labeled on error')
})

test('both organization headings preserve fixed 14px geometry but never flash progress', () => {
  for (const id of ['saved-searches', 'tags']) {
    assert.ok(pane.includes('data-xdrive-organization-quiet-header="' + id + '"'))
  }
  assert.equal((pane.match(/aria-busy=\{organizationLoading \|\| undefined\}/g) || []).length, 2)
  assert.equal(pane.includes('XDriveNavigationQuietSpinner'), false)
  assert.equal(pane.includes('CircularProgress'), false)
  assert.ok(pane.includes("width: 14, height: 14, flexShrink: 0, display: 'grid', placeItems: 'center'"))
  assert.ok(pane.includes('data-xdrive-organization-quiet-header="tags" aria-hidden="true"'))
  assert.ok(pane.includes('data-xdrive-organization-quiet-header="saved-searches" aria-hidden="true"'))
  assert.ok(hook.includes('XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300'),
    'shared genuine network loading rules elsewhere remain available')
})

test('actual organized data/actions and shared Web/Desktop transports stay unchanged', () => {
  for (const token of [
    "organizationReadState('智能文件夹', savedSearches.length)",
    "organizationReadState('标签', tags.length)",
    "onSaveCurrentSearch", "onManageTags", "onActivateSavedSearch",
    "onActivateTag", "onRetryOrganization", "savedSearches.map((search)",
    "tags.map((tag)", "requestLifecycleKey !== lifecycleKeyRef.current",
  ]) assert.ok(pane.includes(token), token)
  for (const [name, code] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(code.includes('XDriveFileExplorerNavigationPane'), name)
    assert.ok(code.includes('loadDirectoryPage={loadTreeDirectoryPage}'), name)
  }
})
