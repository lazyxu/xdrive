// Cross-platform Clipboard v1 fixture. No production password, key or ciphertext.
import assert from 'node:assert/strict'
import { createDecipheriv, pbkdf2Sync, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

if (!globalThis.crypto) globalThis.crypto = webcrypto
const root = resolve(fileURLToPath(new URL('../', import.meta.url)), '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const vector = JSON.parse(read('tests/fixtures/clipboard-v1-interoperability.json'))
assert.equal(vector.protocol, 'xdrive-clipboard-v1')
assert.equal(vector.iterations, 310000)
assert.equal(vector.kdf, 'PBKDF2-SHA256')
assert.equal(vector.aad_scope, 'https://clipboard.example.test:' + vector.owner_id)
const salt = Buffer.from(vector.salt, 'base64')
assert.equal(salt.byteLength, 16)
const key = pbkdf2Sync(Buffer.from(vector.passphrase, 'utf8'), salt, 310000, 32, 'sha256')
assert.equal(key.toString('hex'), vector.key_hex)

function nodeDecrypt(item, ownerScope = vector.aad_scope, keyBytes = key) {
  const ciphertextAndTag = Buffer.from(item.ciphertext, 'base64')
  assert.ok(ciphertextAndTag.length >= 17)
  const nonce = Buffer.from(item.nonce, 'base64')
  assert.equal(nonce.length, 12)
  const cipher = createDecipheriv('aes-256-gcm', keyBytes, nonce)
  cipher.setAAD(Buffer.from(
    'xdrive-clipboard-v1|' + ownerScope + '|' + item.client_event_id + '|' + item.kind, 'utf8'))
  cipher.setAuthTag(ciphertextAndTag.subarray(-16))
  return Buffer.concat([
    cipher.update(ciphertextAndTag.subarray(0, -16)), cipher.final(),
  ]).toString('utf8')
}

const compiled = ts.transpileModule(read('ui/shared/src/clipboard-crypto.ts'), {
  fileName: 'clipboard-crypto.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics ?? []).filter(
  problem => problem.category === ts.DiagnosticCategory.Error), [])
const browser = await import('data:text/javascript;base64,' +
  Buffer.from(compiled.outputText).toString('base64'))
const webKey = await browser.xDriveClipboardDeriveKey(vector.passphrase, vector.salt)
await browser.xDriveClipboardVerifyVaultCheck(webKey, vector.aad_scope, vector.vault_check)
const wrongKey = await browser.xDriveClipboardDeriveKey(
  vector.passphrase + ' incorrect', vector.salt)
await assert.rejects(browser.xDriveClipboardVerifyVaultCheck(
  wrongKey, vector.aad_scope, vector.vault_check))
for (const item of vector.items) {
  assert.equal(nodeDecrypt(item), item.plaintext)
  assert.equal(await browser.xDriveClipboardDecrypt(webKey, vector.aad_scope, item),
    item.plaintext, 'WebCrypto and AES-256-GCM must agree on fixed ciphertext')
  for (const invalid of [
    { ...item, kind: item.kind === 'text/plain' ? 'text/uri-list' : 'text/plain' },
    { ...item, client_event_id: '00000000-0000-4000-8000-000000000002' },
    { ...item, ciphertext: Buffer.from(
      Buffer.from(item.ciphertext, 'base64').map((b, i) => i ? b : b ^ 1)
    ).toString('base64') },
  ]) {
    assert.throws(() => nodeDecrypt(invalid), 'modified AAD or ciphertext must fail')
    await assert.rejects(browser.xDriveClipboardDecrypt(webKey, vector.aad_scope, invalid))
  }
  assert.throws(() => nodeDecrypt(item, vector.aad_scope.replace(':42', ':43')))
  await assert.rejects(browser.xDriveClipboardDecrypt(
    webKey, vector.aad_scope.replace(':42', ':43'), item))
  await assert.rejects(browser.xDriveClipboardDecrypt(wrongKey, vector.aad_scope, item))
}
assert.equal(nodeDecrypt({
  ...vector.vault_check, kind: 'text/plain',
  client_event_id: '00000000-0000-4000-8000-000000000001',
}), 'xDrive Clipboard Vault v1')
console.log('Clipboard fixed PBKDF2 / AES-256-GCM / AAD interoperability vector OK')
