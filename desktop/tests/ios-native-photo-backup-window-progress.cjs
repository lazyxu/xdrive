'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const policy = read('ios/XDriveIOS/NativeBackupWindowReadProgress.swift')
const screen = read('ios/XDriveIOS/NativePhotoBackupScreen.swift')
const scanner = read('ios/XDriveIOS/PhotoBackupScanWindow.swift')
const writer = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
const issueSummary = read('ios/XDriveIOS/PhotoBackupIssueSummary.swift')

test('scan bar is bounded to the real current 256-slot window, not the whole library', () => {
  assert.match(policy, /XDrivePhotoBackupScanWindow\.capacity\(/)
  assert.match(policy, /capacity <= XDrivePhotoBackupScanWindow\.maxItems/)
  assert.match(policy, /scanned >= 0, scanned <= capacity/)
  assert.match(policy, /var remaining: Int \{ capacity - scanned \}/)
  assert.match(policy, /Double\(scanned\) \/ Double\(capacity\)/)
  assert.match(screen, /XDriveIOSNativeBackupWindowReadProgress\.current\(/)
  assert.match(screen, /ProgressView\(value: window\.fractionScanned\)/)
  assert.match(screen, /native-ios-photo-window-scanned-progress/)
  assert.match(screen, /不代表整库已备份/)
})

test('read-only metrics may never silently promote unsuccessful originals', () => {
  assert.match(policy, /for value in \[uploaded, verifiedAlready, unavailable, needsReview, unsupported\]/)
  assert.match(policy, /value <= unclassified/)
  assert.match(policy, /confirmed: uploaded \+ verifiedAlready/)
  assert.match(screen, /needsReview: result\.windowNeedsReview/)
  assert.match(screen, /unavailable: result\.windowUnavailable/)
  assert.match(screen, /unsupported: result\.windowUnsupported/)
  assert.match(screen, /window\.remaining/)
  assert.match(writer, /report\.uploaded \+= 1/)
  assert.match(writer, /report\.verifiedAlready \+= 1/)
  assert.match(writer, /report\.unavailable \+= 1/)
  assert.match(writer, /report\.stoppedForReview = true/)
  assert.doesNotMatch(policy, /100%.*backed up|UserDefaults|PHAsset|URLSession|UploadSession|PhotoSyncLedger/)
})

test('existing backup runner, Owner/ledger status and false whole-library completion fences are preserved', () => {
  assert.match(screen, /Section\("手动备份"\)/)
  assert.match(screen, /native-ios-photos-manual-coverage/)
  assert.match(screen, /当前段已扫描/)
  assert.match(screen, /Section\("当前图库与历史原件收据"\)/)
  assert.match(screen, /整库是否已经备份：尚未逐张核验/)
  assert.match(scanner, /static let maxItems = 256/)
  assert.match(writer, /static let maxScannedAssets = XDrivePhotoBackupScanWindow\.maxItems/)
  // Documentation can mention PhotoKit while this pure Foundation policy
  // must not import, call or persist any PhotoKit/backup source.
  const executablePolicy = policy.replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(executablePolicy, /UserDefaults|CoreData|PhotoKit|import Photos|PHAsset|UploadSession|PhotoSyncLedger/)
})

test('bounded per-item failure explanation never marks failed originals as backed up', () => {
  assert.match(issueSummary, /static let maxVisible = 20/)
  assert.match(issueSummary, /private\(set\) var additionalCount = 0/)
  assert.match(issueSummary, /var total: Int \{ entries\.count \+ additionalCount \}/)
  assert.match(issueSummary, /case incompleteLivePair/)
  assert.match(issueSummary, /case resourceTooLarge/)
  assert.match(issueSummary, /case sourceChanged/)
  assert.match(writer, /var issues = XDriveIOSPhotoBackupIssueSummary\(\)/)
  assert.match(writer, /report\.issues\.append\([\s\S]*?reason: \.unsupported/)
  assert.match(writer, /report\.unavailable \+= 1\s*report\.issues\.append\([\s\S]*?reason: Self\.issueReason\(after: error\)/)
  assert.match(writer, /XDrivePhotoKitExportFailure/)
  assert.match(writer, /XDriveIOSPhotoIntentPreparationError/)
  assert.match(screen, /if result\.issues\.total > 0 \{/)
  assert.match(screen, /ForEach\(result\.issues\.entries\)/)
  assert.match(screen, /native-ios-photo-window-issue-count/)
  assert.match(screen, /native-ios-photo-window-issue-overflow/)
  const summaryExecutable = issueSummary.replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(summaryExecutable, /localIdentifier|originalFilename|UserDefaults|Keychain|FileManager|URLSession|UploadSession|PHAsset/)
  assert.doesNotMatch(writer.slice(writer.indexOf('    private static func issueReason('),
                               writer.indexOf('    /// A global authorization/receipt trust loss')),
                      /uploadPrepared|confirmReceipt|beginCreate/)
})

test('incremental queue receipts never consume unread current-window slots', () => {
  // A queued original may be uploaded while scanned=0. The read policy
  // must see only slot outcomes, not the queue-inclusive SourceRun totals.
  const scanStart = writer.indexOf('scanning: while report.scanned < windowCapacity')
  const scanEnd = writer.indexOf('/// Explicit one-photo priority upload.')
  const queueStart = writer.indexOf('if let changeQueue {')
  assert.ok(queueStart > 0 && scanStart > queueStart && scanEnd > scanStart)
  const queue = writer.slice(queueStart, scanStart)
  const scan = writer.slice(scanStart, scanEnd)
  for (const label of [
    'windowUploaded', 'windowVerifiedAlready', 'windowUnavailable',
    'windowNeedsReview', 'windowUnsupported'
  ]) {
    assert.match(writer, new RegExp('var ' + label + ' = 0'))
    assert.doesNotMatch(queue, new RegExp('report\\.' + label + ' \\+= 1'))
  }
  for (const [total, slot] of [
    ['uploaded', 'windowUploaded'],
    ['verifiedAlready', 'windowVerifiedAlready'],
    ['unavailable', 'windowUnavailable'],
    ['needsReview', 'windowNeedsReview'],
    ['videosNotSupported', 'windowUnsupported']
  ]) {
    const countTotal = (scan.match(new RegExp('report\\.' + total + ' \\+= 1', 'g')) || []).length
    const countSlot = (scan.match(new RegExp('report\\.' + slot + ' \\+= 1', 'g')) || []).length
    assert.ok(countTotal > 0, total + ' must be counted in the scan')
    assert.equal(countSlot, countTotal, slot + ' must track only positional scan results')
    assert.match(screen, new RegExp('result\\.' + slot))
  }
  assert.match(screen, /不含增量优先队列/)
})
