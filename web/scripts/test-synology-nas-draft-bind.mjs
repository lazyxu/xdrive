#!/usr/bin/env node
// Live typed CGI transport contract: one explicit owning draft bind, never
// a browser-selected native path or independent Source-create/upload path.
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
assert.equal((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)

const selection = 'a'.repeat(64)
const ownerScope = 'b'.repeat(64)
const csrf = 'c'.repeat(64)
let responseBody = { source_id: 57, state: 'authorized' }
const calls = []
const exports = {}
const ctx = vm.createContext({
  module: { exports }, exports, URL, TextEncoder,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/synology.html',
    origin: 'https://nas.example',
  } },
  fetch: async (address, opts) => {
    const url = new URL(address)
    calls.push({ url, opts })
    const op = url.searchParams.get('op')
    if (op !== 'bootstrap' && op !== 'nas-draft-bind') {
      throw Error('unexpected DSM browser authority: ' + op)
    }
    return { ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => op === 'bootstrap' ? { csrf_token: csrf } : responseBody }
  },
})
vm.runInContext(compiled.outputText, ctx, { filename: file, timeout: 1000 })
const client = ctx.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi',
)
assert.equal((await client.bindNativeDraft(57, selection, ownerScope)).state, 'authorized')
assert.equal(calls.length, 2, 'valid bind must bootstrap exactly once')
assert.equal(calls[0].url.search, '?op=bootstrap')
assert.equal(calls[0].opts.method, 'GET')
assert.equal(calls[1].url.search, '?op=nas-draft-bind')
assert.equal(calls[1].opts.method, 'POST')
assert.equal(calls[1].opts.headers['X-CSRF-Token'], csrf)
assert.equal(calls[1].opts.credentials, 'same-origin')
assert.equal(calls[1].opts.redirect, 'error')
assert.equal(calls[1].opts.cache, 'no-store')
assert.deepEqual(JSON.parse(calls[1].opts.body), {
  source_id: 57, selection_id: selection, owner_scope: ownerScope, confirmed: true,
})
assert.equal(Object.hasOwn(calls[1].opts.headers, 'Authorization'), false)

responseBody = { source_id: 57, state: 'needs_inspection' }
assert.equal((await client.bindNativeDraft(57, selection, ownerScope)).state, 'needs_inspection')
for (const invalid of [
  { source_id: 0, state: 'authorized' },
  { source_id: 99, state: 'authorized' },
  { source_id: 57, state: 'completed' },
  { source_id: 57, state: 'authorized', root_id: 'private' },
  {},
]) {
  responseBody = invalid
  await assert.rejects(() => client.bindNativeDraft(57, selection, ownerScope), /Invalid|Unverified/)
}
const beforeReject = calls.length
for (const [id, sel, scope] of [
  [0, selection, ownerScope],
  [Number.MAX_SAFE_INTEGER + 1, selection, ownerScope],
  [57, 'INVALID', ownerScope],
  [57, selection, 'INVALID'],
]) {
  await assert.rejects(() => client.bindNativeDraft(id, sel, scope), /Invalid/)
}
assert.equal(calls.length, beforeReject, 'untrusted selector called native Agent')

const binder = read('internal/synologyui/nas_draft_bind.go')
const gateway = read('internal/synologyui/gateway.go')
const cgi = read('internal/synologyui/cgi.go')
const review = read('ui/shared/src/mui/SynologyNativeDraftReview.tsx')
const setup = read('ui/shared/src/mui/SynologyBackupSourceSetup.tsx')
const workflow = read('.github/workflows/synology-ui.yml')
assert.match(cgi, /"nas-draft-bind"/)
assert.match(gateway, /serveDSMNativeDraftBind\(w, r, ctx, agent, key, username, g\.nasShareRoot\)/)
assert.match(binder, /reader\.LocalDrafts\(ctx\)/)
assert.match(binder, /bootstrap\.AuthorizeLocalRoot\(ctx, input\.SourceID, path\)/)
assert.match(binder, /grant\.StrongIdentity/)
assert.doesNotMatch(binder, /CreateLocalBackupSource\(|Start\(|exec\.Command/)
assert.match(review, /client\.bindNativeDraft\(draft\.source_id, pinnedSelection, pinnedScope\)/)
assert.match(review, /!confirmed \|\| attemptedRef\.current/)
assert.match(review, /confirmedBoundSourceRef\.current = draft\.source_id/)
assert.match(review, /onBound\(draft\.source_id\)/)
assert.match(setup, /onBound=\{onNativeDraftBound\}/)
assert.match(review, /report\.items\.some\(item => item\.source_id === boundID\)/)
assert.match(review, /confirmedBoundSourceRef\.current = null/)
assert.match(review, /attemptedRef\.current = false/)
assert.match(review, /setConfirmed\(false\)/)
assert.match(setup, /selectionID=\{selectedShare\?\.selection_id \?\? ''\}/)
assert.match(workflow, /node web\/scripts\/test-synology-nas-draft-bind\.mjs/)
console.log('DSM native draft bind requires owning Agent, fresh NAS selection, verified Owner and one explicit consent')
