#!/usr/bin/env node
// DSM read-only historical SQL receipt review. The shared dialog already
// renders this observer; DSM adds only a scoped Host/CGI projection, no writer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const base = new URL('../../', import.meta.url)
const read = path => fs.readFileSync(new URL(path, base), 'utf8')
const helperSource = stripTypeScriptTypes(
  read('ui/shared/src/synology-recovery-review.ts'), { mode: 'strip' })
const { xDriveValidateSynologyRecoveryReview: validate } =
  await import('data:text/javascript,' + encodeURIComponent(helperSource))
const epoch = 'a'.repeat(64)
const fixture = {
  source_id: 42, revision: 3, run_state: 'partial',
  reviewed_files: 16, ignored_files: 0, unsupported_files: 0,
  unrecorded_files: 0, historical_committed_files: 16,
  current_node_metadata_match_files: 16, current_node_metadata_mismatch_files: 0,
  pending_original_files: 0, next_after_file: 16,
  page_epoch: epoch, has_more: true, authoritative: false,
}
assert.deepEqual(validate(fixture, 42, 0, ''), fixture)
const final = {
  ...fixture, reviewed_files: 2, historical_committed_files: 1,
  current_node_metadata_match_files: 1, pending_original_files: 1,
  has_more: false, next_after_file: 0,
}
assert.deepEqual(validate(final, 42, 16, epoch), final)
for (const bad of [
  { ...fixture, source_id: 43 },
  { ...fixture, revision: 9007199254740992 },
  { ...fixture, run_state: 'running' },
  { ...fixture, authoritative: true },
  { ...fixture, backup_complete: true },
  { ...fixture, cas_verified: true },
  { ...fixture, path: '/volume1/photos' },
  { ...fixture, root_id: 'SECRET' },
  { ...fixture, operation_id: 'SECRET' },
  { ...fixture, reviewed_files: 17 },
  { ...fixture, pending_original_files: 1 },
  { ...fixture, current_node_metadata_mismatch_files: 1 },
  { ...fixture, page_epoch: 'A'.repeat(64) },
  { ...fixture, next_after_file: 15 },
  { ...fixture, has_more: false },
]) assert.throws(() => validate(bad, 42, 0, ''), /Unsafe|Inconsistent/)
assert.throws(() => validate(fixture, 42, 16, 'b'.repeat(64)), /Unsafe/)
assert.throws(() => validate(fixture, 42, 0, epoch), /Invalid/)
assert.throws(() => validate(fixture, 42, -1, ''), /Invalid/)
assert.throws(() => validate(fixture, 42, 1_000_001, epoch), /Invalid/)

const cgi = read('internal/synologyui/cgi.go')
const gateway = read('internal/synologyui/gateway.go')
const native = read('internal/localbackupipc/recovery_review.go')
const bridge = read('internal/synologyui/recovery_review.go')
const adapter = read('ui/shared/src/synology-backup-adapter.ts')
const dialog = read('ui/shared/src/mui/DeviceBackupLocalCommonBatchDialog.tsx')
const panel = read('ui/shared/src/mui/SynologyBackupLocalPanel.tsx')
const workflow = read('.github/workflows/synology-ui.yml')
assert.match(cgi, /"recovery-review"/)
assert.match(gateway, /serveDSMRecoveryReview\(w, r, ctx, agent\)/)
assert.match(gateway, /r\.URL\.Path == "\/v1\/recovery-review"/)
assert.match(bridge, /parseDSMRecoveryReview\(r\)/)
assert.match(bridge, /reader\.RecoveryReview\(ctx, sourceID, after, epoch\)/)
assert.match(bridge, /localbackupipc\.ValidateRecoveryReviewPage\(page, sourceID, after, epoch\)/)
assert.match(native, /device-backup-local-common-recovery-review/)
assert.match(native, /"\/v1\/device-backups\/local-common-batch\/recovery-review\?"/)
assert.match(adapter, /'\/v1\/recovery-review' \+ selector, 'GET', undefined, controller\.signal/)
assert.match(adapter, /xDriveValidateSynologyRecoveryReview\(page, sourceID, afterFile, pageEpoch\)/)
assert.match(adapter, /recoveryReads\.get\(requestID\)\?\.abort\(\)/)
assert.match(dialog, /actions\.review\(sourceID, after, pageEpoch, requestID\)/)
assert.match(dialog, /safeRecoveryReviewPage\(next, sourceID, after, pageEpoch\)/)
assert.match(dialog, /仅核对当前 Owner 的持久原始 SQL 回执/)
assert.match(panel, /<XDriveDeviceBackupLocalCommonBatchDialog/)
assert.match(workflow, /node web\/scripts\/test-synology-recovery-review\.mjs/)
assert.doesNotMatch(bridge + native + helperSource, /CreateLocalBackupSource|AuthorizeLocalRoot|Start\(|Control\(|exec\.Command|localStorage\.setItem/)
console.log('DSM historical SQL review: strict 16-file page/Owner epoch and no new CAS/Source writer')
