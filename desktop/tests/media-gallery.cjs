const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedGallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const sharedModels = read('ui', 'shared', 'src', 'models.ts')
const webApp = read('web', 'src', 'App.tsx')
const webAPI = read('web', 'src', 'api.ts')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const desktopIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')

test('Gallery is one shared MUI surface for Web and Desktop', () => {
  assert.match(sharedGallery, /export function XDriveMediaGalleryPage/)
  assert.match(sharedGallery, /export function XDriveMediaGallery/)
  assert.match(sharedGallery, /所有 xDrive 图片和视频，包括普通上传和外部来源文件/)
  assert.match(sharedGallery, /onOpenAlbum/)
  assert.match(sharedGallery, /图片/)
  assert.match(sharedGallery, /视频/)
  assert.match(sharedGallery, /GPS/)
  assert.match(sharedGallery, /视频编码/)
  assert.match(sharedGallery, /缩略图/)

  assert.equal((webApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.equal((desktopApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.equal(webApp.includes('function MediaGallery'), false)
  assert.equal(desktopApp.includes('function MediaGallery'), false)
})

test('Gallery contracts are node-level and connector-neutral', () => {
  assert.match(sharedModels, /export interface MediaItem \{\s*node: Node\s*metadata: MediaMetadata/s)
  assert.match(sharedModels, /rotation_degrees\?: number/)
  assert.match(sharedModels, /latitude\?: number/)
  assert.match(sharedModels, /longitude\?: number/)
  assert.match(sharedModels, /thumbnail_width\?: number/)
  assert.match(sharedModels, /thumbnail_height\?: number/)
  assert.equal(sharedModels.includes('source_item_id: number\n  metadata: MediaMetadata'), false)
})

test('Web and Desktop expose the same Gallery data operations', () => {
  for (const token of ['mediaItems(', 'mediaAlbums()', 'mediaAlbumItems(', 'mediaThumbnail(']) {
    assert.ok(webAPI.includes(token), `Web API missing ${token}`)
  }

  for (const token of [
    'getMediaItems:',
    'getMediaAlbums:',
    'getMediaAlbumItems:',
    'getMediaThumbnail:',
  ]) {
    assert.ok(preload.includes(token), `Desktop preload missing ${token}`)
  }

  for (const token of [
    "mediaItems(kind = ''",
    'mediaAlbums()',
    'mediaAlbumItems(albumID:',
    'mediaThumbnail(nodeID:',
  ]) {
    assert.ok(agentClient.includes(token), `Desktop Agent client missing ${token}`)
  }

  assert.ok(desktopIPC.includes('"media-gallery"'))
  assert.ok(desktopIPC.includes('GET /v1/media/items'))
  assert.ok(desktopIPC.includes('GET /v1/media/albums'))
  assert.ok(desktopIPC.includes('GET /v1/media/thumbnail'))
})

test('Desktop navigation exposes Gallery as a first-class view', () => {
  assert.match(desktopApp, /type View = [^\n]*'gallery'/)
  assert.match(desktopApp, /gallery: '图库'/)
  assert.match(desktopApp, /view === 'gallery'/)
  assert.match(desktopApp, />图库<\/button>/)
})

test('Web switches between files and Gallery without duplicating the file shell', () => {
  assert.match(webApp, /useState<'files' \| 'gallery'>\('files'\)/)
  assert.match(webApp, /appView === 'gallery' \? '文件' : '图库'/)
  assert.equal((webApp.match(/<Card className="file-card">/g) || []).length, 1)
})
