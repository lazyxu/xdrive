const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p), 'utf8')
const controller = read('ui/shared/src/mui/FileExplorerTrashController.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const mobile = read('web/src/MobileFiles.tsx')
test('shared Trash controller first-read receipt follows current authenticated query and current request only', () => {
  for (const token of [
    "state: 'unverified' | 'ready' | 'error'", "queryKey: ''",
    "setReadReceipt({ queryKey: rangeQueryKey, state: 'ready' })",
    "setReadReceipt({ queryKey: rangeQueryKey, state: 'error' })",
    "readReceipt.queryKey === rangeQueryKey",
    "visibleScopeRef.current.lifecycleKey === lifecycleKey",
    "visibleScopeRef.current.enabled === enabled",
    "virtualCollection: scopeVisible ? virtualCollection : undefined",
    "items: scopeVisible ? items : []",
    "requestID === requestRef.current && enabledRef.current",
  ]) assert.ok(controller.includes(token), token)
  assert.ok(controller.includes("setReadReceipt({ queryKey: '', state: 'unverified' })"))
  const start = controller.indexOf("const refresh = useCallback(async () =>")
  const firstPage = controller.indexOf("const page = await adapter.listTrashRange(", start)
  const reset = controller.indexOf('rangeCollection.reset(rangeQueryKey)', firstPage)
  const claim = controller.indexOf('if (requestID === requestRef.current && enabledRef.current)', firstPage)
  assert.ok(start >= 0 && firstPage > start && claim > firstPage && reset > claim,
    'never reset the accepted sparse list before a matching successful first Range')
  assert.equal(controller.slice(start,firstPage).includes('rangeCollection.reset(rangeQueryKey)'), false)
})
test('real Mobile Trash only advertises zero after confirmed current GET, keeps retries and thumbnails', () => {
  assert.ok(web.includes('trashReadState={trash.readState}'))
  assert.ok(web.includes('useXDriveFileExplorerTrash({'))
  assert.ok(desktop.includes('useXDriveFileExplorerTrash({'))
  for (const token of [
    "trashReadState?: 'unverified' | 'ready' | 'error'",
    "const trashReadState = props.trashReadState ?? 'ready'",
    "const verifiedTrashEmpty = props.trashActive && trashReadState === 'ready'",
    "trashReadState === 'unverified'",
    "const failedTrashEmpty = props.trashActive",
    "data-mobile-files-trash-first-read",
    "data-mobile-files-trash-read-error",
    "onClick={props.onRefresh}",
    "loading={zeroStateLoading} message={zeroStateMessage}",
    "XDriveFileExplorerThumbnail",
    "const totalCount = props.virtualCollection?.itemCount ?? props.items.length",
  ]) assert.ok(mobile.includes(token), token)
  assert.ok(mobile.includes("minHeight: 180, display: 'grid', placeItems: 'center'"))
  assert.ok(mobile.includes("props.searchActive || (props.trashActive && totalCount > 0)"),
    'unverified zero Trash may not schedule a display-only timer')
  assert.ok(mobile.includes("aria-busy={props.loading || trashReadState === 'unverified' || undefined}"))
  assert.equal(mobile.includes('正在读取最近删除…'), false,
    'no transient first-GET loading caption may reappear on Mobile Web')
  const start = mobile.indexOf('data-mobile-files-trash-first-read')
  const end = mobile.indexOf('data-mobile-files-trash-read-error', start)
  assert.ok(start >= 0 && end > start)
  assert.equal(mobile.slice(start, end).includes('XDriveStatePanel'), false,
    'original Mobile Trash unverified branch must stay a self-closing silent slot')
  assert.ok(mobile.includes('300'),
    'deliberate Search and already-populated Trash feedback is not disabled')
})
