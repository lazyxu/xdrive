'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
const page = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const mutation = read('ios/XDriveIOS/NativeFilesSingleMutation.swift')
const destination = read('ios/XDriveIOS/NativeFilesDestinationMutation.swift')
const collection = read('ios/XDriveIOS/NativeFilesCollections.swift')
const actions = page.slice(page.indexOf('private func canQuickMutate('),
  page.indexOf('private func openManagement(', page.indexOf('private func canQuickMutate(')))

test('each verified row exposes copy/move/rename/favorite/trash without an intermediate management page', () => {
  for (const action of ['requestRowDestination(entry.node, kind: .copy)',
    'requestRowDestination(entry.node, kind: .move)', 'requestQuickRename(entry.node)',
    'requestQuickFavorite(entry.node)', 'requestQuickTrash(entry.node)']) {
    assert.ok(actions.includes(action), action)
  }
  for (const old of ['openManagement(for: entry.node, quickAction: .copy)',
    'openManagement(for: entry.node, quickAction: .move)',
    'openManagement(for: entry.node, quickAction: .rename)',
    'openManagement(for: entry.node, quickAction: .favorite)',
    'openManagement(for: entry.node, quickAction: .trash)']) {
    assert.ok(!actions.includes(old), old)
  }
  assert.match(page, /native-ios-files-row-rename/)
  assert.match(page, /native-ios-files-row-copy-to/)
  assert.match(page, /native-ios-files-row-move-to/)
  assert.match(page, /native-ios-files-row-favorite/)
  assert.match(page, /native-ios-files-row-trash/)
  assert.match(page, /nativeQuickActions\(for: entry\)/)
})

test('all one-node quick mutations fail closed for verified Owner, revision and busy state', () => {
  assert.match(actions, /!model\.loading && model\.verifiedPage/)
  assert.match(actions, /!quickMutation\.busy && !quickDestinationWriter\.busy/)
  assert.match(actions, /login\.owner != nil &&[\s\S]*?containsVerifiedNode\(node\)/)
  assert.match(actions, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, intent\.owner\)/)
  assert.match(actions, /XDriveIOSNativeFilesBatchTrashPolicy\.validSelection\(/)
  assert.match(page, /quickDestinationWriter\.perform\([\s\S]*?original: intent\.node/)
  assert.match(mutation, /let \(body, response\) = try await session\.data\(/)
  assert.match(mutation, /current == node/)
  assert.match(mutation, /forHTTPHeaderField: "If-Match"/)
  assert.match(mutation, /status = "文件操作结果未确认，请刷新核对后再操作。"/)
  assert.match(destination, /XDriveIOSNativePhotoOwnerScope\.matches/)
  assert.match(collection, /status = "服务器已确认收藏操作。"/)
})

test('native alerts and destination picker are displayed directly on Files, not in management modal', () => {
  assert.match(page, /\.alert\("重命名", isPresented: Binding\(/)
  assert.match(page, /TextField\("新名称", text: \$quickRenameDraft\)/)
  assert.match(page, /Button\("保存"\) \{ confirmQuickRename\(\) \}/)
  assert.match(page, /confirmQuickTrash\(\)/)
  assert.match(page, /\.sheet\(item: \$rowDestinationIntent\)/)
  assert.match(page, /XDriveIOSNativeFilesDestinationPicker\(/)
  assert.match(page, /selected: intent\.node, kind: intent\.kind/)
  assert.match(page, /onConfirmed|\) \{ reload\(\) \}/)
  assert.match(page, /quickMutation\.perform\(/)
  assert.match(page, /quickFavorite\.add\(node, login: login\)/)
})

test('status overlay is not an in-list row and disabled state explains Owner/busy gating', () => {
  assert.match(page, /private var filesQuickFeedback: some View/)
  assert.match(page, /quickMutation\.status/)
  assert.match(page, /quickDestinationWriter\.status/)
  assert.match(page, /quickFavorite\.status/)
  assert.match(page, /\.overlay\(alignment: \.bottom\) \{ filesQuickFeedback \}/)
  assert.match(page, /native-ios-files-quick-feedback/)
  assert.match(page, /当前文件尚未验证，或另一个文件操作正在进行/)
  assert.ok((actions.match(/\.disabled\(!canQuickMutate\(entry\.node\)\)/g) || []).length >= 5)
})

test('Owner switch and navigation revoke active row shortcuts, without losing read-only Viewer retention', () => {
  const ownerChange = page.slice(page.indexOf(".onChange(of: login.owner) { _ in"),
    page.indexOf(".onChange(of: model.verifiedPage)", page.indexOf(".onChange(of: login.owner) { _ in")))
  assert.ok(ownerChange.length > 300, "Owner change handler must exist")
  assert.match(ownerChange, /chunked\.invalidate\(\)\s*quickMutation\.invalidate\(\)[\s\S]*?quickDestinationWriter\.invalidate\(\)[\s\S]*?quickFavorite\.invalidate\(\)/)
  assert.match(ownerChange, /resumeTask\?\.cancel\(\)/)
  assert.match(ownerChange, /viewerAdmitted\.removeAll\(\)/)
  assert.match(ownerChange, /model\.invalidate\(\)/)
  assert.match(page, /if rowDestinationIntent == nil \{\s*quickMutation\.invalidate\(\)/)
  assert.match(page, /\.fullScreenCover\(item: \$selectedFile, onDismiss: \{[\s\S]*?model\.canResume\(/)
  assert.match(page, /\.sheet\(item: \$locateIntent\) \{ intent in/)
  assert.doesNotMatch(page, /\.sheet\(item: \$locateIntent, onDismiss: \{\s*reload\(\)/)
})
