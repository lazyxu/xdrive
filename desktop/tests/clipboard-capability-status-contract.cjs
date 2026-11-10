'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const doc = read('docs/architecture/clipboard-sync.md')
const page = read('ui/shared/src/mui/ClipboardPage.tsx')

test('Clipboard architecture documents the unencrypted Owner-scoped contract', () => {
  assert.match(doc,/\*\*Current source status \(\d{4}-\d{2}-\d{2}\):\*\*/)
  assert.match(doc,/plaintext|明文/i)
  assert.match(doc,/Server (?:can read|stores|保存)|服务器可读取/)
  assert.match(doc,/Owner/)
  assert.match(doc,/DeviceIdentity|设备身份/)
  assert.match(doc,/CAS/)
  assert.match(doc,/SSE/)
  assert.match(doc,/24.hour|24 小时/i)
  assert.match(doc,/#4262/)
  assert.doesNotMatch(doc,/passphrase required|密钥派生|PBKDF2-HMAC|AES-256-GCM|客户端必须解锁/i)
})

test('all browser/Host ports accept content directly without a vault or decrypt API', () => {
  const paths=[
    'desktop/src/renderer/desktopClipboardDataPort.ts',
    'web/src/synologyClipboardPort.ts',
    'web/src/clipboardDataPort.ts',
  ]
  for (const filename of paths) {
    const src=read(filename)
    assert.match(src,/content|clipboardCreate|create:/)
    assert.doesNotMatch(src,/decryptTarget:|initializeCheck:|\bvault:\s*|xDriveClipboardEncrypt\(/)
  }
  assert.match(read('web/src/clipboardDataPort.ts'),/uploadLocalFile:/)
  assert.match(read('web/src/clipboardDataPort.ts'),/importImageFromClipboard/)
  assert.match(read('ios/XDriveIOS/NativeClipboardScreen.swift'),/XDriveNativeUploadSessionTransport/)
  assert.match(read('android/app/src/main/java/com/tfluid/xdrive/NativeClipboardScreens.kt'),/clipboardImportLocalFile/)
})

test('single shared Clipboard page has no unlocking or encrypted-send branch', () => {
  assert.match(page,/当前账号的剪贴板/)
  assert.match(page,/Server 保存明文/)
  assert.match(page,/content: textAtStart/)
  assert.match(page,/port\.listDevices\s*\?/)
  assert.match(page,/port\.watchLocalClipboard\s*\?/)
  assert.match(page,/默认关闭/)
  assert.doesNotMatch(page,/剪贴板口令|加密发送|解锁加密剪贴板|xDriveClipboardDeriveKey|xDriveClipboardEncrypt\(/)
})
