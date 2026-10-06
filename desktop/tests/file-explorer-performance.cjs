const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repoRoot = path.join(__dirname, '..', '..')
const shared = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'), 'utf8')
const web = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'WebFileExplorer.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')
const cloudFilesController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'CloudFilesController.ts'), 'utf8')
const searchController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerSearch.ts'), 'utf8')
const virtualCollectionController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'VirtualCollectionController.ts'), 'utf8')
const childrenPagination = fs.readFileSync(path.join(repoRoot, 'internal', 'api', 'children_pagination.go'), 'utf8')
const apiHandlers = fs.readFileSync(path.join(repoRoot, 'internal', 'api', 'handlers.go'), 'utf8')
const explorerProjection = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts'), 'utf8')
const serverSearch = fs.readFileSync(path.join(repoRoot, 'internal', 'api', 'search.go'), 'utf8')
const navigationPane = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx'), 'utf8')
const autoLoadSentinel = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'AutoLoadSentinel.tsx'), 'utf8')
const explorerController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'file-explorer-controller.ts'), 'utf8')
const mediaTraceHarness = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerPerformanceHarness.tsx'), 'utf8')
const desktopRendererMain = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'main.tsx'), 'utf8')
const webRendererMain = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'main.tsx'), 'utf8')
const mediaTraceRunner = fs.readFileSync(path.join(repoRoot, 'desktop', 'scripts', 'file-explorer-media-trace-main.cjs'), 'utf8')
const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
const webViteConfig = fs.readFileSync(path.join(repoRoot, 'web', 'vite.config.ts'), 'utf8')

function loadPerformanceTypeScriptModule(relativePath) {
  const filename = path.join(repoRoot, ...relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const execute = new Function('exports', 'module', 'require', output)
  execute(mod.exports, mod, require)
  return mod.exports
}

test('FileExplorer derives system-style file types and icons from extensions', () => {
  assert.ok(shared.includes('export function xDriveFileKind'), 'shared file-kind classifier is missing')
  assert.ok(shared.includes('export function xDriveFileTypeLabel'), 'shared file-type labels are missing')
  for (const kind of ['image', 'video', 'audio', 'pdf', 'document', 'spreadsheet', 'presentation', 'archive', 'code', 'text']) {
    assert.ok(shared.includes(`'${kind}'`), `missing shared file kind: ${kind}`)
  }
  for (const icon of [
    'ImageRoundedIcon',
    'MovieRoundedIcon',
    'AudioFileRoundedIcon',
    'PictureAsPdfRoundedIcon',
    'TableChartRoundedIcon',
    'ViewCarouselRoundedIcon',
    'DescriptionRoundedIcon',
    'CodeRoundedIcon',
  ]) {
    assert.ok(shared.includes(icon), `missing Explorer file icon: ${icon}`)
  }
  assert.equal(web.includes("typeLabel: node.type === 'dir' ? '文件夹' : '文件'"), false, 'Web must not override shared file type inference')
  assert.equal(desktop.includes("typeLabel: node.type === 'dir' ? '文件夹' : '文件'"), false, 'Desktop must not override shared file type inference')
})

test('FileExplorer bounds and reuses viewport-proximate thumbnail work', () => {
  assert.ok(shared.includes('export function xDriveFileSupportsThumbnail'), 'thumbnail eligibility classifier is missing')
  assert.ok(shared.includes("return xDriveFileKind(name, kind) === 'image'"), 'FileExplorer thumbnail requests must stay image-only until video posters are supported')
  assert.equal(shared.includes("fileKind === 'image' || fileKind === 'video'"), false, 'unsupported videos must not enter the image-thumbnail request path')
  assert.ok(shared.includes('let fileThumbnailVisibilityObserver: IntersectionObserver | null = null'), 'thumbnail visibility must use one shared observer')
  assert.ok(shared.includes('const fileThumbnailVisibilityCallbacks = new Map<Element, () => void>()'), 'shared thumbnail visibility callback registry is missing')
  assert.ok(shared.includes("rootMargin: '240px'"), 'thumbnail prefetch margin should stay bounded')
  assert.ok(shared.includes('const fileThumbnailConcurrency = 6'), 'thumbnail concurrency budget is missing')
  assert.ok(shared.includes('const fileThumbnailCacheLimit = 96'), 'thumbnail cache must stay bounded')
  assert.ok(shared.includes('const scheduled = scheduleFileThumbnail(() => loadThumbnail(item))'), 'thumbnail loads must pass through the cancellable scheduler')
  assert.ok(shared.includes('scheduled.cancel()'), 'unmounted queued thumbnails must be cancellable')
  assert.ok(shared.includes('fileThumbnailCacheGet(cache, cacheKey)'), 'thumbnail remounts should reuse cached sources')
  assert.ok(shared.includes('fileThumbnailCacheSet(cache, cacheKey, value)'), 'loaded thumbnails should enter the bounded cache')
  assert.ok(shared.includes('disposeFileThumbnailCache(thumbnailCache)'), 'Explorer teardown must release cached blob URLs')
  assert.ok(shared.includes("if (value?.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(value)"), 'cached Web blob thumbnails must be released on eviction/disposal')
  assert.ok(web.includes('api.mediaThumbnail(Number(item.id))'), 'Web Explorer is not wired to the real media thumbnail API')
  assert.ok(web.includes('URL.createObjectURL(blob)'), 'Web Explorer should avoid base64 inflation for thumbnail blobs')
  assert.ok(desktop.includes('getMediaThumbnail(Number(item.id))'), 'Desktop Explorer is not wired to the Agent thumbnail API')
  assert.ok(desktop.includes('new Blob([result.data.data], { type: contentType })'), 'Desktop thumbnail binary Blob mapping is missing')
  assert.ok(desktop.includes('URL.createObjectURL(blob)'), 'Desktop thumbnail should expose binary data through a Blob URL')
  assert.equal(desktop.includes('data_base64'), false, 'Desktop FileExplorer thumbnail transport must not use base64')
})

test('large Details and Grid directories use bounded rendering', () => {
  assert.ok(shared.includes('const detailsVirtualizationThreshold = 240'), 'Details virtualization threshold is missing')
  assert.ok(shared.includes('const detailsOverscan = 10'), 'Details virtualization overscan is missing')
  assert.ok(shared.includes('visibleItems.slice(detailsWindow.start, detailsWindow.end)'), 'Details view does not window large directories')
  assert.ok(shared.includes('detailsWindow.before'), 'Details virtual list top spacer is missing')
  assert.ok(shared.includes('detailsWindow.after'), 'Details virtual list bottom spacer is missing')
  assert.ok(shared.includes('ResizeObserver'), 'virtual list does not track viewport height')
  assert.ok(shared.includes('const gridVirtualizationThreshold = 400'), 'Grid virtualization threshold is missing')
  assert.ok(shared.includes('const gridOverscanRows = 3'), 'Grid virtualization overscan is missing')
  assert.ok(shared.includes('visibleItems.slice(gridWindow.start, gridWindow.end)'), 'Grid view does not window large directories')
  assert.ok(shared.includes("gridAutoRows: virtualizeGrid ? `${gridMetrics.estimatedRowHeight}px` : undefined"), 'Grid rows must stay deterministic only while windowing')
  assert.ok(shared.includes('height: virtualizeGrid ? gridWindow.totalHeight : undefined'), 'Grid window must preserve full scroll height')
  assert.ok(shared.includes('gridPaddingPx + gridWindow.startRow * gridRowStep'), 'Grid window must position the mounted row range')
  assert.ok(shared.includes("contentVisibility: 'auto'"), 'Grid items should retain browser render containment')
})

test('type sorting uses the same labels users see', () => {
  assert.ok(shared.includes("const leftType = left.typeLabel || xDriveFileTypeLabel(left.name, left.kind)"), 'type sort does not use displayed type labels')
  assert.ok(shared.includes("const rightType = right.typeLabel || xDriveFileTypeLabel(right.name, right.kind)"), 'type sort right operand drifted')
})


test('FileExplorer bounds thumbnail and pointer/scroll work under large directories', () => {
  assert.ok(shared.includes('const fileThumbnailConcurrency = 6'), 'thumbnail concurrency budget is missing')
  assert.ok(shared.includes('pumpFileThumbnailQueue()'), 'thumbnail queue must refill from one bounded scheduler')
  assert.ok(shared.includes('scrollFrameRef.current = window.requestAnimationFrame(updateVirtualWindow)'), 'virtual-list scroll updates must be frame bounded')
  assert.ok(shared.includes('Math.floor((raw - detailsHeaderHeight) / detailsRowHeight)'), 'virtual-list scroll updates should advance by row boundaries')
  assert.ok(shared.includes('marqueeFrameRef.current = window.requestAnimationFrame(flushMarqueeSelection)'), 'marquee selection must be frame bounded')
  assert.ok(shared.includes('if (!cancelled && marqueePointerRef.current) flushMarqueeSelection()'), 'marquee selection must flush its final pointer position')
  assert.ok(shared.includes('const gridColumnCount = () => viewMode === \'grid\' ? gridColumns : 1'), 'Grid keyboard navigation must not scan mounted DOM')
  assert.ok(shared.includes('const itemLeft = gridPaddingPx + column * (cellWidth + gridGapPx)'), 'Grid marquee selection must use virtual geometry')
})

test('FileExplorer directory and search ranges reject duplicate and stale requests', () => {
  assert.ok(cloudFilesController.includes('const directoryRequestRef = useRef(0)'), 'directory request generation guard is missing')
  assert.ok(cloudFilesController.includes('if (requestID !== directoryRequestRef.current) return'), 'stale directory responses must be ignored')
  assert.ok(cloudFilesController.includes('useXDriveVirtualCollection<TNode>'), 'directory range loading must delegate in-flight ownership to VirtualCollection')
  assert.ok(virtualCollectionController.includes('const inFlightRef = useRef(new Map<string, InFlightRange>())'), 'VirtualCollection in-flight range map is missing')
  assert.ok(virtualCollectionController.includes('existing && existing.generation === generation'), 'VirtualCollection must deduplicate same-generation range requests')
  assert.ok(searchController.includes('const requestRef = useRef<Record<string, number>>({})'), 'search request generation guard is missing')
  assert.ok(searchController.includes('targetIsCurrent(nextTarget)'), 'stale search responses must be rejected against the active target')
  assert.ok(searchController.includes('useXDriveVirtualCollection<TResult>'), 'Search must delegate viewport ranges to VirtualCollection')
})


test('FileExplorer selection and keyboard lookup avoid repeated whole-directory scans', () => {
  assert.ok(shared.includes('const visibleItemProjection = useMemo(() => {'), 'one-pass visible-item projection is missing')
  assert.ok(shared.includes('const logicalItemByID = (id: XDriveFileExplorerID) =>'), 'selected items need logical ID lookup')
  assert.ok(shared.includes('.map((id) => logicalItemByID(id))'), 'selected items must use bounded logical ID lookup')
  assert.ok(shared.includes('logicalIndexOf(activeItemID) ?? -1'), 'active item lookup must be logically indexed')
  assert.ok(shared.includes('logicalIndexOf(selectionAnchorID) ?? -1'), 'mouse Shift anchor lookup must be logically indexed')
  assert.ok(shared.includes('logicalIndexOf(item.id) ?? -1'), 'keyboard current-item lookup must be logically indexed')
  assert.ok(shared.includes('logicalIndexOf(anchorID) ?? -1'), 'keyboard Shift anchor lookup must be logically indexed')
  assert.ok(shared.includes('names: visibleItemNames'), 'dense type-select names should stay memoized')
  assert.ok(shared.includes('() => selectedItems.reduce((total, item) => ('), 'selected-size aggregation must scale with the selection')
  assert.equal(shared.includes('visibleItems.findIndex((candidate)'), false, 'keyboard/selection paths must not rescan visibleItems')
  assert.equal(shared.includes('() => visibleItems.filter((item) => selectedKeySet.has(explorerIDKey(item.id)))'), false, 'selectedItems must not scan the whole directory')
})


test('FileExplorer paged directory reads avoid redundant parent and File preload queries', () => {
  const childrenStart = apiHandlers.indexOf('func (s *Server) children(c *gin.Context)')
  const childrenEnd = apiHandlers.indexOf('func (s *Server) createDirectory', childrenStart)
  const childrenHandler = apiHandlers.slice(childrenStart, childrenEnd)
  assert.ok(
    childrenHandler.indexOf('if childrenPaginationRequested(c)') < childrenHandler.indexOf('s.ownedDirectory'),
    'paged FileExplorer requests should enter childrenPage before the legacy parent lookup',
  )
  assert.equal(childrenPagination.includes('Preload("File")'), false, 'paged children must not issue a separate File preload')
  assert.ok(childrenPagination.includes('COALESCE(child_file.size, 0) AS file_size'), 'paged children should project file size in the main query')
  assert.ok(childrenPagination.includes("COALESCE(child_file.sha256, '') AS file_sha256"), 'paged children should project file digest in the main query')
  assert.ok(childrenPagination.includes('if len(rows) == 0 {'), 'empty pages must retain parent validation')
  assert.ok(childrenPagination.includes('s.ownedDirectory(uid, parentID)'), 'empty pages must distinguish a valid empty directory from 404')
})


test('FileExplorer projection builds large paged view-models in one node pass', () => {
  assert.ok(explorerProjection.includes('const crumbProjection = useMemo(() => {'), 'breadcrumb projection should be memoized once')
  assert.ok(explorerProjection.includes("pathPrefix: crumbs.length > 0 ? `${names.join('/')}/` : ''"), 'directory path prefix must be computed once per breadcrumb set')
  assert.ok(explorerProjection.includes('const projection = useMemo(() => {'), 'node projection should use one memoized pass')
  assert.ok(explorerProjection.includes('const nodeByID = new Map<number, TNode>()'), 'node index must be built inside the projection pass')
  assert.ok(explorerProjection.includes('const explorerItems = new Array<XDriveFileExplorerItem>(sourceLength)'), 'Explorer items should be allocated once at final size')
  assert.ok(explorerProjection.includes('for (let index = 0; index < sourceLength; index += 1)'), 'projection should traverse active nodes once')
  assert.ok(explorerProjection.includes('if (results) activeNodes[index] = node'), 'search active nodes should be populated in the same pass')
  assert.ok(explorerProjection.includes('if (result) searchByID.set(node.id, result)'), 'search result index should be populated in the same pass')
  assert.equal(explorerProjection.includes('activeNodes.map('), false, 'projection must not remap active nodes')
  assert.equal(explorerProjection.includes('crumbs.map((crumb) => crumb.name)'), false, 'item projection must not rebuild breadcrumb names per item')
})


test('FileExplorer search keeps file matches out of descendant recursion', () => {
  assert.ok(serverSearch.includes('const componentSearch = `WITH RECURSIVE matching_nodes AS ('), 'component match set is missing')
  assert.ok(serverSearch.includes('AND strpos(lower(n.name), lower(?)) > 0'), 'component search must seed on matching node names')
  assert.ok(serverSearch.includes('descendant_tree AS ('), 'directory descendant expansion is missing')
  assert.ok(serverSearch.includes("ON matched.type = 'dir' AND n.parent_id = matched.id"), 'only matching directories should seed descendant recursion')
  assert.ok(serverSearch.includes("ON parent.type = 'dir' AND n.parent_id = parent.id"), 'only directory descendants should continue recursion')
  assert.ok(serverSearch.includes('SELECT id, parent_id, type FROM matching_nodes'), 'candidate set must retain direct file matches without recursive work')
  assert.ok(serverSearch.includes('SELECT id, parent_id, type FROM descendant_tree'), 'candidate set must include descendants of matching directories')
  assert.ok(serverSearch.includes('required_dirs AS ('), 'component search must derive the required directory set')
  assert.ok(serverSearch.includes("CASE WHEN candidate.type = 'dir' THEN candidate.id ELSE candidate.parent_id END AS id"), 'candidate files must contribute only their parent directory to path reconstruction')
  assert.ok(serverSearch.includes('directory_tree AS ('), 'directory path state must be built separately from candidate files')
  assert.ok(serverSearch.includes('LEFT JOIN directory_tree parent_dir'), 'file results must reuse parent directory path state')
  assert.ok(serverSearch.includes('const recursivePathSearch = `WITH RECURSIVE tree AS ('), 'full-path fallback must remain available')
  assert.ok(serverSearch.includes('if strings.Contains(query, "/") {'), 'slash-containing queries must retain cross-component path semantics')
})


test('FileExplorer navigation tree expands with bounded pages instead of draining all folders', () => {
  assert.ok(explorerController.includes('XDRIVE_FILE_EXPLORER_TREE_PAGE_SIZE = 200'), 'tree page size should stay bounded')
  assert.ok(explorerController.includes('xDriveFileExplorerLoadChildDirectoryPage'), 'one-page tree loader is missing')
  const loaderStart = explorerController.indexOf('export async function xDriveFileExplorerLoadChildDirectoryPage')
  const loaderEnd = explorerController.indexOf('export type XDriveFileExplorerFolderUploadEntry', loaderStart)
  assert.equal(explorerController.slice(loaderStart, loaderEnd).includes('while (true)'), false, 'tree expansion must not drain every server page')
  assert.ok(navigationPane.includes('loadDirectoryPage(node.id, append ? current?.nextCursor : undefined)'), 'tree auto-load must advance one cursor page')
  assert.ok(navigationPane.includes('data-xdrive-file-explorer-tree-auto-load'), 'tree must expose an automatic page sentinel')
  assert.ok(navigationPane.includes('onLoad={() => loadChildren(node, true)}'), 'tree sentinel must request exactly the next bounded page')
  assert.equal(navigationPane.includes('data-xdrive-file-explorer-tree-load-more'), false, 'tree must not expose a manual load-more affordance')
  assert.ok(navigationPane.includes('const pathChild = pathChildByParent.get(node.id)'), 'current path child must remain visible outside the loaded page')
})


test('FileExplorer reuses server-sorted arrays and derives item indexes in one pass', () => {
  assert.ok(shared.includes('if (externallySorted) return items'), 'server-sorted directory items should not be cloned')
  assert.ok(shared.includes('const visibleItemProjection = useMemo(() => {'), 'visible-item projection should be shared')
  assert.ok(shared.includes('const indexByKey = new Map<string, number>()'), 'visible ID index is missing')
  assert.ok(shared.includes('const names = new Array<string>(visibleItems.length)'), 'type-select names should be allocated once')
  assert.ok(shared.includes('const files: XDriveFileExplorerItem[] = []'), 'Quick Look file list should share the same pass')
  assert.ok(shared.includes('const fileIndexByKey = new Map<string, number>()'), 'Quick Look index should share the same pass')
  assert.ok(shared.includes('for (let index = 0; index < visibleItems.length; index += 1)'), 'visible items should be traversed once for indexes')
  assert.equal(shared.includes('visibleItems.map((item, index)'), false, 'visible ID index must not trigger a second map')
  assert.equal(shared.includes('visibleItems.map((item) => item.name)'), false, 'type-select names must not trigger a second map')
  assert.equal(shared.includes("visibleItems.filter((item) => item.kind === 'file')"), false, 'Quick Look files must not trigger a second pass')
})


test('FileExplorer typed paths use indexed exact-child lookups instead of loading whole directories', () => {
  assert.ok(explorerController.includes('xDriveFileExplorerPathLookupPageOptions'), 'typed-path exact page helper is missing')
  assert.ok(explorerController.includes('limit: 1'), 'typed-path lookup must request at most one child')
  assert.ok(explorerController.includes('findChildDirectory(parentID, part)'), 'typed-path traversal must resolve one child per segment')
  const resolverStart = explorerController.indexOf('export async function xDriveResolveFileExplorerPath')
  const resolverEnd = explorerController.indexOf('export type XDriveFileExplorerPathRoot', resolverStart)
  const resolverSource = explorerController.slice(resolverStart, resolverEnd)
  assert.equal(resolverSource.includes('listChildren'), false, 'typed-path traversal must not load a whole directory per segment')
  assert.ok(childrenPagination.includes('"lower(xd_nodes.name) = lower(?) AND xd_nodes.name = ?"'), 'server exact-name filter must use the indexed lower(name) key while preserving exact case')
})


test('FileExplorer virtual directories avoid rebuilding a whole-directory ID Map', () => {
  assert.ok(cloudFilesController.includes('loadedItems: virtualCollection.loadedItems'), 'directory controller must expose bounded sparse metadata')
  assert.ok(cloudFilesController.includes('ensureViewport: virtualCollection.ensureViewport'), 'directory controller must delegate viewport range loading')
  assert.ok(virtualCollectionController.includes('xDriveVirtualCollectionRetainRanges(current, retentionRanges)'), 'VirtualCollection must evict metadata outside retention')
  assert.equal(cloudFilesController.includes('directoryItemIDsRef'), false, 'range-backed directory controller must not retain a whole-directory ID set')
  assert.equal(cloudFilesController.includes('xDriveFileExplorerMergePageItems'), false, 'range-backed directory controller must not append cursor pages')
})


test('FileExplorer search ranges keep metadata sparse instead of appending cursor pages', () => {
  assert.ok(searchController.includes('searchVirtualItems = activeTarget'), 'Search must expose bounded sparse results')
  assert.ok(searchController.includes('virtualCollection.loadedItems'), 'Search must use VirtualCollection metadata storage')
  assert.ok(searchController.includes('virtualCollection.primePage(page)'), 'first Search range must seed the sparse cache')
  for (const legacy of [
    'searchCursor',
    'searchLoadingMore',
    'loadMoreSearch',
    'resultIDsRef',
  ]) {
    assert.equal(searchController.includes(legacy), false, `Search must not retain legacy load-more state: ${legacy}`)
  }
  assert.equal(explorerController.includes('xDriveFileExplorerMergeSearchResults'), false, 'shared core must not append Search cursor pages')
  assert.equal(explorerController.includes('xDriveFileExplorerCanLoadMoreSearch'), false, 'shared core must not expose Search load-more eligibility')
})

test('FileExplorer search sorting stays server-ranged instead of re-sorting loaded metadata', () => {
  assert.ok(serverSearch.includes('sort must be name, updated, size, or type'), 'Search API sort validation is missing')
  assert.ok(serverSearch.includes('COUNT(*) OVER() AS total_count'), 'Search range must report stable logical count')
  assert.ok(searchController.includes('sortSignature: searchSortSignature(targetSort)'), 'Search target must bind sort/order')
  assert.ok(searchController.includes('active.sortSignature === sortSignature'), 'sort changes must invalidate the active search generation')
  assert.ok(web.includes('searchSort.key'), 'Web Search range adapter must forward sort key')
  assert.ok(desktop.includes('searchSort.direction'), 'Desktop Search range adapter must forward sort direction')
})

test('FileExplorer folder uploads reuse existing directories with indexed name lookups', () => {
  assert.ok(explorerController.includes('xDriveFileExplorerCaseInsensitiveNameLookupPageOptions'), 'case-insensitive upload lookup helper is missing')
  assert.ok(explorerController.includes('nameInsensitive: name'), 'upload fallback must request the indexed folded sibling name')
  const ensureStart = explorerController.indexOf('export async function xDriveFileExplorerEnsureUploadDirectory')
  const ensureEnd = explorerController.indexOf('export async function xDriveFileExplorerResolveFolderUploadTargets', ensureStart)
  const ensureSource = explorerController.slice(ensureStart, ensureEnd)
  assert.ok(ensureSource.includes('findExistingDirectory(parentID, name)'), 'upload conflict fallback must query one existing directory')
  assert.equal(ensureSource.includes('listChildren'), false, 'upload conflict fallback must not load every sibling')
  assert.ok(desktop.includes('xDriveFileExplorerCaseInsensitiveNameLookupPageOptions(directoryName)'), 'Desktop folder upload must use indexed sibling lookup')
  assert.equal(desktop.includes('listChildren: async (id) =>'), false, 'Desktop folder upload must not use the legacy full children list')
  assert.ok(childrenPagination.includes('lower(xd_nodes.name) = lower(?)'), 'server folded-name lookup must use the sibling-name index expression')
})


test('FileExplorer uses viewport range prefetch instead of dense bottom append', () => {
  assert.ok(shared.includes('virtualCollection?.onRangeChange'), 'FileExplorer must request sparse viewport ranges')
  assert.ok(cloudFilesController.includes('ensureViewport: virtualCollection.ensureViewport'), 'Cloud Files must expose VirtualCollection viewport loading')
  assert.ok(autoLoadSentinel.includes("rootMargin = '240px 0px'"), 'small cursor browsers should prefetch through the shared sentinel margin')
  for (const legacy of [
    'fileExplorerLoadMorePrefetchViewportMultiplier',
    'fileExplorerLoadMorePrefetchMinimum',
    'xDriveFileExplorerLoadMorePrefetchDistance',
    'host.scrollHeight - host.scrollTop - host.clientHeight',
  ]) {
    assert.equal(shared.includes(legacy), false, `legacy dense append prefetch remains: ${legacy}`)
  }
})


test('FileExplorer sparse virtual surface keeps logical count separate from rendered slots', () => {
  const surface = shared
  const virtualSurface = fs.readFileSync(
    path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerVirtualSurface.ts'),
    'utf8',
  )

  for (const token of [
    'XDriveFileExplorerVirtualCollection',
    'const logicalItemCount = virtualCollectionEnabled',
    'xDriveFileExplorerDetailsVirtualWindow({',
    'xDriveFileExplorerGridVirtualWindow({',
    'xDriveFileExplorerVirtualWindowSlots({',
    'virtualCollection?.onRangeChange',
    'onRangeChange(window.start, window.end - 1)',
    '{logicalItemCount} 个项目',
    'data-xdrive-file-explorer-placeholder',
  ]) {
    assert.ok(surface.includes(token), `sparse FileExplorer surface missing: ${token}`)
  }

  assert.ok(virtualSurface.includes('normalizedEnd - normalizedStart'), 'virtual slots must allocate only the requested window width')
  assert.equal(surface.includes('new Array(logicalItemCount)'), false, 'FileExplorer must never allocate one placeholder per logical item')
  assert.equal(surface.includes('Array.from({ length: logicalItemCount'), false, 'FileExplorer must never materialize the logical collection')
  assert.equal(surface.includes('hasMore?: boolean'), false, 'main FileExplorer surface must not expose cursor append state')
  assert.equal(surface.includes('onLoadMore?: () => void'), false, 'main FileExplorer surface must not expose a load-more callback')
  assert.equal(surface.includes('xDriveFileExplorerLoadMorePrefetchDistance'), false, 'legacy dense bottom prefetch helper must be removed')
})


test('FileExplorer sparse interactions stay bounded to loaded metadata', () => {
  assert.ok(shared.includes('loadedItems: ReadonlyMap<number, XDriveFileExplorerItem>'), 'virtual surface must receive bounded loaded metadata')
  assert.ok(shared.includes('const virtualLoadedItems = virtualCollection?.loadedItems'), 'loaded virtual metadata projection is missing')
  assert.ok(shared.includes('const interactionProjection = virtualLoadedProjection ?? visibleItemProjection'), 'interaction lookup must switch to bounded virtual metadata')
  assert.ok(shared.includes('const loadedRangeIDs = (start: number, end: number) =>'), 'Shift selection needs a bounded loaded-range helper')
  assert.ok(shared.includes('itemCount: logicalItemCount'), 'keyboard navigation must use the logical collection length')
  assert.ok(shared.includes('const target = logicalItemAt(targetIndex)'), 'keyboard navigation must resolve sparse indexes lazily')
  assert.ok(shared.includes('virtualCollection?.onRangeChange?.(index, index)'), 'unloaded keyboard targets must request their range')
  assert.ok(shared.includes('if (virtualCollectionEnabled) return false'), 'dense type-select must not scan sparse logical indexes')
  assert.ok(shared.includes('const selectableItems = interactionProjection.orderedItems'), 'Ctrl+A must stay bounded to loaded metadata')
  assert.equal(shared.includes('new Array<XDriveFileExplorerItem>(logicalItemCount)'), false, 'interaction lookup must not materialize the logical directory')
})


test('FileExplorer Search VirtualCollection reduces retained metadata by at least 90% at 10k results', () => {
  const virtual = loadPerformanceTypeScriptModule([
    'ui', 'shared', 'src', 'virtual-collection.ts',
  ])
  const totalCount = 10_000
  const pageSize = virtual.XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE
  const retentionOverscanPages = virtual.XDRIVE_VIRTUAL_COLLECTION_DEFAULT_RETENTION_OVERSCAN_PAGES

  // Before: legacy dense cursor append retained every result the user had scrolled through.
  const denseRetained = new Map()
  for (let index = 0; index < totalCount; index += 1) denseRetained.set(index, index)
  const beforeRetained = denseRetained.size

  // After: apply the same 10k logical results, then retain only the real viewport window.
  let snapshot = virtual.xDriveCreateVirtualCollectionSnapshot('search-perf', 1)
  for (let offset = 0; offset < totalCount; offset += pageSize) {
    const items = Array.from(
      { length: Math.min(pageSize, totalCount - offset) },
      (_, index) => offset + index,
    )
    snapshot = virtual.xDriveVirtualCollectionApplyPage(snapshot, 1, {
      items,
      offset,
      limit: pageSize,
      totalCount,
    })
  }
  const retentionRanges = virtual.xDriveVirtualCollectionRangesForViewport({
    startIndex: 5_000,
    endIndex: 5_039,
    totalCount,
    pageSize,
    overscanPages: retentionOverscanPages,
  })
  snapshot = virtual.xDriveVirtualCollectionRetainRanges(snapshot, retentionRanges)
  const afterRetained = virtual.xDriveVirtualCollectionLoadedCount(snapshot)
  const reduction = 1 - afterRetained / beforeRetained

  assert.equal(beforeRetained, 10_000, 'legacy dense baseline changed')
  assert.equal(pageSize, 200, 'Search performance workload assumes the shared 200-item page')
  assert.equal(retentionOverscanPages, 2, 'Search performance workload assumes two retention overscan pages')
  assert.equal(afterRetained, 1_000, 'VirtualCollection should retain five 200-item pages around the middle viewport')
  assert.ok(reduction >= 0.9, `retained metadata reduction ${(reduction * 100).toFixed(1)}% is below 90%`)
})


test('FileExplorer 100k media renderer trace uses real Web/Desktop Chromium surfaces', () => {
  assert.ok(mediaTraceHarness.includes('const itemCount = 100_000'), 'media trace namespace must stay at 100k logical items')
  assert.ok(mediaTraceHarness.includes("'image-cold'"), 'cold-image renderer trace scenario is missing')
  assert.ok(mediaTraceHarness.includes("'image-warm'"), 'warm-image renderer trace scenario is missing')
  assert.ok(mediaTraceHarness.includes("'video-icons'"), 'video icon-fallback renderer trace scenario is missing')
  assert.ok(mediaTraceHarness.includes("longTaskObserver.observe({ type: 'longtask'"), 'renderer trace must observe long tasks')
  assert.ok(mediaTraceHarness.includes("document.querySelectorAll('[data-xdrive-file-explorer-item]').length"), 'renderer trace must record mounted DOM items')
  assert.ok(mediaTraceHarness.includes("return grid?.parentElement as HTMLElement | null"), 'renderer trace must bind directly to the FileExplorer scroll host')
  assert.ok(mediaTraceHarness.includes('window.__xdriveFileExplorerPerfError = message'), 'renderer trace must expose harness failures without waiting for timeout')
  assert.ok(mediaTraceHarness.includes('peakThumbnailInFlightRef.current'), 'renderer trace must record thumbnail concurrency')
  assert.ok(mediaTraceHarness.includes('peakRetainedItemsRef.current'), 'renderer trace must record retained sparse metadata')
  assert.ok(mediaTraceHarness.includes('for (const ratio of [0.5, 1, 0])'), 'renderer trace must cover midpoint/end/top jumps')
  assert.ok(mediaTraceHarness.includes('for (let step = 1; step <= 36; step += 1)'), 'renderer trace must cover continuous scrolling')

  for (const [label, source] of [['Desktop', desktopRendererMain], ['Web', webRendererMain]]) {
    assert.ok(source.includes("VITE_XDRIVE_FILE_EXPLORER_PERF === '1'"), `${label} perf mode must be build-time gated`)
    assert.ok(source.includes('xdriveFileExplorerPerf'), `${label} perf mode must require the explicit query`)
    assert.ok(source.includes("@xdrive/ui/mui/perf"), `${label} must load the trace harness through the shared package boundary`)
    assert.ok(source.includes('__xdriveFileExplorerPerfBoot'), `${label} perf mode must expose boot state for trace diagnostics`)
    assert.ok(source.includes('__xdriveFileExplorerPerfBootError'), `${label} perf mode must expose dynamic-import failures`)
    assert.ok(source.includes('FileExplorerPerformanceHarness'), `${label} must load the shared trace harness`)
  }

  assert.ok(mediaTraceRunner.includes('contentTracing.startRecording'), 'Electron trace runner must capture Chromium trace data')
  assert.ok(mediaTraceRunner.includes('window.__xdriveFileExplorerPerfError || null'), 'Electron trace runner must fail fast on renderer harness errors')
  assert.ok(mediaTraceRunner.includes('window.__xdriveFileExplorerPerfBootError || null'), 'Electron trace runner must fail fast on perf boot/import errors')
  assert.ok(mediaTraceRunner.includes("hasExplorer: Boolean(document.querySelector('[data-xdrive-file-explorer]'))"), 'Electron trace timeout diagnostics must report whether the FileExplorer mounted')
  assert.ok(mediaTraceRunner.includes("win.webContents.on('did-fail-load'"), 'Electron trace runner must expose load failures')
  assert.ok(mediaTraceRunner.includes('app.getAppMetrics()'), 'Electron trace runner must capture renderer process memory')
  assert.ok(mediaTraceRunner.includes('combined.maxMountedItems >= 1000'), 'trace runner must enforce a bounded mounted-item budget')
  assert.ok(mediaTraceRunner.includes('combined.peakRetainedItems > 1200'), 'trace runner must enforce a bounded sparse-metadata budget')
  assert.ok(mediaTraceRunner.includes('combined.peakThumbnailInFlight > 6'), 'trace runner must enforce thumbnail concurrency <= 6')
  assert.ok(mediaTraceRunner.includes("scenario === 'video-icons' && combined.thumbnailRequests !== 0"), 'video fallback trace must enforce zero thumbnail requests')
  assert.ok(ciWorkflow.includes('file-explorer-media-renderer-trace:'), 'dedicated media renderer trace CI job is missing')
  assert.ok(ciWorkflow.includes("github.head_ref == 'perf/file-explorer-media-renderer-trace'"), 'media trace CI must stay opt-in to the dedicated performance branch')
  assert.ok(ciWorkflow.includes('xvfb-run -a ./node_modules/.bin/electron --no-sandbox'), 'media trace CI must execute the real Electron/Chromium renderer with hosted-runner sandbox disabled')
  assert.ok(webViteConfig.includes("VITE_XDRIVE_FILE_EXPLORER_PERF === '1' ? './' : '/'"), 'Web perf build must use relative assets so Electron loadFile can execute the real renderer')
})
