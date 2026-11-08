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
const background = read('ios/XDriveIOS/BackgroundPhotoTask.swift');
const sourceIcon = read('ui/shared/src/mui/SourceKindIcon.tsx');
const browserHost = read('web/src/browserWorkspaceHost.ts');
const desktopHost = read('desktop/src/renderer/App.tsx');

test('iOS Photos is a device-executed Push Source, not a server-triggered worker', () => {
  assert.match(profile, /kind === 'ios_photos'/);
  assert.match(profile, /manualTriggerExecutor: 'ios_device'/);
  assert.match(profile, /iPhone 正在备份/);
  assert.match(profile, /Server 不执行 PhotoKit 扫描或原件读取/);
  assert.match(profile, /latestRun\?\.status === 'cancelled'/);
  assert.match(profile, /最近一次备份已取消/);
  assert.ok(sourceIcon.includes('ios-photos.svg'));
  assert.match(browserHost, /remotePullPage: \{ \.\.\.ports\.remotePull \}/);
  assert.doesNotMatch(browserHost, /directionFilter:\s*'pull'/);
  assert.match(desktopHost, /remotePullPage: \{/);
  assert.doesNotMatch(desktopHost, /directionFilter:\s*"pull"/);
  assert.match(list, /row\.source\.kind === 'ios_photos'/);
  assert.match(list, /新增上传/);
  assert.match(list, /云端已核验/);
  assert.match(list, /待处理/);
});

test('shared Source Manager reads run history without inventing PhotoKit collections or file identities', () => {
  assert.match(details, /title="运行记录"/);
  assert.match(details, /批次完成不代表整库已备份/);
  assert.match(details, /!isNativePhotoSource\(row\.source\)/);
  assert.match(manager, /aggregate SyncRun history/);
  assert.match(manager, /isNativePhotoSource\(row\.source\)/);
  assert.match(manager, /isIOSPhotoSource/);
  assert.match(details, /本次待处理项目/);
  assert.match(details, /逐项原因仅在手机端显示/);
  assert.match(details, /externalSourceRunDetailView\(run, row\.source\.kind\)/);
  assert.match(details, /\['scanned', 'new', 'unchanged', 'failed'\]/);
});

test('native iPhone reports begin, progress and terminal state with the exact device proof', () => {
  assert.ok(reporter.includes('return "/api/v1/sources/\\(authority.destination.sourceID)/runs"'));
  assert.ok(reporter.includes('path: "\\(basePath)/\\(self.runID)/progress"'));
  assert.ok(reporter.includes('path: "\\(basePath)/\\(self.runID)/finish"'));
  assert.ok(reporter.includes('/ios/photos/background-managed/sources/'));
  assert.match(reporter, /X-XDrive-Device-ID/);
  assert.match(reporter, /X-XDrive-Device-Token/);
  assert.match(reporter, /X-XDrive-IOS-Photo-Grant/);
  assert.match(reporter, /complete_inventory": false/);
  assert.match(controller, /XDriveIOSPhotoSourceRunReporter/);
  assert.match(controller, /onSourceProgress:/);
  assert.match(reporter, /beginRequested/);
  assert.match(reporter, /guard !finished, beginRequested,/);
  const beginAt = controller.indexOf('sourceRunReporter = reporter');
  const singleAt = controller.indexOf('if kind == .single', beginAt);
  const firstBegin = controller.indexOf('await reporter.begin()', beginAt);
  assert.ok(beginAt >= 0 && singleAt > beginAt && firstBegin > singleAt);
  assert.match(controller, /\.reserveDue\(owner: selected,[\s\S]*?await reporter\.begin\(\)[\s\S]*?ForegroundPhotoBackupMVP/);
  assert.match(background, /XDriveIOSPhotoSourceRunReporter/);
  assert.match(background, /approvedBackgroundGrant: approved, trigger: "scheduled"/);
  assert.match(background, /onSourceProgress:/);
  assert.doesNotMatch(reporter, /PHAsset|localIdentifier|latitude|longitude|originalFilename/);
});

test('server binds iOS SourceRun writes to the registered device and managed Source/Node', () => {
  assert.ok(router.includes('authed.POST("/sources/:id/runs", s.requireSourceRunExecutor(), s.beginSourceRun)'));
  assert.ok(router.includes('authed.POST("/sources/:id/runs/:runID/progress", s.requireSourceRunExecutor(), s.progressSourceRun)'));
  assert.ok(router.includes('iosPhotoManagedBG.POST("/sources/:id/runs", s.requireIOSPhotoBackgroundSourceRunExecutor(), s.beginSourceRun)'));
  assert.match(executor, /requireIOSPhotoBackgroundSourceRunExecutor/);
  assert.match(executor, /iosPhotoBackgroundGrantFromContext/);
  assert.match(executor, /iosPhotoGrantValid/);
  assert.match(executor, /iosPhotoDestinationDeviceTx/);
  assert.match(executor, /iosPhotoDestinationBindingTx/);
  assert.match(executor, /requireIOSPhotoSourceRunProofTx/);
  assert.match(localAuth, /meta\.SourceKindIOSPhotos/);
  assert.match(runs, /!nativePhotoSourceRunKind\(source\.Kind\)/)
  assert.match(read('internal/api/android_photo_source_executor.go'), /func nativePhotoSourceRunKind\(/);
  assert.match(runs, /nativePhotoSourceRunKind\(source\.Kind\)/);
  assert.match(runs, /last_success_at/);
});
