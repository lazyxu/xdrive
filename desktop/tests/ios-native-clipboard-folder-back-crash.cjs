'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const picker = read('ios/XDriveIOS/NativeClipboardScreen.swift').split(
  'private struct XDriveIOSNativeClipboardCloudPicker: View'
)[1];
const policy = read('ios/XDriveIOS/NativeClipboardFolderBackPolicy.swift');
const checks = read('ios/tests/NativeClipboardFolderBackPolicyChecks.swift');

test('real Clipboard cloud picker verifies current Owner and rechecks path when Back is tapped', () => {
  assert.ok(picker, 'real cloud picker must still exist');
  const back = picker.slice(picker.indexOf('Button("返回上一级")'),
    picker.indexOf('Section("当前 Owner 的云端文件")'));
  assert.ok(back.startsWith('Button("返回上一级")'), 'real Back action must still exist');
  assert.match(back, /guard XDriveIOSNativePhotoOwnerScope\.matches\(\s*login\.owner, openedOwner\s*\),\s*XDriveIOSNativeClipboardFolderBackPolicy\.retreat\(path: &folders\)\s*else \{ return \}/);
  assert.doesNotMatch(picker, /folders\.removeLast\(\)/,
    'UI callbacks must never removeLast without action-time checking');
  assert.match(picker, /requestID = UUID\(\)\s*offset = 0\s*totalCount = 0\s*rows = \[\]/,
    'back navigation must retire the previous Owner/page load');
});

test('real child-folder tap cannot revive stale data after Owner or path changes', () => {
  assert.match(picker, /guard XDriveIOSNativePhotoOwnerScope\.matches\(\s*login\.owner, openedOwner\s*\),\s*node\.parent_id == folderID, node\.id > 0,\s*rows\.contains\(where: \{ \$0\.id == node\.id \}\)\s*else \{ return \}/);
  assert.match(picker, /requestID = UUID\(\)\s*folders\.append\(/,
    'entering a new folder must invalidate the old asynchronous read');
  assert.match(picker, /\.task\(id: "\\\(folderID\):\\\(offset\)"\)/,
    'retained 64-item page requests must follow actual current folder and offset');
});

test('guarded pure Swift back policy and double-tap test remain executable', () => {
  assert.match(policy, /static func retreat<Folder>\(path: inout \[Folder\]\) -> Bool/);
  assert.match(policy, /guard !path\.isEmpty else \{ return false \}/);
  assert.match(policy, /path\.removeLast\(\)/);
  assert.match(checks, /second stale tap must not terminate the process/);
  assert.match(checks, /nested retreat must reach root/);
});
