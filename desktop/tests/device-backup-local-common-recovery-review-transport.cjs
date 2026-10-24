const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('owning Desktop pipes bounded redacted original-receipt review without write capabilities', () => {
  const agent = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
  const router = read('cmd', 'xdrive-agent', 'desktop_ipc_device_backup_common_recovery_v2.go')
  const overview = read('cmd', 'xdrive-agent', 'device_backup_local_common_recovery_review_v2.go')
  const client = read('desktop', 'src', 'main', 'agent_client.cts')
  const main = read('desktop', 'src', 'main', 'index.cts')
  const preload = read('desktop', 'src', 'preload', 'index.cts')
  const globals = read('desktop', 'src', 'renderer', 'global.d.ts')
  const app = read('desktop', 'src', 'renderer', 'App.tsx')
  const dialog = read('ui', 'shared', 'src', 'mui', 'DeviceBackupLocalCommonBatchDialog.tsx')
  const shared = read('ui', 'shared', 'src', 'device-backups.ts')
  const web = read('web', 'src', 'App.tsx')

  assert.ok(agent.includes('device-backup-local-common-recovery-review'))
  assert.ok(agent.includes('GET /v1/device-backups/local-common-batch/recovery-review'))
  assert.ok(router.includes('validLocalCommonRecoveryReviewRequest(r)'))
  assert.ok(router.includes('validLocalCommonRecoveryReviewPage(page, sourceID, after, epoch)'))
  assert.ok(overview.includes('ReadVerifiedOriginalFileReceipts('))
  assert.ok(overview.includes('localpush.VerifyRootGrant(grantNow)'))
  assert.ok(client.includes("'GET', `/v1/device-backups/local-common-batch/recovery-review?"))
  assert.ok(client.includes("query.set('page_epoch', pageEpoch)"))
  assert.ok(main.includes("requireAgentCapability(hello, 'device-backup-local-common-recovery-review')"))
  assert.ok(main.includes('const localRecoveryReviewRequests = new Map<string, AbortController>()'))
  assert.ok(main.includes('controller.abort()'))
  assert.ok(main.includes('Number.isSafeInteger(afterFile)'))
  assert.ok(preload.includes('agent:get-device-backup-local-recovery-review'))
  assert.ok(preload.includes('agent:cancel-device-backup-local-recovery-review'))
  assert.ok(globals.includes('getDeviceBackupLocalRecoveryReview:'))
  assert.ok(shared.includes('export interface XDriveLocalBackupRecoveryReview'))
  assert.ok(app.includes("capabilities.includes('device-backup-local-common-recovery-review')"))
  assert.ok(dialog.includes('safeRecoveryReviewPage('))
  assert.ok(dialog.includes('void actions.cancelReview?.(id).catch(() => {})'))
  assert.ok(dialog.includes('历史已提交'))
  assert.ok(dialog.includes('current_node_metadata_match_files'))
  assert.ok(dialog.includes('current_node_metadata_mismatch_files'))
  assert.ok(router.includes('page.HistoricalCommitted != page.CurrentNodeMatch+page.CurrentNodeMismatch'))
  assert.ok(overview.includes('localCommonHistoricalMatchesCurrentNode('))
  assert.ok(overview.includes('localCommonVerifyCloudFileUnchanged('))
  assert.ok(dialog.includes('待确认'))
  assert.ok(dialog.includes('不允许自动重发'))
  assert.ok(!web.includes('getDeviceBackupLocalRecoveryReview'))
  assert.ok(!web.includes('device-backup-local-common-recovery-review'))

  const sharedDTO = shared.slice(shared.indexOf('export interface XDriveLocalBackupRecoveryReview'),
    shared.indexOf('export interface XDriveLocalBackupSnapshot'))
  const agentDTO = client.slice(client.indexOf('export type AgentLocalBackupRecoveryReview'),
    client.indexOf('export type AgentLocalBackupSnapshot'))
  for (const dto of [sharedDTO, agentDTO]) {
    assert.ok(dto.includes('authoritative: false'))
    for (const forbidden of [
      'root_id', 'root_fingerprint', 'session_digest', 'device_token', 'absolute_path',
      'relative_path', 'operation_id', 'resume_key', 'content_sha256', 'node_id',
      'backup_complete', 'retirement_safe', 'current_cas_verified',
    ]) {
      assert.equal(dto.includes(forbidden), false, 'private recovery selector leaked: ' + forbidden)
    }
  }
})

test('read-only review is paged by Agent-issued generation and cancelled when observer leaves', () => {
  const client = read('desktop', 'src', 'main', 'agent_client.cts')
  const main = read('desktop', 'src', 'main', 'index.cts')
  const dialog = read('ui', 'shared', 'src', 'mui', 'DeviceBackupLocalCommonBatchDialog.tsx')
  assert.ok(client.includes("query.set('after_file', String(afterFile))"))
  assert.ok(client.includes("query.set('page_epoch', pageEpoch)"))
  assert.ok(main.includes('!validLocalPreviewID(requestID) || localRecoveryReviewRequests.has(key)'))
  assert.ok(main.includes('const key = `${event.sender.id}:${String(requestID)}`'))
  assert.ok(main.includes('localRecoveryReviewRequests.get(key)?.abort()'))
  assert.ok(dialog.includes('const generation = ++reviewGeneration.current'))
  assert.ok(dialog.includes('const requestID = crypto.randomUUID()'))
  assert.ok(dialog.includes('activeReviewID.current = requestID'))
  assert.ok(dialog.includes('value.next_after_file === after + value.reviewed_files'))
  assert.ok(dialog.includes("const pageEpoch = after > 0 && earlier ? earlier.page_epoch : ''"))
  assert.ok(dialog.includes('actions.review(sourceID, after, pageEpoch, requestID)'))
  assert.ok(dialog.includes('safeRecoveryReviewPage(next, sourceID, after, pageEpoch)'))
  assert.ok(dialog.includes('next.revision !== earlier.revision || next.run_state !== earlier.run_state'))
  assert.ok(dialog.includes('reviewPage?.has_more'))
  assert.ok(dialog.includes('每页最多 16 个文件'))
  assert.ok(!dialog.includes('review(sourceID, 0, \'\', \'\')'))
})
