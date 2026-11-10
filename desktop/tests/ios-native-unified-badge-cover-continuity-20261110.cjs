'use strict'
// Unified Gallery visible-backup badge continuity, source-level contracts.
// No signed PhotoKit/Server device data are fabricated by this suite.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const wall = fs.readFileSync(path.resolve(__dirname, '../..', 'ios/XDriveIOS/NativeUnifiedPhotoWall.swift'), 'utf8')
const start = wall.indexOf('private func readVisibleQueueBadges() async')
const end = wall.indexOf('    var body: some View {', start)
assert.ok(start >= 0 && end > start)
const read = wall.slice(start, end)

test('repro: child/Viewer/tab cover preserves verified queue pixels rather than flashing empty', () => {
  assert.match(read, /guard ids.count <= 48, visible, displayActive, sameOwner, !ids.isEmpty else \{[\s\S]*?if !retainWhileCovered \|\| !sameOwner \|\| ids.isEmpty \|\| ids.count > 48 \{\s*queueBadges = \[:\]/)
})
test('repro: visible same-scope badge refresh does not clear caught-up indicators before a verified replacement', () => {
  const head = read.slice(0, read.indexOf('        do {'))
  assert.doesNotMatch(head, /badgeReadEpoch = epoch\s*queueHistoryCurrent = false/)
  assert.match(read, /queueBadges = fetched\s*queueHistoryCurrent = isCurrent/)
})
test('changing current login Owner or the badge Owner immediately clears status', () => {
  assert.match(read, /let sameOwner = XDriveIOSNativePhotoOwnerScope.matches\(backupBadgeOwner, owner\) &&\s*XDriveIOSNativePhotoOwnerScope.matches\(login.owner, owner\)/)
  assert.match(read, /!sameOwner \|\| ids.isEmpty/)
  assert.match(read, /queueBadges = \[:\]\s*queueHistoryCurrent = false/)
})
test('offscreen eviction and empty or oversized source windows always clear stale badges', () => {
  assert.match(read, /!retainWhileCovered/)
  assert.match(read, /ids.isEmpty \|\| ids.count > 48/)
  assert.match(wall, /\.onDisappear \{\s*visible = false\s*if !retainWhileCovered \{\s*acceptedGeneration = nil\s*queueBadges = \[:\]\s*queueHistoryCurrent = false/)
})
test('late async queue response must match generation, visibility, Owner and exact IDs', () => {
  assert.match(read, /guard badgeReadEpoch == epoch, visible, displayActive,/)
  assert.match(read, /XDriveIOSNativePhotoOwnerScope.matches\(backupBadgeOwner, owner\)/)
  assert.match(read, /model.rows.compactMap\(\{ \$0.local\?\.id \}\) == ids/)
})
test('queue read failure clears both the previous badge map and completed-history proof', () => {
  assert.match(read, /catch \{\s*if badgeReadEpoch == epoch \{\s*queueBadges = \[:\]\s*queueHistoryCurrent = false/)
})
test('a covered or resumed page never starts an unbounded backlog scan', () => {
  assert.match(read, /let ids = model.rows.compactMap \{ \$0.local\?\.id \}/)
  assert.match(read, /ids.count <= 48/)
  assert.match(wall, /\.task\(id: .*visible.*displayActive.*retry/)
  assert.match(wall, /await readVisibleQueueBadges\(\)/)
})

test('cancelled queue reads preserve covered verified badges but never cross a revoked Owner', () => {
  assert.match(read, /catch is CancellationError \{[\s\S]*?badgeReadEpoch == epoch &&[\s\S]*?!retainWhileCovered[\s\S]*?matches\(login.owner, owner\)/)
  assert.match(read, /\} catch \{\s*if badgeReadEpoch == epoch \{\s*queueBadges = \[:\]\s*queueHistoryCurrent = false/)
})
