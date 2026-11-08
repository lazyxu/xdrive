'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const src = fs.readFileSync(path.resolve(__dirname, '../..', 'ios/XDriveIOS/NativeFilesVersionHistory.swift'), 'utf8')
const part = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length)
  assert.ok(i >= 0 && j > i, 'missing bounded lifecycle block: ' + a)
  return src.slice(i, j)
}
test('verified history has exact Node and Owner identity', () => {
  assert.match(src, /private var loadedNode: XDriveIOSNativeFilesNode\?/)
  assert.match(src, /private var loadedOwner: XDriveNativeOwnerRoot\?/)
  assert.match(src, /loadedNode == node, let loadedOwner/)
})
test('Owner identity is compared by complete verified scope', () => {
  assert.match(src, /XDriveIOSNativePhotoOwnerScope\.matches\(loadedOwner, owner\)/)
})
test('read publishes source identity before SwiftUI rows', () => {
  assert.match(src, /loadedNode = node\s*loadedOwner = openedOwner\s*items = listed\s*verified = true/)
})
test('invalidation retires identity and write flag with rows', () => {
  assert.match(src, /items = \[\]\s*loadedNode = nil\s*loadedOwner = nil\s*verified = false\s*busy = false\s*writing = false/)
})
test('same-Node explicit reload preserves verified geometry', () => {
  const s = part('func load(node: XDriveIOSNativeFilesNode, login:', 'func restore(')
  assert.match(s, /if !matches\(node: node, owner: openedOwner\) && !busy \{ invalidate\(\) \}/)
  assert.match(s, /run\(node: node, version: nil/)
})
test('restore rejects stale Node even when a historical ID matches', () => {
  const s = part('func restore(_ version: XDriveIOSNativeFilesVersionRecord,', 'private func run(')
  assert.match(s, /guard verified && items\.contains\(version\),\s*matches\(node: node, owner: openedOwner\)/)
})
test('read-only network activity does not disable safe dismissal', () => {
  assert.match(src, /writing = version != nil/)
  assert.match(src, /job = nil\s*busy = false\s*writing = false/)
  assert.match(src, /\.disabled\(model\.writing \|\| historicalExport\.busy\)/)
})
test('old Owner or Node rows cannot appear while state changes', () => {
  assert.match(src, /private var historyVisible: Bool \{\s*phase == \.active && ownerValid &&\s*model\.matches\(node: node, owner: openedOwner\)/)
  assert.match(src, /if historyVisible \{\s*ForEach\(model\.items\)/)
})
test('a staged historical ShareLink is disabled during revalidation', () => {
  assert.match(src, /\.accessibilityIdentifier\("native-ios-files-version-share-\\\(version\.id\)"\)\s*\.disabled\(model\.busy \|\| historicalExport\.busy \|\| !historyVisible\)/)
})
test('destructive confirmation requires current verified source and foreground', () => {
  assert.match(src, /model\.verified, model\.items\.contains\(version\)/)
  assert.match(src, /ownerValid, !historicalExport\.busy,\s*phase == \.active, historyVisible, !model\.busy/)
})
test('onAppear rejects background and avoids duplicate GET', () => {
  const s=part('.onAppear {', '.onDisappear {')
  assert.match(s, /guard phase == \.active, ownerValid else \{ return \}/)
  assert.match(s, /if !model\.matches\(node: node, owner: openedOwner\) && !model\.busy/)
})
test('reused sheet clears pending confirmation, old export and old version cache', () => {
  const s=part('.onChange(of: node) { _ in', '.onChange(of: login.owner) { _ in')
  assert.match(s, /pendingVersion = nil\s*confirming = false\s*historicalExport\.invalidate\(\)\s*model\.invalidate\(\)/)
})
test('foreground resume does not duplicate a valid same-file read', () => {
  assert.match(src, /else if ownerValid && !model\.busy &&\s*!model\.matches\(node: node, owner: openedOwner\)/)
})
test('dismissal still retires staged bytes and metadata jobs', () => {
  assert.match(src, /\.onDisappear \{\s*pendingVersion = nil\s*historicalExport\.invalidate\(\)\s*model\.invalidate\(\)/)
})
test('restore writer preserves If-Match, readback and uncertain-ACK safety', () => {
  assert.match(src, /method: "POST", ifMatch: node\.revision/)
  assert.match(src, /current\(node\.id, session: client\) == restored/)
  assert.match(src, /!latest\.contains\(where: \{ \$0\.id == version\.id \}\)/)
  assert.doesNotMatch(src, /retry.*POST|URLSession\.shared/)
})
