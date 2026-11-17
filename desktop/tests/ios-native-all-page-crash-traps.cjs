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


test('every native Files child rejects unconditional Swift fatal operations', () => {
  // Not a replacement for the real Simulator/process-crash audit. This catches
  // newly introduced unconditional fatal operations in Files subpage sources
  // before a native IPA is produced; comments are excluded from the scan.
  const dir = path.join(root, 'ios/XDriveIOS');
  const filenames = fs.readdirSync(dir).filter(name =>
    /^Native(?:Cloud)?Files.*\.swift$/.test(name)
  );
  assert.ok(filenames.length >= 45,
    'all NativeFiles and NativeCloudFiles child modules must be audited');
  const fatal = /\b(?:try\s*!|as\s*!|fatalError\s*\(|preconditionFailure\s*\(|unsafeBitCast\s*\()/;
  for (const filename of filenames) {
    const executable = fs.readFileSync(path.join(dir, filename), 'utf8')
      .split('\n')
      .filter(line => !/^\s*(?:\/\/|\*)/.test(line))
      .map(line => line.replace(/\/\/.*$/, ''))
      .join('\n');
    assert.doesNotMatch(executable, fatal,
      filename + ' has an unconditional Swift runtime trap');
  }
});

test('native Files array indexing and sliding-window retirement stay guarded on every child route', () => {
  const browser = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift');
  const picker = read('ios/XDriveIOS/NativeFilesDestinationPicker.swift');
  const inline = read('ios/XDriveIOS/NativeFilesInlineFolders.swift');
  const windowPolicy = read('ios/XDriveIOS/NativeFilesContinuousWindowPolicy.swift');
  const windowChecks = read('ios/tests/NativeFilesContinuousWindowChecks.swift');
  assert.match(browser,
    /providers\.count == 1,\s*providers\[0\]\.hasItemConformingToTypeIdentifier/,
    'foreign drag providers must be counted before subscripting');
  assert.match(browser,
    /if chosenItems\.count == 1 \{\s*return chosenItems\[0\]\.type/,
    'single-selection direct download needs a verified count guard');
  for (const [name, source] of [['browser', browser], ['destination picker', picker], ['inline folders', inline]]) {
    assert.match(source, /XDriveIOSNativeFilesContinuousWindowPolicy\.mergePlan\(/,
      name + ' must validate a server range before trimming');
    assert.match(source, /if plan\.dropFromBack > 0 \{/,
      name + ' must only trim a positive verified range');
  }
  assert.match(windowPolicy,
    /drop <= currentIDs\.count else \{ return nil \}/,
    'reverse-page drop cannot exceed the currently verified page');
  assert.match(windowChecks, /oversized aligned next-page cursor fails without integer overflow/);
  assert.match(windowChecks, /oversized aligned return cursor fails without integer overflow/);
});
