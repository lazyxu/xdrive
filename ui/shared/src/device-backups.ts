// This is a strict API allowlist for *viewing* a remote device's Push,
// never the unrestricted Source/SourceItem/SyncRun contract.
export interface XDriveDeviceBackupRun {
  id: string
  source_id: number
  run_number: number
  mode: string
  trigger: string
  status: string
  scanned_items: number
  scanned_bytes: number
  ignored_items: number
  new_items: number
  changed_items: number
  moved_items: number
  unchanged_items: number
  planned_transfer_bytes: number
  transferred_items: number
  transferred_bytes: number
  failed_items: number
  active_transfer_bytes: number
  active_transfer_total_bytes: number
  cancel_requested_at?: string
  started_at: string
  finished_at?: string
}
export interface XDriveDeviceBackupFolder {
  source_id: number
  name: string
  target_path?: string
  sync_mode: 'backup' | 'mirror'
  status: string
  latest_run?: XDriveDeviceBackupRun
}
export interface XDriveDeviceBackupDevice {
  id: string
  name: string
  platform: string
  client_version?: string
  last_seen_at?: string
  connection_state: 'unknown' | 'online' | 'offline'
  revoked: boolean
  folders: XDriveDeviceBackupFolder[]
}
export interface XDriveDeviceBackupOverview {
  devices: XDriveDeviceBackupDevice[]
  has_more: boolean
  has_more_folders: boolean
}
export interface XDriveDeviceBackupRunPage {
  items: XDriveDeviceBackupRun[]
  has_more: boolean
}
export interface XDriveDeviceBackupDataSource {
  // Optional Desktop-only verified installation identity. No Root authority.
  verifiedLocalDevice?(): Promise<string | null>
  list(): Promise<XDriveDeviceBackupOverview>
  runs(sourceID: number, limit: number, offset: number): Promise<XDriveDeviceBackupRunPage>
}

// Separate private Agent-only draft projection. This is never returned by
// the Web B-scope device/folder read API or by generic Source listing.
export interface XDriveLocalSourceDraft {
  source_id: number
  name: string
  revision: number
  created_at: string
}
export interface XDriveLocalSourceDraftPage {
  items: XDriveLocalSourceDraft[]
  has_more: boolean
  next_after_id: number
}

// Owning-Desktop-only minimal config, separate from the foreign-device DTO.
export interface XDriveLocalBoundBackupSettings {
  source_id: number
  name: string
  revision: number
  sync_mode: 'backup' | 'mirror'
  target_node_id?: number
  target_path?: string
}


// Owning-Desktop-only sensitive rules; NEVER serialize this in Web / foreign B-scope.
export interface XDriveLocalBoundBackupRules {
  source_id: number
  revision: number
  ignore_rules: string
}

// Owning-Desktop-only saved schedule. No execution/online-state claim.
export interface XDriveLocalBoundBackupSchedule {
  source_id: number
  revision: number
  schedule_type: '' | 'manual' | 'interval' | 'cron'
  schedule_expression: string
  schedule_timezone: string
}

// Desktop owning-Agent-only completed local metadata summary.
export interface XDriveLocalBackupPreview {
  source_id: number
  revision: number
  scanned_files: number
  scanned_directories: number
  scanned_bytes: number
  ignored_items: number
  ignored_bytes: number
  skipped_unsafe_items: number
  complete: boolean
  missing_inference_safe: false
}

// An owning Desktop can explicitly persist a LOCAL-only, verified inventory.
// It is not a completed backup, deletion/missing inference, or cloud checkpoint.
export interface XDriveLocalBackupSnapshot {
  source_id: number
  revision: number
  scanned_files: number
  scanned_directories: number
  scanned_bytes: number
  ignored_items: number
  ignored_bytes: number
  skipped_unsafe_items: number
  has_verified_previous: boolean
  saved: true
  complete: true
  missing_inference_safe: false
}

// Verified LOCAL two-generation comparison, advisory numeric counts only.
// No item path, device secrets, SourceItem identity, or deletion authority.
export interface XDriveLocalBackupDelta {
  source_id: number
  revision: number
  previous_items: number
  current_items: number
  added: number
  changed: number
  metadata_stable: number
  absent_candidates: number
  complete: true
  authoritative: false
  missing_inference_safe: false
}

// Owning Desktop request for SERVER-PERSISTED ADVISORY candidates only.
// Existing SourceItem/Node/CAS and Mirror state are never changed here.
export interface XDriveLocalBackupEvidence {
  source_id: number
  revision: number
  hints: number
  matched: number
  unmatched: number
  stored: number
  replayed: number
  complete: true
  authoritative: false
  missing_inference_safe: false
}


// A read-only owning-Desktop COUNT for the current verified local generation.
// No individual file paths, SourceItem IDs or Root identity reach Renderer.
export interface XDriveLocalBackupEvidenceSummary {
  source_id: number
  revision: number
  staged_records: number
  authoritative: false
  missing_inference_safe: false
}

// Owning-Agent only. Never expose local Root identity or path.
export interface XDriveLocalBoundBackupRemoval {
  source_id: number
  local_grant_removed: boolean
}
