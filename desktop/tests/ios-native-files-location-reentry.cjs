'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(__dirname, '../..', 'ios/XDriveIOS/NativeFilesSearchLocation.swift'), 'utf8')
function between(start, finish) {
  const i = source.indexOf(start), j = source.indexOf(finish, i + start.length)
  assert.ok(i >= 0 && j > i, 'expected section: ' + start)
  return source.slice(i, j)
}
test('verified location records exact selected Node including revision', () => {
  assert.match(source, /private var locatedSelected: XDriveIOSNativeFilesNode\?/)
  assert.match(source, /locatedSelected == selected/)
})
test('verified location records whole originating Owner scope', () => {
  assert.match(source, /private var locatedOwner: XDriveNativeOwnerRoot\?/)
  assert.match(source, /XDriveIOSNativePhotoOwnerScope\.matches\(owner, locatedOwner\)/)
})
test('UI selection can only use an actually verified target', () => {
  assert.match(source, /func matches\(selected: XDriveIOSNativeFilesNode,[\s\S]*?guard target != nil, locatedSelected == selected/)
})
test('invalidate retires selected identity and Owner before source page', () => {
  assert.match(source, /job = nil\s*locatedSelected = nil\s*locatedOwner = nil\s*target = nil\s*loading = false\s*error = nil/)
})
test('successful server location publishes exact source before route target', () => {
  assert.match(source, /locatedSelected = selected\s*locatedOwner = expectedOwner\s*target = folder\s*error = nil/)
})
test('failed old account request cannot publish an error on current account', () => {
  assert.match(source, /catch \{\s*guard generation == ticket,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\)\s*else \{ return \}/)
})
test('route target is gated by active phase, current Owner and exact Node', () => {
  assert.match(source, /if let target = model\.target,\s*phase == \.active,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, openedOwner\),\s*model\.matches\(selected: selected, owner: login\.owner\)/)
})
test('in-progress spinner cannot leak a changed Owner location', () => {
  assert.match(source, /else if model\.loading && phase == \.active &&\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, openedOwner\)/)
})
test('retry button does not create a hidden or duplicate location GET', () => {
  const r=between('Button("重试定位") {', '.accessibilityIdentifier("native-ios-files-locate-retry")')
  assert.match(r, /guard isVisible, phase == \.active else \{ return \}/)
  assert.match(r, /\.disabled\(model\.loading \|\| phase != \.active \|\|/)
})
test('first mount and return use loadIfNeeded, not a permanently stuck started flag', () => {
  assert.match(source, /\.onAppear \{\s*isVisible = true\s*loadIfNeeded\(\)/)
  assert.doesNotMatch(source, /@State private var started = false|guard !started/)
})
test('leaving this route retires the old location model', () => {
  assert.match(source, /\.onDisappear \{\s*isVisible = false\s*model\.invalidate\(\)/)
})
test('reused sheet revokes stale routing when selected Node changes', () => {
  assert.match(source, /\.onChange\(of: selected\) \{ _ in\s*model\.invalidate\(\)\s*loadIfNeeded\(\)/)
})
test('reused sheet revokes stale routing when expected Owner changes', () => {
  assert.match(source, /\.onChange\(of: openedOwner\) \{ _ in\s*model\.invalidate\(\)\s*loadIfNeeded\(\)/)
})
test('active account change revalidates, rather than leaving blank forever', () => {
  assert.match(source, /\.onChange\(of: login\.owner\) \{ _ in\s*model\.invalidate\(\)\s*loadIfNeeded\(\)/)
})
test('background cancellation and foreground re-entry preserve navigation correctness', () => {
  assert.match(source, /\.onChange\(of: phase\) \{ state in\s*if state != \.active \{ model\.invalidate\(\) \}\s*else \{ loadIfNeeded\(\) \}/)
})
test('deduplicated foreground load checks exact current node, Owner and loading', () => {
  assert.match(source, /private func loadIfNeeded\(\) \{\s*guard isVisible, phase == \.active, !model\.loading,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, openedOwner\),\s*!model\.matches\(selected: selected, owner: login\.owner\) else \{ return \}/)
})
test('located root reuses canonical Files browser, not a fake Browse home', () => {
  assert.match(source, /target\.folder\.id == openedOwner\.rootNodeID/)
  assert.match(source, /folderID: openedOwner\.rootNodeID,/)
  assert.match(source, /initialOffset: target\.offset, focus: selected/)
  assert.doesNotMatch(source, /WKWebView|import WebKit|URLSession\.shared/)
})
