'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const spec = fs.readFileSync(path.join(root, 'ios/project.yml'), 'utf8');
const workflow = fs.readFileSync(
  path.join(root, '.github/workflows/ios-unsigned-ipa.yml'), 'utf8'
);

function orientations(key) {
  const lines = spec.split(/\r?\n/);
  const marker = key.includes('~') ? `"${key}":` : `${key}:`;
  const line = lines.findIndex(text => text.trim() === marker);
  assert.ok(line >= 0, `generated plist declaration missing: ${key}`);
  const values = [];
  for (const current of lines.slice(line + 1)) {
    const match = /^\s+- (UIInterfaceOrientation\w+)\s*$/.exec(current);
    if (!match) break;
    values.push(match[1]);
  }
  return values;
}

test('XcodeGen explicitly allows iPhone portrait and both landscape rotations', () => {
  assert.match(spec, /TARGETED_DEVICE_FAMILY: "1,2"/);
  assert.deepEqual(orientations('UISupportedInterfaceOrientations'), [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight'
  ]);
  assert.deepEqual(orientations('UISupportedInterfaceOrientations~ipad'), [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight'
  ]);
});

test('IPA workflow verifies compiled app Info.plist, not just uncompiled YAML', () => {
  assert.match(workflow, /ios-native-supported-orientations\.cjs/);
  assert.match(workflow, /APP_PLIST="\$app\/Info\.plist" python3/);
  assert.match(workflow, /plistlib\.load\(fp\)/);
  assert.match(workflow, /info\.get\("UISupportedInterfaceOrientations"\) == iphone/);
  assert.match(workflow, /info\.get\("UISupportedInterfaceOrientations~ipad"\) == ipad/);
  assert.match(workflow, /-sdk iphoneos/);
});
