'use strict'
const test=require('node:test'), assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const screen=read('ios/XDriveIOS/NativeClipboardScreen.swift')
const client=read('ios/XDriveIOS/NativeClipboardClient.swift')
const enroll=read('ios/XDriveIOS/IOSDeviceEnrollment.swift')

test('iOS Clipboard has no passphrase, unlock, E2EE key storage or device ciphertext',()=>{
  assert.doesNotMatch(screen,/SecureField|Button\("解锁"\)|XDriveIOSClipboardDeviceCrypto|AES\.GCM|passphrase/)
  assert.doesNotMatch(client,/PBKDF2|CommonCrypto|Ciphertext|ephemeral_key|wrapped_key|public_key/)
  assert.match(screen,/Text\("此剪贴板不加密/)
  assert.match(client,/struct XDriveIOSClipboardWrite: Encodable/)
  assert.match(client,/let content: String/)
  assert.equal(fs.existsSync(path.join(root,'ios/XDriveIOS/NativeClipboardDeviceCrypto.swift')),false)
})
test('iOS targeted reception retains verified installation identity and independent Owner bearer',()=>{
  assert.match(enroll,/func clipboardDeviceProof\(/)
  assert.match(screen,/enableRecipient\(\)/)
  assert.match(screen,/recipientProof = proof/)
  assert.match(client,/func enrollClipboardDevice\(\)/)
  assert.match(client,/X-XDrive-Device-ID/)
  assert.match(client,/X-XDrive-Device-Token/)
  assert.match(client,/let sender = try XDriveIOSNativeClipboardClient\(owner: owner, accessToken: token\)/)
  assert.match(client,/value\.target_device_id == wire\.target_device_id/)
  assert.match(client,/value\.content == wire\.content/)
})
test('iOS active Owner and scene lifecycle still fence late results',()=>{
  assert.match(screen,/sessionGeneration &\+= 1/)
  assert.match(screen,/\.onChange\(of: login\.owner\) \{ _ in reset\(\) \}/)
  assert.match(screen,/\.onDisappear \{ reset\(\) \}/)
  assert.match(screen,/\.task\(id: scenePhase == \.active\)/)
  assert.match(screen,/sessionGeneration == generation|generation == sessionGeneration/)
  // Comments may document that background access is forbidden: inspect only
  // executable Swift, rather than failing on the safety comment itself.
  const executableScreen = screen.replace(/^\\s*\\/\\/.*$/gm, '')
  assert.doesNotMatch(executableScreen, /background pasteboard/i)
})