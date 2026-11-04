'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const model = read('ios/XDriveIOS/NativePhotoBackupDestinationModel.swift');
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift');
const screen = read('ios/XDriveIOS/NativePhotoBackupScreen.swift');
const auth = read('ios/XDriveIOS/OriginalOwnerAuthorization.swift');
const transport = read('ios/XDriveIOS/NativeUploadSessionTransport.swift');
const runner = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift');
const intent = read('ios/XDriveIOS/PhotoKitStagedIntentPreparer.swift');
const writer = read('ios/XDriveIOS/IOSJournaledOriginalUpload.swift');
const routes = read('ios/XDriveIOS/ManagedPhotoUploadRoutePolicy.swift');

test('automatic schedule cannot enable or reserve a window before Owner+device+Source+Node proof', () => {
  const setup = controller.slice(controller.indexOf('func configure('),
    controller.indexOf('func disable('));
  const current = controller.slice(controller.indexOf('private func start('),
    controller.indexOf('private func runFocused('));
  const pending = current.indexOf('pendingCount(owner: selected)');
  const proof = current.indexOf('.readExistingForUpload(owner: selected');
  const reserve = current.indexOf('.reserveDue(owner: selected,');
  assert.ok(setup.indexOf('.readExistingForUpload(owner: selected') <
    setup.indexOf('store.configure('));
  assert.ok(pending > 0 && proof > pending && reserve > proof,
    'pending ACK and managed target must be proven before reserving due');
  assert.match(current, /owner: selected, managedForeground: managed/);
  assert.match(controller, /\.readExistingForUpload\(owner: owner, accessToken: auth\.accessToken\)/);
  assert.match(controller, /owner: owner, managedForeground: managed/);
  assert.match(model, /static func readExistingForUpload\(/);
  const admission = model.slice(model.indexOf('static func readExistingForUpload('),
    model.indexOf('private func verifiedBinding('));
  assert.match(admission, /method: "GET", body: nil/);
  assert.doesNotMatch(admission, /\.enroll\(|method: "PUT"/);
  assert.match(admission, /backgroundPhotoDeviceProof\(/);
});

test('all foreground writer phases use exactly the Server-confirmed managed parent, not Owner root', () => {
  assert.match(auth, /case managedForeground\(XDriveIOSManagedOriginalAuthority\)/);
  assert.match(auth, /func destinationParentID\(owner: XDriveNativeOwnerRoot\)/);
  assert.match(auth, /authority\.destination\.targetNodeID/);
  assert.match(auth, /XDriveIOSManagedOriginalNodeReceiptVerifier/);
  assert.match(intent, /role: \.liveBundle, parentID: authorization\.destinationParentID\(owner: owner\)/);
  assert.match(intent, /parentID: authorization\.destinationParentID\(owner: owner\)/);
  assert.match(writer, /requested\.destinationParentID == authorization\.destinationParentID\(owner: owner\)/);
  assert.match(writer, /parentID: current\.destinationParentID/);
  assert.match(runner, /case \.managedForeground\(let authority\)/);
  assert.match(runner, /managedForeground: authority, ledger: journal/);
  assert.match(transport, /case managedIOSPhoto\(XDriveIOSManagedOriginalAuthority\)/);
  assert.match(transport, /parentID == authority\.destination\.targetNodeID/);
  assert.match(transport, /XDriveIOSManagedPhotoUploadRoutePolicy\.translatedPath\(path\)/);
  assert.match(routes, /XDriveIOSBackgroundUploadRoutePolicy\.translatedPath\(path\)/);
});

test('managed route uses separate device proof, deny-redirects, and actual finalized Node readback', () => {
  assert.match(transport, /request\.setValue\("Bearer " \+ authority\.accessToken/);
  assert.match(transport, /authority\.device\.deviceID/);
  assert.match(transport, /authority\.device\.secret/);
  assert.match(transport, /completionHandler\(nil\)/);
  assert.match(auth, /parts\.path = "\/api\/v1\/ios\/photos\/managed\/receipts\/nodes\\\(receipt\.nodeID\)"/);
  assert.match(auth, /node\.parent_id == parentID/);
  assert.match(auth, /node\.sha256\.lowercased\(\) == receipt\.sha256/);
  assert.match(auth, /node\.revision == receipt\.revision/);
  assert.match(auth, /node\.size == receipt\.bytes/);
  assert.match(auth, /XDriveIOSBackgroundOriginalNamePolicy\.valid\(expectedName\)/);
  assert.match(auth, /case \.background\(let grant\)/);
  assert.match(auth, /case \.webBearer\(let token\)/);
});

test('backup actions disable when no matching confirmed input and never silently choose old name', () => {
  assert.match(model, /var confirmedForCurrentName: Bool/);
  assert.match(model, /stored\.name == name/);
  assert.match(screen, /!destination\.confirmedForCurrentName/);
  assert.match(screen, /destination\.confirmedForCurrentName,/);
  assert.match(screen, /文件夹名已修改，请重新保存后再备份/);
});
