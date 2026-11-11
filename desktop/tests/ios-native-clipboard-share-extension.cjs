'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..',p),'utf8')
const project = read('ios/project.yml')
const source = read('ios/ClipboardShareExtension/ShareViewController.swift')
test('iOS real extension target is embedded in unsigned IPA scheme',()=>{
  assert.match(project,/type: app-extension/)
  assert.match(project,/target: xDriveClipboardShare[\s\S]*?embed: true/)
  assert.match(project,/NSExtensionPointIdentifier: com\.apple\.share-services/)
  assert.match(project,/NSExtensionActivationSupportsText: true/)
  assert.match(project,/NSExtensionActivationSupportsWebURLWithMaxCount: 1/)
})
test('share extension accepts only an explicit local and time-limited paste, never uses Owner secrets',()=>{
  assert.match(source,/provider\.loadItem\(forTypeIdentifier:/)
  assert.match(source,/@objc private func copySelectedText/)
  assert.match(source,/\.localOnly: true/)
  assert.match(source,/\.expirationDate: Date\(\)\.addingTimeInterval\(120\)/)
  assert.match(source,/XDriveIOSClipboardSharePolicy\.acceptable/)
  assert.doesNotMatch(source,/UserDefaults|Keychain|accessToken|Authorization|clipboard\/items|URLSession|URLRequest|fetch\(/)
})

test('share instructions match the current unencrypted native Clipboard UI',()=>{
  assert.match(source,/复制后 2 分钟内/)
  assert.match(source,/xDrive → 剪贴板 → 从本机粘贴 → 发送/)
  assert.match(source,/消息不加密，请勿发送密码或验证码/)
  assert.doesNotMatch(source,/解锁|加密发送|performs encryption itself/)
  const nativePage = read('ios/XDriveIOS/NativeClipboardScreen.swift')
  assert.match(nativePage,/Button\("从本机粘贴"\)/)
  assert.match(nativePage,/Button\("发送"\)/)
})


test('iOS Share Extension file/image uses 2-minute private pasteboard and explicit native CAS import',()=>{
  const native=read('ios/XDriveIOS/NativeClipboardScreen.swift')
  const policy=read('ios/ClipboardShareExtension/ClipboardSharePolicy.swift')
  assert.match(project,/NSExtensionActivationSupportsImageWithMaxCount: 1/)
  assert.match(project,/NSExtensionActivationSupportsFileWithMaxCount: 1/)
  assert.match(source,/loadFileRepresentation\(forTypeIdentifier:/)
  assert.match(source,/loadDataRepresentation\(forTypeIdentifier:/)
  assert.match(source,/acceptableFileSize/)
  assert.match(source,/acceptableFileName/)
  assert.match(source,/\.localOnly: true/)
  assert.match(source,/addingTimeInterval\(120\)/)
  for(const type of [
    'com.lazyxu.xdrive.clipboard.file.bytes',
    'com.lazyxu.xdrive.clipboard.file.name',
    'com.lazyxu.xdrive.clipboard.file.kind']){
    assert.ok(source.includes(type))
    assert.ok(native.includes(type))
  }
  assert.match(native,/Button\("从分享内容导入"\)/)
  assert.match(native,/private func importSharedPasteboard\(\) async/)
  assert.match(native,/pasteboard\.data\(forPasteboardType: bytesType\)/)
  assert.match(native,/await importLocalFile\(url, generation: generation\)/)
  assert.match(native,/XDriveNativeUploadSessionTransport/)
  assert.match(policy,/maxFileBytes = 64 \* 1_048_576/)
  assert.doesNotMatch(source,/api\/v1|Server bearer|encryptSend|recipientPrivateKey/)
})

