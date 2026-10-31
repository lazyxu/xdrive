#!/usr/bin/env node
// Source-exact DSM target-read regression. No synthetic NAS paths, grants,
// cloud mutations or browser-supplied Server credentials are introduced.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => fs.readFileSync(new URL(path, new URL('../../', import.meta.url)), 'utf8')
const helper = read('ui/shared/src/synology-backup-target-directory.ts')
const compiled = stripTypeScriptTypes(helper, { mode: 'strip' })
const { xDriveSynologyBackupTargetDirectories: directories } =
  await import('data:text/javascript,' + encodeURIComponent(compiled))
const date = '2026-10-30T00:00:00Z'
const row = (id, type, parentID = 17) => ({
  id, parent_id: parentID, name: 'Folder ' + id, type,
  size: 0, revision: 2, created_at: date, updated_at: date,
})
const page = [row(19, 'file'), row(20, 'dir'), row(21, 'dir')]
assert.deepEqual(directories(page, 17, false), [], 'unverified scope must show no directories')
assert.deepEqual(directories(page, 17, true).map(item => item.id), [20, 21],
  'target picker must exclude files and never invent a cloud directory')
assert.deepEqual(page.map(item => item.id), [19, 20, 21],
  'read-only projection must not mutate the original Owner response')
for (const fake of [
  [row(20, 'dir'), row(20, 'dir')],
  [row(20, 'dir', 99)],
  [{ ...row(20, 'dir'), private_path: '/volume1/secret' }],
  [{ ...row(20, 'dir'), bearer: 'SECRET' }],
  [{ ...row(20, 'dir'), revision: 0 }],
  [{ ...row(20, 'dir'), id: Number.MAX_SAFE_INTEGER + 1 }],
  [{ ...row(20, 'dir'), type: 'symlink' }],
  [{ ...row(20, 'dir'), name: '' }],
  Array.from({ length: 201 }, (_, id) => row(id + 1, 'dir')),
]) {
  assert.throws(() => directories(fake, 17, true), /Unsafe|Unverified/)
}
assert.throws(() => directories(page, 0, true), /Unverified/)
const picker = read('ui/shared/src/mui/SynologyBackupTargetBrowser.tsx')
const panel = read('ui/shared/src/mui/SynologyBackupLocalPanel.tsx')
const setup = read('ui/shared/src/mui/SynologyBackupSourceSetup.tsx')
const sharedDevice = read('ui/shared/src/mui/DeviceBackupPage.tsx')
const ownerSource = read('ui/shared/src/synology-backup-adapter.ts')
const workflow = read('.github/workflows/synology-ui.yml')
assert.match(picker, /useXDriveFileExplorerCursorDirectory\(/,
  'must reuse the common Owner cursor lifecycle, not a parallel browser')
assert.match(picker, /client\.ownerFilesRoot\(signal\)/)
assert.match(picker, /client\.ownerFilesPage\(parentID, limit, sort\.key, sort\.direction, cursor, signal\)/)
assert.match(picker, /currentScopeVerified && isCurrentOwner\(\)/)
assert.match(picker, /itemsRef\.current\.some\(/,
  'directory navigation must recheck the current verified Owner rows at click time')
assert.match(picker, /xDriveSynologyBackupTargetDirectories\(items, parentID, verified\)/)
assert.match(picker, /refreshAuthenticatedRoot/)
assert.match(picker, /hasMore/)
assert.match(picker, /loadMore/)
assert.match(panel, /<XDriveSynologyBackupSourceSetup client=\{client\} onCreated=\{refresh\}/)
assert.match(setup, /<XDriveSynologyBackupTargetBrowser client=\{client\} onSelectTarget=\{onSelectTarget\}/)
assert.match(setup, /selectedTarget\.id/)
assert.match(picker, /currentScopeVerified && isCurrentOwner\(\)/)
assert.match(sharedDevice, /<XDriveSynologyBackupLocalPanel/)
assert.match(ownerSource, /ownerFilesRoot\(signal\?: AbortSignal\)/)
assert.match(ownerSource, /ownerFilesPage\(/)
assert.doesNotMatch(picker + helper, /fetch\(|Authorization:|localStorage|window\.xdriveDesktop|ipcRenderer|createLocalBackupSource|AuthorizeLocalRoot/,
  'selector must have no private Agent, Root grant or cloud write bridge')
assert.match(workflow, /node web\/scripts\/test-synology-backup-target-browser\.mjs/)
console.log('DSM backup target picker: current Owner folders only, verified cursors, no local Root or write capability')
