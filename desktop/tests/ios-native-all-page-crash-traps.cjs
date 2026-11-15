'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('real Files audio Viewer bounds player duration and avoids Double-to-Int traps', () => {
  const viewer = read('ios/XDriveIOS/NativeFilesViewer.swift');
  const policy = read('ios/XDriveIOS/NativeFileAudioTimecodePolicy.swift');
  const checks = read('ios/tests/NativeFileAudioTimecodeChecks.swift');
  assert.match(viewer, /duration = XDriveIOSNativeFileAudioTimecodePolicy\.acceptedDuration\(total\)/);
  assert.match(viewer, /return XDriveIOSNativeFileAudioTimecodePolicy\.label\(seconds: seconds\)/);
  assert.doesNotMatch(viewer, /Int\(max\(0, seconds\.isFinite \? seconds : 0\)\)/);
  assert.match(policy, /seconds\.isFinite && seconds > 0 && seconds <= maximumSeconds/);
  assert.match(policy, /seconds <= maximumSeconds else \{ return "--:--" \}/);
  assert.match(checks, /\.greatestFiniteMagnitude/);
  assert.match(checks, /Double\.nan/);
});

test('Clipboard picker revalidates Owner, path, and pending page on Back and child entry', () => {
  const source = read('ios/XDriveIOS/NativeClipboardScreen.swift');
  const picker = source.split('private struct XDriveIOSNativeClipboardCloudPicker: View')[1];
  assert.ok(picker, 'real Clipboard Cloud Files picker must exist');
  const back = picker.slice(picker.indexOf('Button("返回上一级")'),
                            picker.indexOf('Section("当前 Owner 的云端文件")'));
  assert.match(back, /XDriveIOSNativePhotoOwnerScope\.matches\(\s*login\.owner, openedOwner\s*\)/);
  assert.match(back, /XDriveIOSNativeClipboardFolderBackPolicy\.retreat\(path: &folders\)/);
  assert.match(back, /requestID = UUID\(\)[\s\S]*?offset = 0[\s\S]*?totalCount = 0[\s\S]*?rows = \[\]/);
  assert.doesNotMatch(picker, /^\s*folders\.removeLast\(\)/m);
  assert.match(picker, /node\.parent_id == folderID, node\.id > 0,[\s\S]*?rows\.contains\(where: \{ \$0\.id == node\.id \}\)/);
  const policy = read('ios/XDriveIOS/NativeClipboardFolderBackPolicy.swift');
  const checks = read('ios/tests/NativeClipboardFolderBackPolicyChecks.swift');
  assert.match(policy, /guard !path\.isEmpty else \{ return false \}/);
  assert.match(checks, /second stale tap must not terminate the process/);
});

test('unsigned IPA gate runs both executable Swift regressions and integration contracts', () => {
  const workflow = read('.github/workflows/ios-unsigned-ipa.yml');
  assert.match(workflow, /NativeFileAudioTimecodeChecks\.swift/);
  assert.match(workflow, /NativeClipboardFolderBackPolicyChecks\.swift/);
  assert.match(workflow, /node --test desktop\/tests\/ios-native-all-page-crash-traps\.cjs/);
});
