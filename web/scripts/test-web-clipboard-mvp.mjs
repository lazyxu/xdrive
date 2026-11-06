import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) globalThis.crypto = webcrypto
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)), '..')
const read = filename => readFileSync(resolve(root, filename), 'utf8')
const filename = 'ui/shared/src/clipboard-crypto.ts'
const compiled = ts.transpileModule(read(filename), {
  fileName: filename,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error), [])
const mod = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'))
const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64')
const key = await mod.xDriveClipboardDeriveKey('same long passphrase for both browsers', salt)
const peer = await mod.xDriveClipboardDeriveKey('same long passphrase for both browsers', salt)
const wrong = await mod.xDriveClipboardDeriveKey('a completely different passphrase', salt)
const verifier = await mod.xDriveClipboardMakeVaultCheck(key, 'owner-scope')
await mod.xDriveClipboardVerifyVaultCheck(peer, 'owner-scope', verifier)
await assert.rejects(mod.xDriveClipboardVerifyVaultCheck(wrong, 'owner-scope', verifier))
await assert.rejects(mod.xDriveClipboardVerifyVaultCheck(peer, 'different-owner', verifier))
const eventID = crypto.randomUUID()
const owner = 'https://drive.example.test:12'
const text = 'https://example.com/path?参数=文档'
const encrypted = await mod.xDriveClipboardEncrypt(key, owner, eventID, text)
assert.equal(encrypted.kind, 'text/uri-list')
const record = { client_event_id: eventID, ...encrypted }
assert.equal(await mod.xDriveClipboardDecrypt(peer, owner, record), text)
await assert.rejects(mod.xDriveClipboardDecrypt(wrong, owner, record))
await assert.rejects(mod.xDriveClipboardDecrypt(peer, 'another-owner', record))
await assert.rejects(mod.xDriveClipboardDecrypt(peer, owner, { ...record, client_event_id: crypto.randomUUID() }))
await assert.rejects(mod.xDriveClipboardDecrypt(peer, owner, { ...record, kind: 'text/plain' }))
await assert.rejects(mod.xDriveClipboardDecrypt(peer, owner, { ...record, nonce: 'invalid' }))
await assert.rejects(mod.xDriveClipboardDecrypt(peer, owner, { ...record, ciphertext: 'plain text' }))
await assert.rejects(mod.xDriveClipboardDeriveKey('short', salt))
await assert.rejects(mod.xDriveClipboardDeriveKey('valid passphrase', 'not-base64'))
const multiline = '你好，xDrive!\ncode = "✓"\nEND'
const enc2 = await mod.xDriveClipboardEncrypt(key, owner, crypto.randomUUID(), multiline)
assert.equal(enc2.kind, 'text/plain')
const textRecord = { client_event_id: 'test-event', ...enc2 }
await assert.rejects(mod.xDriveClipboardDecrypt(peer, owner, textRecord),
  'changing an event after encryption must fail AEAD')
assert.throws(() => mod.xDriveClipboardValidateText(''))
assert.throws(() => mod.xDriveClipboardValidateText('X'.repeat(65537)))
assert.equal(mod.xDriveClipboardKind('https://example.test'), 'text/uri-list')

const ui = read('ui/shared/src/mui/ClipboardPage.tsx')
const transpiledUI = ts.transpileModule(ui, {
  fileName: 'ClipboardPage.tsx', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
})
assert.deepEqual((transpiledUI.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error), [])
assert.match(ui, /key=\{port\.ownerScopeKey\}/)
assert.match(ui, /readController\.current\?\.abort\(\)/)
assert.match(ui, /pending\.current\?\.text !== draft/)
assert.match(ui, /xDriveClipboardDecrypt\(/)
assert.match(ui, /port\.copyText\(text\)/)
assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/)
assert.match(read('web/src/App.tsx'), /clipboard: clipboardPort/)
assert.match(read('web/src/browserWorkspaceHost.ts'), /clipboardPage: ports\.clipboard/)
assert.match(read('ui/shared/src/mui/XDriveAppPageOutlet.tsx'), /case 'clipboard'/)
assert.match(read('ui/shared/src/web-app.ts'), /case 'clipboard':/)
assert.match(read('internal/api/router.go'), /authed\.POST\("\/clipboard\/items"/)
console.log('Web Clipboard MVP: E2EE roundtrip/Owner AAD/rejections and route boundaries passed')
