#!/usr/bin/env node
// Executable DSM native-draft transport contract. No browser writes or
// automatic adoption of an uncertain Source/Root operation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const file = path.join(root, 'ui/shared/src/synology-backup-adapter.ts')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)

const scope = 'a'.repeat(64)
const createdAt = '2026-10-30T00:00:00Z'
const valid = { owner_scope: scope, items: [
  { source_id: 57, name: 'NAS Photos', revision: 1, created_at: createdAt },
  { source_id: 58, name: 'NAS Documents', revision: 1, created_at: createdAt },
] }
let reply = valid
const requests = []
const exports = {}
const ctx = vm.createContext({
  module: { exports }, exports, URL, TextEncoder,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example',
  } },
  fetch: async (address, options) => {
    requests.push({ url: new URL(address), options })
    return { ok: true, headers: { get: () => 'application/json' },
      json: async () => reply }
  },
})
vm.runInContext(compiled.outputText, ctx, { filename: file, timeout: 1000 })
const client = ctx.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi',
)
assert.equal((await client.nativeDrafts()).items.length, 2)
assert.equal(requests.length, 1)
assert.equal(requests[0].url.search, '?op=nas-drafts')
assert.equal(requests[0].options.method, 'GET')
assert.equal(requests[0].options.body, undefined)
assert.equal(requests[0].options.credentials, 'same-origin')
assert.equal(requests[0].options.cache, 'no-store')
assert.equal(requests[0].options.redirect, 'error')
assert.equal(Object.hasOwn(requests[0].options.headers, 'Authorization'), false)
reply = { ...valid, items: [] }
assert.equal((await client.nativeDrafts()).items.length, 0)
for (const bad of [
  null, {}, { ...valid, path: '/volume1/photo' }, { ...valid, owner_scope: 'bad' },
  { ...valid, items: null }, { ...valid, items: new Array(101).fill(valid.items[0]) },
  { ...valid, items: [{ ...valid.items[0], revision: 2 }] },
  { ...valid, items: [{ ...valid.items[0], source_id: 0 }] },
  { ...valid, items: [valid.items[0], valid.items[0]] },
  { ...valid, items: [valid.items[1], valid.items[0]] },
  { ...valid, items: [{ ...valid.items[0], created_at: 'invalid' }] },
  { ...valid, items: [{ ...valid.items[0], name: 'NAS\nRoot' }] },
  { ...valid, items: [{ ...valid.items[0], name: 'NAS\rRoot' }] },
  { ...valid, items: [{ ...valid.items[0], name: 'NAS\0Root' }] },
  { ...valid, items: [{ ...valid.items[0], root_id: 'private' }] },
]) {
  reply = bad
  await assert.rejects(() => client.nativeDrafts(), /Invalid|Untrusted/)
}
const review = read('ui/shared/src/mui/SynologyNativeDraftReview.tsx')
const setup = read('ui/shared/src/mui/SynologyBackupSourceSetup.tsx')
const cgi = read('internal/synologyui/cgi.go')
const gateway = read('internal/synologyui/gateway.go')
const native = read('internal/synologyui/nas_drafts.go')
const workflow = read('.github/workflows/synology-ui.yml')
assert.match(review, /client\.nativeDrafts\(controller\.signal\)/)
assert.match(review, /report\.owner_scope !== ownerScope/)
assert.match(review, /controller\.abort\(\)/)
assert.doesNotMatch(review, /createNASBackupSource|AuthorizeLocalRoot|localStorage\.setItem|fetch\(/)
assert.match(setup, /<XDriveSynologyNativeDraftReview\s+client=\{client\} ownerScope=\{ownerScope\}\s+selectionID=\{selectedShare\?\.selection_id \?\? ''\}\s+onBound=\{onCreated\}\s*\/>/)
assert.match(cgi, /"nas-drafts"/)
assert.match(gateway, /serveDSMNativeDrafts\(w, r, ctx, agent, key, username\)/)
assert.match(native, /reader\.LocalDrafts\(ctx\)/)
assert.match(native, /quotaReader\.OwnerQuota\(ctx\)/)
assert.doesNotMatch(native, /CreateLocalBackupSource|AuthorizeLocalRoot|exec\.Command/)
assert.match(workflow, /node web\/scripts\/test-synology-nas-drafts\.mjs/)
console.log('DSM native draft inspection is Owner-scoped, read-only and rejects unsafe projections')
