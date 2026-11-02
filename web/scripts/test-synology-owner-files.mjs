#!/usr/bin/env node
// Native Owner cloud root and children transport: source-exact code, no DSM
// device, no real account and no credential. This is not physical DSM testing.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const filename = path.join(repo, 'ui/shared/src/synology-backup-adapter.ts')
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((code.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const calls = []
const date = '2026-10-26T00:00:00Z'
const root = { id: 17, name: 'Cloud', type: 'dir', size: 0,
  revision: 1, created_at: date, updated_at: date }
const child = { id: 42, parent_id: 17, name: 'album.jpg', type: 'file',
  size: 1200, revision: 2, created_at: date, updated_at: date }
const validPage = { items: [child], has_more: false, sort: 'name', order: 'asc' }
const validText = { text: 'hello', truncated: false, size: 5 }
let response = (url) => url.searchParams.get('op') === 'cloud-root'
  ? root : url.searchParams.get('op') === 'cloud-text-preview' ? validText : validPage
const exports = {}
const context = vm.createContext({
  exports, module: { exports }, URL, TextEncoder, atob, Uint8Array,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example',
  } },
  fetch: async (raw, options) => {
    const url = new URL(raw)
    calls.push({url, options})
    assert.ok(['cloud-root', 'cloud-children', 'cloud-create-folder', 'cloud-rename-node', 'bootstrap', 'cloud-text-preview', 'cloud-media-range'].includes(url.searchParams.get('op')))
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => response(url) }
  },
})
vm.runInContext(code.outputText, context, { filename, timeout: 1000 })
const client = context.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi',
)
const abort = new AbortController()
assert.equal((await client.ownerFilesRoot(abort.signal)).id, 17)
const data = await client.ownerFilesPage(17, 200, 'name', 'asc', '', abort.signal)
assert.equal(data.items.length, 1)
assert.equal(data.items[0].parent_id, 17)
assert.equal(data.items[0].name, 'album.jpg')
assert.equal(calls.length, 2)
assert.equal(calls[0].url.search, '?op=cloud-root')
assert.equal(calls[1].url.searchParams.get('op'), 'cloud-children')
for (const [name, expected] of [
  ['parent_id', '17'], ['limit', '200'], ['sort', 'name'], ['order', 'asc'],
]) {
  assert.equal(calls[1].url.searchParams.get(name), expected)
}
assert.ok(calls.every(({url,options}) =>
  url.origin === 'https://nas.example' &&
  options.method === 'GET' && options.signal === abort.signal &&
  options.credentials === 'same-origin' && options.redirect === 'error' &&
  !options.headers.Authorization && !options.body))

for (const args of [
  [0,200,'name','asc',''], [Number.MAX_SAFE_INTEGER+1,200,'name','asc',''],
  [17,0,'name','asc',''], [17,201,'name','asc',''],
  [17,200,'invalid','asc',''], [17,200,'name','random',''],
  [17,200,'name','asc','x\ny'], [17,200,'name','asc','x\ry'],
  [17,200,'name','asc',String.fromCharCode(0)],
  [17,200,'name','asc','x'.repeat(1025)],
]) {
  await assert.rejects(client.ownerFilesPage(...args), /Invalid/)
}
assert.equal(calls.length, 2, 'invalid request contacted Server Owner Agent')

// Valid opaque cursors must not be mistaken for control characters.
await client.ownerFilesPage(17, 200, 'name', 'asc', 'run-list==')
assert.equal(calls[2].url.searchParams.get('cursor'), 'run-list==')
assert.equal(calls[2].options.headers.Authorization, undefined)

// Preview travels through the same fixed DSM CGI, never a signed origin URL,
// and never receives the original Agent/Server bearer.
const goodText = await client.ownerFileTextPreview(42)
assert.equal(goodText.text, 'hello')
assert.equal(goodText.size, 5)
assert.equal(calls[3].url.search, '?op=cloud-text-preview&node_id=42')
assert.equal(calls[3].options.method, 'GET')
assert.equal(calls[3].options.headers.Authorization, undefined)
for (const id of [0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, NaN]) {
  await assert.rejects(client.ownerFileTextPreview(id), /Invalid/)
}
assert.equal(calls.length, 4, 'invalid preview IDs reached DSM')
// Schema and decoded UTF-8 byte cap are authoritative, including unknown keys.
for (const badText of [
  {...validText, text: 'x'.repeat((1 << 20) + 1)},
  {...validText, text: '字'.repeat(400000)},
  {...validText, size: -1},
  {...validText, size: Number.MAX_SAFE_INTEGER + 1},
  {...validText, truncated: 'no'},
  {...validText, upstream_url: 'https://private.example/data'},
  {text: 'hi', truncated: false},
]) {
  response = url => url.searchParams.get('op') === 'cloud-text-preview' ? badText : validPage
  await assert.rejects(client.ownerFileTextPreview(42), /Invalid/)
}
response = (url) => url.searchParams.get('op') === 'cloud-root'
  ? root : url.searchParams.get('op') === 'cloud-text-preview' ? validText : validPage

const rejectsPage = async (fake) => {
  response = url => url.searchParams.get('op') === 'cloud-root' ? root : fake
  await assert.rejects(client.ownerFilesPage(17,200,'name','asc',''), /Invalid/)
}
for (const bad of [
  {...validPage, items: [{...child,parent_id:99}]},
  {...validPage, items: [{...child, id: Number.MAX_SAFE_INTEGER+1}]},
  {...validPage, items: [{...child, private_path:'/volume1/secrets'}]},
  {...validPage, items: [child,child]},
  {...validPage, items: [{...child,type:'symlink'}]},
  {...validPage, items: [{...child, size:-1}]},
  {...validPage, items: [{...child, created_at:'bad-time'}]},
  {...validPage, has_more:true, next_cursor:''},
  {...validPage, sort:'size'},
  {...validPage, next_cursor:'secret\ntoken'},
]) {
  await rejectsPage(bad)
}
response = url => url.searchParams.get('op') === 'cloud-root'
  ? {...root, storage_key:'PRIVATE-CAS-KEY'} : validPage
await assert.rejects(client.ownerFilesRoot(), /Invalid/)
response = url => url.searchParams.get('op') === 'cloud-root'
  ? {...root,parent_id:17} : validPage
await assert.rejects(client.ownerFilesRoot(), /Invalid/)
assert.ok(calls.every(({url,options}) =>
  url.origin === 'https://nas.example' && options.method === 'GET' && !options.headers.Authorization))
// Folder/sort scope guards never reuse a previous authenticated page while
// React is rendering a changed breadcrumb, before its request effect executes.
// Scroll-driven paging may only follow a real user scroll in an overflowed
// canonical FileExplorer host; the explicit "加载更多" button remains a fallback.
const scopeFile = path.join(repo, 'ui/shared/src/synology-owner-files-scope.ts')
const scopeCompiled = ts.transpileModule(fs.readFileSync(scopeFile, 'utf8'), {
  fileName: scopeFile, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((scopeCompiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const scopeExports = {}
const scopeContext = vm.createContext({ exports: scopeExports, module: { exports: scopeExports } })
vm.runInContext(scopeCompiled.outputText, scopeContext, { filename: scopeFile, timeout: 1000 })
const { xDriveSynologyOwnerFilesScopeKey: scopeKey, xDriveSynologyOwnerFilesNearEnd: nearEnd } =
  scopeContext.module.exports
const rootScope = scopeKey([{ id: 17 }], 'name', 'asc')
assert.equal(rootScope, scopeKey([{ id: 17 }], 'name', 'asc'))
assert.notEqual(rootScope, scopeKey([{ id: 17 }, { id: 42 }], 'name', 'asc'))
assert.notEqual(rootScope, scopeKey([{ id: 18 }], 'name', 'asc'))
assert.notEqual(rootScope, scopeKey([{ id: 17 }], 'updated', 'asc'))
assert.notEqual(rootScope, scopeKey([{ id: 17 }], 'name', 'desc'))
assert.equal(nearEnd(0, 900, 900), false, 'no eager pagination for short directories')
assert.equal(nearEnd(100, 800, 4000), false)
assert.equal(nearEnd(2970, 800, 4000), true, 'load only when scrolled near end')
assert.equal(nearEnd(-1, 800, 4000), false)
assert.equal(nearEnd(NaN, 800, 4000), false)
assert.equal(nearEnd(0, 0, 4000), false)
const pageSource = fs.readFileSync(
  path.join(repo, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
const controllerSource = fs.readFileSync(
  path.join(repo, 'ui/shared/src/mui/FileExplorerCursorDirectoryController.ts'), 'utf8')
assert.match(pageSource, /useXDriveFileExplorerCursorDirectory\(/)
assert.match(controllerSource, /verified\s*&&\s*rootCurrent\s*&&\s*verifiedScopeKey\s*===\s*currentScopeKey/)
assert.match(pageSource, /currentScopeVerified\s*\?\s*items\.map\(itemForExplorer\)\s*:\s*\[\]/)
assert.match(pageSource, /onScrollCapture=/)
assert.match(pageSource, /data-xdrive-file-explorer-scroll-host/)
assert.match(pageSource, /xDriveSynologyOwnerFilesNearEnd\(/)
assert.match(controllerSource, /setVerifiedScopeKey\(''\)/)
assert.match(pageSource, /<XDriveActionButton compact loading=\{paging\}/)

const explorerSource = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
const hostEntrySource = fs.readFileSync(path.join(repo, 'web/src/synology.tsx'), 'utf8')
const hostOutletSource = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/XDriveAppPageOutlet.tsx'), 'utf8')
assert.match(pageSource, /unavailableActions=\{unavailableActions\}/)
assert.match(pageSource, /searchEnabled\s+unavailableActions=/)
const hostAdapterSource = fs.readFileSync(path.join(repo, 'web/src/synologyHost.ts'), 'utf8')
assert.match(hostEntrySource, /const host = createXDriveSynologyHost\(\)/)
assert.match(hostEntrySource, /<XDriveApp\s+host=\{host\}/)
assert.match(hostAdapterSource, /ownerFilesPage:\s*\{\s*client:\s*local,\s*unavailableActions:\s*\{/)
assert.match(hostOutletSource, /client=\{services\.ownerFilesPage\.client\}/)
assert.match(hostOutletSource, /unavailableActions=\{services\.ownerFilesPage\.unavailableActions\}/)
assert.match(explorerSource, /searchUnavailableReason\s*\?\s*'搜索暂不可用'/)
assert.ok(explorerSource.includes("if (command === 'new-folder' && onCreateFolder && !unavailableActions?.createFolder)"),
  'disabled Host mutations must not be callable through keyboard shortcuts')
assert.ok(explorerSource.includes("(onUpload && !unavailableActions?.uploadFiles)"),
  'UI cannot claim a write capability when Host upload is disabled')
assert.match(explorerSource, /disabled=\{Boolean\(!onUpload \|\| unavailableActions\?\.uploadFiles\)\}/)
assert.match(explorerSource, /disabled=\{Boolean\(!onCreateFolder \|\| unavailableActions\?\.createFolder\)\}/)


// Immutable Owner media ranges never expose private Agent credentials or
// arbitrary Server download URLs; byte arrays are canonical base64-only.
const validRange = { offset: 0, total: 4, revision: 7,
  sha256: 'a'.repeat(64), data: 'YWJjZA==' }
response = url => url.searchParams.get('op') === 'cloud-media-range' ? validRange : validPage
const first = await client.ownerFileMediaRange(42, 7, 0, 4, abort.signal)
assert.equal(first.data.length, 4)
assert.equal(Array.from(first.data).join(','), '97,98,99,100')
assert.equal(first.sha256, validRange.sha256)
assert.equal(calls.at(-1).url.searchParams.get('op'), 'cloud-media-range')
assert.equal(calls.at(-1).url.searchParams.get('node_id'), '42')
assert.equal(calls.at(-1).url.searchParams.get('revision'), '7')
assert.equal(calls.at(-1).options.method, 'GET')
assert.equal(calls.at(-1).options.headers.Authorization, undefined)
const callsAfterRange = calls.length
for (const args of [
  [0,7,0,4], [42,0,0,4], [Number.MAX_SAFE_INTEGER+1,7,0,4],
  [42,7,-1,4], [42,7,0,0], [42,7,0,262145],
]) {
  await assert.rejects(client.ownerFileMediaRange(...args), /Invalid/)
}
assert.equal(calls.length, callsAfterRange)
for (const bad of [
  {...validRange, offset:1},
  {...validRange, total:3},
  {...validRange, revision:8},
  {...validRange, sha256:'not-a-hash'},
  {...validRange, sha256:'B'.repeat(64)},
  {...validRange, data:'invalid+/='},
  {...validRange, data:'YWJjZAAA'},
  {...validRange, data:'YWJj'},
  {...validRange, secretBearer:'stolen'},
]) {
  response = url => url.searchParams.get('op') === 'cloud-media-range' ? bad : validPage
  await assert.rejects(client.ownerFileMediaRange(42,7,0,4), /Invalid|Inconsistent/)
}

// A single current-Owner create action uses the same CGI/CSRF transport and
// cannot introduce arbitrary cloud writes or private Node fields.
const folder = {id:57,parent_id:17,name:'新文件夹',type:'dir',size:0,
  revision:1,created_at:date,updated_at:date}
response = url => url.searchParams.get('op') === 'bootstrap'
  ? {csrf_token:'b'.repeat(64)} : folder
const firstCreateIndex = calls.length
const created = await client.ownerCreateFolder(17, '新文件夹', 'a'.repeat(64))
assert.equal(created.id,57)
assert.equal(calls.length,firstCreateIndex+2)
assert.equal(calls.at(-2).url.search,'?op=bootstrap')
assert.equal(calls.at(-1).url.search,'?op=cloud-create-folder')
assert.equal(calls.at(-1).options.method,'POST')
assert.equal(calls.at(-1).options.headers['X-CSRF-Token'],'b'.repeat(64))
assert.deepEqual(JSON.parse(calls.at(-1).options.body),
  {parent_id:17,name:'新文件夹',owner_scope:'a'.repeat(64)})
assert.equal(calls.at(-1).options.headers.Authorization,undefined)
const beforeInvalid = calls.length
for (const [parent, name, scope] of [
  [0,'A','a'.repeat(64)], [17,'/private','a'.repeat(64)],
  [17,'..','a'.repeat(64)], [17,'bad\nname','a'.repeat(64)],
  [17,'A','bogus'], [17,'x'.repeat(256),'a'.repeat(64)],
]) {
  await assert.rejects(client.ownerCreateFolder(parent,name,scope), /Invalid/)
}
assert.equal(calls.length,beforeInvalid,'invalid folder create touched DSM CGI')
for (const invalid of [
  {...folder,parent_id:99},
  {...folder,type:'file'},
  {...folder,name:'switched-owner'},
  {...folder,root_path:'/volume1/private'},
]) {
  response = url => url.searchParams.get('op') === 'bootstrap'
    ? {csrf_token:'b'.repeat(64)} : invalid
  await assert.rejects(client.ownerCreateFolder(17,'新文件夹','a'.repeat(64)),/Invalid/)
}
assert.match(pageSource, /onCreateFolder=\{/)
assert.match(pageSource, /<XDriveFileNameDialog/)
assert.match(pageSource, /client\.ownerCreateFolder\(/)
// Owner-scoped file/folder rename must never bypass the current Agent,
// current page revision, DSM CSRF, or the original authenticated Server API.
const renamedNode = { id:42, parent_id:17, type:'file', name:'新照片.jpg',
  size:1500, revision:8, created_at:date, updated_at:date }
response = url => url.searchParams.get('op') === 'bootstrap'
  ? { csrf_token:'b'.repeat(64) } : renamedNode
const renameStart = calls.length
const renameResult = await client.ownerRenameNode(
  42, 7, 17, 'file', '新照片.jpg', 'a'.repeat(64))
assert.equal(renameResult.revision, 8)
assert.equal(renameResult.parent_id, 17)
assert.equal(calls.length, renameStart + 1)
assert.equal(calls.at(-1).url.search, '?op=cloud-rename-node')
assert.equal(calls.at(-1).options.method, 'POST')
assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], 'b'.repeat(64))
assert.equal(calls.at(-1).options.headers.Authorization, undefined)
assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
  id:42, revision:7, parent_id:17, type:'file',
  name:'新照片.jpg', owner_scope:'a'.repeat(64),
})
const renameInvalidStart = calls.length
for (const args of [
  [0,7,17,'file','新照片.jpg','a'.repeat(64)],
  [42,0,17,'file','新照片.jpg','a'.repeat(64)],
  [42,7,0,'file','新照片.jpg','a'.repeat(64)],
  [42,7,17,'symlink','新照片.jpg','a'.repeat(64)],
  [42,7,17,'file','../bad','a'.repeat(64)],
  [42,7,17,'file','bad\\nname','a'.repeat(64)],
  [42,7,17,'file','新照片.jpg','invalid-scope'],
]) await assert.rejects(client.ownerRenameNode(...args), /Invalid/)
assert.equal(calls.length, renameInvalidStart)
for (const bad of [
  { ...renamedNode, id:43 },
  { ...renamedNode, parent_id:99 },
  { ...renamedNode, type:'dir' },
  { ...renamedNode, revision:7 },
  { ...renamedNode, name:'foreign-name.jpg' },
  { ...renamedNode, original_path:'/volume1/private' },
]) {
  response = url => url.searchParams.get('op') === 'bootstrap'
    ? { csrf_token:'b'.repeat(64) } : bad
  await assert.rejects(
    client.ownerRenameNode(42,7,17,'file','新照片.jpg','a'.repeat(64)),
    /Invalid/)
}
assert.ok(pageSource.includes('onRenameItem={async (item, name) => {'))
assert.ok(pageSource.includes('xDriveFindVerifiedOwnerSelection(item, itemsRef.current)'))
assert.ok(pageSource.includes('client.ownerRenameNode('))
console.log('DSM Owner Files: current Owner reads, folder create, and exact-revision rename verified')
