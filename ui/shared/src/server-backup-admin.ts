/** Keep the administrator's history terms distinct from recovery evidence.
 * A DB-only restore must never be labeled as a complete restore. */
export const xDriveServerBackupActionLabel = (action: string): string => {
  const labels: Record<string, string> = {
    create: '创建服务器备份',
    verify: '校验单个备份',
    verify_all: '批量校验备份',
    preview_delete: '预览删除影响',
    plan: '查看保留计划',
    restore: '恢复数据库和文件',
    restore_database_only: '仅恢复数据库（保留文件）',
    drill: '隔离恢复演练',
    delete: '删除 v1 备份',
    delete_selected: '删除指定 v2 备份',
    prune: '手动清理旧代',
    policy: '修改定时备份策略',
  }
  return labels[action] || '未知备份操作'
}

/** Administrator-only Host-owned Server backup repository view.
 * Distinct from owning-device Push backups and online Storage CAS checks. */
export type XDriveServerBackupSnapshot = {
  id: string
  name: string
  format: 'v1' | 'v2'
  created_at: string
  state: 'complete' | 'incomplete' | 'inconsistent'
  bytes: number
  file_data_included: boolean
}

export type XDriveServerBackupPolicy = {
  schedule_format: 'v1' | 'v2'
  retention_days: number
  repository: string
  revision: string
}

export type XDriveServerBackupRetention = {
  mode: 'read_only'
  validation: string
  keep_last: number
  keep_snapshots: string[]
  drop_candidates: string[]
  retained_objects: number
  drop_only_objects: number
  unreferenced_objects: number
  /** Older Host releases omit these. Treat missing or unsafe JS numbers as unavailable. */
  committed_snapshots?: number
  drop_snapshot_bytes?: number
  drop_only_object_bytes?: number
  unreferenced_bytes?: number
  potential_logical_bytes: number
  hashed_objects: number
  hashed_bytes: number
  delete_enabled: false
}

export type XDriveServerBackupOperation = {
  protocol: string
  state: 'unavailable' | 'idle' | 'queued' | 'running' | 'success' | 'failed'
  request_id?: string
  action?: string
  snapshot_id?: string
  started_at?: string
  updated_at?: string
  finished_at?: string
  error_code?: string
  message?: string
  stage?: string
  bytes_done?: number
  bytes_total?: number
}

export type XDriveServerBackupVerificationReceipt = {
  protocol: 'xdrive-host-backup-verify-v1'
  state: 'success' | 'failed'
  format: 'v1' | 'v2'
  scope: 'backup_snapshot_and_referenced_cas'
  cas_objects_checked: number
  cas_bytes_hashed: number
  failure_category?: string
}
export type XDriveServerBackupDrillReceipt = {
  protocol: 'xdrive-host-isolated-drill-v1'
  state: 'success' | 'failed'
  environment: 'host_ephemeral_offline_tmpfs'
  snapshot: string
  started_at: string
  finished_at: string
  files_restored: boolean
  postgresql_restored: boolean
  production_verified: false
  max_mib: number
  failure_category: string
}

export type XDriveServerBackupSelectedDeleteReceipt = {
  mode: 'manual_selected'
  keep_last: number
  retired_snapshots: string[]
  recovered_transactions: number
  deleted_cas_objects: number
  deleted_cas_logical_bytes: number
  deleted_snapshot_files: number
  deleted_snapshot_file_bytes: number
  verification: 'exclusive_lock_and_full_cas_sha256'
  automatic: false
}

export type XDriveServerBackupHistoryEntry = XDriveServerBackupOperation & {
  mode?: 'fast' | 'deep'
  verification?: XDriveServerBackupVerificationReceipt
  drill?: XDriveServerBackupDrillReceipt
  selected_delete?: XDriveServerBackupSelectedDeleteReceipt
}

export type XDriveServerBackupVerifyAllReport = {
  protocol: 'xdrive-host-verify-all-v1'
  request_id: string
  mode: 'fast' | 'deep'
  state: 'success' | 'failed'
  started_at: string
  finished_at: string
  total_snapshots: number
  checked_snapshots: number
  passed_snapshots: number
  failed_snapshots: number
  unverified_snapshots: number
  deep_repositories_checked: number
  deep_repositories_failed: number
  failure_sample: { snapshot_id: string; category: string }[]
  failure_sample_truncated: boolean
  failure_category: string
}

export type XDriveServerBackupSelectedPreview = {
  protocol: "xdrive-host-selected-v2-preview-v1"
  request_id: string
  snapshot_id: string
  mode: "fast" | "deep"
  report: {
    protocol: "xdrive-backup-selected-prune-plan-v1"
    mode: "read_only"
    validation: string
    snapshot: string
    committed_snapshots: number
    surviving_snapshots: number
    selected_snapshot_bytes: number
    selected_cas_objects: number
    shared_cas_objects: number
    exclusive_cas_objects: number
    exclusive_cas_bytes: number
    unreferenced_objects: number
    unreferenced_bytes: number
    potential_logical_bytes: number
    hashed_objects: number
    hashed_bytes: number
    delete_enabled: false
  }
}

export type XDriveServerBackupPage = {
  supported: boolean
  message?: string
  inventory: {
    protocol: string
    generated_at: string
    policy: XDriveServerBackupPolicy
    snapshots: XDriveServerBackupSnapshot[]
  }
  operation: XDriveServerBackupOperation
  retention?: XDriveServerBackupRetention
  history?: XDriveServerBackupHistoryEntry[]
  bulk_verification?: XDriveServerBackupVerifyAllReport
  selected_preview?: XDriveServerBackupSelectedPreview
}

export type XDriveServerBackupRequest =
  | { action: 'create'; format: 'v1' | 'v2' }
  | { action: 'verify'; snapshot_id: string; mode: 'fast' | 'deep' }
  | { action: 'verify_all'; mode: 'fast' | 'deep' }
  | { action: 'preview_delete'; snapshot_id: string; mode: 'fast' | 'deep' }
  | { action: 'plan'; keep_last: number; mode: 'fast' | 'deep' }
  | { action: 'restore'; snapshot_id: string; confirmation: string }
  | { action: 'restore_database_only'; snapshot_id: string; confirmation: string }
  | { action: 'drill'; snapshot_id: string; confirmation: string }
  | { action: 'delete'; snapshot_id: string; confirmation: string }
  | { action: 'delete_selected'; snapshot_id: string; confirmation: string; preview_request_id: string }
  | { action: 'prune'; keep_last: number; confirmation: string }
  | { action: 'policy'; format: 'v1' | 'v2'; retention_days: number; revision: string }

export type XDriveServerBackupPort = {
  read(): Promise<XDriveServerBackupPage>
  submit(request: XDriveServerBackupRequest): Promise<XDriveServerBackupOperation>
}
