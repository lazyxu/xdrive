'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/public-share-viewer-preview.ts')
const raw = fs.readFileSync(filename, 'utf8')
const result = ts.transpileModule(raw, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((result.diagnostics || []).filter(x=>x.category===ts.DiagnosticCategory.Error)
  .map(x=>ts.flattenDiagnosticMessageText(x.messageText, '\n')),[])
const mod = { exports: {} }
new Function('module', 'exports', result.outputText)(mod, mod.exports)
const mode = mod.exports.xDrivePublicShareViewerStillMode
const entry=(name, rest={}) => ({
  type: 'file', name, revision: 7, thumbnail_candidate: true, ...rest,
})
const granted={canPreview:true, hasOriginal:true, hasThumbnail:true}

test('Public Share original preview remains scoped to existing four signed safe raster formats', () => {
  for (const name of ['photo.JPG', 'image.jpeg', 'image.PNG', 'image.webp','image.gif'])
    assert.equal(mode(entry(name),granted),'original',name)
  assert.equal(mode(entry('photo.jpg',{revision:undefined,thumbnail_candidate:false}),granted),'original')
  for (const name of ['index.html', 'index.pdf', 'download.zip', 'x.svg'])
    assert.equal(mode(entry(name),granted),null,name)
})

test('cached Share-derived stills never become full-resolution or Live-motion tickets', () => {
  for(const name of ['photo.heic','photo.HEIF','x.avif','x.bmp','x.tif','x.tiff','x.livp'])
    assert.equal(mode(entry(name),granted),'cached-still',name)
  for (const value of [undefined,0,-1,1.2,Number.MAX_SAFE_INTEGER+1])
    assert.equal(mode(entry('photo.heic',{revision:value}),granted),null,String(value))
  assert.equal(mode(entry('photo.heic',{thumbnail_candidate:false}),granted),null)
  assert.equal(mode(entry('photo.livp',{type:'dir'}),granted),null)
  assert.equal(mode(entry('photo.heic'),{...granted,canPreview:false}),null)
  assert.equal(mode(entry('photo.heic'),{...granted,hasThumbnail:false}),null)
  assert.equal(mode(entry('photo.jpg'),{...granted,hasOriginal:false}),null,
    'cached thumbnail must not secretly replace a supported original ticket')
  assert.equal(mode(entry('photo.heic'),{...granted,hasOriginal:false}),'cached-still')
})

test('Share cached video posters are bounded readonly JPEG stills, never playable media', () => {
  for (const filename of ['clip.mp4', 'clip.MOV', 'clip.m4v', 'clip.mkv', 'clip.webm']) {
    assert.equal(mode(entry(filename), granted), 'cached-video-poster', filename)
    assert.equal(mode(entry(filename, { thumbnail_candidate: false }), granted), null)
    assert.equal(mode(entry(filename, { revision: 0 }), granted), null)
    assert.equal(mode(entry(filename, { type: 'dir' }), granted), null)
    assert.equal(mode(entry(filename), { ...granted, hasThumbnail: false }), null)
    assert.equal(mode(entry(filename), { ...granted, canPreview: false }), null)
  }
  for (const filename of ['clip.avi', 'clip.mpeg', 'script.html', 'index.pdf', 'clip.svg'])
    assert.equal(mode(entry(filename), granted), null, filename)
})

test('shared FilePreviewSurface renders derived still only from Share thumbnail', () => {
  const bridge=fs.readFileSync(path.join(root,'ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx'),'utf8')
  const web=fs.readFileSync(path.join(root,'web/src/PublicShare.tsx'),'utf8')
  const api=fs.readFileSync(path.join(root,'web/src/api.ts'),'utf8')
  assert.match(bridge, /xDrivePublicShareViewerStillMode\(entry/)
  assert.match(bridge, /previewMode === 'cached-still'/)
  assert.match(bridge, /previewMode === 'cached-video-poster'/)
  assert.match(bridge, /仅缓存视频封面（不能播放）/)
  assert.match(bridge, /安全缓存视频封面\.jpg/)
  assert.match(bridge, /previewMode === 'cached-video-poster'[\s\S]*?loadThumbnail\(previewEntry, signal\)/)
  assert.match(bridge, /loadThumbnail\(previewEntry, signal\)/)
  assert.match(bridge, /loadImagePreview\(previewEntry, signal\)/)
  assert.match(bridge, /shareImagePreviewPattern\.test\(entry\.name\)/)
  assert.match(bridge, /entry\.revision === item\.revision/)
  assert.match(bridge, /<XDriveFilePreviewSurface/)
  assert.match(bridge, /仅缓存缩略图（非原图；实况不含动态）/)
  assert.doesNotMatch(bridge, /loadLivePhotoMotion=|getMediaLivePhotoMotion|Authorization: Bearer|onUpload=|onDeleteItems=/)
  assert.match(web, /api\.publicShareThumbnailURL\(token, password, entry\.id, entry\.revision, controller\.signal\)/)
  assert.match(api, /'\/api\/v1\/public\/share\/thumbnail-ticket'/)
  assert.match(api, /credentials: 'omit'/)
  assert.match(api, /xDriveThumbnailHasSafeImageEnvelope\(blob, mime, signal\)/)
})
