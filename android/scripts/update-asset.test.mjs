import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareUpdateAsset } from './update-asset.mjs';

test('packages release metadata with its real Android version, without modifying APK bytes or overwriting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xdrive-update-'));
  try {
    const apk = Buffer.from('PK fixture APK bytes');
    writeFileSync(join(dir, 'app-release.apk'), apk);
    writeFileSync(join(dir, 'output-metadata.json'), JSON.stringify({ applicationId: 'com.tfluid.xdrive', variantName: 'release', elements: [{ versionCode: 3, versionName: '0.1.2', outputFile: 'app-release.apk' }] }));
    const result = prepareUpdateAsset(join(dir, 'output-metadata.json'), join(dir, 'out'));
    assert.equal(result, join(dir, 'out', 'xdrive-android-3-0.1.2.apk'));
    assert.deepEqual(readFileSync(result), apk);
    assert.throws(() => prepareUpdateAsset(join(dir, 'output-metadata.json'), join(dir, 'out')), /exist/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects debug, foreign app, split APK, invalid versions and traversing paths before copying', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xdrive-update-'));
  try {
    const base = { applicationId: 'com.tfluid.xdrive', variantName: 'release', elements: [{ versionCode: 3, versionName: '0.1.2', outputFile: 'app-release.apk' }] };
    writeFileSync(join(dir, 'app-release.apk'), Buffer.from('PK fixture APK bytes'));
    writeFileSync(join(dir, 'app-release-unsigned.apk'), Buffer.from('PK fixture unsigned bytes'));
    const bad = [ { ...base, variantName: 'debug' }, { ...base, applicationId: 'other.app' }, { ...base, elements: [...base.elements, ...base.elements] },
      ...[0, 2100000001, 3.5, '3'].map(versionCode => ({ ...base, elements: [{ ...base.elements[0], versionCode }] })),
      { ...base, elements: [{ ...base.elements[0], versionName: '../escape' }] },
      { ...base, elements: [{ ...base.elements[0], outputFile: 'app-release-unsigned.apk' }] },
      { ...base, elements: [{ ...base.elements[0], outputFile: '../app-release.apk' }] } ];
    for (const metadata of bad) {
      writeFileSync(join(dir, 'output-metadata.json'), JSON.stringify(metadata));
      assert.throws(() => prepareUpdateAsset(join(dir, 'output-metadata.json'), join(dir, 'out')), /Invalid Android version or APK path|Expected one xDrive release APK/);
      assert.equal(existsSync(join(dir, 'out')), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
