'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const screen = read('ios/XDriveIOS/NativePhotoBackupScreen.swift');
const model = read('ios/XDriveIOS/NativePhotoBackupDestinationModel.swift');
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift');
const server = read('internal/api/ios_photo_backup_destination.go');
const managedUpload = read('internal/api/ios_photo_managed_uploads.go');
const router = read('internal/api/router.go');

test('iOS native backup destination is a user-confirmed mandatory named folder with real Server path', () => {
  for (const id of [
    'native-ios-photos-destination-name',
    'native-ios-photos-destination-save',
    'native-ios-photos-destination-refresh',
    'native-ios-photos-destination-device-register',
    'native-ios-photos-destination-target-path',
  ]) assert.ok(screen.includes(id), id);
  assert.match(screen, /Section\("备份目的地（必选）"\)/);
  assert.match(screen, /TextField\("备份文件夹名称", text: \$destination\.folderName\)/);
  assert.match(screen, /destination\.save\(login: login\)/);
  assert.match(screen, /destination\.registerDevice\(login: login\)/);
  assert.match(screen, /destination\.refresh\(login: login\)/);
  assert.match(screen, /\.onChange\(of: login\.owner\)[\s\S]*destination\.reset\(\)/);
  assert.match(screen, /if let verified = destination\.confirmed/);
  assert.match(screen, /Text\(verified\.targetPath\)/);
  assert.doesNotMatch(screen, /destinat(?:ion|ed).*appendingPathComponent/);
});

test('config read never silently enrolls the iPhone or uses a JS/browser credential', () => {
  const readPart = model.slice(model.indexOf('func refresh('), model.indexOf('func registerDevice('));
  assert.match(readPart, /login\.verifiedAuthorization\(\)/);
  assert.match(readPart, /backgroundPhotoDeviceProof\(/);
  assert.doesNotMatch(readPart, /\.enroll\(/);
  assert.match(model, /func registerDevice\(/);
  assert.match(model, /func save\(/);
  assert.match(model, /request\([\s\S]*method: "PUT", body: body/);
  assert.match(model, /"X-XDrive-Device-ID"/);
  assert.match(model, /"X-XDrive-Device-Token"/);
  assert.match(model, /"Authorization"/);
  assert.match(model, /URLSessionConfiguration\.ephemeral/);
  assert.match(model, /willPerformHTTPRedirection/);
  assert.match(model, /completionHandler\(nil\)/);
  assert.doesNotMatch(model, /WKWebView|UserDefaults|localStorage|PHPicker|UploadSessionTransport/);
});

test('only server response supplies actual target/source ID, local path cannot become authority', () => {
  assert.match(model, /dto\.device_id == device\.deviceID/);
  assert.match(model, /targetID != owner\.rootNodeID/);
  assert.match(model, /path\.hasPrefix\("同步文件夹\/设备备份\/"\)/);
  assert.match(model, /XDriveIOSPhotoBackupDestinationNamePolicy\.normalized/);
  assert.match(server, /createLocalPushManagedTargetTx/);
  assert.match(server, /managedSourceTargetAncestorIDsTx/);
  assert.match(server, /renameManagedSourceTargetTx/);
  assert.match(router, /authed\.PUT\("\/ios\/photos\/backup-destination"/);
  assert.doesNotMatch(model, /\.rootNodeID\s*\+\s*["']/);
});

test('native original backup is gated by a verified managed destination and uses the scoped CAS route', () => {
  assert.ok((screen.match(/!destination\.confirmedForCurrentName/g) || []).length >= 3,
    'manual, focused and automatic writers all require the confirmed current destination');
  assert.match(model, /static func readExistingForUpload/);
  const uploadAdmission = model.slice(model.indexOf('static func readExistingForUpload'));
  assert.match(uploadAdmission, /backgroundPhotoDeviceProof/);
  assert.match(uploadAdmission, /method: "GET", body: nil/);
  assert.match(uploadAdmission, /verifiedBinding/);
  assert.match(uploadAdmission, /XDriveIOSManagedOriginalAuthority/);
  assert.match(model, /not an upload permission/);
  assert.match(managedUpload, /func \(s \*Server\) iosPhotoManagedCreateUpload/);
  assert.match(managedUpload, /iosPhotoManagedAuthorizedScope\(c\)/);
  assert.match(managedUpload, /validIOSPhotoManagedUploadInit\(req, scope\)/);
  assert.match(managedUpload, /s\.createUploadSession\(c\)/);
  assert.match(managedUpload, /requireIOSPhotoManagedUploadTx/);
  assert.match(router, /authed\.POST\("\/ios\/photos\/managed\/uploads", s\.iosPhotoManagedCreateUpload\)/);
  assert.match(router, /iosPhotoManagedBG\.POST\("\/uploads", s\.iosPhotoManagedCreateUpload\)/);
  assert.doesNotMatch(screen, /本阶段只完成目标目录绑定/);
  assert.doesNotMatch(server, /\bcreateUploadSession\(|\bfinalizeUploadSession\(/);
});
