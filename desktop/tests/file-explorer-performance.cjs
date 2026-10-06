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

test('FileExplorer loads media thumbnails only when grid items approach the viewport', () => {
  assert.ok(shared.includes('export function xDriveFileSupportsThumbnail'), 'thumbnail eligibility classifier is missing')
  assert.ok(shared.includes('IntersectionObserver'), 'grid thumbnails should be intersection-lazy')
  assert.ok(shared.includes("rootMargin: '240px'"), 'thumbnail prefetch margin should stay bounded')
  assert.ok(shared.includes("if (value?.startsWith('blob:')) URL.revokeObjectURL(value)"), 'abandoned Web blob thumbnails must be released')
  assert.ok(shared.includes("if (src?.startsWith('blob:')) URL.revokeObjectURL(src)"), 'mounted Web blob thumbnails must be released on replacement/unmount')
  assert.ok(web.includes('api.mediaThumbnail(Number(item.id))'), 'Web Explorer is not wired to the real media thumbnail API')
  assert.ok(web.includes('URL.createObjectURL(blob)'), 'Web Explorer should avoid base64 inflation for thumbnail blobs')
  assert.ok(desktop.includes('getMediaThumbnail(Number(item.id))'), 'Desktop Explorer is not wired to the Agent thumbnail API')
  assert.ok(desktop.includes('data:${contentType};base64,${result.data.data_base64}'), 'Desktop thumbnail data URL mapping is missing')
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
  assert.ok(shared.includes('scheduleFileThumbnail(() => loadThumbnail(item))'), 'thumbnail loads must pass through the shared scheduler')
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
  assert.ok(shared.includes('const visibleItemIndexByKey = useMemo('), 'visible-item index is missing')
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
