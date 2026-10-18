const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const explorer = read('ui/shared/src/mui/FileExplorer.tsx')
const mobile = read('web/src/MobileFiles.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')

test('Web/Desktop shared cold first Range reserves geometry before any delayed feedback', () => {
  const begin = explorer.indexOf(') : loading && logicalItemCount === 0 && !keepAcceptedEmpty ? (')
  const end = explorer.indexOf(') : logicalItemCount === 0 ? (', begin)
  assert.ok(begin >= 0 && end > begin, 'must retain original authoritative cold read gate')
  const cold = explorer.slice(begin, end)
  for (const token of [
    'data-xdrive-file-explorer-cold-first-range',
    'aria-busy="true"',
    "minHeight: 180, display: 'grid', placeItems: 'center'",
    'showDelayedLoading',
    '<XDriveStatePanel variant="plain" loading message="正在加载文件…" />',
  ]) assert.ok(cold.includes(token), token)
  assert.ok(cold.indexOf('data-xdrive-file-explorer-cold-first-range') <
    cold.indexOf('showDelayedLoading'), 'feedback must live inside the first-frame slot')
  assert.ok(explorer.includes('globalThis.setTimeout(() => setDelayedLoadingScope(interactionScopeKey), 300)'))
  assert.ok(explorer.includes('showDelayedLoading = loading && delayedLoadingScope === interactionScopeKey'))
  assert.ok(explorer.includes('keepAcceptedEmpty'), 'accepted empty directory may not flash progress')
  assert.ok(explorer.includes('data-xdrive-file-explorer-unverified-first-read'),
    'original 180px unverified Trash slot remains')
  assert.ok(explorer.includes('data-xdrive-file-explorer-empty-read-error'),
    'read failure must remain distinguishable from verified zero')
})

test('same shared Explorer and Mobile cold slot retain original Range, virtual scroll and media progress', () => {
  for (const [name, src] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(src.includes('<XDriveFileExplorer'), name + ' must use the shared virtual Explorer')
    assert.ok(src.includes('virtualCollection='), name + ' must retain sparse Range')
  }
  assert.ok(mobile.includes('data-mobile-files-cold-read-slot={coldUnconfirmedBrowse || undefined}'))
  assert.ok(mobile.includes("minHeight: 180, display: 'grid', placeItems: 'center'"))
  assert.ok(explorer.includes('XDriveFileExplorerThumbnail'))
  assert.ok(gallery.includes('XDriveMediaAsyncThumbnail'))
  assert.ok(gallery.includes('XDriveMediaAsyncVideoPoster'))
})
