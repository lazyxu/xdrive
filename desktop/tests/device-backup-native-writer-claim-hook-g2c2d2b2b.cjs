'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// This contract guards the production owning Agent path, not an unused
// prototype helper or a mocked standalone native-writer unit test.
const root = path.resolve(__dirname, '../..');
const agent = fs.readFileSync(path.join(root, 'cmd/xdrive-agent/device_backup_local_first_file_activation.go'), 'utf8');
const native = fs.readFileSync(path.join(root, 'internal/localpushwriter/writer.go'), 'utf8');
const at = (needle) => {
  const index = agent.indexOf(needle);
  assert.ok(index >= 0, 'missing production first-file writer stage: ' + needle);
  return index;
};

const owner = at('func (c *agentController) cloudStartLocalBoundBackupFirstFileOnce(');
const authorize = at('driver.Check(workCtx, driver.scope)');
const scope = at('localpushwriter.NewScope(');
const begin = at('localpushwriter.Begin(workCtx, writerScope)');
const runner = at('(&localpushrunner.Runner{}).RunFirstLeaf(workCtx, driver.scope, driver)');
const close = at('closeErr := writer.Close()');
const positive = at('ObservedFiles: 1, ObservedBytes: digest.Size');
assert.ok(owner < authorize && authorize < scope && scope < begin && begin < runner && runner < close && close < positive,
  'native persistent O_EXCL writer claim must enclose the actual authenticated HTTP/CAS/SQL/native Runner');
for (const bound of ['grant.Path', 'account.Server', 'account.Username', 'account.SessionID',
  'proof.DeviceID', 'proof.RootID', 'proof.RootFingerprint', 'sourceID', 'source.Revision',
  '*source.TargetNodeID', 'digest.NativeIdentityKey', 'digest.SHA256']) {
  assert.ok(agent.slice(scope, begin).includes(bound), 'writer claim missing private immutable binding: ' + bound);
}
assert.match(agent.slice(begin, positive), /defer writer\.Close\(\)/,
  'all unwind paths must release the native kernel handle');
assert.match(agent.slice(close, positive), /closeErr != nil/,
  'release errors must not be reported as success');
assert.match(native, /os\.O_CREATE\|os\.O_EXCL/, 'claim must persist across process exits');
assert.doesNotMatch(native.slice(native.indexOf('func (c *Claim) Close()')), /os\.Remove/,
  'kernel lock release must not erase immutable writer quarantine');
assert.match(agent, /BackupComplete: false, RetirementSafe: false/,
  'first-file observation is not a completed or repeatable backup');
const heldWindow = fs.readFileSync(path.join(root, 'internal/localpush/native_file_held_window.go'), 'utf8');
assert.match(heldWindow, /already-enabled owning Windows\/Linux Desktop manual/,
  'physical native commit window must preserve approved first-file early activation');
assert.doesNotMatch(heldWindow, /Keep ALL product entrypoints disabled|installed-device acceptance/,
  'unreachable production-only safety acceptance must not re-disable the first file');
console.log('owning first-file native writer claim hook: production contract passed');
