import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(fileURLToPath(new URL('../',import.meta.url)),'..')
const read=p=>readFileSync(resolve(root,p),'utf8')
const ui=read('ui/shared/src/mui/ClipboardPage.tsx')
const api=read('internal/api/clipboard.go')
const target=read('internal/api/clipboard_extended.go')
assert.match(ui,/selectedNodeID > 0 \? \{ node_id: selectedNodeID \} : \{\}/)
assert.match(ui,/target_device_id: selectedTarget/)
assert.match(ui,/content: textAtStart/)
assert.match(ui,/text !== 'asset:' \+ record\.node_id/)
assert.match(api,/req\.Content != fmt\.Sprintf\("asset:%d", req\.NodeID\)/)
assert.match(api,/clipboardValidateTargetAndNode\(db, uid, req\)/)
assert.match(target,/owner_id = \? AND device_id = \? AND revoked_at IS NULL/)
assert.match(target,/owner_id = \? AND id = \? AND revoked_at IS NULL/)
assert.doesNotMatch(ui,/xDriveClipboardEncryptForDevice|ephemeral_key|wrapped_key/)
assert.doesNotMatch(api,/crypto\/aes|crypto\/ecdh|crypto\/cipher/)
console.log('Plaintext targeted Clipboard identity and Node permissions checked')
