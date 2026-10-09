const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (pathName) => fs.readFileSync(path.join(root, pathName), 'utf8')

test('Gallery verified duplicate folding is opt-in and scoped by authoritative Server ranges', () => {
  const backend = read('internal/api/media_folding.go')
  const media = read('internal/api/media.go')
  const filters = read('internal/api/media_filters.go')
  const ui = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(backend, /duplicateAssetIdentityFor/)
  assert.match(backend, /mediaFoldMaxAssetsPerGroup = 512/)
  assert.match(backend, /ROW_NUMBER\(\) OVER/)
  assert.match(backend, /fold_rank > 1/)
  assert.match(backend, /n\.id NOT IN/)
  assert.doesNotMatch(backend, /LEFT JOIN jsonb_to_recordset/)
  assert.match(backend, /jsonb_to_recordset/)
  assert.match(media, /prepareVerifiedMediaFolding/)
  assert.match(media, /applyVerifiedMediaFolding/)
  assert.match(media, /FoldMemberIDs:\s+memberIDs/)
  assert.match(filters, /fold_duplicates/)
  assert.match(filters, /fold_member_id/)
  assert.match(ui, /data-xdrive-gallery-fold-duplicates/)
  assert.match(ui, /data-xdrive-media-fold-expand/)
  assert.match(ui, /data-xdrive-gallery-verified-fold-dialog/)
  assert.match(ui, /fold_member_ids: nodeIDs/)
  assert.match(ui, /listItemRange\(500, 0, memberQuery\)/)
  assert.match(ui, /listItemRange\(500, members.length, memberQuery\)/)
  assert.doesNotMatch(ui, /listItemRange\(512,/)
  assert.match(media, /queryOptions\.foldIndex = nil/)
  assert.match(ui, /activeIndex: index/)
  assert.match(ui, /totalCount,/)
  assert.match(ui, /onClickCapture={handleFoldExpandClick}/)
  const desktopMain = read('desktop/src/main/index.cts')
  const galleryAlbumIDChecks = [...desktopMain.matchAll(/!\(\['folder:', 'source:', 'manual:', 'smart:'\]/g)]
  assert.equal(galleryAlbumIDChecks.length, 2, 'Desktop must load manual/smart album items and ranges')
})

test('Web/Desktop/Agent transport preserve fold flags and explicit member scope', () => {
  for (const filename of [
    'ui/shared/src/models.ts',
    'web/src/api.ts',
    'desktop/src/preload/index.cts',
    'desktop/src/main/index.cts',
    'desktop/src/main/agent_client.cts',
    'cmd/xdrive-agent/desktop_ipc.go',
    'internal/client/media.go',
  ]) {
    const source = read(filename)
    assert.match(source, /fold_duplicates|FoldDuplicates/, filename + ': opt-in flag')
    assert.match(source, /fold_member_id|FoldMemberIDs/, filename + ': exact member scope')
  }
})

test('Gallery never exposes zero-reclaimable SHA groups as cleanup suggestions', () => {
  const cleanup = read('ui/shared/src/mui/MediaGalleryCleanup.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.doesNotMatch(cleanup, /主原文件重复|CAS 已去重|DuplicateCard/)
  assert.doesNotMatch(gallery, /source\.listDuplicateGroups\(48/)
  assert.match(gallery, /data-xdrive-gallery-verified-fold-dialog/)
})
