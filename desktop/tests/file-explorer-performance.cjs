const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const shared = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'), 'utf8')
const web = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'WebFileExplorer.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')
const cloudFilesController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'CloudFilesController.ts'), 'utf8')
const searchController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerSearch.ts'), 'utf8')
const childrenPagination = fs.readFileSync(path.join(repoRoot, 'internal', 'api', 'children_pagination.go'), 'utf8')
const apiHandlers = fs.readFileSync(path.join(repoRoot, 'internal', 'api', 'handlers.go'), 'utf8')
const explorerProjection = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts'), 'utf8')
const serverSearch = fs.readFileSync(path.join(repoRoot, 'internal', 'api', 'search.go'), 'utf8')
const navigationPane = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx'), 'utf8')
const explorerController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'file-explorer-controller.ts'), 'utf8')

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

test('FileExplorer pagination rejects duplicate and stale page requests', () => {
  assert.ok(cloudFilesController.includes('const directoryRequestRef = useRef(0)'), 'directory request generation guard is missing')
  assert.ok(cloudFilesController.includes('const loadMoreRequestRef = useRef(false)'), 'directory load-more lock is missing')
  assert.ok(cloudFilesController.includes('if (requestID !== directoryRequestRef.current) return'), 'stale directory responses must be ignored')
  assert.ok(cloudFilesController.includes('loadMoreRequestRef.current ||'), 'directory pagination must synchronously reject duplicate load-more calls')
  assert.ok(searchController.includes('const loadMoreRequestRef = useRef<Record<string, boolean>>({})'), 'search pagination lock is missing')
  assert.ok(searchController.includes('if (loadMoreRequestRef.current[key]) return'), 'search pagination must synchronously reject duplicate load-more calls')
})


test('FileExplorer selection and keyboard lookup avoid repeated whole-directory scans', () => {
  assert.ok(shared.includes('const visibleItemProjection = useMemo(() => {'), 'one-pass visible-item projection is missing')
  assert.ok(shared.includes('visibleItemIndexByKey.get(explorerIDKey(id))'), 'selected items must use indexed lookup')
  assert.ok(shared.includes('visibleItemIndexByKey.get(explorerIDKey(activeItemID)) ?? -1'), 'active item lookup must be indexed')
  assert.ok(shared.includes('visibleItemIndexByKey.get(anchorKey) ?? -1'), 'mouse Shift anchor lookup must be indexed')
  assert.ok(shared.includes('visibleItemIndexByKey.get(explorerIDKey(item.id)) ?? -1'), 'keyboard current-item lookup must be indexed')
  assert.ok(shared.includes('visibleItemIndexByKey.get(explorerIDKey(anchorID)) ?? -1'), 'keyboard Shift anchor lookup must be indexed')
  assert.ok(shared.includes('names: visibleItemNames'), 'type-select names should be memoized')
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


test('FileExplorer search avoids full-tree path materialization for component queries', () => {
  assert.ok(serverSearch.includes('const componentSearch = `WITH RECURSIVE candidate_tree AS ('), 'component candidate search is missing')
  assert.ok(serverSearch.includes('AND strpos(lower(n.name), lower(?)) > 0'), 'component search must seed on matching node names')
  assert.ok(serverSearch.includes('JOIN candidate_tree candidate ON n.parent_id = candidate.id'), 'matching directories must expand to descendants')
  assert.ok(serverSearch.includes("string_agg(ancestry.name, '/' ORDER BY ancestry.depth DESC)"), 'candidate paths must be reconstructed only after filtering')
  assert.ok(serverSearch.includes('bool_or(ancestry.parent_id IS NULL) AS rooted'), 'candidate search must prove reachability from an active root')
  assert.ok(serverSearch.includes('WHERE candidate_paths.rooted'), 'unrooted/deleted-ancestor candidates must be excluded')
  assert.ok(serverSearch.includes('const recursivePathSearch = `WITH RECURSIVE tree AS ('), 'full-path fallback must remain available')
  assert.ok(serverSearch.includes('if !strings.Contains(query, "/") {'), 'slash-containing queries must retain cross-component path semantics')
})


test('FileExplorer navigation tree expands with bounded pages instead of draining all folders', () => {
  assert.ok(explorerController.includes('XDRIVE_FILE_EXPLORER_TREE_PAGE_SIZE = 200'), 'tree page size should stay bounded')
  assert.ok(explorerController.includes('xDriveFileExplorerLoadChildDirectoryPage'), 'one-page tree loader is missing')
  const loaderStart = explorerController.indexOf('export async function xDriveFileExplorerLoadChildDirectoryPage')
  const loaderEnd = explorerController.indexOf('export type XDriveFileExplorerFolderUploadEntry', loaderStart)
  assert.equal(explorerController.slice(loaderStart, loaderEnd).includes('while (true)'), false, 'tree expansion must not drain every server page')
  assert.ok(navigationPane.includes('loadDirectoryPage(node.id, append ? current?.nextCursor : undefined)'), 'tree load-more must advance one cursor page')
  assert.ok(navigationPane.includes('data-xdrive-file-explorer-tree-load-more'), 'tree must expose an explicit load-more affordance')
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


test('FileExplorer directory pagination avoids rebuilding a whole-directory ID Map on normal appends', () => {
  assert.ok(explorerController.includes('knownIDs?: Set<number>'), 'page merge needs a retained ID-set fast path')
  assert.ok(explorerController.includes('const pageIDs = new Set<number>()'), 'page merge should inspect only the incoming page for duplicate IDs')
  assert.ok(explorerController.includes('if (knownIDs.has(item.id) || pageIDs.has(item.id))'), 'page merge must preserve duplicate detection')
  assert.ok(explorerController.includes('return [...currentItems, ...pageItems]'), 'unique cursor pages should use the direct append path')
  assert.ok(explorerController.includes('const merged = new Map(currentItems.map((item) => [item.id, item] as const))'), 'duplicate pages must retain the replacement fallback')
  assert.ok(cloudFilesController.includes('const directoryItemIDsRef = useRef(new Set<number>())'), 'directory controller must retain seen IDs across page loads')
  assert.ok(cloudFilesController.includes('directoryItemIDsRef.current.clear()'), 'directory ID cache must reset with the workspace')
})


test('FileExplorer search pagination appends unique cursor pages without rebuilding all result IDs', () => {
  assert.ok(explorerController.includes('xDriveFileExplorerMergeSearchResults'), 'shared search merge is missing')
  assert.ok(explorerController.includes('const pageIDs = new Set<number>()'), 'search merge should inspect only the incoming page')
  assert.ok(explorerController.includes('if (knownIDs.has(id) || pageIDs.has(id))'), 'search merge must preserve duplicate detection')
  assert.ok(explorerController.includes('return [...current, ...page]'), 'unique search pages should use the direct append path')
  assert.ok(searchController.includes('const resultIDsRef = useRef<Record<string, Set<number>>>({})'), 'search controller must retain result IDs per workspace')
  assert.ok(searchController.includes('delete resultIDsRef.current[workspaceKey]'), 'search result ID cache must clear with search state')
  assert.ok(searchController.includes('resultIDs = new Set(currentResults.map((item) => item.node.id))'), 'restored search state must lazily rebuild its ID cache')
})


test('FileExplorer search sorting stays server-paged instead of re-sorting the loaded subset', () => {
  assert.ok(serverSearch.includes('sort must be name, updated, size, or type'), 'Search API sort validation is missing')
  assert.ok(serverSearch.includes('cursor does not match q/type/sort/order'), 'Search cursor must bind sort/order')
  assert.ok(serverSearch.includes('ORDER BY %s ASC, %s %s, %s ASC, search_rows.id ASC'), 'Search keyset order must include server sort and stable path tie-breaker')
  assert.ok(searchController.includes('const sortSignatureRef = useRef<Record<string, string>>({})'), 'search sort signature cache is missing')
  assert.ok(searchController.includes('void executeSearch(workspaceKey, searchState.query, sort)'), 'sort changes must reload the active search')
  assert.ok(searchController.includes('loadPage(searchState.query, sort, searchState.cursor)'), 'search load-more must keep the same server sort')
  assert.ok(web.includes('searchSort.key'), 'Web search adapter must forward sort key')
  assert.ok(desktop.includes('searchSort.direction'), 'Desktop search adapter must forward sort direction')
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


test('FileExplorer prefetches the next page before fast scrolling reaches the bottom', () => {
  assert.ok(shared.includes('const fileExplorerLoadMorePrefetchViewportMultiplier = 1.5'), 'viewport prefetch multiplier is missing')
  assert.ok(shared.includes('const fileExplorerLoadMorePrefetchMinimum = 500'), 'minimum prefetch distance is missing')
  assert.ok(shared.includes('export function xDriveFileExplorerLoadMorePrefetchDistance(viewportHeight: number)'), 'prefetch distance helper is missing')
  assert.ok(shared.includes('Math.ceil(Math.max(0, viewportHeight) * fileExplorerLoadMorePrefetchViewportMultiplier)'), 'prefetch distance must scale with viewport height')
  assert.ok(shared.includes('xDriveFileExplorerLoadMorePrefetchDistance(host.clientHeight)'), 'scroll pagination must use the adaptive prefetch distance')
  assert.equal(shared.includes('host.scrollHeight - host.scrollTop - host.clientHeight <= 500'), false, 'scroll pagination must not keep the fixed 500px threshold')
})
