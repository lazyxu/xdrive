'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const profile = read('ui/shared/src/external-sources.ts');
const list = read('ui/shared/src/mui/SourceManagerListPage.tsx');
const details = read('ui/shared/src/mui/SourceManagerDetailsDialog.tsx');
const manager = read('ui/shared/src/mui/SourceManager.tsx');
const router = read('internal/api/router.go');
const executor = read('internal/api/ios_photo_source_executor.go');
const localAuth = read('internal/api/local_source_executor_auth.go');
const runs = read('internal/api/source_runs.go');
const reporter = read('ios/XDriveIOS/PhotoSourceRunReporter.swift');
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift');

test('iOS Photos is a device-executed Push Source, not a server-triggered worker', () => {
  assert.match(profile, /kind === 'ios_photos'/);
  assert.match(profile, /manualTriggerExecutor: 'ios_device'/);
  assert.match(profile, /iPhone 正在备份/);
  assert.match(profile, /Server 不执行 PhotoKit 扫描或原件读取/);
  assert.match(list, /row\.source\.kind === 'ios_photos'/);
  assert.match(list, /新增上传/);
  assert.match(list, /云端已核验/);
  assert.match(list, /待处理/);
});

test('shared Source Manager reads run history without inventing PhotoKit collections or file identities', () => {
  assert.match(details, /title="运行记录"/);
  assert.match(details, /每条运行记录只代表该次有界批次/);
  assert.match(details, /row\.source\.kind !== 'ios_photos'/);
  assert.match(manager, /aggregate SyncRun history/);
  assert.match(manager, /row\.source\.kind === 'ios_photos'/);
  assert.match(details, /逐项原因仅在手机端显示/);
});

test('native iPhone reports begin, progress and terminal state with the exact device proof', () => {
  assert.ok(reporter.includes('path: "/api/v1/sources/\\(authority.destination.sourceID)/runs"'));
  assert.ok(reporter.includes('runs/\\(self.runID)/progress'));
  assert.ok(reporter.includes('runs/\\(self.runID)/finish'));
  assert.match(reporter, /X-XDrive-Device-ID/);
  assert.match(reporter, /X-XDrive-Device-Token/);
  assert.match(reporter, /complete_inventory": false/);
  assert.match(controller, /XDriveIOSPhotoSourceRunReporter/);
  assert.match(controller, /onSourceProgress:/);
  assert.doesNotMatch(reporter, /PHAsset|localIdentifier|latitude|longitude|originalFilename/);
});

test('server binds iOS SourceRun writes to the registered device and managed Source/Node', () => {
  assert.ok(router.includes('authed.POST("/sources/:id/runs", s.requireSourceRunExecutor(), s.beginSourceRun)'));
  assert.ok(router.includes('authed.POST("/sources/:id/runs/:runID/progress", s.requireSourceRunExecutor(), s.progressSourceRun)'));
  assert.match(executor, /iosPhotoDestinationDeviceTx/);
  assert.match(executor, /iosPhotoDestinationBindingTx/);
  assert.match(executor, /requireIOSPhotoSourceRunProofTx/);
  assert.match(localAuth, /meta\.SourceKindIOSPhotos/);
  assert.match(runs, /source\.Kind != meta\.SourceKindIOSPhotos/);
  assert.match(runs, /source\.Kind == meta\.SourceKindIOSPhotos/);
  assert.match(runs, /last_success_at/);
});
