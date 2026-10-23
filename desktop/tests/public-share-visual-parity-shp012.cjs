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
  const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  for (const name of ['XDriveFileExplorerItemName', 'XDriveFileExplorerDetailsNameCell']) {
    assert.match(pure, new RegExp('export function ' + name + '\\('))
    assert.match(owner, new RegExp('<' + name + '\\b'))
  }
  assert.match(pure, /WebkitLineClamp: 2/)
  assert.match(pure, /width: 24, height: 24/)
  assert.ok(bridge.includes('<XDriveFileExplorer'))
  assert.ok(facade.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert.equal(facade.includes('<XDriveFileExplorerGridTileContent'), false)
  assert.ok(owner.includes('<XDriveFileExplorerGridTileContent'))
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


test('SH-P012: Share workspace offers no Owner mutations; compact taps use the shared Core', () => {
  const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const core = read('ui/shared/src/mui/FileExplorer.tsx')
  assert.match(bridge, /onOpenItem=\{openItem\}/)
  assert.match(bridge, /getItemMenuItems=\{contextActions\}/)
  assert.ok(core.includes('onOpenItem'))
  assert.ok(bridge.includes('if (entry.type === \'dir\') onOpenFolder?.(entry)'))
  for (const forbidden of ['onDeleteItems=', 'onMoveItemsTo=', 'onPaste=', 'onUpload=', 'OwnerApi', 'Authorization: Bearer']) {
    assert.ok(!bridge.includes(forbidden), 'Share bridge may not expose: ' + forbidden)
    assert.ok(!facade.includes(forbidden), 'Share facade may not expose: ' + forbidden)
  }
})
