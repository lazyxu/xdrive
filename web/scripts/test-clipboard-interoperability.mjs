// Compile-time multi-platform protocol contract: no encryption envelope.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(fileURLToPath(new URL('../',import.meta.url)),'..')
const read=p=>readFileSync(resolve(root,p),'utf8')
const ts=read('ui/shared/src/mui/ClipboardPage.tsx')
const go=read('internal/client/clipboard.go')
const swift=read('ios/XDriveIOS/NativeClipboardClient.swift')
const kotlin=read('android/core/src/main/kotlin/com/tfluid/xdrive/core/XDriveApi.kt')
for(const source of [ts,go,swift,kotlin]){
 assert.match(source,/content|Content/, 'plaintext field is required')
 assert.match(source,/target_device_id|TargetDeviceID|targetDeviceID/,
   'targeted device identity remains bound')
 assert.match(source,/node_id|NodeID|nodeID/,
   'cloud Files Node ref remains scoped')
 assert.doesNotMatch(source,/wrapped_key|ephemeral_key|AES\.GCM\.seal|PBKDF2/)
}
assert.match(go,/json:"content"/)
assert.match(swift,/let content: String/)
assert.match(kotlin,/val content: String/)
assert.match(ts,/content: string/)
assert.match(go,/len\(v\.Content\) > 65536/)
assert.match(swift,/maxTextBytes = 65_536/)
assert.match(kotlin,/size !in 1\.\.65536/)
assert.equal(read('web/src/clipboardDataPort.ts').includes('clipboardInitializeCheck('),false)
console.log('Go/TS/Swift/Kotlin plaintext Clipboard protocol field parity passed')
