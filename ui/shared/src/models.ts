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
  reserved_bytes: number
  available_bytes: number
  disk_total_bytes?: number
  disk_available_bytes?: number
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

export interface UploadStagingStats {
  supported: boolean
  active_sessions: number
  reserved_bytes: number
  part_files: number
  part_bytes: number
  staging_files: number
  staging_bytes: number
  orphan_files: number
  orphan_bytes: number
  recent_untracked_files: number
  recent_untracked_bytes: number
  missing_part_files: number
  missing_part_bytes: number
  expired_sessions: number
  expired_staging_files: number
  expired_staging_bytes: number
  reclaimable_files: number
  reclaimable_bytes: number
  orphan_grace_seconds: number
  generated_at: string
}

export interface UploadStagingFile {
  key: string
  size: number
  modified_at: string
}

export interface UploadStagingDetail {
  stats: UploadStagingStats
  orphans: UploadStagingFile[]
  has_more: boolean
  next_cursor?: string
}

export interface UploadStagingCleanup {
  run_id: number
  deleted_files: number
  deleted_bytes: number
  failed_files: number
  stats: UploadStagingStats
}

export interface StagingCleanupRun {
  id: number
  trigger: 'manual' | 'janitor' | string
  status: 'success' | 'partial' | 'failed' | string
  deleted_files: number
  deleted_bytes: number
  failed_files: number
  error?: string
  started_at: string
  finished_at?: string
}

export interface StagingCleanupFailure {
  id: number
  storage_key: string
  size: number
  error: string
  failed_at: string
}

export interface StorageStats {
  scope: 'self' | 'global'
  disk_total_bytes?: number
  disk_used_bytes?: number
  disk_available_bytes?: number
  xdrive_physical_bytes?: number
  upload_staging?: UploadStagingStats
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
  reserved_bytes: number
  available_bytes: number
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


export interface BuildInfo {
  version: string
  channel?: string
  commit?: string
  commit_message?: string
  commit_time?: string
  build_time?: string
}


export type MediaKind = 'image' | 'video'

export interface MediaMetadata {
  media_kind: MediaKind
  mime_type?: string
  container_kind?: string
  live_photo_asset_identifier?: string
  width?: number
  height?: number
  orientation?: number
  rotation_degrees?: number
  duration_ms?: number
  frame_rate?: number
  bit_rate?: number
  video_codec?: string
  audio_codec?: string
  captured_at?: string
  latitude?: number
  longitude?: number
  altitude_m?: number
  camera_make?: string
  camera_model?: string
  lens_model?: string
  exif?: Record<string, unknown>
  video?: Record<string, unknown>
  index_state: 'ready' | 'unsupported' | 'error' | string
  index_error?: string
  has_thumbnail: boolean
  thumbnail_mime_type?: string
  thumbnail_width?: number
  thumbnail_height?: number
}

export interface MediaDerivedResource {
  role: string
  name: string
  media_kind: MediaKind
  mime_type: string
  size: number
}

export type PhotoAssetKind =
  | 'image'
  | 'video'
  | 'live_photo'
  | 'raw_pair'
  | 'sidecar'
  | 'burst'
  | string

export interface MediaResource {
  kind: 'node' | 'derived' | string
  node_id: number
  role: string
  name: string
  media_kind: MediaKind | 'other' | string
  mime_type?: string
  size: number
}

export interface MediaItem {
  node: Node
  metadata: MediaMetadata
  asset_kind?: PhotoAssetKind
  favorite?: boolean
  tags?: string[]
  people?: string[]
  description?: string
  resources?: MediaResource[]
  derived_resources?: MediaDerivedResource[]
  live_photo?: boolean
}

export interface MediaAlbum {
  id: string
  kind: 'folder' | 'imported' | 'manual' | 'smart' | string
  name: string
  revision?: number
  item_count: number
  cover_node_id?: number
  updated_at?: string
  query?: MediaGalleryQuery
}

export interface MediaGalleryQuery {
  search?: string
  asset_kind?: PhotoAssetKind
  captured_from?: string
  captured_to?: string
  has_location?: boolean
  favorite?: boolean
  tag?: string
  person?: string
  place?: string
}

export interface MediaPlaceFacet {
  id: string
  name: string
  latitude: number
  longitude: number
  item_count: number
  cover_node_id?: number
  updated_at?: string
  attribution?: string
  attribution_url?: string
}

export interface MediaSuggestedPerson {
  id: string
  face_count: number
  item_count: number
  cover_node_id?: number
  updated_at?: string
}

export interface MediaPersonIdentity {
  id: string
  name: string
  hidden: boolean
  revision: number
  item_count: number
  cover_node_id?: number
  updated_at?: string
}

export interface MediaPersonSplit {
  source: MediaPersonIdentity
  created: MediaPersonIdentity
}

export interface UpdateMediaPersonIdentityInput {
  name?: string
  hidden?: boolean
  cover_node_id?: number
}
