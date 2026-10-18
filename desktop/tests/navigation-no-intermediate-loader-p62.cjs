const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = filename => fs.readFileSync(path.join(root,filename),'utf8')

test('P62 first-frame and sustained Directory GETs never paint navigation loading messages', () => {
  const mobile = read('web/src/MobileFiles.tsx')
  const wide = read('ui/shared/src/mui/FileExplorer.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const web = read('web/src/WebFileExplorer.tsx')
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const workflow = read('.github/workflows/ci.yml')
  const chromePrepare = workflow.slice(workflow.indexOf('Prepare opt-in native Chrome iOS 27 Web acceptance'),
    workflow.indexOf('      - name: U12 real Chrome Files deep destination'))
  const chromeRun = workflow.slice(workflow.indexOf('Real Web Gallery iOS 27 360-900px browser geometry and actions'),
    workflow.indexOf('      - name: Real Web Mobile Files', workflow.indexOf('Real Web Gallery iOS 27 360-900px browser geometry and actions')) >= 0
      ? workflow.indexOf('      - name: Real Web Mobile Files', workflow.indexOf('Real Web Gallery iOS 27 360-900px browser geometry and actions'))
      : workflow.length)
  assert.ok(chromePrepare.includes("startsWith(github.head_ref, 'fix/navigation-no-intermediate-files-gallery-loading-p62-')"),
    'P62 real Chrome step must run its browser setup first')
  assert.ok(chromeRun.includes("startsWith(github.head_ref, 'fix/navigation-no-intermediate-files-gallery-loading-p62-')"),
    'P62 must run the compiled 390px Chrome Gallery Range fixture')
  assert.ok(chromeRun.includes("XDRIVE_GALLERY_COLD_P39:"),
    'P62 must assert held Range0 is visually silent, not merely static source')
  assert.ok(mobile.includes('(props.searchActive || props.trashActive)'))
  assert.ok(!mobile.includes('(props.searchActive || props.trashActive || coldUnconfirmedBrowse)'))
  assert.ok(mobile.includes('data-mobile-files-cold-read-slot={coldUnconfirmedBrowse || undefined}'))
  assert.ok(mobile.includes("minHeight: 180, display: 'grid', placeItems: 'center'"))
  assert.ok(mobile.includes('coldDirectoryFirstRead || (props.searchActive && zeroStatePending)'))
  assert.ok(!mobile.includes('正在加载文件…'))
  assert.ok(wide.includes('data-xdrive-file-explorer-cold-first-range'))
  assert.ok(wide.includes('aria-busy="true"'))
  assert.ok(!wide.includes('正在加载文件…'))
  assert.ok(wide.includes('data-xdrive-file-explorer-empty-read-error'))
  assert.ok(gallery.includes('data-xdrive-gallery-cold-pending'))
  assert.ok(gallery.includes('aria-busy={loading || !hasRequestedPhotoRange || undefined}'))
  assert.ok(!gallery.includes('正在加载图库…'))
  assert.ok(!gallery.includes('showDelayedColdPhotoLoad'))
  assert.ok(gallery.includes('XDriveMediaAsyncThumbnail'))
  assert.ok(gallery.includes('XDriveMediaAsyncVideoPoster'))
  for (const [name, code] of [['Web',web],['Desktop',desktop]]) {
    assert.ok(code.includes('<XDriveFileExplorer'),name+' must use shared virtual Explorer')
    assert.ok(code.includes('virtualCollection='),name+' must retain sparse Range')
  }
  assert.ok(wide.includes('showDelayedLoading'), 'genuine Trash/refresh feedback survives')
  assert.ok(mobile.includes('showRangeLoading'), 'Search and Trash network states survive')
  assert.ok(gallery.includes('data-xdrive-gallery-load-error'))
  assert.ok(mobile.includes('文件夹内容尚未确认，请刷新页面后重试。'))
})
