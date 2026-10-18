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

test('Web/Desktop shared cold first Range reserves one silent slot through a slow GET', () => {
  const begin = explorer.indexOf(') : loading && logicalItemCount === 0 && !keepAcceptedEmpty ? (')
  const end = explorer.indexOf(') : logicalItemCount === 0 ? (', begin)
  assert.ok(begin >= 0 && end > begin, 'retain original authoritative cold read gate')
  const cold = explorer.slice(begin, end)
  for (const token of [
    'data-xdrive-file-explorer-cold-first-range',
    'aria-busy="true"',
    "minHeight: 180, display: 'grid', placeItems: 'center'",
  ]) assert.ok(cold.includes(token), token)
  assert.equal(cold.includes('showDelayedLoading'), false)
  assert.equal(cold.includes('XDriveStatePanel'), false,
    'cold directory transition must not paint an intermediate spinner or caption')
  assert.ok(explorer.includes('globalThis.setTimeout(() => setDelayedLoadingScope(interactionScopeKey), 300)'),
    'long-running Trash and accepted-row refresh feedback remain independent')
  assert.ok(explorer.includes('showDelayedLoading = loading && delayedLoadingScope === interactionScopeKey'))
  assert.ok(explorer.includes('keepAcceptedEmpty'), 'accepted empty remains visible')
  assert.ok(explorer.includes('data-xdrive-file-explorer-unverified-first-read'))
  assert.ok(explorer.includes('data-xdrive-file-explorer-empty-read-error'))
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
