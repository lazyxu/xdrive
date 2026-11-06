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
// Two different Browser origins on one Server must use the AAD scope pinned
// by its first verified browser, never each browser's own current URL.
const publicOrigin = 'https://nas.example.test:12'
const lanOrigin = 'http://nas.lan:5000:12'
const initialVerifier = await mod.xDriveClipboardMakeVaultCheck(key, publicOrigin)
await mod.xDriveClipboardVerifyVaultCheck(peer, publicOrigin, initialVerifier)
await assert.rejects(mod.xDriveClipboardVerifyVaultCheck(peer, lanOrigin, initialVerifier))
const eventID = crypto.randomUUID()
const owner = 'https://drive.example.test:12'
const text = 'https://example.com/path?参数=文档'
const encrypted = await mod.xDriveClipboardEncrypt(key, owner, eventID, text)
assert.equal(encrypted.kind, 'text/uri-list')
const record = { client_event_id: eventID, ...encrypted }
assert.equal(await mod.xDriveClipboardDecrypt(peer, owner, record), text)
const aliasEventID = crypto.randomUUID()
const crossAlias = await mod.xDriveClipboardEncrypt(key, publicOrigin, aliasEventID, 'NAS 内网与公网共享')
assert.equal(await mod.xDriveClipboardDecrypt(peer, publicOrigin, {
  client_event_id: aliasEventID, ...crossAlias,
}), 'NAS 内网与公网共享')
await assert.rejects(mod.xDriveClipboardDecrypt(peer, lanOrigin, {
  client_event_id: aliasEventID, ...crossAlias,
}), 'a different URL cannot invent an unrelated AAD scope')
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

// A pending OS clipboard permission prompt can resolve *after* Lock. Test
// the actual async fence, not merely a regex over the React source.
const fenceFilename = 'ui/shared/src/clipboard-action-fence.ts'
const compiledFence = ts.transpileModule(read(fenceFilename), {
  fileName: fenceFilename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiledFence.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error), [])
const { XDriveClipboardActionFence } = await import('data:text/javascript;base64,' +
  Buffer.from(compiledFence.outputText).toString('base64'))
const fence = new XDriveClipboardActionFence()
let resolveRead
let screenDraft = ''
const oldReadToken = fence.capture()
const delayedRead = new Promise(resolve => { resolveRead = resolve }).then(value => {
  if (fence.isCurrent(oldReadToken)) screenDraft = value
})
fence.invalidate() // the user locked or switched Owner before permission resolved
resolveRead('sensitive clipboard text')
await delayedRead
assert.equal(screenDraft, '', 'late OS clipboard plaintext must not return after Lock')
const freshReadToken = fence.capture()
assert.equal(fence.isCurrent(freshReadToken), true)
assert.equal(fence.isCurrent(oldReadToken), false)
let copyNotice = ''
const copyToken = fence.capture()
const lateCopy = Promise.resolve().then(() => {
  if (fence.isCurrent(copyToken)) copyNotice = 'copied'
})
fence.invalidate()
await lateCopy
assert.equal(copyNotice, '', 'late copy promise must not overwrite Locked notice')

// Lock can happen while WebCrypto is still producing ciphertext; do not
// repopulate the old retry cache with a late AES-GCM completion.
const pendingFence = new XDriveClipboardActionFence()
const pendingPayload = { current: null }
let finishEncrypt
const oldSendToken = pendingFence.capture()
const lateEncrypted = new Promise(resolve => { finishEncrypt = resolve }).then(value => {
  if (pendingFence.isCurrent(oldSendToken)) pendingPayload.current = value
})
pendingFence.invalidate()
finishEncrypt({ text: 'secret from locked session', event: 'obsolete' })
await lateEncrypted
assert.equal(pendingPayload.current, null,
  'encrypt() completing after Lock must not recreate the retry payload')
assert.equal(pendingFence.isCurrent(oldSendToken), false)
assert.equal(pendingFence.isCurrent(pendingFence.capture()), true,
  'a fresh session can still use the encrypted Clipboard')

// A non-secure Browser context is rejected by WebCrypto before key use.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
try {
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { isSecureContext: false },
  })
  await assert.rejects(mod.xDriveClipboardDeriveKey('same long passphrase for both browsers', salt),
    /HTTPS.*localhost/, 'unsafe HTTP pages cannot initialize encrypted Clipboard')
} finally {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else delete globalThis.window
}

// Fail closed when crypto.subtle or secure randomness is unavailable.
// The fallback may never send plaintext or silently invent encryption.
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
try {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true, value: { getRandomValues: () => new Uint8Array(16) },
  })
  await assert.rejects(mod.xDriveClipboardDeriveKey('same long passphrase for both browsers', salt),
    /不支持安全加密/, 'PBKDF2 must refuse missing crypto.subtle')
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true, value: { subtle: webcrypto.subtle },
  })
  await assert.rejects(mod.xDriveClipboardEncrypt(key, owner, crypto.randomUUID?.() ?? 'id', 'secret'),
    /不支持安全加密/, 'encryption must refuse missing secure randomness')
} finally {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
  else delete globalThis.crypto
}

const ui = read('ui/shared/src/mui/ClipboardPage.tsx')
const transpiledUI = ts.transpileModule(ui, {
  fileName: 'ClipboardPage.tsx', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
})
assert.deepEqual((transpiledUI.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error), [])
assert.match(ui, /key=\{port\.ownerScopeKey\}/)
assert.match(ui, /readController\.current\?\.abort\(\)/)
assert.match(ui, /actionFence\.current\.invalidate\(\)/)
assert.match(ui, /actionFence\.current\.isCurrent\(actionToken\)/)
assert.match(ui, /setReading\(false\)/)
assert.match(ui, /setConfirmClear\(false\)/)
assert.match(ui, /pending\.current\?\.text !== draft/)
assert.match(ui, /await xDriveClipboardEncrypt\(key, aadScope, client_event_id, draft\)[\s\S]*?actionFence\.current\.isCurrent\(actionToken\)\) return\s+pending\.current =/,
  'Sender must check the action fence after encryption, before writing retry cache')
assert.match(ui, /setDraft\(current => current === draft \? '' : current\)/,
  'successful old send must preserve draft text entered during that send')
assert.match(ui, /xDriveClipboardDecrypt\(/)
assert.match(ui, /canonicalScope = verified\.aad_scope \|\| port\.ownerScopeKey/)
assert.match(ui, /setAADScope\(canonicalScope\)/)
assert.match(ui, /!verified\.aad_scope/)
assert.match(ui, /scope: port\.ownerScopeKey/)
assert.match(ui, /xDriveClipboardEncrypt\(key, aadScope/)
assert.match(ui, /xDriveClipboardDecrypt\(key, aadScope/)
assert.match(ui, /port\.copyText\(text\)/)
assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/)
assert.match(read('web/src/App.tsx'), /clipboard: clipboardPort/)
assert.match(read('web/src/App.tsx'), /appView === 'clipboard'/,
  'Browser shared page outlet must actually mount clipboard route, not only register it')
assert.match(read('web/src/browserWorkspaceHost.ts'), /clipboardPage: ports\.clipboard/)
assert.match(read('ui/shared/src/mui/XDriveAppPageOutlet.tsx'), /case 'clipboard'/)
assert.match(read('ui/shared/src/web-app.ts'), /case 'clipboard':/)
assert.match(read('internal/api/router.go'), /authed\.POST\("\/clipboard\/items"/)
assert.match(read('internal/api/clipboard.go'), /clause\.Locking\{Strength: "UPDATE"\}/)
assert.match(read('internal/meta/clipboard.go'), /\bAADScope\s+string\b/)
console.log('Web Clipboard MVP: E2EE roundtrip/Owner AAD/rejections and route boundaries passed')
