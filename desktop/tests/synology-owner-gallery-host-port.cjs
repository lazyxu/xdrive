'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const hostFile = 'web/src/synologyHost.ts'
const galleryFile = 'ui/shared/src/mui/SynologyOwnerGallerySource.ts'
const host = fs.readFileSync(path.join(root, hostFile), 'utf8')
const gallery = fs.readFileSync(path.join(root, galleryFile), 'utf8')
const app = fs.readFileSync(path.join(root, 'web/src/synology.tsx'), 'utf8')
const outlet = fs.readFileSync(path.join(root, 'ui/shared/src/mui/XDriveAppPageOutlet.tsx'), 'utf8')
const compile = (source, filename) => {
  const result = ts.transpileModule(source, {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  return result.outputText
}

function compiledGallery() {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile(gallery, galleryFile))(
    mod, mod.exports, name => {
      if (name === '../synology-media-preview') return {
        xDriveSynologyLoadBoundedMediaPreview: async () => {
          throw Error('test did not authorize an Owner original preview')
        },
      }
      if (name === '../synology-owner-thumbnail') return {
        xDriveSynologyLoadOwnerThumbnail: async (local, item, signal) => {
          const thumb = await local.ownerFileThumbnail(item.id, item.revision, signal)
          return URL.createObjectURL(new Blob([thumb.data], { type: thumb.contentType }))
        },
      }
      throw Error('unexpected DSM Owner Gallery import: ' + name)
    },
  )
  return mod.exports.createXDriveSynologyOwnerGallerySource
}

test('authenticated DSM Host feeds the exact canonical Gallery JSX using a real read-only source', async () => {
  const local = {
    ownerGalleryItemsRange: async (_kind, limit, offset) =>
      ({ items: [], total_count: 0, offset, limit }),
    ownerGalleryAlbums: async () => [],
    ownerFileThumbnail: async () => { throw Error('no authenticated thumbnail') },
    ownerFileMediaRange: async () => { throw Error('no Owner original') },
  }
  const calls = []
  const fakeUI = {
    createXDriveSynologyBackupLocalClient: url => { calls.push(url); return local },
    createXDriveSynologyOwnerBackupSource: c => ({ client: c }),
    createXDriveSynologyCloudStorageDataSource: c => ({ client: c }),
    createXDriveSynologyBrowserStorageSource: () => ({ browser: true }),
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', 'window', compile(host, hostFile))(
    mod, mod.exports,
    name => {
      if (name === '@xdrive/ui/mui') return fakeUI
      if (name === '../../ui/shared/src/mui/SynologyOwnerGallerySource') return {
        createXDriveSynologyOwnerGallerySource: compiledGallery(),
      }
      throw Error('unexpected Host module ' + name)
    },
    { location: { href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html' } },
  )
  const actualHost = mod.exports.createXDriveSynologyHost()
  assert.equal(actualHost.platform, 'synology')
  assert.notEqual(actualHost.adminRoleVerified, true)
  assert.deepEqual(calls, ['https://nas.example/webman/3rdparty/xdrivenas/backup.cgi'])
  assert.equal(actualHost.services.galleryPage.pageSize, 100)
  const source = actualHost.services.galleryPage.source
  const result = await source.listItemRange(1, 0)
  assert.equal(result.total_count, 0)
  assert.equal(result.items.length, 0)
  assert.deepEqual(await source.listAlbums(), [])
  for (const action of ['setFavorite', 'deleteMedia', 'deleteItems', 'createAlbum',
    'saveEditRecipe', 'submitSelectionFavoriteJob']) {
    assert.equal(source[action], undefined, action)
  }
  assert.match(app, /<XDriveApp\b/)
  assert.equal(app.includes('<XDriveMediaGalleryPage'), false)
  assert.match(outlet, /<XDriveMediaGalleryPage \{\.\.\.services\.galleryPage\} \/>/)
  assert.equal(host.includes('<XDriveMediaGalleryPage'), false)
  assert.equal(host.includes('window.xdriveDesktop'), false)
})

test('same authorized Node/revision page must not cancel its own pending thumbnail', async () => {
  const sourceFactory = compiledGallery()
  let resolveThumbnail
  const node = {
    node: { id: 42, parent_id: 17, name: 'owner.jpg',
      revision: 7, size: 120, type: 'file' },
    metadata: { media_kind: 'image', index_state: 'ready', has_thumbnail: true },
    favorite: false,
  }
  const local = {
    ownerGalleryItemsRange: async (_kind, limit, offset) =>
      ({ items: offset ? [] : [node], total_count: 1, offset, limit }),
    ownerGalleryAlbums: async () => [],
    ownerFileThumbnail: async () => new Promise(resolve => { resolveThumbnail = resolve }),
    ownerFileMediaRange: async () => { throw Error('no original') },
  }
  const original = URL.createObjectURL
  URL.createObjectURL = () => 'blob:same-revision'
  try {
    const source = sourceFactory(local)
    await source.listItemRange(1, 0)
    const pending = source.loadThumbnail(42, undefined, 7)
    await source.listItemRange(1, 0)
    resolveThumbnail({ data: new Uint8Array([1, 2]), contentType: 'image/png' })
    assert.equal(await pending, 'blob:same-revision')
  } finally {
    URL.createObjectURL = original
  }
})
