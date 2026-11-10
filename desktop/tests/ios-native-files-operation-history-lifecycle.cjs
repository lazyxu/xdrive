'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(__dirname,'../..','ios/XDriveIOS/NativeFilesOperationHistory.swift'),'utf8')
test('Operations model can rebind a reused sheet to a new expected Owner',()=>{
  assert.match(source,/private var expected: XDriveNativeOwnerRoot/)
  assert.match(source,/func updateExpectedOwner\(_ owner: XDriveNativeOwnerRoot\) \{\s*if let expected, XDriveIOSNativePhotoOwnerScope\.matches\(expected, owner\) \{\s*return\s*\}\s*invalidate\(\)\s*expected = owner/)
  assert.match(source,/init\(owner: XDriveNativeOwnerRoot\? = nil\)/)
})
test('old request failure cannot post error or uncertain ACK to a switched account',()=>{
  assert.equal((source.match(/\} catch \{\s*guard let self, self\.epoch == ticket,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)\s*else \{ return \}/g)||[]).length,2)
})
test('operations use exact verified Owner scope',()=>{
  assert.match(source,/return verified && XDriveIOSNativePhotoOwnerScope\.matches\(current, expected\)/)
})
test('Operation History records scene phase and actual visibility',()=>{
  assert.match(source,/@Environment\(\\\.scenePhase\) private var phase/)
  assert.match(source,/@State private var isVisible = false/)
})
test('read and write actions share a visible, current Owner, idle gate',()=>{
  assert.match(source,/private var canInteract: Bool \{\s*isVisible && phase == \.active && model\.matches\(login\.owner\) &&\s*!model\.loading && !model\.busy/)
})
test('history and empty-state rows are hidden outside the current foreground Owner',()=>{
  assert.match(source,/if isVisible && phase == \.active &&\s*model\.matches\(login\.owner\) && model\.items\.isEmpty/)
  assert.match(source,/if isVisible && phase == \.active &&\s*model\.matches\(login\.owner\) \{\s*ForEach\(model\.items\)/)
})
test('undo/redo taps recheck the exact visible operation before prompting',()=>{
  assert.match(source,/Button\("撤销"\) \{\s*guard canInteract, model\.items\.contains\(item\) else \{ return \}/)
  assert.match(source,/Button\("重做"\) \{\s*guard canInteract, model\.items\.contains\(item\) else \{ return \}/)
})
test('undo/redo controls are disabled while another request is in flight',()=>{
  assert.match(source,/\.buttonStyle\(\.bordered\)\s*\.disabled\(!canInteract\)/)
})
test('confirm button rechecks action eligibility, item membership and Owner',()=>{
  assert.match(source,/if let snapshot = pending, canInteract,\s*model\.items\.contains\(snapshot\.operation\),\s*XDriveIOSNativeFilesOperationPolicy\.canPerform\(\s*snapshot\.action, for: snapshot\.operation/)
})
test('pending one-shot POST disables both Done and swipe dismissal',()=>{
  assert.match(source,/\.interactiveDismissDisabled\(model\.busy\)/)
  assert.match(source,/Button\("完成"\) \{\s*if let onClose \{ onClose\(\) \} else \{ dismiss\(\) \}\s*\}\s*\.accessibilityIdentifier\("native-ios-files-operation-history-done"\)\s*\.disabled\(model\.busy\)/)
})
test('status panel is scoped to current active login, not previous account',()=>{
  assert.match(source,/if phase == \.active,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\),\s*let status = model\.status/)
})
test('both refresh controls guard background reads and clear pending confirmation',()=>{
  assert.equal((source.match(/guard isVisible, phase == \.active,\s*!model\.busy, !model\.loading else \{ return \}\s*pending = nil\s*model\.load\(login: login\)/g)||[]).length,2)
})
test('first mount uses conditional reader, not hidden unconditional task',()=>{
  assert.match(source,/\.onAppear \{\s*isVisible = true\s*loadIfNeeded\(\)/)
  assert.doesNotMatch(source,/\.task \{ model\.load\(login: login\) \}/)
})
test('disappearance revokes selected intent and cancels source jobs',()=>{
  assert.match(source,/\.onDisappear \{\s*isVisible = false\s*pending = nil\s*model\.invalidate\(\)/)
})
test('scene inactivity fences old jobs and resumes only when active',()=>{
  assert.match(source,/\.onChange\(of: phase\) \{ state in\s*if state != \.active \{\s*pending = nil\s*model\.invalidate\(\)\s*\} else \{\s*loadIfNeeded\(\)/)
})
test('reused expected Owner sheet revokes old pending action',()=>{
  assert.match(source,/\.onChange\(of: expectedOwner\) \{ owner in\s*pending = nil\s*model\.updateExpectedOwner\(owner\)\s*loadIfNeeded\(\)/)
})
test('login Owner change cannot carry pending undo/redo intent',()=>{
  assert.match(source,/\.onChange\(of: login\.owner\) \{ owner in\s*pending = nil\s*if !XDriveIOSNativePhotoOwnerScope\.matches\(owner, expectedOwner\)/)
})
test('loadIfNeeded never issues duplicate GET for verified or busy Owner',()=>{
  assert.match(source,/private func loadIfNeeded\(\) \{\s*guard isVisible, phase == \.active, !model\.loading, !model\.busy,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\),\s*!model\.matches\(login\.owner\) else \{ return \}/)
})
test('server remains sole accepted queue and uncertainty never causes blind POST retry',()=>{
  assert.match(source,/\.submit\(action, original: operation\)/)
  assert.match(source,/self\.status = "结果尚未确认。请先刷新操作历史核对，不要重复提交。"/)
  assert.match(source,/XDriveIOSNativeFilesOperationPolicy\.accepted\(/)
  assert.doesNotMatch(source,/retryUndo|retryRedo|URLSession\.shared|WKWebView/)
})
