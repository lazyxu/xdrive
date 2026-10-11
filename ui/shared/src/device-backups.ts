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


// Owning-Agent only. Never expose local Root identity or path.
export interface XDriveLocalBoundBackupRemoval {
  source_id: number
  local_grant_removed: boolean
}
