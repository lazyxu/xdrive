export type NodeType = 'dir' | 'file'

export interface Node {
  id: number
  parent_id?: number
  name: string
  type: NodeType
  size: number
  revision: number
  sha256?: string
  deleted_at?: string
  created_at: string
  updated_at: string
}

export interface FileVersion {
  id: number
  node_id: number
  revision: number
  size: number
  sha256?: string
  created_at: string
}

export type ShareStatus = 'active' | 'expired' | 'exhausted' | 'revoked'

export interface FileShare {
  id: number
  node_id: number
  has_password: boolean
  expires_at?: string
  max_downloads: number
  download_count: number
  revoked_at?: string
  status: ShareStatus
  created_at: string
  updated_at: string
}

export interface CreatedFileShare extends FileShare {
  token: string
}

export interface PublicShare {
  name: string
  size: number
  requires_password: boolean
  expires_at?: string
  max_downloads: number
  download_count: number
}

export interface MeResult {
  id: number
  username: string
  role: 'user' | 'admin'
  must_change_password: boolean
}

export interface QuotaUsage {
  quota_bytes: number
  physical_used_bytes: number
  logical_file_bytes: number
  trash_bytes: number
  history_bytes: number
  over_quota: boolean
}

export interface StorageSizeBucket {
  key: string
  label: string
  count: number
  bytes: number
}

export interface StorageStats {
  scope: 'self' | 'global'
  cas_blob_count: number
  cas_physical_bytes: number
  cas_logical_referenced_bytes: number
  cas_dedup_saved_bytes: number
  cas_dedup_ratio: number
  cas_savings_ratio: number
  average_blob_size_bytes: number
  p50_blob_size_bytes: number
  p90_blob_size_bytes: number
  p99_blob_size_bytes: number
  legacy_blob_count: number
  legacy_physical_bytes: number
  buckets: StorageSizeBucket[]
  generated_at: string
}

export interface StorageHealth {
  status: 'ok' | 'warning' | 'fail'
  healthy: boolean
  ready_blobs: number
  deleting_blobs: number
  stale_deleting_blobs: number
  missing_metadata: number
  refcount_mismatches: number
  state_mismatches: number
  size_mismatches: number
  key_hash_mismatches: number
  invalid_states: number
  generated_at: string
}

export interface StorageHistoryPoint {
  slot_at: string
  captured_at: string
  cas_blob_count: number
  cas_physical_bytes: number
  cas_logical_referenced_bytes: number
  cas_dedup_ratio: number
  cas_savings_ratio: number
  p50_blob_size_bytes: number
  p90_blob_size_bytes: number
  p99_blob_size_bytes: number
  small_lt64_kib_count_share: number
  small_lt256_kib_count_share: number
  large_ge16_mib_byte_share: number
  buckets: StorageSizeBucket[]
}

export interface StorageDecision {
  priority: 'collecting' | 'small_file_packing' | 'cdc' | 'observe'
  confidence: 'low' | 'medium' | 'high'
  sample_count: number
  span_hours: number
  window_hours: number
  average_small_lt64_kib_count_share: number
  average_small_lt256_kib_count_share: number
  average_large_ge16_mib_byte_share: number
  average_dedup_ratio: number
  reason_codes: string[]
}

export interface StorageHistory {
  samples: StorageHistoryPoint[]
  decision: StorageDecision
  sampling_interval_hours: number
  retention_days: number
}

export interface AdminUser {
  id: number
  username: string
  role: 'user' | 'admin'
  disabled: boolean
  must_change_password: boolean
  quota_bytes: number
  physical_used_bytes: number
  logical_file_bytes: number
  trash_bytes: number
  history_bytes: number
  over_quota: boolean
  last_login_at?: string
  created_at: string
  updated_at: string
}

export interface AuditEvent {
  id: number
  actor_user_id?: number
  actor_username?: string
  actor_role?: string
  action: string
  target_type?: string
  target_id?: string
  target_label?: string
  result: 'success' | 'failure'
  request_id?: string
  ip_address?: string
  metadata?: Record<string, unknown>
  created_at: string
}
