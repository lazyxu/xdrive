'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const upload = read('internal/api/ios_photo_managed_uploads.go');
const bridge = read('internal/api/managed_upload_authority_bridge.go');
const routes = read('internal/api/router.go');
const engine = read('internal/api/uploads.go');
const grant = read('internal/api/ios_photo_background_uploads.go');

test('managed iPhone originals have a dedicated Owner-and-device upload route', () => {
  for (const [method, route, handler] of [
    ['POST','/ios/photos/managed/uploads','iosPhotoManagedCreateUpload'],
    ['GET','/ios/photos/managed/uploads/:id','iosPhotoManagedGetUpload'],
    ['PUT','/ios/photos/managed/uploads/:id/chunks/:index','iosPhotoManagedPutChunk'],
    ['POST','/ios/photos/managed/uploads/:id/finalize','iosPhotoManagedFinalize'],
    ['POST','/ios/photos/managed/uploads/resume-lookup','iosPhotoManagedResumeLookup'],
    ['GET','/ios/photos/managed/receipts/nodes/:id','iosPhotoManagedReceipt'],
  ]) assert.ok(routes.includes('authed.' + method + '("' + route + '", s.' + handler + ')'),
    'missing dedicated original route ' + route);
  assert.match(upload, /ownerID = owner\.ID/);
  assert.match(upload, /iosPhotoDestinationDeviceTx\(c, tx, ownerID\)/);
  assert.match(upload, /iosPhotoDestinationBindingTx\(tx, device\)/);
  assert.match(upload, /clientDeviceIdentityCredentialMatches\(device, c\.GetHeader\("X-XDrive-Device-Token"\)\)/);
  assert.match(upload, /device\.Platform != "ios"/);
  assert.doesNotMatch(upload, /clientDeviceCredentialMatches\(/);
});

test('generic SourceRun, ordinary Owner and Desktop lp2_ cannot impersonate managed iPhone original', () => {
  assert.match(bridge, /currentIOSPhotoManagedUploadScope\(c\)/);
  assert.match(bridge, /requireIOSPhotoManagedUploadTx\(/);
  assert.match(bridge, /requireIOSPhotoManagedFinalizeTx\(/);
  assert.match(upload, /source\.TargetManaged/);
  assert.match(upload, /meta\.SourceKindIOSPhotos/);
  assert.match(upload, /scope\.targetID/);
  assert.match(upload, /scope\.sourceID/);
  assert.match(upload, /source\.Status|iosPhotoDestinationSource\(source\)/);
  assert.match(upload, /validIOSUploadResumeLookupKey/);
  assert.match(upload, /iosBackgroundOriginalNameValid/);
  assert.match(upload, /req\.ConflictPolicy == meta\.UploadConflictPolicyFail/);
  assert.match(upload, /req\.NodeID == nil/);
  assert.match(upload, /managedSourceTargetAncestorIDsTx/);
  assert.match(upload, /validIOSPhotoManagedUploadInit\(req, scope\)/);
  assert.match(upload, /COALESCE\(source_run_id, ''\) = ''/);
});

test('exact iOS managed context is rechecked at commit, not only at HTTP entry', () => {
  assert.match(engine, /requireSourceRunOrLocalPushTargetTx\(c\.Request\.Context\(\), tx, c,/);
  assert.match(engine, /requireSourceRunOrLocalPushFinalizeTx\(c\.Request\.Context\(\), tx, c,/);
  assert.match(upload, /Clauses\(clause\.Locking/);
  assert.match(upload, /device\.RevokedAt|revoked_at IS NULL/);
  assert.match(upload, /session\.ShareID != nil/);
  assert.match(upload, /session\.SourceRunID != ""/);
  assert.match(upload, /session\.Status != meta\.UploadStatusActive/);
  assert.match(upload, /session\.Name != session\.RequestedName/);
  assert.match(upload, /session\.ParentID == nil/);
  assert.match(upload, /http\.MaxBytesReader/);
  assert.match(upload, /lookupIOSUploadResumeKey\(c\)/);
  assert.match(upload, /meta\.UploadStatusFinalized/);
  assert.match(engine, /!scopedRun && !managedIOSPhoto/);
  assert.doesNotMatch(upload, /newUploadEngine|UploadSessionBypass|writePhysicalFile/);
});

test('legacy BG grant still has separate scoped route; no generic grant elevation', () => {
  assert.match(grant, /iosBackgroundAuthorizedOwner/);
  assert.match(routes, /iosPhotoBackground\.Use\(s\.requireIOSPhotoBackgroundGrant\(\)\)/);
  assert.doesNotMatch(upload, /requireIOSPhotoBackgroundGrant/);
});
