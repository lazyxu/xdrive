'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = pathName => fs.readFileSync(path.join(root,pathName),'utf8')
const page = read('web/src/PublicShare.tsx')
const explorer = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')

test('P115: public share live status cannot be inserted among normal Explorer layout rows', () => {
  const marker=page.indexOf('data-xdrive-public-share-read-slot')
  const shareStart=page.indexOf('<Stack spacing={2.25}',marker)
  const shareEnd=page.indexOf('</Stack>\n          )}',shareStart)
  const floating=page.indexOf('data-xdrive-public-share-floating-feedback')
  assert.ok(marker>0 && shareStart>marker && shareEnd>shareStart && floating>shareEnd)
  const originalStack=page.slice(shareStart,shareEnd)
  for(const bad of [
    '{folderError && <XDriveStatusAlert',
    '{zipError && <XDriveStatusAlert',
    '{zipNotice && <Typography',
    '{exhausted && <XDriveStatusAlert',
  ])assert.equal(originalStack.includes(bad),false,bad)
  for(const must of [
    'folderError','zipError','zipNotice','exhausted','notice',
    'role="status"', "position: 'fixed'",
    "env(safe-area-inset-bottom", "pointerEvents: 'none'",
  ])assert.ok(page.slice(floating).includes(must),must)
  assert.ok(originalStack.includes('data-xdrive-public-share-zip-status-slot'))
  assert.ok(originalStack.includes('height: 24, minHeight: 24'))
})

test('P115: common Core page identity, not fresh array, resets controls before paint', () => {
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  assert.ok(explorer.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert.ok(bridge.includes('const pageIdentity = useMemo('))
  assert.ok(bridge.includes('[kind, currentFolderID, acceptedPage]'))
  assert.ok(bridge.includes('useLayoutEffect(() => {'))
  assert.ok(bridge.includes('}, [pageIdentity])'))
  assert.ok(bridge.includes('items.slice(0, fileLink ? 1 : sharePageLimit)'))
  assert.ok(bridge.includes('<XDriveFileExplorer'))
  assert.ok(page.includes('pendingPage.current?.abort()'))
  assert.ok(page.includes('api.publicShareChildren('))
})
