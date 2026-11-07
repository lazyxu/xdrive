'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const server = read('internal/api/ios_photo_backup_destination.go');
const router = read('internal/api/router.go');
const model = read('internal/meta/external_sources.go');
const managed = read('internal/api/local_push_managed_provision.go');
const pullManaged = read('internal/api/source_managed_provision.go');
const source = read('internal/api/sources.go');
const policy = read('ios/XDriveIOS/NativePhotoBackupDestinationNamePolicy.swift');

test('iOS destination is a dedicated Owner+Device-scoped Server Source, never a fake local_folder Agent', () => {
  assert.match(model, /SourceKindIOSPhotos\s*=\s*"ios_photos"/);
  assert.match(router, /authed\.GET\("\/ios\/photos\/backup-destination", s\.getIOSPhotoBackupDestination\)/);
  assert.match(router, /authed\.PUT\("\/ios\/photos\/backup-destination", s\.putIOSPhotoBackupDestination\)/);
  assert.match(server, /device\.Platform != "ios"/);
  assert.match(server, /clientDeviceIdentityCredentialMatches\(device, c\.GetHeader\("X-XDrive-Device-Token"\)\)/);
  assert.doesNotMatch(server, /clientDeviceCredentialMatches\(/);
  assert.match(server, /Kind: meta\.SourceKindIOSPhotos/);
  assert.match(server, /Status: meta\.SourceStatusPaused/);
  assert.match(server, /TargetManaged = true/);
  assert.match(server, /createLocalPushManagedTargetTx\(/);
  assert.match(source, /if req\.Kind == meta\.SourceKindIOSPhotos \|\| req\.Kind == meta\.SourceKindAndroidPhotos/);
  assert.match(source, /if current\.Kind == meta\.SourceKindIOSPhotos \|\| current\.Kind == meta\.SourceKindAndroidPhotos \{/);
  assert.match(source, /if source\.Kind == meta\.SourceKindIOSPhotos \|\| source\.Kind == meta\.SourceKindAndroidPhotos \{/);
  assert.match(source, /errors\.Is\(err, errAndroidPhotoSourceRunUnauthorized\)/);
});

test('server is sole authority for actual Node/Path and never adopts a user-supplied target id', () => {
  assert.match(server, /managedSourceTargetAncestorIDsTx\(/);
  assert.doesNotMatch(server, /managedPushDeviceFolderName\(device\)/)
  assert.match(server, /createLocalPushManagedTargetTx\(c\.Request\.Context\(\), tx, source, device\)/);
  assert.match(server, /renameManagedSourceTargetTx\(tx, source, name\)/);
  assert.match(server, /"target_node_id": target\.ID/);
  assert.match(server, /"target_path":\s*path/);
  assert.match(server, /"configured":\s*false/);
  assert.match(server, /"suggested_name": suggestedIOSPhotoDestinationName\(device\.Name\)/);
  assert.match(pullManaged, /segments = \[\]string\{yikeTargetRootName, "Push"\}/);
  assert.match(pullManaged, /\[\]string\{yikeTargetRootName,\s*"Pull",\s*connector\}/);
  assert.doesNotMatch(managed, /"设备备份"/);
  assert.doesNotMatch(pullManaged, /"远程拉取"/);
  assert.match(pullManaged, /source\.Kind != meta\.SourceKindLocalFolder && source\.Kind != meta\.SourceKindIOSPhotos/);
  assert.doesNotMatch(server, /TargetNodeID\s+uint64.*json/);
  assert.doesNotMatch(server, /createUploadSession\(|finalizeUploadSession\(/);
});

test('native name is a single bounded folder component, not a client cloud path', () => {
  assert.match(policy, /maximumBytes = 128/);
  assert.match(policy, /trimmingCharacters\(in: \.whitespacesAndNewlines\)/);
  assert.match(policy, /!reserved\.contains\(base\)/);
  assert.match(policy, /static func suggested\(deviceName: String\)/);
  assert.doesNotMatch(policy, /pathComponents|appendingPathComponent|target_node_id/);
});
