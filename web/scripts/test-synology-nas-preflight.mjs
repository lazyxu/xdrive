#!/usr/bin/env node
// Preflight only: no Source creation, Root grants, arbitrary paths or secrets.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = new URL('../../', import.meta.url)
const read = p => fs.readFileSync(new URL(p, base), 'utf8')
const browser = read('ui/shared/src/mui/SynologyNASShareInventory.tsx')
const client = read('ui/shared/src/synology-backup-adapter.ts')
const gateway = read('internal/synologyui/gateway.go')
const native = read('internal/synologyui/nas_share_preflight.go')
const workflow = read('.github/workflows/synology-ui.yml')
assert.match(client, /preflightNASShare\(selectionID: string, signal\?: AbortSignal\)/)
assert.match(client, /'\/v1\/nas-share-preflight', 'POST'/)
assert.match(client, /selection_id: selectionID/)
assert.match(browser, /client\.preflightNASShare\(share\.selection_id, controller\.signal\)/)
assert.match(browser, /activePreflight\.current\?\.abort\(\)/)
assert.doesNotMatch(browser, /\{share\.selection_id\}\s*</)
assert.doesNotMatch(browser, /AuthorizeLocalRoot|createLocalBackupSource|localStorage\.setItem/)
assert.match(gateway, /checker\.PreflightLocalRoot\(ctx, path\)/)
assert.match(native, /subtle\.ConstantTimeCompare/)
assert.doesNotMatch(native, /CreateLocalBackupSource|AuthorizeLocalRoot|exec\.Command/)
assert.match(workflow, /node web\/scripts\/test-synology-nas-preflight\.mjs/)
console.log('DSM NAS share preflight delegates only to the original owning Agent, without granting Root authority')
