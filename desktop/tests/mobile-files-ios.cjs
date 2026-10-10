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
const virtualSource = path.join(root, 'ui/shared/src/mui/FileExplorerVirtualSurface.ts')
const virtualCompiled = ts.transpileModule(fs.readFileSync(virtualSource, 'utf8'), {
  fileName: virtualSource,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const virtualPkg = { exports: {} }
new Function('module', 'exports', virtualCompiled)(virtualPkg, virtualPkg.exports)
const pkg = { exports: {} }
new Function('module', 'exports', 'require', transpiled)(pkg, pkg.exports, moduleName => {
  assert.equal(moduleName, '../../ui/shared/src/mui/FileExplorerVirtualSurface')
  return virtualPkg.exports
})
const { mobileFilesDecodeState, mobileFilesEncodeState, mobileFilesWindow, mobileFilesIsMoved } = pkg.exports

test('Mobile Files centralizes Apple-reference blue and document palette across views', () => {
  const start = mobileSource.indexOf('const IOS_FILES_ICON_COLORS =')
  const end = mobileSource.indexOf('function MobileFolderIcon', start)
  const colors = mobileSource.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.match(colors, /folderBackTop: '#69c8ee'/)
  assert.match(colors, /folderBackBottom: '#49add9'/)
  assert.match(colors, /folderFrontTop: '#7dceeb'/)
  assert.match(colors, /folderFrontMiddle: '#5dbce3'/)
  assert.match(colors, /folderOutline: '#399abf'/)
  assert.match(colors, /folderHighlight: '#e8fbff'/)
  assert.match(colors, /documentPaper: '#ffffff'/)
  assert.match(colors, /documentBorder: '#c4cad2'/)
  assert.match(mobileSource, /stopColor=\{IOS_FILES_ICON_COLORS\.folderFrontTop\}/)
  assert.match(mobileSource, /stopColor=\{IOS_FILES_ICON_COLORS\.folderFrontMiddle\}/)
  assert.match(mobileSource, /stroke=\{IOS_FILES_ICON_COLORS\.folderOutline\}/)
  assert.match(mobileSource, /fill=\{IOS_FILES_ICON_COLORS\.documentPaper\}/)
  assert.match(mobileSource, /fill=\{IOS_FILES_ICON_COLORS\.documentFold\}/)
  assert.equal((mobileSource.match(/function MobileFolderIcon\(/g) || []).length, 1)
  assert.equal((mobileSource.match(/function MobileDocumentIcon\(/g) || []).length, 1)
})

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

test('10k/100k Mobile viewport delegates to the shared Desktop FileExplorer window kernel', () => {
  const shared = virtualPkg.exports.xDriveFileExplorerDetailsVirtualWindow
  for (const count of [0, 10_000, 100_000]) {
    for (const rowHeight of [68, 150]) {
      for (const height of [240, 390, 844]) {
        const top = count * rowHeight * 0.8
        assert.deepEqual(mobileFilesWindow(count, top, height, rowHeight), shared({
          itemCount: count, scrollTop: top, viewportHeight: height,
          rowHeight, headerHeight: 0, overscan: 5, minViewportHeight: 300,
        }))
      }
    }
  }
  assert.match(read('web/src/mobileFilesState.ts'), /xDriveFileExplorerDetailsVirtualWindow\(\{/)
  assert.match(read('ui/shared/src/mui/FileExplorerVirtualSurface.ts'), /minViewportHeight/)
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
  assert.match(mobileSource, /BLUE_FOLDER = '#4caddb'/)
  assert.match(mobileSource, /data-xdrive-mobile-folder-icon/)
  assert.match(mobileSource, /data-xdrive-mobile-document-icon/)
  assert.match(mobileSource, /const paintID = useId\(\)/)
  assert.match(mobileSource, /-folder-front/)
  assert.match(mobileSource, /MOBILE_DOCUMENT_BADGES/)
  assert.match(mobileSource, /fallback=\{<MobileDocumentIcon item=\{item\}/)
  assert.match(mobileSource, /<MobileFolderIcon size=\{effectiveGrid \? 62 : 38\}/)
  assert.match(mobileSource, /<MobileDocumentIcon item=\{entry\}/)
  assert.doesNotMatch(mobileSource, /XDriveFileExplorerItemIcon/,
    'Mobile icons must not embed desktop file glyphs')
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

test('F-PARITY-07F: Mobile bulk selection uses shared chunks, progress, cancel and preserves previous state', () => {
  const action = mobileSource.slice(mobileSource.indexOf('const selectedAction ='), mobileSource.indexOf('const cancelSelectAll ='))
  assert.match(action, /props\.onCopy\(selection\)/)
  assert.doesNotMatch(action, /setSelected\(/)
  assert.doesNotMatch(mobileSource, /if \(totalCount > 200\)/)
  assert.match(mobileSource, /XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE/)
  assert.match(mobileSource, /collection\?\.collectRange/)
  assert.match(mobileSource, /selectionIntentRef\.current === intent && selectionScopeRef\.current === scope/)
  assert.match(mobileSource, /new Set\(results\.map\(mobileItemKey\)\)\.size !== count/)
  assert.match(mobileSource, /data-mobile-files-select-cancel/)
  assert.match(mobileSource, /data-mobile-files-select-progress/)
  assert.match(mobileSource, /已选 \$\{selection\.length\} 项/)
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
  assert.match(mobileSource, /props\.virtualCollection\?\.groups \?\? \[\]/)
  assert.match(mobileSource, /xDriveFileExplorerInlineGroupIndex\(/)
  assert.match(mobileSource, /groups: groups \?\? \[\]/)
  assert.match(mobileSource, /xDriveFileExplorerVisibleGroupSegments\(/)
  assert.match(mobileSource, /data-xdrive-mobile-files-group-header=\{segment\.group\.key\}/)
  assert.match(mobileSource, /height: groupedLayout\.totalHeight/)
  assert.match(mobileSource, /groupedSegments\.map\(segment =>/)
  assert.match(mobileSource, /onRangeChange\(visible\[0\]\.startIndex, visible\[visible\.length - 1\]\.endIndex - 1\)/)
  assert.match(mobileSource, /useState<MobileFilesSection>\('browse'\)/)
  assert.doesNotMatch(mobileSource, /useState<MobileFilesSection>\(initial\.section\)/)
})

test('iOS Files icons retain real thumbnail ownership and stable list/grid proportions', () => {
  const iconLayer = mobileSource.slice(mobileSource.indexOf('const BLUE_FOLDER ='), mobileSource.indexOf('const MIN_TOUCH ='))
  assert.match(iconLayer, /viewBox="0 0 64 54"/)
  assert.match(iconLayer, /viewBox="0 0 44 52"/)
  assert.match(iconLayer, /linearGradient/)
  assert.match(iconLayer, /data-xdrive-mobile-folder-icon/)
  assert.match(iconLayer, /data-xdrive-mobile-document-icon/)
  assert.match(mobileSource, /eligible=\{xDriveFileSupportsThumbnail\(item.name, item.kind\)\}/)
  assert.match(mobileSource, /<XDriveFileExplorerThumbnail item=\{item\}/)
  assert.match(mobileSource, /borderRadius: 0/)
  assert.match(mobileSource, /<MobileFolderIcon size=\{35\}/)
  assert.match(mobileSource, /<MobileDocumentIcon item=\{entry\} size=\{29\}/)
})

test('Mobile home uses location semantics, not generic folder icons', () => {
  assert.match(mobileSource, /locationKind === 'cloud'/)
  assert.match(mobileSource, /locationKind === 'trash'/)
  assert.match(mobileSource, /locationKind === 'smart'/)
  assert.match(mobileSource, /locationKind === 'tag'/)
  assert.match(mobileSource, /true, undefined, 'cloud'/)
  assert.match(mobileSource, /true, undefined, 'trash'/)
  assert.match(mobileSource, /kind === 'saved' \? 'smart' : undefined/)
  assert.match(mobileSource, /editableHomeRow\(\{\s*\.\.\.entry, kind: 'dir', subtitle: entry\.subtitle/)
  assert.match(mobileSource, /false, undefined, 'tag'/)
  assert.match(mobileSource, /<MobileFolderIcon size=\{35\}/)
})

test('Recent/Favorites reuse viewport-controlled thumbnail cache and real item actions', () => {
  assert.match(mobileSource, /<XDriveFileExplorerThumbnail item=\{entry\}/)
  assert.match(mobileSource, /eligible=\{xDriveFileSupportsThumbnail\(entry\.name, entry\.kind\)\}/)
  assert.match(mobileSource, /data-xdrive-file-explorer-scroll-host/)
  assert.match(mobileSource, /xDriveFileExplorerMarkThumbnailScrollActivity\(event\.currentTarget\)/)
  assert.match(mobileSource, /data-mobile-files-collection-action="copy"/)
  assert.match(mobileSource, /data-mobile-files-collection-action="download"/)
  assert.match(mobileSource, /data-mobile-files-collection-action="share"/)
  const adapter = read('web/src/WebFileExplorer.tsx')
  assert.match(adapter, /updatedAt: item\.updatedAt/)
  assert.match(adapter, /onCollectionAction=\{collectionAction\}/)
  assert.match(adapter, /const node = await api\.node\(entry\.id\)/)
  assert.match(adapter, /renameLifecycleKeyRef\.current !== lifecycle/)
  assert.match(adapter, /copyWorkspaceNodes\(\[node\]\)/)
  assert.match(adapter, /const plan = xDriveFileExplorerWebDownloadPlan\(\[node\]\)/)
  assert.match(adapter, /const downloadSelected = async/)
  assert.ok(adapter.indexOf('const downloadSelected = async') < adapter.indexOf('const collectionAction = async'))
  assert.match(adapter, /onShare\(node\)/)
  const clipboard = read('ui/shared/src/mui/FileExplorerClipboard.ts')
  assert.match(clipboard, /const copyNodes = \(nodes: readonly TNode\[\]\)/)
  assert.match(clipboard, /setClipboard\(\{ mode: 'copy', nodes: \[\.\.\.nodes\] \}\)/)
})

test('Mobile selection replaces, never stacks upon, the Files category rail', () => {
  assert.match(mobileSource, /selectionActive \? \(/)
  assert.match(mobileSource, /data-xdrive-mobile-selection-toolbar/)
  assert.match(mobileSource, /component="nav"/)
  assert.match(mobileSource, /aria-pressed=\{selectionMode \? chosen : undefined\}/)
  assert.match(mobileSource, /<CheckCircleRoundedIcon/)
  assert.match(mobileSource, /<RadioButtonUncheckedRoundedIcon/)
  assert.match(mobileSource, /aria-label="下载已选"/)
  assert.match(mobileSource, /pb: 'max\(env\(safe-area-inset-bottom\), 4px\)'/)
  assert.match(mobileSource, /data-mobile-files-arrangement-status/)
  assert.match(mobileSource, /const arrangementLabel =/)
  assert.match(mobileSource, /props\.sort\.direction === 'asc' \? '↑' : '↓'/)
})

test('Mobile Browse editor persists only visibility locally and delegates ordering to authoritative controllers', () => {
  assert.match(mobileSource, /xdrive\.mobile\.files\.sections\.v1:/)
  assert.match(mobileSource, /data-mobile-files-home-section="quick"/)
  assert.match(mobileSource, /data-mobile-files-home-section="organization"/)
  assert.match(mobileSource, /data-mobile-files-home-edit-item=\{kind\}/)
  assert.match(mobileSource, /locationKind \?\? owner \?\? 'home'/)
  assert.match(mobileSource, /key=\{`\$\{kind\}:\$\{entry\.id\}`\}/)
  assert.match(mobileSource, /onReorderQuickAccess\?\.\(ids\)/)
  assert.match(mobileSource, /onReorderSavedSearches\?\.\(ids\)/)
  assert.match(mobileSource, /window\.localStorage\.setItem\(browseSectionsKey, JSON\.stringify\(next\)\)/)
  assert.match(mobileSource, /aria-expanded=\{browseSections\.quick\}/)
  assert.match(mobileSource, /aria-expanded=\{browseSections\.organization\}/)
  const adapter = read('web/src/WebFileExplorer.tsx')
  assert.match(adapter, /onReorderQuickAccess=\{ids => quickAccess\.reorder\(ids\)\}/)
  assert.match(adapter, /onReorderSavedSearches=\{ids => organization\.reorderSavedSearches\(ids\)\}/)
  assert.doesNotMatch(mobileSource, /props\.onViewModeChange\(next\)/)
})

test('F-iOS-01A: Mobile-only large-title chrome and grouped iOS surfaces preserve original viewport work', () => {
  assert.match(mobileSource, /IOS_FILES_MOBILE_FONT/)
  assert.match(mobileSource, /IOS_FILES_MOBILE_BLUE = '#007aff'/)
  assert.match(mobileSource, /data-mobile-files-navigation-bar/)
  assert.match(mobileSource, /data-mobile-files-compact-title/)
  assert.match(mobileSource, /data-mobile-files-large-title/)
  assert.match(mobileSource, /compactTitleVisible = scrollTop > 48/)
  assert.match(mobileSource, /component="h2"/)
  for (const group of ['locations', 'quick', 'organization', 'directory', 'collection']) {
    assert.ok(mobileSource.includes(`data-mobile-files-group="${group}"`), 'missing Mobile-only native grouped section: ' + group)
  }
  assert.match(mobileSource, /borderRadius: '13px'/)
  assert.match(mobileSource, /left: 60, right: 0/)
  assert.match(mobileSource, /MOBILE_FILES_ROW_HEIGHT/)
  assert.match(mobileSource, /MOBILE_FILES_GRID_ROW_HEIGHT/)
  assert.match(mobileSource, /xDriveFileExplorerVisibleGroupSegments/)
  assert.match(mobileSource, /data-xdrive-file-explorer-scroll-host/)
  assert.doesNotMatch(mobileSource, /props\.onViewModeChange\(next\)/)
})

test('F-iOS-01A: context menu consumes shared action icon/divider/danger metadata', () => {
  assert.match(mobileSource, /mobileContextAction = \(action: XDriveFileExplorerMenuItem\)/)
  assert.match(mobileSource, /<ListItemIcon sx=\{\{ minWidth: 34/)
  assert.match(mobileSource, /item\.dividerBefore/)
  assert.match(mobileSource, /item\.danger/)
  assert.match(mobileSource, /data-mobile-files-context-separator="danger"/)
  assert.match(mobileSource, /data-mobile-files-context-action=\{action\.id\}/)
  assert.match(mobileSource, /action\.id === 'share' \? '分享链接' : action\.label/)
  assert.match(mobileSource, /action\.id !== 'open-new-tab'/)
  assert.doesNotMatch(mobileSource, /\['open-new-tab', 'open-browser-tab'\]/)
  assert.match(mobileSource, /data-mobile-files-native-share-entry="directory"/)
})

test('F-PARITY-01A: Mobile Properties reuse the wide Web stats loader, abortable hook and dialog', () => {
  const adapter = read('web/src/WebFileExplorer.tsx')
  assert.match(adapter, /loadPropertiesStats=\{loadPropertiesStats\}/)
  assert.match(mobileSource, /useXDriveFileExplorerPropertiesController\(\{/)
  assert.match(mobileSource, /loadStats: props\.loadPropertiesStats/)
  assert.match(mobileSource, /const \[propertiesItems, setPropertiesItems\] = useState/)
  assert.match(mobileSource, /const properties = propertiesItems\.length === 1/)
  assert.match(mobileSource, /propertiesStatsState\.stats\.total_bytes/)
  assert.match(mobileSource, /propertiesStatsState\.stats\.sources/)
  assert.match(mobileSource, /properties\.sha256/)
  assert.match(mobileSource, /extraFileRows=\{mediaFileRows\}/)
  assert.match(mobileSource, /properties=\{propertiesRows\}/)
  assert.doesNotMatch(mobileSource, /api\.filePropertiesStats\(/)
})

test('F-PARITY: AGENTS and canonical FileExplorer docs enforce wide Web / Mobile full feature parity', () => {
  const agents = read('AGENTS.md')
  const canonical = read('docs/file-explorer.md')
  assert.match(agents, /Web\/Mobile Web Files functional equivalence/)
  assert.match(agents, /Only internal multi-tab UI and its commands/)
  assert.match(agents, /shared virtual collection/)
  assert.match(canonical, /Every functional operation available in wide Web/)
  assert.match(canonical, /Only internal multi-tab UI/)
  assert.match(mobileSource, /path: entry\.subtitle, updatedAt: entry\.updatedAt/)
})

test('F-iOS27-02: target is explicitly iOS 27, while only internal file tabs are exempt', () => {
  const agents = read('AGENTS.md')
  const benchmark = read('docs/mobile-files-ios27.md')
  assert.match(agents, /iOS 27 Files 1:1 reference contract/)
  assert.match(agents, /52px global App Header/)
  assert.match(benchmark, /iOS 27「文件」1:1/)
  assert.match(benchmark, /Recents \/ Shared \/ Browse/)
  assert.match(benchmark, /Only internal multiple file tabs/)
  assert.match(benchmark, /shared MUI virtualization-window kernel/)
  assert.match(mobileSource, /backdropFilter: 'blur\(18px\) saturate\(160%\)'/)
  assert.match(mobileSource, /mb: 'max\(env\(safe-area-inset-bottom\), 6px\)'/)
})

test('F-PARITY-02: Mobile More, item menu, selection all reuse wide-Web undo, history and path-copy actions', () => {
  const adapter = read('web/src/WebFileExplorer.tsx')
  const entrypoints = ['canUndo', 'onUndo', 'canRedo', 'onRedo',
    'canHistoryBack', 'onHistoryBack', 'canHistoryForward',
    'onHistoryForward', 'onCopyPaths']
  for (const name of entrypoints) {
    assert.ok(mobileSource.includes('props.' + name), 'missing Mobile action ' + name)
    assert.ok(adapter.includes(name + '='), 'missing wide-Web adapter ' + name)
  }
  assert.match(mobileSource, /复制所选路径/)
  assert.match(mobileSource, /data-mobile-files-copy-path/)
  assert.match(mobileSource, /后退（浏览历史）/)
  assert.match(mobileSource, /前进（浏览历史）/)
  assert.match(mobileSource, /!props\.canUndo/)
  assert.match(mobileSource, /!props\.canRedo/)
})

test('AGENTS continuation status contract is mandatory and distinguishes merged from planned', () => {
  const agents = read('AGENTS.md')
  assert.match(agents, /## Continuation progress reporting/)
  assert.match(agents, /current phase/i)
  assert.match(agents, /completed work/i)
  assert.match(agents, /remaining gaps/i)
  assert.match(agents, /materially related existing branches/i)
  assert.match(agents, /End each implementation turn/)
})

test('F-PARITY-03: Mobile Browse saved-rule management reuses Web organization and shared name dialog', () => {
  const web = read('web/src/WebFileExplorer.tsx')
  assert.match(web, /onRenameSavedSearch=\{id =>/)
  assert.match(web, /setRenameSavedSearch\(saved\)/)
  assert.match(web, /onReplaceSavedSearch=\{id =>/)
  assert.match(web, /organization\.updateSavedSearch\(saved\.id, \{/)
  assert.match(web, /onDeleteSavedSearch=\{id => organization\.deleteSavedSearch\(id\)\}/)
  assert.match(web, /organizationLoading=\{organization\.loading\}/)
  assert.match(web, /organizationError=\{organization\.error\}/)
  assert.match(web, /xDriveFileExplorerSavedSearchRuleLabels\(item/)
  assert.match(web, /<XDriveFileNameDialog[\s\S]*?initialValue=\{renameSavedSearch\?\.name/)
  assert.match(mobileSource, /data-mobile-files-saved-options=\{entry\.id\}/)
  assert.match(mobileSource, /重命名智能文件夹/)
  assert.match(mobileSource, /更新为当前搜索/)
  assert.match(mobileSource, /更新已有智能文件夹…/)
  assert.match(mobileSource, /删除智能文件夹/)
  assert.match(mobileSource, /data-mobile-files-saved-delete/)
  assert.match(mobileSource, /data-mobile-files-saved-replace/)
  assert.match(mobileSource, /onRetryOrganization/)
  assert.match(mobileSource, /organizationBusyKey/)
  assert.doesNotMatch(mobileSource, /api\.deleteFileSavedSearch|api\.updateFileSavedSearch/)
})

test('F-PARITY-03: saved rule destructive action never deletes files or pretends to scope Search', () => {
  const contract = read('docs/mobile-files-ios27.md')
  assert.match(contract, /F-PARITY-03/)
  assert.match(contract, /does not remove matching files|never matching Nodes/)
  assert.match(mobileSource, /只删除保存的搜索规则/)
  assert.match(mobileSource, /不会删除任何匹配的文件/)
  assert.match(mobileSource, /当前已应用的全部文件搜索条件/)
  assert.match(mobileSource, /props\.searchActive && props\.canReplaceSavedSearch/)
  assert.match(mobileSource, /deleteSavedSearchBusyRef\.current/)
  assert.match(mobileSource, /setDeleteSavedSearchError/)
})

test('F-PARITY-04: Mobile Space and context preview invoke the exact wide Web Preview route', () => {
  const adapter = read('web/src/WebFileExplorer.tsx')
  assert.match(adapter, /onQuickLookItem=\{trashActive \? undefined : item => \{/)
  assert.match(adapter, /openWebQuickLook\(\{ item, logicalIndex: logicalIndexForItem\(item\) \}\)/)
  assert.match(mobileSource, /props\.onQuickLookItem\(item, ownerID\)/)
  assert.match(mobileSource, /data-mobile-files-quick-look/)
  assert.match(mobileSource, /event\.key === ' ' && !selectionMode && !props\.trashActive/)
  assert.match(adapter, /const openWebQuickLook = \(request: XDriveFileExplorerQuickLookRequest\)/)
  assert.doesNotMatch(mobileSource, /<XDriveFileQuickLookDialog|filePreviewURL\(/)
})

test('F-PARITY-04: Browser tab remains available; internal file tab still absent on Mobile', () => {
  const adapter = read('web/src/WebFileExplorer.tsx')
  assert.match(adapter, /id: 'open-browser-tab'/)
  assert.match(adapter, /onSelect: \(\) => onOpenNodeInBrowserTab\(node\)/)
  assert.match(mobileSource, /action\.id !== 'open-new-tab'/)
  assert.match(mobileSource, /data-mobile-files-context-action=\{action\.id\}/)
  assert.doesNotMatch(mobileSource, /props\.onNewTab\(/)
})

test('F-PARITY-05: Mobile typed folder path delegates only to the shared Web submitPath', () => {
  const adapter = read('web/src/WebFileExplorer.tsx')
  const controller = read('ui/shared/src/mui/FileExplorerWorkspaceController.ts')
  assert.match(adapter, /pathValue=\{trashActive \? undefined : pathValue\}/)
  assert.match(adapter, /onPathSubmit=\{trashActive \? undefined : \(path\) => \{ void submitPath\(path\) \}\}/)
  assert.match(mobileSource, /pathValue\?: string/)
  assert.match(mobileSource, /onPathSubmit\?: \(path: string\) => void/)
  assert.match(mobileSource, /overflowAction\('前往文件夹路径…', openGoToPath\)/)
  assert.match(mobileSource, /data-mobile-files-go-to-path/)
  assert.match(mobileSource, /data-mobile-files-go-to-path-submit/)
  assert.match(mobileSource, /props\.onPathSubmit\(target\)/)
  assert.match(controller, /const submitPath = async \(rawPath: string\)/)
  assert.match(controller, /await xDriveFileExplorerSubmitPath\(\{/)
  assert.match(controller, /if \(navigation\.isNavigationIntentCurrent\(navigationIntentID\)\) onError\(error\)/)
  assert.doesNotMatch(mobileSource, /xDriveResolveFileExplorerPath|api\.findChildDirectory/)
})

test('F-PARITY-05: typed path keeps FileExplorer tabs and all-files Search separate', () => {
  assert.match(mobileSource, /不是全库搜索/)
  assert.match(mobileSource, /beginBrowse\(directoryID\)/)
  assert.match(mobileSource, /!props\.trashActive && props\.onPathSubmit/)
  assert.doesNotMatch(mobileSource, /props\.onNewTab\(/)
  const ios = read('docs/mobile-files-ios27.md')
  assert.match(ios, /F-PARITY-05/)
  assert.match(ios, /52px/)
})

test('F-PARITY-06: Mobile Files external drop shares wide Web reader and upload controllers', () => {
  const adapter = read('web/src/WebFileExplorer.tsx')
  const controller = read('ui/shared/src/mui/FileExplorerExternalDrop.ts')
  assert.match(mobileSource, /xDriveFileExplorerReadExternalDrop\(dataTransfer\)/)
  assert.match(mobileSource, /data-mobile-files-folder-id/)
  assert.match(mobileSource, /data-mobile-files-crumb-id/)
  assert.match(mobileSource, /onDragOver=\{event => externalDragOver\(event\)\}/)
  assert.match(mobileSource, /onDrop=\{event => externalDrop\(event\)\}/)
  assert.match(mobileSource, /props\.onExternalFolderDrop\?\.\(payload, target\.item\)/)
  assert.match(mobileSource, /props\.onExternalFilesDropToCrumb\?\.\(selected, target\.crumb\)/)
  assert.match(mobileSource, /externalDropGenerationRef\.current !== generation/)
  assert.match(controller, /export async function xDriveFileExplorerReadExternalDrop/)
  assert.match(controller, /useXDriveFileExplorerExternalDropController/)
  for (const name of ['onExternalFilesDrop', 'onExternalFolderDrop',
    'onExternalFilesDropToCrumb', 'onExternalFolderDropToCrumb']) {
    assert.ok(adapter.includes(name + '={trashActive ? undefined'), 'missing shared Web upload bridge: ' + name)
    assert.ok(mobileSource.includes(name + '?:'), 'missing Mobile adapter prop: ' + name)
  }
  assert.doesNotMatch(mobileSource, /api\.upload|fetch\(.*api\/v1\/upload/)
})

test('F-PARITY-06: Mobile external drops preserve account scope and iOS Files chrome', () => {
  const ios = read('docs/mobile-files-ios27.md')
  assert.match(ios, /F-PARITY-06/)
  assert.match(mobileSource, /showDirectory && !props\.trashActive/)
  assert.match(mobileSource, /props\.virtualCollection\?\.interactionKey/)
  assert.match(mobileSource, /externalDropGenerationRef\.current \+= 1/)
  assert.match(mobileSource, /data-xdrive-file-explorer-scroll-host/)
  assert.doesNotMatch(mobileSource, /<XDriveFileExplorer\b/)
})

test('F-PARITY-07B: Mobile disclosure uses shared virtualization and real Server ranges', () => {
  const inline = read('ui/shared/src/file-explorer-inline.ts')
  const store = read('ui/shared/src/file-explorer-inline-range-store.ts')
  assert.match(mobileSource, /data-mobile-files-folder-disclosure/)
  assert.match(mobileSource, /aria-expanded=\{Boolean\(inlineBranch\)\}/)
  assert.match(mobileSource, /xDriveFileExplorerInlineCellAt\(inlineLayout, index\)/)
  assert.match(mobileSource, /xDriveFileExplorerInlineVisibleRanges/)
  assert.match(mobileSource, /props\.onInlineViewport\?\.\(/)
  assert.match(webAdapter, /api\.listRange\(parentID, offset, limit, sort\.key, sort\.direction, true, grouping, signal\)/)
  assert.match(webAdapter, /nodeByID\.set\(node\.id, node\)/)
  assert.match(webAdapter, /inlineParentCrumbs\(/)
  assert.match(store, /controller\.abort\(\)/)
  assert.match(store, /maxBranches = 48/)
  assert.match(inline, /export function xDriveFileExplorerInlineLayout/)
  assert.doesNotMatch(mobileSource, /api\.listRange|api\.listPage|new XDriveApi/)
  assert.doesNotMatch(mobileSource, /<XDriveFileExplorer\b/)
})

test('F-PARITY-07B: no extra app bar, screen owner or internal tab', () => {
  const ios = read('docs/mobile-files-ios27.md')
  assert.match(ios, /F-PARITY-07B/)
  assert.match(mobileSource, /data-xdrive-file-explorer-scroll-host/)
  assert.match(mobileSource, /MIN_TOUCH/)
  assert.match(webAdapter, /compactMobile \? \(/)
  assert.match(mobileSource, /action\.id !== 'open-new-tab'/)
  assert.match(ios, /52px/)
})


test('F-PARITY-07C: grouped List keeps authoritative Server sections and shared child viewport', () => {
  const grouped = read('ui/shared/src/mui/FileExplorerGroupingLayout.ts')
  const inline = read('ui/shared/src/file-explorer-inline.ts')
  assert.match(mobileSource, /xDriveFileExplorerInlineGroupIndex\(/)
  assert.match(mobileSource, /inlineLayout && directoryID !== null/)
  assert.match(mobileSource, /props\.virtualCollection\?\.groups/)
  assert.match(mobileSource, /itemCount: displayedCount/)
  assert.match(mobileSource, /groupedSegments\.filter\(segment => segment\.endIndex > segment\.startIndex\)/)
  assert.match(mobileSource, /xDriveFileExplorerInlineVisibleRanges\(inlineLayout, from, through\)/)
  assert.match(mobileSource, /data-xdrive-file-explorer-scroll-host/)
  assert.match(inline, /export function xDriveFileExplorerInlineGroupIndex/)
  assert.match(grouped, /xDriveFileExplorerGroupIndexValid\(groups, count\)/)
  assert.doesNotMatch(mobileSource, /!props\.searchActive && props\.grouping\?\.groupBy === 'none'/)
  assert.doesNotMatch(mobileSource, /api\.listRange|new XDriveApi|<XDriveFileExplorer\b/)
})

test('F-PARITY-07C: iOS Files grouped child disclosure changes no global app architecture', () => {
  const ios = read('docs/mobile-files-ios27.md')
  const app = read('web/src/WebFileExplorer.tsx')
  assert.match(ios, /F-PARITY-07C/)
  assert.match(ios, /52px/)
  assert.match(app, /compactMobile \? \(/)
  assert.match(app, /api\.listRange\(parentID, offset, limit, sort\.key, sort\.direction, true, grouping, signal\)/)
  assert.match(mobileSource, /action\.id !== 'open-new-tab'/)
})
