'use strict'

const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../..')
const source = (name) => readFileSync(path.join(root, name), 'utf8')
const surfaces = [
  'ui/shared/src/mui',
  'web/src',
  'desktop/src/renderer',
]

function jsxFiles(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) return jsxFiles(relative)
    return entry.isFile() && /\.(?:tsx|jsx)$/.test(entry.name) ? [relative] : []
  })
}

test('file and album folder identity has one desktop/web glyph and color', () => {
  const icon = source('ui/shared/src/mui/FolderIcon.tsx')
  const presentation = source('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
  assert.match(icon, /FolderRoundedIcon/)
  assert.match(icon, /XDRIVE_FOLDER_YELLOW = '#ffcb3d'/)
  assert.match(icon, /data-xdrive-folder-icon/)
  assert.match(presentation, /if \(fileKind === 'folder'\) return <XDriveFolderIcon/)
  assert.match(source('ui/shared/src/mui/index.tsx'), /export \* from '\.\/FolderIcon'/)
})

test('no file, album, backup, share or desktop folder row bypasses the shared glyph', () => {
  const exempt = new Set([
    // This is intentional iOS-style blue folder artwork and a Browse tab action.
    'web/src/MobileFiles.tsx',
    // The one definition of the shared Windows-style yellow folder.
    'ui/shared/src/mui/FolderIcon.tsx',
  ])
  const bypasses = []
  for (const directory of surfaces) {
    for (const file of jsxFiles(directory)) {
      if (exempt.has(file)) continue
      const text = source(file)
      if (/<Folder(?:Outlined|Rounded)Icon\b/.test(text) ||
          /\bFolderOutlined\s+as\s+FolderOutlinedIcon\b/.test(text)) {
        bypasses.push(file)
      }
    }
  }
  assert.deepEqual(bypasses, [])
})

test('column, trash, share and offline file rows preserve file-kind icons', () => {
  for (const file of [
    'ui/shared/src/mui/FileExplorerColumnView.tsx',
    'ui/shared/src/mui/TrashDialog.tsx',
    'web/src/PublicShare.tsx',
    'web/src/PwaOfflineDirectoryBrowser.tsx',
  ]) {
    assert.match(source(file), /<XDriveFileExplorerItemIcon\b/, file)
  }
  assert.doesNotMatch(source('web/src/PwaOfflineDirectoryBrowser.tsx'), /📁|📄/)
})

test('iOS Files folder imagery remains blue and consistent across views and location menu', () => {
  const mobile = source('web/src/MobileFiles.tsx')
  assert.match(mobile, /data-xdrive-mobile-folder-icon/)
  assert.match(mobile, /<MobileFolderIcon size=\{effectiveGrid \? 62 : 38\}/)
  assert.match(mobile, /<MobileFolderIcon size=\{35\}/)
  assert.match(mobile, /<MobileFolderIcon size=\{23\}/)
  // New-folder, folder-upload and Browse navigation icons communicate actions,
  // not the visual identity of an actual directory item.
  assert.match(mobile, /\['browse', <FolderRoundedIcon\/>/)
})
