#!/usr/bin/env node
// Executable bounded DSM package-volume read contract; no physical NAS needed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const compile = file => {
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.equal((result.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
  return result.outputText
}
const adapterFile = path.join(root, 'ui/shared/src/synology-backup-adapter.ts')
const localSpaceFile = path.join(root, 'ui/shared/src/synology-nas-storage.ts')
let payload = { capacity_bytes: 4096, available_bytes: 1024 }
let hold = false
const calls = []
const exports = {}
const ctx = vm.createContext({
  module: { exports }, exports, URL, TextEncoder,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/synology.html',
    origin: 'https://nas.example',
  } },
  fetch: (href, options) => {
    calls.push({ href, options })
    if (hold) return new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('cancelled')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    })
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => payload,
    })
  },
})
vm.runInContext(compile(adapterFile), ctx, { filename: adapterFile, timeout: 1000 })
const client = ctx.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi',
)
assert.equal((await client.nasVolumeSpace()).capacity_bytes, 4096)
assert.equal(calls.length, 1)
assert.equal(new URL(calls[0].href).search, '?op=nas-volume')
assert.equal(calls[0].options.method, 'GET')
assert.equal(calls[0].options.credentials, 'same-origin')
assert.equal(calls[0].options.redirect, 'error')
assert.equal(calls[0].options.headers.Authorization, undefined)
for (const invalid of [
  { available_bytes: 1024 }, { capacity_bytes: 0, available_bytes: 0 },
  { capacity_bytes: 10, available_bytes: 11 },
  { capacity_bytes: 4096, available_bytes: -1 },
  { capacity_bytes: '4096', available_bytes: 10 },
  { capacity_bytes: Number.MAX_SAFE_INTEGER + 1, available_bytes: 1 },
  { capacity_bytes: 4096, available_bytes: 1024, volume: '/volume1/photo' },
  null, [], {},
]) {
  payload = invalid
  await assert.rejects(() => client.nasVolumeSpace(), /Invalid/)
}
payload = { capacity_bytes: 4096, available_bytes: 1024 }
hold = true
const controller = new AbortController()
const cancelled = client.nasVolumeSpace(controller.signal)
assert.equal(calls.at(-1).options.signal, controller.signal)
controller.abort()
await assert.rejects(cancelled, error => error.name === 'AbortError')
hold = false

let diskRead = async () => ({ capacity_bytes: 4096, available_bytes: 1024 })
const hostExports = {}
const hostContext = vm.createContext({
  module: { exports: hostExports }, exports: hostExports,
  require: module => {
    assert.equal(module, './synology-browser-storage')
    return { createXDriveSynologyBrowserStorageSource: () => ({
      load: async () => ({ browserStorage: { supported: true, clear_supported: false, total_used_bytes: 8 } }),
    }) }
  },
})
vm.runInContext(compile(localSpaceFile), hostContext, { filename: localSpaceFile, timeout: 1000 })
const makeSource = hostContext.module.exports.createXDriveSynologyNASStorageSource
const source = makeSource({ nasVolumeSpace: signal => diskRead(signal) })
const snapshot = await source.load()
assert.equal(snapshot.browserStorage.total_used_bytes, 8)
assert.equal(snapshot.nasSpace.supported, true)
assert.equal(snapshot.nasSpace.capacity_bytes, 4096)
assert.equal(snapshot.nasSpace.available_bytes, 1024)
assert.equal(snapshot.desktopStorage, undefined)
assert.equal(typeof source.clearBrowserCache, 'undefined')
assert.equal(typeof source.setFolderMode, 'undefined')
diskRead = async () => { throw new Error('unavailable') }
const unavailable = await source.load()
assert.equal(unavailable.nasSpace.supported, false)
assert.ok(/无法确认/.test(unavailable.nasSpace.reason))
const aborted = new AbortController()
aborted.abort()
await assert.rejects(() => source.load(aborted.signal), /cancelled/)

const dsmHostSource = fs.readFileSync(path.join(root, 'web/src/synologyHost.ts'), 'utf8')
const pageSource = fs.readFileSync(path.join(root, 'ui/shared/src/mui/LocalStoragePage.tsx'), 'utf8')
assert.match(dsmHostSource, /localStorage: createXDriveSynologyNASStorageSource\(local\)/)
assert.match(pageSource, /title="DSM 套件数据所在文件系统"/)
assert.match(pageSource, /nas\.capacity_bytes - nas\.available_bytes/)
assert.doesNotMatch(fs.readFileSync(localSpaceFile, 'utf8'), /localStorage|document\.cookie|Authorization|\.delete\(/)
console.log('DSM package filesystem read: authenticated fixed GET, strict receipt, no path or write, independent browser totals.')
