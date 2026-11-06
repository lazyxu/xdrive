'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = name => fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS', name + '.swift'), 'utf8')
const overview = read('NativeTransfers')
const dashboard = read('NativePhotosDashboard')

test('transfer overview uses only current Owner records and rejects late callbacks after switching', () => {
  assert.match(dashboard, /case \.transfers:\s*XDriveIOSNativeTransfersScreen\(/)
  assert.match(dashboard, /\.onChange\(of: ownerScopeKey\) \{ _ in\s*transfers\.selectOwner\(login\.owner\)/)
  assert.match(overview, /func selectOwner[\s\S]*?owner = next\s*items = \[\]/)
  assert.match(overview, /func visibleItems[\s\S]*?matches\(current, owner\) else \{ return \[\] \}/)
  assert.match(overview, /func begin[\s\S]*?matches\(owner, expected\) else \{ return nil \}/)
  assert.match(overview, /firstIndex\(where: \{ \$0\.id == id \}\),\s*items\[index\]\.phase == \.running else \{ return \}/)
  assert.match(overview, /items\.filter \{ \$0\.phase != \.running \}\.dropFirst\(completedLimit\)/)
  assert.match(read('NativePhotoBackupController'), /canShowTransferStatus[\s\S]*?matches\(displayOwner, owner\)[\s\S]*?matches\(runningOwner, owner\)/)
  assert.doesNotMatch(overview, /URLSession|UserDefaults|\.cancel\(|\.start\(|UploadSession|fileURL/)
})

test('native upload confirmation and verified download report their distinct outcomes', () => {
  const uploads = read('NativeFilesManualUpload')
  assert.match(uploads, /Phase\.needsReview/)
  assert.equal((uploads.match(/activity\?\.finish\(\.confirmed, detail: status\)\s*onConfirmed\(\)/g) ?? []).length, 2)
  for (const source of ['NativeFilesDownloadExport', 'NativeFilesBatchExport',
    'NativeFilesFolderArchiveExport', 'NativeFilesHistoricalExport']) {
    const reader = read(source)
    assert.match(reader, /transfers\?\.begin\(\.download,/)
    assert.match(reader, /finishDownload\(\s*verified: current && (?:prepared != nil|published),\s*stopped: !current \|\| Task\.isCancelled/)
  }
  assert.match(overview, /finish\(\.downloaded, detail: "已取得并验证临时文件。是否存入 iOS「文件」请在系统中确认。"/)
})
