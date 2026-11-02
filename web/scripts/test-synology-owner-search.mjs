#!/usr/bin/env node
// Actual DSM same-Origin Owner search transport and strict response validation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const filename = path.join(repo, 'ui/shared/src/synology-backup-adapter.ts')
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((code.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
const date = '2026-11-03T00:00:00Z'
const file = { id: 42, parent_id: 17, name: 'family.jpg', type: 'file',
  revision: 3, size: 1200, created_at: date, updated_at: date }
const hit = { node: file, crumbs: [{ id: 1, name: 'Cloud' }, { id: 17, name: 'Photos' }] }
const page = { items: [hit], has_more: true, next_cursor: 'next-page' }
let response = page
const calls = []
const exports = {}
const context = vm.createContext({
  exports, module: { exports }, URL, URLSearchParams, TextEncoder, Uint8Array,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/synology.html',
    origin: 'https://nas.example',
  } },
  fetch: async (href, options) => {
    const url = new URL(href)
    calls.push({ url, options })
    return { ok: true, headers: { get: () => 'application/json' },
      json: async () => response }
  },
})
vm.runInContext(code.outputText, context, { filename, timeout: 1000 })
const client = context.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi')
const abort = new AbortController()
const result = await client.ownerSearchPage('family', '', abort.signal)
assert.equal(result.items.length, 1)
assert.equal(result.items[0].node.id, 42)
assert.equal(result.has_more, true)
assert.equal(result.next_cursor, 'next-page')
assert.equal(calls.length, 1)
assert.equal(calls[0].url.search, '?op=cloud-search&q=family')
assert.equal(calls[0].options.method, 'GET')
assert.equal(calls[0].options.signal, abort.signal)
assert.equal(calls[0].options.credentials, 'same-origin')
assert.equal(calls[0].options.redirect, 'error')
assert.equal(calls[0].options.headers.Authorization, undefined)
await client.ownerSearchPage('family', 'next-page')
assert.equal(calls.at(-1).url.searchParams.get('cursor'), 'next-page')
const before = calls.length
for (const [q,cursor] of [
  ['', ''], ['f', ''], [' x', ''], ['x ', ''], ['family\nfiles', ''],
  ['family', 'bad\ncursor'], ['family', 'x'.repeat(1025)],
]) {
  await assert.rejects(client.ownerSearchPage(q,cursor), /Invalid/)
}
assert.equal(calls.length, before, 'invalid query contacted DSM CGI')
for (const invalid of [
  { ...page, items: [{ ...hit, node: { ...file, parent_id: 99 } }] },
  { ...page, items: [{ ...hit, node: { ...file, secret: 'private' } }] },
  { ...page, items: [{ ...hit, crumbs: [{ id: 99, name: 'Foreign' }] }] },
  { ...page, items: [{ ...hit, crumbs: [{ id: 1, name: 'Root' }, { id: 42, name: 'Self' }] }] },
  { ...page, items: [hit, hit] },
  { ...page, items: [], has_more: true },
  { ...page, next_cursor: '', has_more: true },
  { ...page, next_cursor: 'run-list', has_more: false },
  { ...page, next_cursor: 'bad\ntoken' },
  { ...page, owner: 'another-account' },
]) {
  response = invalid
  await assert.rejects(client.ownerSearchPage('family'), /Invalid|Unverified/)
}
response = page
const filesPage = fs.readFileSync(path.join(repo,
  'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
const filesSearch = fs.readFileSync(path.join(repo,
  'ui/shared/src/mui/SynologyOwnerFilesSearch.ts'), 'utf8')
const host = fs.readFileSync(path.join(repo, 'web/src/synologyHost.ts'), 'utf8')
const ipc = fs.readFileSync(path.join(repo,
  'cmd/xdrive-agent/desktop_ipc_runtime_mode.go'), 'utf8')
assert.match(filesPage, /useXDriveSynologyOwnerFilesSearch\(/)
assert.match(filesPage, /items=\{search\.current \? search\.items : displayedItems\}/)
assert.match(filesPage, /searchSummary=\{searchSummary\}/)
assert.match(filesPage, /search\.clear\(\)/)
assert.match(filesPage, /result\.crumbs\[0\]\?\.id !== crumbs\[0\]\?\.id/)
assert.match(filesSearch, /abortRef\.current\?\.abort\(\)/)
assert.match(filesSearch, /generation\.current !== id/)
assert.match(ipc, /"GET \/v1\/cloud\/owner-search"/)
assert.match(ipc, /capability == "cloud-owner-search-read"/)
assert.doesNotMatch(host, /search: 'DSM 尚未接通/)
for (const action of ['uploadFiles', 'uploadFolder', 'delete', 'copyTo', 'moveTo']) {
  assert.match(host, new RegExp(action + ": 'DSM"))
}
console.log('DSM Owner search: current-user CGI, bounded cursor, strict path, shared FileExplorer and cancellation')
