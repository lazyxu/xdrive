const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const mobileSource = read('web/src/MobileFiles.tsx')
const webAdapter = read('web/src/WebFileExplorer.tsx')
const sharedExplorer = read('ui/shared/src/mui/FileExplorer.tsx')
const stateFile = path.join(root, 'web/src/mobileFilesState.ts')
const transpiled = ts.transpileModule(fs.readFileSync(stateFile, 'utf8'), {
  fileName: stateFile,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const pkg = { exports: {} }
new Function('module', 'exports', transpiled)(pkg, pkg.exports)
const { mobileFilesDecodeState, mobileFilesEncodeState, mobileFilesWindow, mobileFilesIsMoved } = pkg.exports

test('iOS Files starts on Browse, restores known folders and rejects corrupted per-account state', () => {
  assert.deepEqual(mobileFilesDecodeState(null), {
    section: 'browse', folderID: null, scrollTop: 0, view: 'details',
  })
  assert.deepEqual(mobileFilesDecodeState('{corrupted'), mobileFilesDecodeState(null))
  const state = { section: 'favorites', folderID: 42, scrollTop: 800, view: 'grid' }
  assert.deepEqual(mobileFilesDecodeState(mobileFilesEncodeState(state)), state)
  assert.deepEqual(mobileFilesDecodeState('{"section":"random","folderID":-1,"scrollTop":-10,"view":"other"}'),
    mobileFilesDecodeState(null))
  assert.equal(mobileFilesDecodeState('{"folderID":1.5}').folderID, null)
  assert.equal(mobileFilesDecodeState('{"scrollTop":1e30}').scrollTop, 10000000)
})

test('10k/100k Mobile Files virtualizes only visible list/grid ranges', () => {
  for (const count of [10000, 100000]) {
    for (const row of [68, 150]) {
      const viewport = mobileFilesWindow(count, count * row * 0.5, 844, row)
      assert.ok(viewport.end - viewport.start <= Math.ceil(844 / row) + 12)
      assert.equal(viewport.before + (viewport.end - viewport.start) * row + viewport.after, count * row)
      assert.ok(viewport.start > 0)
      assert.ok(viewport.end < count)
    }
  }
  assert.deepEqual(mobileFilesWindow(0, 0, 650, 68),
    { start: 0, end: 0, before: 0, after: 0 })
})

test('hold threshold differentiates stationary menu, native scroll and drag', () => {
  assert.equal(mobileFilesIsMoved({ x: 0, y: 0 }, { x: 6, y: 8 }), false)
  assert.equal(mobileFilesIsMoved({ x: 0, y: 0 }, { x: 7, y: 8 }), true)
  assert.match(mobileSource, /MOBILE_FILES_HOLD_MS/)
  assert.match(mobileSource, /pointerDrag\.begin\(event, \[item\]\)/)
  assert.match(mobileSource, /pointerDrag\.cancel\(\)/)
  assert.match(mobileSource, /onDropToFolder\(sources, target\.folder\)/)
  assert.match(mobileSource, /onDropToCrumb\(sources, target\.crumb\)/)
})

test('the new Mobile UI is independent of the wide FileExplorer while sharing Web controllers', () => {
  assert.match(webAdapter, /useXDriveFileExplorerWorkspace/)
  assert.match(webAdapter, /useXDriveFileExplorerOperationController/)
  assert.match(webAdapter, /api\.listPage/)
  assert.match(webAdapter, /api\.searchRange/)
  assert.match(webAdapter, /compactMobile \? \(\s*<MobileFiles/)
  assert.match(webAdapter, /\) : \(\s*<XDriveFileExplorer/)
  assert.match(webAdapter, /requestedDirectoryID=\{initialDirectoryID\}/)
  assert.match(webAdapter, /onRestoreFolder=\{restoreMobileDirectory\}/)
  assert.match(mobileSource, /data-xdrive-mobile-files-home/)
  assert.match(mobileSource, /data-mobile-files-section=\{value\}/)
  assert.match(mobileSource, /\['recent',/)
  assert.match(mobileSource, /\['browse',/)
  assert.match(mobileSource, /\['favorites',/)
  assert.doesNotMatch(mobileSource, /<XDriveFileExplorer\b/)
  assert.match(sharedExplorer, /export function XDriveFileExplorer\(/)
})

test('iOS presentation keeps global Search semantics and does not change desktop view state', () => {
  assert.match(mobileSource, /搜索范围：全部文件（不限定当前文件夹）/)
  assert.match(mobileSource, /maxHeight: scrollTop > 48/)
  assert.match(mobileSource, /BLUE_FOLDER = '#2677e8'/)
  assert.match(mobileSource, /MOBILE_FILES_ROW_HEIGHT/)
  assert.match(mobileSource, /viewPreference === 'grid'/)
  assert.match(mobileSource, /setViewPreference\(next\); browseScrollRef\.current = 0/)
  assert.doesNotMatch(mobileSource, /props\.onViewModeChange\(next\)/)
  assert.match(mobileSource, /文件操作菜单/)
  assert.match(mobileSource, /overflowAction\('新建文件夹'/)
  assert.match(mobileSource, /overflowAction\('上传文件'/)
  assert.match(mobileSource, /overflowAction\('上传文件夹'/)
  assert.match(mobileSource, /data-xdrive-mobile-files-scroll/)
})

test('a held pointer opens Context Menu only on stationary release, not on drag or second touch', () => {
  const gestureStart = mobileSource.indexOf('const pointerDown =')
  const gestureEnd = mobileSource.indexOf('const menuFor =', gestureStart)
  const gestures = mobileSource.slice(gestureStart, gestureEnd)
  assert.match(gestures, /held: false, moved: false/)
  assert.match(gestures, /if \(press\.held\) press\.moved = true/)
  assert.match(gestures, /if \(press\.held && !press\.moved\)/)
  assert.match(gestures, /pointerDrag\.cancel\(\)/)
  assert.match(mobileSource, /onPointerCancel=\{\(\) => \{ closeHold\(\)/)
})

test('mobile Search filter and error recovery are reachable without a prior successful query', () => {
  assert.match(mobileSource, /placeholder="搜索全部文件"/)
  assert.match(mobileSource, /\{props\.filtersControl\}/)
  assert.match(mobileSource, /props\.searchSummary\?\.error/)
  assert.match(mobileSource, /props\.searchSummary\.onRetry/)
  assert.match(mobileSource, /全\u90e8文件（不限定当前文件夹）/)
  assert.match(mobileSource, /sectionWindow = mobileFilesWindow\(sectionItems\.length/)
  assert.match(mobileSource, /slice\(sectionWindow\.start, sectionWindow\.end\)/)
  assert.match(webAdapter, /grouping=\{trashActive \? undefined : grouping\}/)
  assert.match(webAdapter, /actionFeedback=\{actionFeedback\}/)
  assert.match(webAdapter, /if \(trashActive\) return/) 
  assert.match(webAdapter, /return openItem\(item,/) 
  assert.match(webAdapter, /onOpenError=\{onError\}/)
})

test('Mobile Files root, persisted section history and strict restoration stay separate', () => {
  assert.match(mobileSource, /if \(props\.crumbs\.length <= 1\) \{ beginBrowse\(null\); return \}/)
  assert.match(mobileSource, /restoreTaskRef = useRef/)
  assert.match(mobileSource, /restoreTaskRef\.current\?\.id !== folderID/)
  assert.match(mobileSource, /directoryID !== initial\.folderID/)
  assert.match(mobileSource, /pendingSectionScrollRef\.current/)
  assert.match(mobileSource, /browseScrollRef\.current/)
  assert.match(mobileSource, /pendingScrollRef\.current/)
  assert.match(mobileSource, /if \(pendingScrollRef\.current\) persist\(pendingScrollRef\.current\)/)
  assert.doesNotMatch(mobileSource, /didRestoreRef/)
})

test('global Search and saved rules retain browsing context and authoritative Server scope', () => {
  assert.match(mobileSource, /launchGlobalSearch\(\(\) => props\.onOpenSavedSearch\(entry\.id\)\)/)
  assert.match(mobileSource, /launchGlobalSearch\(\(\) => props\.onOpenTag\(entry\.id\)\)/)
  assert.match(mobileSource, /searchReturnHomeRef\.current/)
  assert.match(mobileSource, /onClick=\{clearGlobalSearch\}/)
  assert.match(mobileSource, /persist\(\{ section: 'browse' \}\)/)
  assert.doesNotMatch(mobileSource, /onClearSearch\(\); setBrowseHome\(true\)/)
})

test('recent and pinned folders navigate only after the existing Web controller accepts', () => {
  assert.match(webAdapter, /return recent\.activate\(/)
  assert.match(webAdapter, /return quickAccess\.navigate\(/)
  assert.match(mobileSource, /void open\.then\(accepted => \{/)
  assert.match(mobileSource, /accepted && intent === navigationIntentRef\.current/)
  assert.match(mobileSource, /props\.onOpenQuickAccess\(entry\.id\)\.then\(accepted =>/)
})

test('mobile batch actions retain selection until Done and never pretend all 100k are loaded', () => {
  const action = mobileSource.slice(mobileSource.indexOf('const selectedAction ='), mobileSource.indexOf('const selectAllCurrent ='))
  assert.match(action, /props\.onCopy\(selection\)/)
  assert.doesNotMatch(action, /setSelected\(/)
  assert.match(mobileSource, /if \(totalCount > 200\)/)
  assert.match(mobileSource, /props\.virtualCollection\?\.collectRange/)
  assert.match(mobileSource, /已选 \{selection\.length\} 项/)
  assert.match(mobileSource, /更多已选操作/)
  assert.match(mobileSource, /props\.onManageTags\(selection\)/)
})

test('Recent and Favorites have long-press/context menu without dangerous per-row overlays', () => {
  assert.match(mobileSource, /const collectionHoldRef = useRef/)
  assert.match(mobileSource, /setCollectionMenu\(\{ entry: press\.entry/)
  assert.match(mobileSource, /props\.onUnfavorite\(id\)/)
  assert.match(mobileSource, /props\.onClearRecent\(\)/)
  assert.match(mobileSource, /只清除最近打开的记录，不删除云端文件/)
  assert.match(webAdapter, /onClearRecent=\{\(\) => recent\.clear\(\)\}/)
  assert.match(webAdapter, /onUnfavorite=\{id => favorites\.unfavorite\(id\)\}/)
})

test('one shared media Inspector follows the opened identity and G06 location semantics', () => {
  assert.match(mobileSource, /const mediaKey = mediaEligible/)
  assert.match(mobileSource, /activeMediaState\?\.status !== 'done'/)
  assert.match(mobileSource, /XDriveMediaDetailsInspector open item=/)
  assert.match(mobileSource, /showPreview=\{false\}/)
  assert.match(mobileSource, /loadNodeLocation=\{props\.loadNodeLocation\}/)
  assert.match(mobileSource, /onShowInFolder=\{props\.onShowInFolder\}/)
})

test('grouped Mobile Files uses the shared authoritative layout and bounded range', () => {
  assert.match(mobileSource, /xDriveCreateFileExplorerGroupLayout\(/)
  assert.match(mobileSource, /groups: props\.virtualCollection\?\.groups \?\? \[\]/)
  assert.match(mobileSource, /xDriveFileExplorerVisibleGroupSegments\(/)
  assert.match(mobileSource, /data-xdrive-mobile-files-group-header=\{segment\.group\.key\}/)
  assert.match(mobileSource, /height: groupedLayout\.totalHeight/)
  assert.match(mobileSource, /groupedSegments\.map\(segment =>/)
  assert.match(mobileSource, /onRangeChange\(visible\[0\]\.startIndex, visible\[visible\.length - 1\]\.endIndex - 1\)/)
  assert.match(mobileSource, /useState<MobileFilesSection>\('browse'\)/)
  assert.doesNotMatch(mobileSource, /useState<MobileFilesSection>\(initial\.section\)/)
})
