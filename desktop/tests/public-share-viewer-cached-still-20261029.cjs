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
  for (const name of ['index.html', 'clip.mp4', 'clip.mov', 'clip.webm', 'index.pdf', 'download.zip', 'x.svg'])
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

test('shared FilePreviewSurface renders derived still only from Share thumbnail', () => {
  const bridge=fs.readFileSync(path.join(root,'ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx'),'utf8')
  const web=fs.readFileSync(path.join(root,'web/src/PublicShare.tsx'),'utf8')
  const api=fs.readFileSync(path.join(root,'web/src/api.ts'),'utf8')
  assert.match(bridge, /xDrivePublicShareViewerStillMode\(entry/)
  assert.match(bridge, /previewMode === 'cached-still'/)
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
