import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const read=p=>readFileSync(resolve(root,p),'utf8')
const ui=read('ui/shared/src/mui/ClipboardPage.tsx')
const port=read('web/src/clipboardDataPort.ts')
const api=read('web/src/api.ts')
const server=read('internal/api/clipboard.go')

// The canonical wire contract stores text directly. No user-provided passphrase,
// vault initialization, browser crypto dependency, ciphertext, or nonce.
assert.match(ui,/content: textAtStart/)
assert.match(ui,/client_event_id = crypto\.randomUUID\(\)/)
assert.match(ui,/pending\.current = \{ text: textAtStart, targetID: selectedTarget/)
assert.match(ui,/await port\.create\(pending\.current\.item, controller\.signal\)/)
assert.match(ui,/selectedTarget \? \{ target_device_id: selectedTarget \}/)
assert.match(ui,/selectedNodeID > 0 \? \{ node_id: selectedNodeID \}/)
assert.match(ui,/pending\.current\.item\.kind !== expectedKind/)
assert.match(ui,/CLIPBOARD_PENDING_RETRY_WINDOW_MS = 5 \* 60 \* 1000/)
assert.match(ui,/actionFence\.current\.isCurrent\(actionToken\)/)
assert.match(ui,/record\.content !== 'asset:' \+ record\.node_id/)
assert.match(ui,/最多保留 50 条未过期消息/)
assert.match(ui,/Server 保存明文/)
assert.doesNotMatch(ui,/剪贴板口令|解锁加密剪贴板|加密发送|xDriveClipboardDeriveKey|xDriveClipboardEncrypt\(/)

assert.match(port,/clipboardItems\(before, signal\)/)
assert.match(port,/clipboardCreate\(item, signal\)/)
assert.match(port,/clipboardDevices\(signal\)/)
assert.match(port,/clipboardEnableDevice/)
assert.match(port,/clipboardRevokeDevice/)
assert.match(port,/importImageFromClipboard/)
assert.match(port,/uploadLocalFile/)
assert.doesNotMatch(port,/\bvault:|\binitializeCheck:|decryptTarget:|xDriveClipboardEncrypt/)

assert.match(api,/client_event_id: string; kind: XDriveClipboardKind; content: string/)
assert.doesNotMatch(api,/clipboard\/vault|clipboard\/vault\/check/)
assert.match(server,/Content\s+string\s+`json:"content"`/)
assert.match(server,/clipboardRetention = 24 \* time\.Hour/)
assert.match(server,/clipboardPageSize\s+= 50/)
assert.match(server,/clipboardMaxText\s+= 64 << 10/)
assert.match(server,/req\.Content != fmt\.Sprintf\("asset:%d", req\.NodeID\)/)
assert.doesNotMatch(server,/json:"nonce"|json:"ciphertext"|json:"wrapped_key"/)

console.log('Clipboard plaintext Web contract: Owner, event-id retry, device target, Node identity and no unlock passed')
