'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const browse = source('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const collection = source('ios/XDriveIOS/NativeFilesCollections.swift')
const viewer = source('ios/XDriveIOS/NativeFilesViewer.swift')
const tokens = source('ios/XDriveIOS/NativeFilesUIStyle.swift')
const policy = source('ios/XDriveIOS/NativeFilesViewModePolicy.swift')
const workflow = source('.github/workflows/ios-native-navigation-runtime.yml')
const video = source('ios/scripts/files_ui_transition_video.py')

test('F1 Home has an overview and collapsed secondary tags', () => {
  assert.match(browse, /native-ios-files-home-overview/)
  assert.match(browse, /DisclosureGroup\("标签与分类", isExpanded: \$homeTagsExpanded\)/)
  assert.match(browse, /private var homeTagsExpanded = false/)
  for (const id of ['native-ios-files-open-root-location',
    'native-ios-files-open-trash', 'native-ios-files-open-recent',
    'native-ios-files-open-favorites', 'native-ios-files-organize-home',
    'native-ios-files-open-saved-searches', 'native-ios-files-open-operations']) {
    assert.ok(browse.includes(id), 'existing shortcut missing: ' + id)
  }
})
test('F2 one bottom selection dock preserves all five common actions', () => {
  assert.match(browse, /\.safeAreaInset\(edge: \.bottom, spacing: 0\)/)
  assert.match(browse, /if selecting \{ filesSelectionToolbar \}/)
  assert.match(browse, /selectionDockHeight/)
  assert.match(tokens, /selectionDockHeight: CGFloat = 52/)
  for (const id of ['batch-copy', 'batch-move', 'batch-direct-download',
    'batch-direct-trash', 'batch-more']) {
    assert.ok(browse.includes('native-ios-files-' + id), id)
  }
})
test('F3 List/Grid uses verified anchored updates and rejects stale tasks', () => {
  for (const src of [browse, collection]) {
    assert.match(src, /XDriveIOSNativeFilesViewModePolicy\.anchor/)
    assert.match(src, /XDriveIOSNativeFilesViewModePolicy\.canRestore/)
    assert.match(src, /modeSwitchTicket = UUID\(\)/)
    assert.match(src, /transaction\.disablesAnimations = true/)
    assert.match(src, /returnScroll\.scrollTo\(anchor, anchor: \.center\)/)
  }
  assert.match(policy, /Set\(loaded\)\.count == loaded\.count/)
  assert.match(policy, /ticketCurrent && ownerValid && pageValid && anchorVisible && screenVisible && active/)
  assert.match(browse, /screenVisible: filesViewVisible/)
  assert.match(browse, /let routeVisible = filesViewVisible && phase == \.active/)
  assert.match(browse, /guard !loading, selectedFile == nil, routeVisible else/)
  assert.match(collection, /if isVisible && phase == \.active && model\.verified &&/)
  assert.match(collection, /model\.matches\(login\.owner, kind: kind\) &&/)

  assert.match(collection, /screenVisible: isVisible/)
  assert.match(browse, /modeSwitchTicket = UUID\(\)/)
  assert.match(collection, /pendingModeSwitchAnchor = nil/)
  assert.match(browse, /model\.canReanchor/)
  assert.match(collection, /model\.matches\(login\.owner, kind: kind\)/)
})
test('F4 Viewer adds explicit checked export and retains native media', () => {
  assert.match(viewer, /native-ios-files-viewer-primary-share/)
  assert.match(viewer, /exporter\.prepare\(viewed, login: login,/)
  assert.match(viewer, /staged\.nodeID == viewed\.id/)
  assert.match(viewer, /staged\.revision == viewed\.revision/)
  assert.match(viewer, /ShareLink\(item: staged\.fileURL\)/)
  assert.match(viewer, /XDriveIOSNativePhotoVideoSurface/)
  assert.match(viewer, /XDriveIOSNativePDFDocumentSurface/)
  assert.match(viewer, /exporter\.invalidate\(\)/)
})
test('F5 real video and decoded-frame audit, not screenshot-only', () => {
  assert.match(workflow, /files_ui_transition_video\.py" watch/)
  assert.match(workflow, /files_ui_transition_video\.py" audit/)
  assert.match(workflow, /--minimum 4/)
  assert.match(video, /"xcrun", "simctl", "io", simulator, "recordVideo"/)
  assert.match(video, /fps=10,scale=64:64,signalstats/)
  assert.match(video, /missing_real_tap_marker/)
  assert.match(video, /test_not_passed/)
  assert.match(video, /incomplete_test_recording/)
  assert.match(video, /recording_process_failed/)
  assert.match(video, /missing_pre_tap_frames/)
  assert.match(video, /invalid_native_tap_marker/)
  assert.match(video, /suspected_solid_white_transition/)
  assert.match(video, /physical_60_120_hz_verified": False/)
})
test('F6 Browse/Recent/Favorites/Viewer share typography tokens', () => {
  assert.match(browse, /XDriveIOSNativeFilesUIStyle\.rowName/)
  assert.match(collection, /XDriveIOSNativeFilesUIStyle\.rowName/)
  assert.match(collection, /XDriveIOSNativeFilesUIStyle\.tileName/)
  assert.match(viewer, /XDriveIOSNativeFilesUIStyle\.metadataFont/)
  assert.match(tokens, /static func metadata\(_ value: String\) -> some View/)
})
