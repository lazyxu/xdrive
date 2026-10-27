#!/usr/bin/env node
// Native DSM site-storage adapter test, no device, credentials or production data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const file = path.join(root, 'ui/shared/src/synology-browser-storage.ts')
const source = fs.readFileSync(file, 'utf8')
assert.ok(!/localStorage|sessionStorage|document\.cookie|xdriveDesktop|\.delete\(/.test(source),
  'DSM site read must not mutate credentials, caches or native storage')
const compiled = ts.transpileModule(source, {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)

async function readWith({ secure = true, estimate, cachesObject } = {}) {
  const exports = {}
  const storage = estimate === null ? undefined : { estimate: estimate ?? (async () =>
    ({ usage: 1024, quota: 8192 })) }
  const context = vm.createContext({
    module: { exports }, exports,
    navigator: { storage },
    caches: cachesObject,
    isSecureContext: secure,
  })
  vm.runInContext(compiled.outputText, context, { filename: file, timeout: 1000 })
  const model = context.module.exports.createXDriveSynologyBrowserStorageSource()
  assert.equal(typeof model.clearBrowserCache, 'undefined')
  assert.equal(typeof model.releaseDesktopCache, 'undefined')
  assert.equal(typeof model.setFolderMode, 'undefined')
  return model.load()
}

const known = await readWith({ cachesObject: { keys: async () => ['only-container'] } })
assert.equal(known.browserStorage.supported, true)
assert.equal(known.browserStorage.total_used_bytes, 1024)
assert.equal(known.browserStorage.quota_bytes, 8192)
assert.equal(known.browserStorage.cache_entries, 1)
assert.equal(known.browserStorage.clear_supported, false)
assert.equal(known.browserStorage.cache_bytes, undefined)
assert.equal(known.desktopStorage, undefined)
assert.match(known.browserStorage.detail, /不包含 NAS 磁盘/)
const invalid = await readWith({ estimate: async () => ({ usage: -10, quota: Infinity }) })
assert.equal(invalid.browserStorage.total_used_bytes, undefined)
assert.equal(invalid.browserStorage.quota_bytes, undefined)
const denied = await readWith({ estimate: async () => { throw new Error('permission') } })
assert.equal(denied.browserStorage.supported, false)
const insecure = await readWith({ secure: false })
assert.equal(insecure.browserStorage.supported, false)
const missing = await readWith({ estimate: null })
assert.equal(missing.browserStorage.supported, false)
console.log('DSM browser-origin storage is measured, bounded, read-only, and never NAS disk.')
