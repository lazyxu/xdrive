import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
if (!globalThis.crypto) globalThis.crypto = webcrypto
const root = resolve(fileURLToPath(new URL('../', import.meta.url)), '..')
const file = 'ui/shared/src/clipboard-target-crypto.ts'
const compiled = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[])
const lib = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputText).toString('base64'))
const recipient = await lib.xDriveClipboardNewTargetKey()
const outsider = await lib.xDriveClipboardNewTargetKey()
const scope = 'https://nas.example:12', target='a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2'
const event='12d922e2-7cca-4315-9c98-bd83e679cb90'
const send = (kind,text,node=0)=>lib.xDriveClipboardEncryptForDevice(
  scope,target,recipient.public_key,event,kind,text,node)
const first = await send('text/plain','Clipboard: 设备定向中文/secret')
assert.equal(first.ephemeral_key.length,44)
assert.equal(Buffer.from(first.wrapped_key,'base64').length,60)
assert.equal(await lib.xDriveClipboardDecryptForDevice(scope,recipient.privateKey,first),
  'Clipboard: 设备定向中文/secret')
await assert.rejects(lib.xDriveClipboardDecryptForDevice(scope,outsider.privateKey,first))
await assert.rejects(lib.xDriveClipboardDecryptForDevice(scope+':other',recipient.privateKey,first))
await assert.rejects(lib.xDriveClipboardDecryptForDevice(scope,recipient.privateKey,{...first,target_device_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}))
await assert.rejects(lib.xDriveClipboardDecryptForDevice(scope,recipient.privateKey,{...first,kind:'text/uri-list'}))
await assert.rejects(lib.xDriveClipboardDecryptForDevice(scope,recipient.privateKey,{...first,wrapped_key:Buffer.alloc(60).toString('base64')}))
await assert.rejects(lib.xDriveClipboardDecryptForDevice(scope,recipient.privateKey,{...first,ciphertext:Buffer.alloc(90).toString('base64')}))
const node=await send('image/x-xdrive-node-ref','asset:118',118)
assert.equal(node.node_id,118)
assert.equal(await lib.xDriveClipboardDecryptForDevice(scope,recipient.privateKey,node),'asset:118')
await assert.rejects(lib.xDriveClipboardDecryptForDevice(scope,recipient.privateKey,{...node,node_id:119}))
await assert.rejects(send('application/x-xdrive-node-ref','asset:118',0))
console.log('Device E2EE X25519/HKDF/AES-GCM: target, payload, Node, tamper and replay identity checks passed')
