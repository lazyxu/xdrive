'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(__dirname, '../..', 'ios/XDriveIOS/NativePhotoThumbnailCacheScreen.swift'), 'utf8')
function region(start, stop) {
  const i = source.indexOf(start), j = source.indexOf(stop, i + start.length)
  assert.ok(i >= 0 && j > i, 'Missing cache lifecycle region: ' + start)
  return source.slice(i, j)
}
test('cache only reports empty after exact current scope is verified', () => {
  assert.match(source, /let verifiedScope = scope != nil && loadedScope == scope/)
  assert.match(source, /let visibleEntries = verifiedScope \? entries : \[\]/)
  assert.match(source, /else if verifiedScope \{\s*Text\("当前账户暂无缓存缩略图/)
})
test('initial scoped read keeps neutral state instead of a false empty result', () => {
  assert.match(source, /else if errorMessage == nil \{\s*Text\("正在核验当前账户的缩略图缓存/)
})
test('in-flight metadata has explicit loading feedback', () => {
  assert.match(source, /if reading \{\s*ProgressView\("正在读取缩略图缓存…"\)/)
  assert.match(source, /native-ios-gallery-cache-loading/)
})
test('failed read provides an actionable same-screen retry', () => {
  assert.match(source, /Button\("重试读取缓存"\) \{\s*self\.errorMessage = nil\s*refreshID = UUID\(\)/)
  assert.match(source, /native-ios-gallery-cache-retry/)
})
test('cache lookup only dispatches in foreground for an actual Owner', () => {
  const r = region('.task(id: refreshID) {', '.onChange(of: scope)')
  assert.match(r, /guard let owner, let scope, phase == \.active else \{ return \}/)
  assert.match(r, /XDriveIOSNativePhotoThumbnailCache\.shared\.entries\(scope: scope\)/)
})
test('successful Owner-verified read clears stale error and intersects selection', () => {
  const r=region('.task(id: refreshID) {', '.onChange(of: scope)')
  assert.match(r, /guard phase == \.active,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/)
  assert.match(r, /entries = snapshot\s*loadedScope = scope\s*selected\.formIntersection\(Set\(snapshot\.map\(\\\.id\)\)\)\s*errorMessage = nil/)
})
test('read failure from cancelled or replaced Owner cannot overwrite current UI', () => {
  const r=region('} catch is CancellationError {', '.onAppear { isVisible = true }')
  assert.match(r, /catch \{\s*guard !Task\.isCancelled, phase == \.active,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\) else \{ return \}/)
})
test('scene resume revalidates only while visible', () => {
  assert.match(source, /\.onChange\(of: phase\) \{ state in\s*if state == \.active && isVisible \{\s*refreshID = UUID\(\)/)
})
test('route disappearance ends visual loading without changing cache disk', () => {
  assert.match(source, /\.onDisappear \{\s*isVisible = false\s*reading = false\s*confirmingClear = false\s*clearOwner = nil/)
})
test('scope change retires mutation token, rows, selected keys and old confirmation', () => {
  const r = region('.onChange(of: scope) { _ in', '.confirmationDialog(')
  assert.match(r, /deletionEpoch = UUID\(\)\s*deleting = false\s*reading = false\s*entries = \[\]\s*loadedScope = nil\s*selected = \[\]/)
  assert.match(r, /confirmingClear = false\s*clearOwner = nil\s*refreshID = UUID\(\)/)
})
test('row selection is disabled during reads or mutations and remains distinguishable in AX', () => {
  assert.match(source, /\.buttonStyle\(\.plain\)\s*\.disabled\(reading \|\| deleting \|\| phase != \.active\)/)
  assert.match(source, /native-ios-gallery-cache-entry-\\\(entry\.id\)/)
})
test('delete and clear buttons cannot race a pending mutation or background', () => {
  assert.match(source, /\.disabled\(selected\.isEmpty \|\| reading \|\| deleting \|\| phase != \.active\)/)
  assert.match(source, /Button\("清空缓存", role: \.destructive\)[\s\S]*?\.disabled\(reading \|\| deleting \|\| phase != \.active\)/)
})
test('clear confirmation must still be on the exact same Owner in active scene', () => {
  assert.match(source, /if let expected = clearOwner, phase == \.active,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
})
test('delete uses one mutation ticket and does not automatically replay a failure', () => {
  const r=region('private func remove(owner:', 'private func size(')
  assert.match(r, /guard !deleting, phase == \.active, isVisible,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/)
  assert.match(r, /let ticket = UUID\(\)\s*deletionEpoch = ticket\s*deleting = true/)
  assert.match(r, /try await XDriveIOSNativePhotoThumbnailCache\.shared\.remove\(scope: scope, keys: keys\)/)
  assert.doesNotMatch(r, /retry.*remove|Task\.sleep/)
})
test('stale deletion completion does not schedule another Owner cache read', () => {
  const r=region('private func remove(owner:', 'private func size(')
  assert.equal((r.match(/guard deletionEpoch == ticket else \{ return \}/g)||[]).length, 2)
  assert.match(r, /if phase == \.active, isVisible,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/)
  assert.match(r, /refreshID = UUID\(\)/)
})
test('thumbnail decoder keeps cancelled or scrolled-away old pixels retired', () => {
  assert.match(source, /\.task\(id: scope \+ ":" \+ entry\.id\) \{\s*image = nil/)
  assert.match(source, /!Task\.isCancelled/)
  assert.match(source, /\.onDisappear \{ image = nil \}/)
})
test('cache UI never obtains signed original or adds a WebKit fallback', () => {
  assert.doesNotMatch(source, /URLSession\.shared|WKWebView|import WebKit|signedURL|uploadPreparedOriginal/)
})
