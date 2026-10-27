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
export type XDriveServerBackupHistoryEntry = XDriveServerBackupOperation & {
  mode?: 'fast' | 'deep'
  verification?: XDriveServerBackupVerificationReceipt
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
}

export type XDriveServerBackupRequest =
  | { action: 'create'; format: 'v1' | 'v2' }
  | { action: 'verify'; snapshot_id: string; mode: 'fast' | 'deep' }
  | { action: 'plan'; keep_last: number; mode: 'fast' | 'deep' }
  | { action: 'restore'; snapshot_id: string; confirmation: string }
  | { action: 'delete'; snapshot_id: string; confirmation: string }
  | { action: 'prune'; keep_last: number; confirmation: string }
  | { action: 'policy'; format: 'v1' | 'v2'; retention_days: number; revision: string }

export type XDriveServerBackupPort = {
  read(): Promise<XDriveServerBackupPage>
  submit(request: XDriveServerBackupRequest): Promise<XDriveServerBackupOperation>
}
