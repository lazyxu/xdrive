import type {
  XDriveLocalBackupCommonBatch, XDriveLocalBackupCommonBatchHistoryItem,
  XDriveLocalBackupCommonBatchHistoryPage,
} from './device-backups'

const validStates = ['running', 'partial', 'uncertain', 'paused', 'cancelled']

/** The DSM Source card is mounted only while expanded. A scheduled run can
 * start while its previous, trusted checkpoint is idle, so idle status also
 * needs bounded foreground polling. Failure backs off; no hidden-tab reads. */
export function xDriveDSMBackupStatusPollDelay(running: boolean, failed: boolean): number {
  if (failed) return 60_000
  return running ? 10_000 : 30_000
}
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export interface XDriveDSMBackupScheduleView {
  enabled: boolean
  title: string
  detail: string
  sourceRevision: number
}

/** Owner-scoped DSM schedule *configuration*, not proof that a timer ran.
 * The Agent has not exposed its private verified checkpoint or cooldown as a
 * browser-readable next-run timestamp. Never infer "armed" or a next due time
 * from the mere existence of this saved Server configuration. */
export function xDriveDSMBackupScheduleView(
  sourceID: number, input: unknown,
): XDriveDSMBackupScheduleView {
  if (!Number.isSafeInteger(sourceID) || sourceID <= 0 ||
    !input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Untrusted DSM backup schedule')
  }
  const s = input as Record<string, unknown>
  if (s.source_id !== sourceID || !Number.isSafeInteger(s.revision) ||
    (s.revision as number) <= 0 ||
    !['', 'manual', 'interval', 'cron'].includes(String(s.schedule_type)) ||
    typeof s.schedule_expression !== 'string' ||
    typeof s.schedule_timezone !== 'string' ||
    s.schedule_expression.length > 256 || s.schedule_timezone.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(s.schedule_expression + s.schedule_timezone)) {
    throw new Error('Untrusted DSM backup schedule')
  }
  const kind = s.schedule_type
  const expression = s.schedule_expression
  const timezone = s.schedule_timezone
  if (((kind === '' || kind === 'manual') && (expression !== '' || timezone !== '')) ||
    (kind === 'interval' && (!expression || timezone !== '')) ||
    (kind === 'cron' && (!expression || !timezone ||
      expression.trim().split(/\s+/).length !== 5))) {
    throw new Error('Untrusted DSM backup schedule')
  }
  const sourceRevision = s.revision as number
  if (kind === 'manual') return {
    enabled: false, title: '仅手动备份 · 自动计划已关闭',
    detail: 'Agent 不会按时间自动执行；可以使用“手动增量备份”。',
    sourceRevision,
  }
  if (kind === '') return {
    enabled: false, title: '尚未明确开启自动备份',
    detail: '请在“配置本机同步计划”中保存间隔或 Cron。历史默认值不代表已开启。',
    sourceRevision,
  }
  return {
    enabled: true,
    title: kind === 'interval'
      ? '自动计划已保存 · 每 ' + expression
      : '自动计划已保存 · Cron ' + expression + '（' + timezone + '）',
    detail: '计划已保存不等于已开始执行。当前版本需先完成可信的手动备份；' +
      'Owner、Root、Agent、未确认收据和冷却状态均由 Agent 再核对。',
    sourceRevision,
  }
}

/** Reject forged, stale or completion-claiming DSM Agent status at the UI boundary. */
export function xDriveValidateSynologyLocalBatch(
  sourceID: number, input: unknown,
): XDriveLocalBackupCommonBatch {
  if (!count(sourceID) || sourceID === 0 || !input || typeof input !== 'object') {
    throw new Error('Invalid owner-scoped DSM batch')
  }
  const s = input as Partial<XDriveLocalBackupCommonBatch>
  if (s.source_id !== sourceID || !count(s.revision) ||
    !validStates.includes(s.state ?? '') ||
    typeof s.running !== 'boolean' || s.running !== (s.state === 'running') ||
    (!s.running && s.revision === 0) ||
    s.backup_complete !== false || s.retirement_safe !== false ||
    s.current_cas_verified !== false ||
    !count(s.inspected_files) || !count(s.confirmed_files) ||
    !count(s.skipped_files) || !count(s.unsupported_files) ||
    !count(s.uncertain_files) || !count(s.confirmed_bytes) ||
    (s.confirmed_files as number) > (s.inspected_files as number) ||
    (s.skipped_files as number) > (s.inspected_files as number) - (s.confirmed_files as number) ||
    (s.unsupported_files as number) > (s.inspected_files as number) -
      (s.confirmed_files as number) - (s.skipped_files as number) ||
    (s.stop_requested !== undefined && (!s.running ||
      (s.stop_requested !== 'pause' && s.stop_requested !== 'cancel')))) {
    throw new Error('Untrusted DSM local backup status')
  }
  return s as XDriveLocalBackupCommonBatch
}

/** A bounded owning-Agent receipt history; it is not current Server/CAS proof. */
export function xDriveValidateSynologyLocalHistoryPage(
  sourceID: number, input: unknown,
): XDriveLocalBackupCommonBatchHistoryPage {
  if (!count(sourceID) || sourceID === 0 || !input ||
    typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid owner-scoped DSM local history')
  }
  const page = input as Partial<XDriveLocalBackupCommonBatchHistoryPage>
  if (page.source_id !== sourceID || !Array.isArray(page.items) || page.items.length > 20) {
    throw new Error('Untrusted DSM local history page')
  }
  const seen = new Set<string>()
  for (const raw of page.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Untrusted DSM local history entry')
    }
    const item = raw as Partial<XDriveLocalBackupCommonBatchHistoryItem>
    if (item.source_id !== sourceID ||
      typeof item.run_id !== 'string' || !item.run_id || item.run_id.length > 256 ||
      seen.has(item.run_id) || !count(item.revision) || item.revision === 0 ||
      !['partial', 'uncertain', 'paused', 'cancelled'].includes(item.state ?? '') ||
      ![item.inspected_files, item.confirmed_files, item.skipped_files,
        item.unsupported_files, item.uncertain_files, item.confirmed_bytes].every(count) ||
      (item.confirmed_files as number) + (item.skipped_files as number) >
        (item.inspected_files as number) ||
      !Number.isFinite(Date.parse(item.finished_at ?? ''))) {
      throw new Error('Untrusted DSM local history entry')
    }
    seen.add(item.run_id)
  }
  return page as XDriveLocalBackupCommonBatchHistoryPage
}
