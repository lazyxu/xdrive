'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const exporter = read('ios/XDriveIOS/PhotoKitOriginalExporter.swift')
const localShare = read('ios/XDriveIOS/NativeLocalPhotoShare.swift')
const receiptProof = read('ios/XDriveIOS/NativeCurrentPhotoReceiptModel.swift')
const manualBackup = read('ios/XDriveIOS/IOSManualPhotoOriginalUpload.swift')
const backupPreparer = read('ios/XDriveIOS/PhotoKitStagedIntentPreparer.swift')

test('original exporter denies Limited permission by default and revalidates each resource', () => {
  assert.match(exporter, /allowLimitedPhotoAccess: Bool = false/)
  assert.match(exporter, /return status == \.authorized \|\|\s*\(allowLimitedPhotoAccess && status == \.limited\)/)
  assert.equal((exporter.match(/guard authorized\(allowLimitedPhotoAccess: allowLimitedPhotoAccess\)/g) || []).length, 3)
  assert.match(exporter, /PHAsset\.fetchAssets\(withLocalIdentifiers: \[localIdentifier\]/)
})

test('native local Share and read-only per-item original proof preserve Limited scope', () => {
  assert.match(localShare, /XDrivePhotoKitOriginalExporter\.stage\([\s\S]*?allowLimitedPhotoAccess: true/)
  assert.match(receiptProof, /XDrivePhotoKitOriginalExporter\.stage\([\s\S]*?allowLimitedPhotoAccess: true/)
  assert.match(localShare, /XDriveIOSNativeLocalPhotoSelectionActions\.verifiedAssets\(candidates\)/)
  assert.match(receiptProof, /XDriveIOSNativePhotoProofStamp\.current\(localIdentifier\)/)
})

test('manual backup and original preparation never opt into partial photo access', () => {
  assert.match(manualBackup, /XDrivePhotoKitOriginalExporter\.stage\(/)
  assert.doesNotMatch(manualBackup, /allowLimitedPhotoAccess: true/)
  assert.match(backupPreparer, /guard authorization == \.authorized,/)
  assert.match(backupPreparer, /guard access == \.authorized,/)
  assert.doesNotMatch(backupPreparer, /allowLimitedPhotoAccess: true/)
})
