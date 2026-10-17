const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo,file), 'utf8')
const mobile = read('web/src/MobileFiles.tsx')
const store = read('ui/shared/src/file-explorer-inline-range-store.ts')
const hook = read('ui/shared/src/mui/useDeferredLoading.ts')
const web = read('web/src/WebFileExplorer.tsx')

test('native-like Mobile Files disclosure remains interactive and mounted under child Range GET', () => {
  const start = mobile.indexOf("canDisclose ? (")
  const end = mobile.indexOf(") : <Box data-mobile-files-leading-spacer", start)
  assert.ok(start >= 0 && end > start)
  const branch = mobile.slice(start, end)
  for (const token of [
    "data-mobile-files-folder-disclosure={String(item.id)}",
    "aria-expanded={Boolean(inlineBranch)}",
    "aria-busy={Boolean(inlineBranch?.loading)}",
    "width: MIN_TOUCH, height: MIN_TOUCH",
    "position: 'relative'",
    "<ArrowBackIosNewRoundedIcon",
    "<MobileInlineDisclosureProgress pending={Boolean(inlineBranch?.loading)} />",
    "props.onToggleInlineFolder?.(item, ownerID, sourceIndex)",
    "props.onRetryInlineFolder?.(Number(item.id))",
    "event.stopPropagation()",
  ]) assert.ok(branch.includes(token),token)
  assert.equal(branch.includes('disabled={Boolean(inlineBranch?.loading)}'), false,
    'pending requests cannot disable cancellation by collapsing the folder')
  assert.equal(branch.includes('inlineBranch?.loading ? <CircularProgress'), false,
    'a pending GET cannot replace the chevron with a spinner')
  assert.ok(mobile.includes('function MobileInlineDisclosureProgress({ pending }'))
})

test('feedback is delayed only for real network pending, overlay never alters list geometry', () => {
  for (const token of [
    'useXDriveDeferredPendingLoading(pending)',
    'data-mobile-files-folder-disclosure-progress',
    'component="span"',
    'aria-hidden="true"',
    "position: 'absolute', right: 3, bottom: 3, width: 14, height: 14",
    "pointerEvents: 'none'",
    'show ? <CircularProgress size={12} /> : null',
  ]) assert.ok(mobile.includes(token),token)
  assert.ok(hook.includes('XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300'))
  assert.ok(hook.includes('return pending && visible'))
  assert.ok(store.includes('this.abort(branch)'), 'the existing child store supports real abort on collapse')
  assert.ok(store.includes('this.branches.delete(id)'))
  assert.ok(web.includes('inlineStore.toggle(Number(item.id), ownerID, parentIndex, item.name)'))
  assert.ok(mobile.includes('xDriveFileExplorerInlineLayout'))
  assert.ok(mobile.includes('XDriveFileExplorerThumbnail'),
    'file thumbnails and real network fallback must remain independent')
})
