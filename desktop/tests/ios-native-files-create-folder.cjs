'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
const creator = read('ios/XDriveIOS/NativeFilesDirectoryCreator.swift')
const browser = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const server = read('internal/api/handlers.go')

test('only existing native verified Owner can submit explicit scoped POST to a directory', () => {
  assert.match(browser, /guard !createBusy, activeQuery\.isEmpty,[\s\S]*?let parentID, let expected = login\.owner/)
  assert.match(browser, /let authorization = try await login\.verifiedAuthorization\(\)/)
  assert.match(browser, /XDriveIOSNativePhotoOwnerScope\.matches\(authorization\.owner, expected\)/)
  assert.match(browser, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(creator, /\/api\/v1\/nodes\/\\\(parentID\)\/directories/)
  assert.match(creator, /request\.httpMethod = "POST"/)
  assert.match(creator, /URLSessionConfiguration\.ephemeral/)
  assert.match(creator, /completionHandler\(nil\)/)
  assert.match(server, /func \(s \*Server\) createDirectory\(c \*gin\.Context\)/)
  assert.match(server, /c\.JSON\(http\.StatusCreated, toNodeDTO\(n\)\)/)
})
test('reject fabricated or stale 201 and retire pending Owner navigation writes', () => {
  assert.match(creator, /guard http\.statusCode == 201/)
  for (const s of ['saved.id > 0','saved.revision > 0','saved.type == "dir"','saved.name == name','saved.parent_id == parentID']) {
    assert.ok(creator.includes(s), s)
  }
  assert.match(browser, /createEpoch = UUID\(\)\s*createTask\?\.cancel\(\)/)
  assert.match(browser, /createNotice = "服务器已确认创建/)
  assert.match(browser, /创建结果未确认，请先刷新目录核对/)
  assert.match(browser, /Button\("新建文件夹"/)
  assert.doesNotMatch(creator, /WKWebView\s*\(|document\.cookie|localStorage|UploadSession/)
})
