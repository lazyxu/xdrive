#!/usr/bin/env node
// Executable parser validation and exact DSM share route wiring regression.
// No new source write, browser-provided NAS pathname or Agent bearer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
const base = new URL('../../', import.meta.url)
const read = p => fs.readFileSync(new URL(p, base), 'utf8')
const helper = stripTypeScriptTypes(read('ui/shared/src/synology-nas-share-inventory.ts'), { mode: 'strip' })
const { xDriveValidateSynologyNASShareInventory: verify } =
  await import('data:text/javascript,' + encodeURIComponent(helper))
const a = 'a'.repeat(64), b = 'b'.repeat(64)
assert.deepEqual(verify({ items: [
  { label: '/volume1/photo', selection_id: a },
  { label: '/volume2/Backup Drive', selection_id: b },
]}).map(v => v.label), ['/volume1/photo', '/volume2/Backup Drive'])
assert.deepEqual(verify({ items: [] }), [], 'empty inventory is not a successful Root grant')
for (const bad of [
  { items: [], bearer: 'SECRET' }, { items: null }, { items: new Array(513).fill(null) },
  { items: [{ label: '/etc/passwd', selection_id: a }] },
  { items: [{ label: '/volume0/photos', selection_id: a }] },
  { items: [{ label: '/volume01/photos', selection_id: a }] },
  { items: [{ label: '/volume1/@appdata', selection_id: a }] },
  { items: [{ label: '/volume1/homes', selection_id: a }] },
  { items: [{ label: '/volume1/../etc', selection_id: a }] },
  { items: [{ label: '/volume1/child/leaf', selection_id: a }] },
  { items: [{ label: '/volume1/child', selection_id: 'x'.repeat(64) }] },
  { items: [{ label: '/volume1/child', selection_id: a, path: '/etc' }] },
  { items: [{ label: '/volume1/child', selection_id: a }, { label: '/volume1/child', selection_id: b }] },
  { items: [{ label: '/volume1/photo', selection_id: a }, { label: '/volume2/photo', selection_id: a }] },
]) assert.throws(() => verify(bad), /Invalid|Unsafe/)
const adapter = read('ui/shared/src/synology-backup-adapter.ts')
const panel = read('ui/shared/src/mui/SynologyBackupLocalPanel.tsx')
const browser = read('ui/shared/src/mui/SynologyNASShareInventory.tsx')
const cgi = read('internal/synologyui/cgi.go')
const gateway = read('internal/synologyui/gateway.go')
const workflow = read('.github/workflows/synology-ui.yml')
assert.match(adapter, /'nas-shares'/)
assert.match(adapter, /xDriveValidateSynologyNASShareInventory/)
assert.match(browser, /client\.nasShares\(controller\.signal\)/)
assert.match(browser, /controller\.abort\(\)/)
assert.match(browser, /share\.label/)
assert.match(browser, /client\.preflightNASShare\(share\.selection_id, controller\.signal\)/)
assert.doesNotMatch(browser, /\{share\.selection_id\}\s*</,
  'opaque share IDs must not be visibly rendered')
assert.doesNotMatch(browser, /AuthorizeLocalRoot|createLocalBackupSource|fetch\(/,
  'native preflight must not grant Root authority')
assert.match(panel, /<XDriveSynologyNASShareInventory client=\{client\}/)
assert.match(cgi, /"nas-shares"/)
assert.match(gateway, /r\.URL\.Path == "\/v1\/nas-shares"/)
assert.match(workflow, /node web\/scripts\/test-synology-nas-shares\.mjs/)
console.log('DSM NAS share inventory uses one authenticated local Agent and no browser path/Root grants.')
