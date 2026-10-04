const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const shared = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'), 'utf8')
const web = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'WebFileExplorer.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')

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

test('large Details directories use bounded rendering and Grid uses browser render containment', () => {
  assert.ok(shared.includes('const detailsVirtualizationThreshold = 240'), 'Details virtualization threshold is missing')
  assert.ok(shared.includes('const detailsOverscan = 10'), 'Details virtualization overscan is missing')
  assert.ok(shared.includes('visibleItems.slice(detailsWindow.start, detailsWindow.end)'), 'Details view does not window large directories')
  assert.ok(shared.includes('detailsWindow.before'), 'Details virtual list top spacer is missing')
  assert.ok(shared.includes('detailsWindow.after'), 'Details virtual list bottom spacer is missing')
  assert.ok(shared.includes('ResizeObserver'), 'virtual list does not track viewport height')
  assert.ok(shared.includes("contentVisibility: 'auto'"), 'Grid items should use content-visibility for large directories')
  assert.ok(shared.includes('containIntrinsicSize: `${gridMetrics.maxItemWidth}px ${gridMetrics.estimatedRowHeight}px`'), 'Grid render containment needs dynamic stable intrinsic sizing')
})

test('type sorting uses the same labels users see', () => {
  assert.ok(shared.includes("const leftType = left.typeLabel || xDriveFileTypeLabel(left.name, left.kind)"), 'type sort does not use displayed type labels')
  assert.ok(shared.includes("const rightType = right.typeLabel || xDriveFileTypeLabel(right.name, right.kind)"), 'type sort right operand drifted')
})
