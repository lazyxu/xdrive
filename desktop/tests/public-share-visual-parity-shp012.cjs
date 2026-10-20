'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('SH-P012: public and Owner Details actually mount one neutral name/visual renderer', () => {
  const pure = read('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const publicView = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  for (const name of ['XDriveFileExplorerItemName', 'XDriveFileExplorerDetailsNameCell']) {
    assert.match(pure, new RegExp('export function ' + name + '\\('))
    assert.match(owner, new RegExp('<' + name + '\\b'))
    assert.match(publicView, new RegExp('<' + name + '\\b'))
  }
  assert.match(pure, /WebkitLineClamp: 2/)
  assert.match(pure, /width: 24, height: 24/)
  assert.match(publicView, /width: 72, height: 72/)
  assert.match(publicView, /size=\{52\} folderSize=\{52\}/)
  assert.doesNotMatch(pure, /\/api\/v1|sessionToken|onDeleteItems|onMoveItemsTo/)
})

test('SH-P012: share root and descendant metadata are strictly authorized and bounded', () => {
  const rootShare = read('internal/api/shares.go')
  const children = read('internal/api/folder_shares.go')
  const models = read('ui/shared/src/models.ts')
  const web = read('web/src/PublicShare.tsx')
  for (const source of [rootShare, children]) {
    assert.match(source, /json:"revision(?:,omitempty)?"/)
    assert.match(source, /json:"updated_at(?:,omitempty)?"/)
  }
  assert.ok(rootShare.includes('if share.PasswordHash == ""'), 'root revision and time must not bypass the password gate')
  assert.match(rootShare, /json:"revision,omitempty"/)
  assert.match(rootShare, /json:"updated_at,omitempty"/)
  for (const source of [models, web]) {
    assert.match(source, /revision/)
    assert.match(source, /updated_at/)
  }
  for (const guarded of ['publicFolderShareContainsNode', 'resolvePublicShare', 'share.PasswordHash']) {
    assert.ok(children.includes(guarded), 'missing Share owner authorization: ' + guarded)
  }
  assert.match(children, /publicFolderSharePageLimit = 100/)
  assert.match(children, /Limit\(publicFolderSharePageLimit \+ 1\)/)
  assert.doesNotMatch(web, /new XDriveFileExplorer\(/)
})

test('SH-P012: Share workspace offers no Owner mutations; a compact row directly opens a permitted target', () => {
  const publicView = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  assert.match(publicView, /useMediaQuery\('\(max-width:620px\)'\)/)
  assert.match(publicView, /if \(compactShareViewport\) openEntry\(entry\)/)
  assert.ok(publicView.includes("closest?.('button, a, input, [role=\"button\"]')"),
    'explicit Download and Preview controls must not initiate a second Share request')
  assert.match(publicView, /onContextMenu=\{\(event\) => openContextMenu\(event, entry\)\}/)
  assert.match(publicView, /onDoubleClick=\{\(\) => \{ if \(!compactShareViewport\) openEntry\(entry\) \}\}/)
  assert.match(publicView, /修改时间/)
  assert.match(publicView, /entry\.updated_at/)
  for (const forbidden of ['onDeleteItems', 'onMoveItemsTo', 'onPaste', 'onUpload', 'OwnerApi', 'Authorization: Bearer']) {
    assert.ok(!publicView.includes(forbidden), 'Share shell must not carry Owner action: ' + forbidden)
  }
})
