const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const mobile = read('web/src/MobileFiles.tsx')
const sharedHook = read('ui/shared/src/mui/useDeferredLoading.ts')
const web = read('web/src/WebFileExplorer.tsx')
const explorer = read('ui/shared/src/mui/FileExplorerNavigationPane.tsx')

test('real compact Browse Home never inserts an ephemeral organization loading row', () => {
  const start = mobile.indexOf('<Box data-xdrive-mobile-files-home')
  const end = mobile.indexOf('data-mobile-files-arrangement-status', start)
  assert.ok(start >= 0 && end > start)
  const home = mobile.slice(start, end)
  assert.ok(home.includes('data-xdrive-mobile-files-home'))
  assert.ok(home.includes(
    'aria-busy={props.organizationLoading || pendingGlobalSearchPresentation || undefined}'),
    'Home must stay semantically busy for an authorized Search intent without adding a loading row')
  assert.ok(home.includes('data-mobile-files-organization-loading'))
  assert.equal((mobile.match(/data-mobile-files-organization-loading/g) || []).length, 1,
    'one persistent status slot instead of a conditional extra row')
  assert.ok(home.includes("position: 'absolute', top: 12, right: 16, width: 16, height: 16"))
  assert.ok(home.includes("pointerEvents: 'none'"))
  assert.ok(home.includes('data-mobile-files-organization-loading'))
  assert.ok(home.includes('aria-hidden="true"'))
  assert.equal(home.includes('showOrganizationLoading'), false)
  assert.equal(home.includes('正在加载智能文件夹和标签…'), false,
    'never shift the Browse Home while a short API read is pending')
})

test('real organization REST is immediate; never mount visual spinner; true errors remain actionable', () => {
  assert.equal(mobile.includes('showOrganizationLoading'), false)
  assert.equal(mobile.includes('useXDriveDeferredPendingLoading'), false)
  assert.ok(sharedHook.includes('XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300'),
    'other genuinely visible progress indicators retain their own feedback contract')
  assert.ok(mobile.includes('!props.organizationLoading && props.organizationError ? ('))
  for (const text of [
    'data-mobile-files-organization-error',
    'props.onRetryOrganization',
    'props.savedSearches.map((entry, index)',
    'props.tags.map(entry',
    'props.onOpenSavedSearch(entry.id)',
    'props.onOpenTag(entry.id)',
    'data-xdrive-mobile-files-home',
  ]) assert.ok(mobile.includes(text), 'original Browse Home must retain: ' + text)
  assert.ok(web.includes('organizationLoading={organization.loading}'))
  assert.ok(explorer.includes('data-xdrive-organization-quiet-header'))
})

test('folder Range state, photo/file thumbnail progress, scroll owner and 52px App frame remain untouched', () => {
  for (const text of [
    'data-mobile-files-zero-state',
    'const coldUnconfirmedBrowse =',
    'const keepAcceptedEmptyDirectory =',
    'const showArrangementLoading =',
    'const pendingScrollRef',
    'XDriveFileExplorerThumbnail',
    'const totalCount = props.virtualCollection?.itemCount ?? props.items.length',
  ]) assert.ok(mobile.includes(text), text)
  assert.ok(web.includes('loadPage: (id, options) => api.listPage(id, options)'))
})
