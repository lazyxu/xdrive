const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const mobile = read('ui/shared/src/mui/MobileGalleryChrome.tsx')
const web = read('web/src/App.tsx')
const desk = read('desktop/src/renderer/App.tsx')
const webAdapter = read('web/src/mediaGalleryAdapter.ts')
const deskAdapter = read('desktop/src/renderer/mediaGalleryAdapter.ts')

test('Gallery directs multi-file upload from wide and mobile shared actions', () => {
  assert.ok(gallery.includes('onUploadRequested?: () => void'))
  assert.ok(gallery.includes('data-xdrive-gallery-upload'))
  assert.ok(gallery.includes('onClick={onUploadRequested}'))
  assert.ok(gallery.includes('onUploadRequested={onUploadRequested}'))
  assert.ok(gallery.includes('onUploadRequested && !isTrashSection'))
  assert.ok(gallery.includes('const seenUploadRevision = useRef(uploadRevision)'))
  assert.ok(mobile.includes('{extraActions}'),
    'Mobile More drawer must expose the same shared upload control')
})

test('Web Gallery uses the real shared FileExplorer upload manager with multiple files', () => {
  assert.ok(web.includes('data-xdrive-gallery-upload-picker'))
  assert.ok(web.includes('type="file"'))
  assert.ok(web.includes('multiple'))
  assert.ok(web.includes('await api.root()'))
  assert.ok(web.includes('await uploadTargets('))
  assert.ok(web.includes("false,\n        'upload',"))
  assert.ok(web.includes('fileUploads.runTargets(targets, action)'))
  assert.ok(web.includes('uploadRevision={galleryUploadRevision}'))
  assert.ok(web.includes('onUploadRequested={() => galleryUploadInputRef.current?.click()}'))
})

test('Desktop Gallery uses authenticated native multi-file picker and refreshes sparse media', () => {
  assert.ok(desk.includes('await window.xdriveDesktop.agent.cloudRoot()'))
  assert.ok(desk.includes('window.xdriveDesktop.agent.cloudUploadFiles(root.data.id)'))
  assert.ok(desk.includes('galleryUploadBusyRef.current'))
  assert.ok(desk.includes('setGalleryUploadRevision((revision) => revision + 1)'))
  assert.ok(desk.includes('onUploadRequested={() => { void uploadGalleryFiles() }}'))
  assert.ok(gallery.includes('seenUploadRevision.current = uploadRevision'))
  assert.ok(gallery.includes('refreshGallery()'))
})

test('Already supported Gallery batch download preserves canonical platform transport', () => {
  assert.ok(webAdapter.includes("items.length === 1"))
  assert.ok(webAdapter.includes("api.downloadArchive(items.map((item) => item.node.id), 'xdrive-photos.zip')"))
  assert.ok(deskAdapter.includes("agent.cloudDownloadArchive(items.map((item) => item.node.id))"))
  assert.ok(gallery.includes('onDownloadItems(selectedItems)') ||
    gallery.includes('runSelectionAction(onDownloadItems, false)'))
})
