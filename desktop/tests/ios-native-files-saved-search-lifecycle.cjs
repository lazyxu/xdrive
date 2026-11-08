'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(__dirname, '../..', 'ios/XDriveIOS/NativeFilesSavedSearches.swift'), 'utf8')
const match = re => assert.match(source,re)
test('mutable expected Owner supports SwiftUI sheet reuse',()=>{
  match(/private var expected: XDriveNativeOwnerRoot/)
  match(/func updateExpectedOwner\(_ owner: XDriveNativeOwnerRoot\) \{\s*guard !XDriveIOSNativePhotoOwnerScope\.matches\(expected, owner\) else \{ return \}\s*invalidate\(\)\s*expected = owner/)
})
test('read and mutation errors from an obsolete Owner cannot overwrite the screen',()=>{
  assert.equal((source.match(/\} catch \{\s*guard let self, self\.epoch == ticket,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)\s*else \{ return \}/g)||[]).length,2)
})
test('Owner matching is exact and requires current verified model',()=>{
  match(/return verified && XDriveIOSNativePhotoOwnerScope\.matches\(current, expected\)/)
})
test('screen keeps foreground and visibility states separate',()=>{
  match(/@Environment\(\\\.scenePhase\) private var phase/)
  match(/@State private var isVisible = false/)
})
test('single action gate checks active scene, matched Owner and no active request',()=>{
  match(/private var canInteract: Bool \{\s*isVisible && phase == \.active && model\.matches\(login\.owner\) &&\s*!model\.loading && !model\.busy/)
})
test('empty-state message requires a current verified Owner',()=>{match(/if model\.matches\(login\.owner\) && model\.items\.isEmpty/)})
test('opening a rule cannot race a still-pending create/update/delete',()=>{
  match(/guard canInteract, model\.items\.contains\(item\) else \{ return \}\s*dismiss\(\)\s*onOpen\(item\)/)
  match(/\.buttonStyle\(\.plain\)\s*\.disabled\(!canInteract\)/)
})
test('context menu and create button are disabled during reads and mutations',()=>{
  match(/\.disabled\(!canInteract\)\s*\}\s*\}/)
  match(/guard validCreate, canInteract else \{ return \}/)
  match(/\.disabled\(!validCreate \|\| !canInteract\)/)
})
test('rename rechecks the exact item before submission',()=>{
  match(/guard canInteract, model\.items\.contains\(item\),\s*XDriveIOSNativeFilesSavedSearchPolicy\.validInput/)
})
test('delete confirmation rejects vanished or old Owner items',()=>{
  match(/if let item = deleteTarget, canInteract,\s*model\.items\.contains\(item\) \{\s*model\.perform\(\.delete\(item\.id\), login: login\)/)
})
test('write gate prevents swiping away a pending unknown commit',()=>{
  match(/\.interactiveDismissDisabled\(model\.busy\)/)
  match(/Button\("完成"\) \{ dismiss\(\) \}\s*\.disabled\(model\.busy\)/)
})
test('explicit Refresh clears stale edit/delete intent and refuses hidden GET',()=>{
  match(/Button\("刷新"\) \{\s*guard isVisible, phase == \.active,\s*!model\.loading, !model\.busy else \{ return \}\s*clearPresentationIntents\(\)\s*model\.load\(login: login\)/)
})
test('mount, disappearance and foreground transition fence requests',()=>{
  match(/\.onAppear \{\s*isVisible = true\s*loadIfNeeded\(\)/)
  match(/\.onDisappear \{\s*isVisible = false\s*clearPresentationIntents\(\)\s*model\.invalidate\(\)/)
  match(/\.onChange\(of: phase\) \{ state in\s*if state != \.active \{\s*clearPresentationIntents\(\)\s*model\.invalidate\(\)\s*\} else \{\s*loadIfNeeded\(\)/)
  assert.doesNotMatch(source,/\.task \{ model\.load\(login: login\) \}/)
})
test('expected and logged-in Owner changes revoke pending CRUD intent',()=>{
  match(/\.onChange\(of: expectedOwner\) \{ owner in\s*clearPresentationIntents\(\)\s*model\.updateExpectedOwner\(owner\)\s*loadIfNeeded\(\)/)
  match(/\.onChange\(of: login\.owner\) \{ owner in\s*clearPresentationIntents\(\)/)
})
test('loadIfNeeded is foreground-scoped and avoids a duplicate verified fetch',()=>{
  match(/private func loadIfNeeded\(\) \{\s*guard isVisible, phase == \.active, !model\.loading, !model\.busy,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\),\s*!model\.matches\(login\.owner\) else \{ return \}/)
})
test('reorder is gated by the same exact, stable displayed Owner',()=>{
  match(/private func reorder\(_ index: Int, by direction: Int\) \{\s*guard canInteract,/)
})
test('existing single-write Server readback and uncertain-ACK rules stay intact',()=>{
  match(/let next = try await XDriveIOSNativeFilesSavedSearchClient\(/)
  match(/\.perform\(action, previous: previous\)/)
  match(/self\.verified = false\s*self\.status = "操作结果未确认/)
  assert.doesNotMatch(source,/URLSession\.shared|WKWebView|DispatchQueue\.main\.asyncAfter/)
})
