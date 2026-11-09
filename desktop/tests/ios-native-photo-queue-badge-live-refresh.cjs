'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const wall = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const badge = read('ios/XDriveIOS/NativeVisiblePhotoQueueBadgePolicy.swift')

test('writer completion updates only visible Owner-local queue badges, without rescan', () => {
  assert.match(badge, /struct XDriveIOSNativePhotoQueueBadgeRefresh: Equatable/)
  assert.match(badge, /let confirmedID: UUID\?/)
  assert.match(dashboard, /xdriveNativePhotoQueueBadgeRefresh,[\s\S]*?busy: backup\.busy,[\s\S]*?confirmedID: backup\.confirmedOriginalUpdate\?\.id/)
  assert.match(wall, /@Environment\(\\\.xdriveNativePhotoQueueBadgeRefresh\) private var badgeRefresh/)
  assert.match(wall, /\.onChange\(of: badgeRefresh\) \{ _ in[\s\S]*?refreshVisibleBackupQueueStatuses\(\)/)
  assert.match(wall, /private func refreshVisibleBackupQueueStatuses\(\) async/)
  assert.match(wall, /guard let current = page, let owner = backupBadgeOwner,[\s\S]*?current\.items\.count <= 64/)
  assert.match(wall, /queue\.visibleStatusDetails\(\s*owner: owner, localIdentifiers: identifiers/)
  assert.match(wall, /page\?\.items\.map\(\\\.id\) == identifiers/)
  assert.match(wall, /\.task\(id: "\\\(generation\)-\\\(offset\)-\\\(mediaFilter\.rawValue\)"\)/)
  assert.doesNotMatch(wall, /\.task\(id:[^\n]*badgeRefresh/)
})

test('stale asynchronous badge results never cross Owners, pages or inactive scenes', () => {
  assert.match(wall, /badgeReadEpoch == token/)
  assert.match(wall, /badgeReadEpoch == initialBadgeEpoch/)
  assert.match(wall, /XDriveIOSNativePhotoOwnerScope\.matches\(backupBadgeOwner, owner\)/)
  assert.match(wall, /\.onChange\(of: backupBadgeOwner\) \{ _ in[\s\S]*?badgeReadEpoch = UUID\(\)/)
  assert.match(wall, /\.onChange\(of: photoQueueScenePhase\) \{ state in/)
  // Handoff is generation/offset/total checked BEFORE local page cleanup.
  // Backup state must always retire, even if a 64-item page is offered to parent.
  assert.match(wall, /\.onDisappear \{[\s\S]*?let verifiedEpoch = retainedGeneration\s*let verifiedPage = \([\s\S]*?verifiedEpoch == generation &&\s*page\?\.startOffset == offset &&\s*page\?\.totalAccessibleAssets == expectedTotal\s*\) \? page : nil\s*if !retainWhileCovered \{\s*page = nil\s*precedingCapturedAt = nil\s*retainedGeneration = nil\s*\}\s*queueHistoryCurrent = false\s*visibleBackupQueueStates = \[:\]\s*badgeReadEpoch = UUID\(\)/)
  assert.match(wall, /onPageHidden\(offset, verifiedEpoch, verifiedPage\)/)
  assert.match(wall, /badgeReadEpoch = UUID\(\)\s*if let scanner \{ Task \{ await scanner\.reset\(\) \} \}\s*scanner = nil/)
  assert.match(wall, /visibleBackupQueueStates = \[:\]/)
  assert.doesNotMatch(wall, /UploadSessionTransport|uploadPrepared\(|\.finalize\(|deleteNode\(/)
})
