'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..', '..')
const files = fs.readFileSync(
  path.join(root, 'ios/XDriveIOS/NativeCloudFilesBrowser.swift'), 'utf8'
)

function segment(start, end) {
  const a = files.indexOf(start)
  const b = files.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, 'missing bounded Files segment: ' + start)
  return files.slice(a, b)
}

test('iOS 26.6 Files main-thread stack-overflow regression: split every oversized modal and lifecycle generic chain', () => {
  const modal = segment('private var filesModalsPrimary: some View {',
    '/// Save the exact loaded page')
  assert.match(modal, /private var filesModalsPrimary: some View \{\s*AnyView\(filesMain\)/)
  assert.match(modal, /private var filesModalsSecondary: some View \{\s*AnyView\(filesModalsPrimary\)/)
  assert.match(modal, /private var filesModals: some View \{\s*AnyView\(filesModalsSecondary\)/)
  const modifiers = modal.match(/\.(?:sheet|alert|confirmationDialog|fullScreenCover)\(/g) || []
  assert.equal(modifiers.length, 22, 'all 22 originally visible modal modifiers remain')
  for (const name of ['showingOrganizeHome', 'showingFileOperations', 'showingSavedSearches',
    'showingTagManager', 'batchDestinationIntent', 'managementIntent',
    'versionHistoryIntent', 'selectedFile']) {
    assert.ok(modal.includes('$' + name), 'modal or Viewer was removed: ' + name)
  }
  const lifecycles = [
    ['filesForegroundLifecycle', 'AnyView(filesModals)'],
    ['filesOwnerLifecycle', 'AnyView(filesForegroundLifecycle(returnScroll: returnScroll))'],
    ['filesNavigationLifecycle', 'AnyView(filesOwnerLifecycle(returnScroll: returnScroll))'],
    ['filesArrangementLifecycle', 'AnyView(filesNavigationLifecycle(returnScroll: returnScroll))'],
    ['filesLoadingLifecycle', 'AnyView(filesArrangementLifecycle(returnScroll: returnScroll))'],
  ]
  for (const [index, [name, erased]] of lifecycles.entries()) {
    const at = files.indexOf('private func ' + name + '(returnScroll: ScrollViewProxy)')
    const next = index + 1 < lifecycles.length
      ? files.indexOf('private func ' + lifecycles[index + 1][0] +
                      '(returnScroll: ScrollViewProxy)', at + 1)
      : files.indexOf('var body: some View {', at + 1)
    assert.ok(at > 0 && next > at, 'Files lifecycle segment missing: ' + name)
    assert.ok(files.slice(at, next).includes(erased),
      name + ' must erase its nested view type at a stable boundary')
  }
  assert.match(files, /ScrollViewReader \{ returnScroll in\s*AnyView\(filesLoadingLifecycle\(returnScroll: returnScroll\)\)/)
})

test('the stack-depth fix does not weaken verified Owner, no-session or selected row fences', () => {
  const foreground = segment('private func filesForegroundLifecycle(returnScroll:',
    'private func filesOwnerLifecycle(returnScroll:')
  const owner = segment('private func filesOwnerLifecycle(returnScroll:',
    'private func filesNavigationLifecycle(returnScroll:')
  const navigation = segment('private func filesNavigationLifecycle(returnScroll:',
    'private func filesArrangementLifecycle(returnScroll:')
  const loading = segment('private func filesLoadingLifecycle(returnScroll:',
    'var body: some View {')
  assert.match(foreground, /\.onAppear \{/)
  assert.match(foreground, /\.onDisappear \{ suspendVisibleRange\(\) \}/)
  assert.match(owner, /\.onChange\(of: login\.owner\)/)
  assert.match(owner, /model\.invalidate\(\)/)
  assert.match(owner, /selectedIDs\.removeAll\(\)/)
  assert.match(navigation, /\.onChange\(of: model\.verifiedPage\)/)
  assert.match(navigation, /XDriveIOSNativeFilesSelectionPolicy\.conflictingIDs\(/)
  assert.match(loading, /if folder != nil && !login\.hasLocalOwnerSession/)
  assert.match(loading, /XDriveIOSNativeFilesNoSessionRoute\(kind: \.cloud\)/)
  assert.match(loading, /\.onChange\(of: model\.loading\)/)
  assert.match(loading, /XDriveIOSNativePhotoOwnerScope\.matches/)
  assert.doesNotMatch(loading, /XDriveIOSNativeFilesNoSessionRoute\(kind: \.cloud\)[\s\S]*?bypassAuthorization/)
})

test('Files retained list, return scroll and real Viewer still receive original SwiftUI lifecycle', () => {
  assert.match(files, /private var filesModals: some View \{[\s\S]*?\.fullScreenCover\(item: \$selectedFile, onDismiss:/)
  assert.match(files, /ScrollViewReader \{ returnScroll in/)
  assert.match(files, /returnScroll\.scrollTo\(anchor, anchor: \.center\)/)
  assert.match(files, /returnScroll\.scrollTo\(returnID, anchor: \.center\)/)
  assert.match(files, /\.onChange\(of: quickSection\)/)
  assert.match(files, /\.onChange\(of: sort\)/)
  assert.match(files, /\.onChange\(of: grouping\)/)
  assert.match(files, /\.onChange\(of: viewMode\)/)
  assert.match(files, /\.onChange\(of: login\.owner\)/)
  assert.doesNotMatch(files, /id\(UUID\(\)\)/)
})
