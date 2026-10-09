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

export type StorageCacheCleanupKind =
  | 'media_thumbnail'
  | 'video_poster'
  | 'analysis_preview'
  | 'upload_staging'
  | 'storage_temp'
  | 'all'

export interface StorageInventoryItem {
  key: string
  label: string
  category: 'primary' | 'cache' | 'temporary' | 'database' | 'backup' | 'host' | 'other' | string
  path: string
  files: number
  bytes: number
  reclaimable_files: number
  reclaimable_bytes: number
  deletable: boolean
  cleanup_kind?: StorageCacheCleanupKind
  status: 'active' | 'regenerable' | 'reclaimable_by_age' | 'not_enabled' | 'read_only' | 'unknown' | 'review' | string
}

export interface StorageInventory {
  items: StorageInventoryItem[]
  storage_root_bytes: number
  database_bytes: number
  backup_bytes: number
  host_service_bytes: number
  total_managed_bytes: number
  reclaimable_bytes: number
  unclassified_bytes: number
  generated_at: string
}

export interface StorageCacheCleanup {
  kind: StorageCacheCleanupKind
  deleted_files: number
  deleted_bytes: number
  failed_files: number
  inventory: StorageInventory
}

export interface StorageLegacyObject {
  storage_key: string
  size: number
  current_file_refs: number
  history_version_refs: number
  last_referenced_at: string
}

export interface StorageLegacyObjectPage {
  items: StorageLegacyObject[]
  has_more: boolean
  next_cursor?: string
}

export type StorageUnreferencedBlobGCStatus =
  | 'awaiting_gc'
  | 'blocked_by_upload'
  | 'physical_missing'
  | 'metadata_inconsistent'

export interface StorageUnreferencedBlob {
  sha256: string
  storage_key: string
  metadata_size: number
  physical_size: number
  physical_exists: boolean
  state: string
  reused_upload_parts: number
  gc_status: StorageUnreferencedBlobGCStatus
  updated_at: string
}

export interface StorageUnreferencedBlobPage {
  items: StorageUnreferencedBlob[]
  has_more: boolean
  next_cursor?: string
}

export interface StoragePendingGC {
  awaiting_gc_blob_count: number
  awaiting_gc_blob_bytes: number
  blocked_by_upload_blob_count: number
  blocked_by_upload_blob_bytes: number
  physical_missing_blob_count: number
  physical_missing_metadata_bytes: number
  metadata_inconsistent_blob_count: number
  metadata_inconsistent_blob_bytes: number
  deleting_blob_count: number
  deleting_blob_metadata_bytes: number
}

export interface StorageStats {
  scope: 'self' | 'global'
  disk_total_bytes?: number
  disk_used_bytes?: number
  disk_available_bytes?: number
  xdrive_physical_bytes?: number
  upload_staging?: UploadStagingStats
  inventory?: StorageInventory
  file_count?: number
  logical_file_bytes?: number
  duplicate_group_count?: number
  duplicate_file_count?: number
  duplicate_logical_bytes?: number
  average_file_size_bytes?: number
  p50_file_size_bytes?: number
  p90_file_size_bytes?: number
  p99_file_size_bytes?: number
  file_buckets?: StorageSizeBucket[]
  cas_blob_count?: number
  cas_physical_bytes?: number
  unreferenced_blob_count?: number
  unreferenced_blob_bytes?: number
  pending_gc?: StoragePendingGC
  cas_health?: StorageHealth
  cas_logical_referenced_bytes?: number
  cas_dedup_saved_bytes?: number
  cas_dedup_ratio?: number
  cas_savings_ratio?: number
  average_blob_size_bytes?: number
  p50_blob_size_bytes?: number
  p90_blob_size_bytes?: number
  p99_blob_size_bytes?: number
  legacy_blob_count?: number
  legacy_physical_bytes?: number
  buckets?: StorageSizeBucket[]
  physical_snapshot_at?: string
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
  unreferenced_blob_count: number
  unreferenced_blob_bytes: number
  legacy_blob_count: number
  legacy_physical_bytes: number
  anomaly_snapshot_available: boolean
  gc_classification_snapshot_available: boolean
  awaiting_gc_blob_count: number
  awaiting_gc_blob_bytes: number
  blocked_by_upload_blob_count: number
  blocked_by_upload_blob_bytes: number
  physical_missing_blob_count: number
  physical_missing_metadata_bytes: number
  metadata_inconsistent_blob_count: number
  metadata_inconsistent_blob_bytes: number
  deleting_blob_metadata_bytes: number
  cas_health_snapshot_available: boolean
  deleting_blob_count: number
  stale_deleting_blob_count: number
  missing_metadata_count: number
  refcount_mismatch_count: number
  state_mismatch_count: number
  size_mismatch_count: number
  key_hash_mismatch_count: number
  invalid_state_count: number
  staging_orphan_bytes: number
  staging_reclaimable_bytes: number
  media_thumbnail_bytes: number
  video_poster_bytes: number
  analysis_preview_bytes: number
  media_other_bytes: number
  preview_cache_bytes: number
  video_transcode_bytes: number
  storage_temp_bytes: number
  unclassified_bytes: number
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

export interface StorageHistoryAnomaly {
  key:
    | 'snapshot_missing'
    | 'snapshot_stale'
    | 'physical_missing'
    | 'metadata_inconsistent'
    | 'blocked_by_upload_stalled'
    | 'cas_metadata_drift'
    | 'stale_deleting'
    | 'unclassified_storage'
    | 'unreferenced_growth'
    | 'cache_growth_spike'
    | string
  severity: 'warning' | 'bad'
  title: string
  message: string
  observed_at: string
  current_count?: number
  current_bytes?: number
  delta_bytes?: number
  age_hours?: number
}

export interface StorageHistory {
  samples: StorageHistoryPoint[]
  anomalies: StorageHistoryAnomaly[]
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

export interface AuditEventRange {
  items: AuditEvent[]
  total_count: number
  offset: number
  limit: number
  snapshot_max_id: number
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

export interface MediaEditRecipe {
  version: number
  revision: number
  source_current: boolean
  media_kind: MediaKind
  rotation_degrees: number
  flip_horizontal: boolean
  flip_vertical: boolean
  crop_x: number
  crop_y: number
  crop_width: number
  crop_height: number
  exposure_ev: number
  contrast: number
  saturation: number
  trim_start_ms: number
  trim_end_ms: number
  updated_at?: string
}

export interface MediaEditRecipeInput {
  revision: number
  rotation_degrees: number
  flip_horizontal: boolean
  flip_vertical: boolean
  crop_x: number
  crop_y: number
  crop_width: number
  crop_height: number
  exposure_ev: number
  contrast: number
  saturation: number
  trim_start_ms: number
  trim_end_ms: number
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

export type MediaCreativeKind = 'cutout' | 'erase' | 'movie' | 'collage'

export interface MediaCreativePoint {
  x: number
  y: number
  foreground: boolean
}

export interface MediaCreativeStrokePoint {
  x: number
  y: number
}

export interface MediaCreativeStroke {
  radius: number
  points: MediaCreativeStrokePoint[]
}

export interface MediaCreativeInput {
  kind: MediaCreativeKind
  output_name?: string
  cutout_mode?: 'object'
  cutout_expand?: number
  cutout_feather?: number
  points?: MediaCreativePoint[]
  strokes?: MediaCreativeStroke[]
  source_node_ids?: number[]
  movie_template?: 'classic' | 'fill' | 'ken_burns'
  music_node_id?: number
  collage_template?: 'grid' | 'featured' | 'columns' | 'rows'
  frame_duration_ms?: number
  transition_ms?: number
}

export interface MediaCreativeGeneration {
  id: string
  kind: MediaCreativeKind | string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string
  source_asset_id: number
  source_node_id: number
  source_node_revision: number
  analyzer_version?: string
  output_node_id?: number
  last_error?: string
  created_at: string
  updated_at: string
  completed_at?: string
}

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
  edit_recipe?: MediaEditRecipe
  resources?: MediaResource[]
  fold_member_ids?: number[]
  derived_resources?: MediaDerivedResource[]
  live_photo?: boolean
  trash_root?: Node
}

export interface MediaTimelineGroupIndex {
  key: string
  item_count: number
  start_index: number
}

export interface MediaTimelineGroupSets {
  year: MediaTimelineGroupIndex[]
  month: MediaTimelineGroupIndex[]
  day: MediaTimelineGroupIndex[]
}

export interface MediaItemRange {
  anchor_index?: number
  items: MediaItem[]
  total_count: number
  offset: number
  limit: number
  search_order?: 'relevance' | 'time' | string
  timeline_groups?: MediaTimelineGroupIndex[]
  timeline_group_sets?: MediaTimelineGroupSets
}

/** Temporary, owner-scoped and versioned; never a durable batch job. */
export interface MediaSelectionSnapshot {
  token: string
  version: number
  total: number
  selected: number
  excluded: number
  day: string
  expires_at: string
  scope?: 'known_photo_assets'
}

export type MediaSelectionJobStatus =
  | 'queued' | 'running' | 'cancel_requested' | 'completed'
  | 'partial' | 'cancelled'

/** Durable owner-scoped Gallery batch task, independent of the temporary token. */
export interface MediaSelectionJob {
  id: string
  action: 'favorite'
  favorite: boolean
  status: MediaSelectionJobStatus
  retry_of_id?: string
  total_items: number
  processed_items: number
  succeeded_items: number
  failed_items: number
  cancelled_items: number
  started_at?: string
  cancel_requested_at?: string
  finished_at?: string
  created_at: string
  updated_at: string
}

export interface MediaSelectionJobFailure {
  node_id: number
  revision: number
  status: 'failed'
  failure_code: string
}

export interface MediaSelectionJobFailurePage {
  items: MediaSelectionJobFailure[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}

export interface MediaSelectionSnapshotItem {
  node_id: number
  revision: number
  name: string
  stale: boolean
}

export interface MediaSelectionSnapshotPage extends MediaSelectionSnapshot {
  offset: number
  limit: number
  items: MediaSelectionSnapshotItem[]
  has_more: boolean
}

export interface MediaAlbumFolder {
  id: number
  parent_id: number
  name: string
  revision: number
  updated_at: string
}

export interface MediaAlbum {
  album_folder_id?: number
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
  time_zone?: string
  /** Only the initial ranged request; not part of persistent Viewer scope. */
  initial_position?: 'latest'
  /** Mobile opt-in: unknown capture dates precede valid dates in asc mode. */
  unknown_first?: boolean
  anchor_node_id?: number
  fold_duplicates?: boolean
  fold_member_ids?: number[]
  sort_by?: 'captured' | 'added'
  sort_dir?: 'asc' | 'desc'
  search?: string
  asset_kind?: PhotoAssetKind
  category?: string
  cameras?: string[]
  formats?: string[]
  folder_id?: number
  include_descendants?: boolean
  captured_from?: string
  captured_to?: string
  has_location?: boolean
  favorite?: boolean
  tag?: string
  person?: string
  person_identity?: string
  place?: string
}

export interface MediaFacetOption {
  value: string
  label: string
  item_count: number
}

export interface MediaGalleryFacets {
  cameras: MediaFacetOption[]
  formats: MediaFacetOption[]
}

/** Counts describe known active logical media, not all files scanned. */
export interface MediaGalleryIndexStatus {
  known_assets: number
  ready_assets: number
  failed_assets: number
  unsupported_assets: number
  missing_metadata_assets: number
  other_unready_assets: number
  scope: 'known_photo_assets'
  checked_at: string
}

export interface MediaSyncFolder {
  source_id: number
  source_name: string
  source_kind: string
  source_status: string
  target_node_id: number
  target_name: string
  target_path: string
  direct_media_count: number
  child_folder_count: number
  cover_node_id?: number
}

export interface MediaFolderEntry {
  id: number
  parent_id?: number
  name: string
  path: string
  direct_media_count: number
  child_folder_count: number
  cover_node_id?: number
}

export interface MediaFolderBreadcrumb {
  id: number
  name: string
  path: string
}

export interface MediaFolderView {
  source: MediaSyncFolder
  current: MediaFolderEntry
  breadcrumbs: MediaFolderBreadcrumb[]
  children: MediaFolderEntry[]
}

// On-demand, owner-authorized xDrive Node-tree location. Provenance from SourceItem
// and current synchronization-folder containment are independent facts.
export interface NodeLocationBreadcrumb {
  id: number
  name: string
  path: string
}

export interface NodeLocationSource {
  source_id: number
  source_name: string
  source_kind: string
  source_item_path?: string
  original_path?: string
}

export interface NodeLocationSyncFolder {
  source_id: number
  source_name: string
  source_kind: string
  target_node_id: number
}

export interface NodeLocation {
  node_id: number
  revision: number
  node_type: 'file' | 'dir' | string
  path: string
  parent_id?: number
  parent_path: string
  breadcrumbs: NodeLocationBreadcrumb[]
  sources: NodeLocationSource[]
  sync_folders: NodeLocationSyncFolder[]
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

export interface MediaMemory {
  id: string
  kind: 'recent_day' | 'on_this_day' | 'trip' | string
  title: string
  subtitle?: string
  start_date?: string
  end_date?: string
  anchor_date?: string
  place_name?: string
  item_count: number
  year_count?: number
  cover_node_id?: number
  updated_at?: string
}

export interface MediaDuplicateGroup {
  id: string
  item_count: number
  file_size_bytes: number
  logical_duplicate_bytes: number
  physical_reclaimable_bytes: number
  recommended_keep_node_id: number
  recommendation_reason: string
  asset_comparison?: 'identical' | 'different' | 'unverified'
  asset_comparison_reason?: string
  cover_node_id?: number
  updated_at?: string
}

export interface MediaDuplicateGroupList {
  groups: MediaDuplicateGroup[]
  offset?: number
  has_more?: boolean
  total_groups: number
  total_items: number
  logical_duplicate_bytes: number
  physical_reclaimable_bytes: number
}

export interface MediaDuplicateOrganizeResource {
  kind: string
  role: string
  node_id: number
  ordinal: number
  name: string
  media_kind: string
  mime_type: string
  size: number
  sha256: string
  byte_offset: number
}

export interface MediaDuplicateOrganizeCollection {
  id: number
  name: string
  kind: string
}

export interface MediaDuplicateOrganizePerson {
  person_key: string
  name: string
}

/** One *locally linked* sync-folder origin. Not a remote inventory scan. */
export interface MediaDuplicateOrganizeSourceLink {
  source_id: number
  source_name: string
  source_kind: string
  source_status: string
  direction: 'pull' | 'push' | string
  sync_mode: 'backup' | 'mirror' | string
  source_item_id: number
  resource_node_id: number
  path: string
  item_state: string
  may_reimport: boolean
}

export interface MediaDuplicateOrganizeMember {
  node_id: number
  asset_id: number
  asset_kind: string
  node_revision: number
  sha256: string
  favorite: boolean
  description: string
  tags: string[]
  people_labels: string[]
  collections: MediaDuplicateOrganizeCollection[]
  durable_people: MediaDuplicateOrganizePerson[]
  original_resources: MediaDuplicateOrganizeResource[]
  source_links?: MediaDuplicateOrganizeSourceLink[]
  edit_recipe?: MediaEditRecipe
  has_edit_recipe: boolean
}

export interface MediaDuplicateOrganizePlan {
  plan_revision: string
  keeper_node_id: number
  members: MediaDuplicateOrganizeMember[]
  asset_comparison: 'identical' | 'different' | 'unverified'
  reason: string
  distinct_descriptions: string[]
  combined_tags: string[]
  combined_people_labels: string[]
  combined_favorite: boolean
  manual_album_count: number
  durable_person_count: number
  source_managed_assets?: number
  potential_reimport_assets?: number
  ready_for_manual_review: boolean
  requires_manual_confirmation: boolean
  no_mutation: boolean
  physical_reclaimable_bytes: number
  source_warning: string
}

export interface MediaDuplicateOrganizeApplyInput {
  keeper_node_id: number
  node_ids: number[]
  expected_plan_revision: string
  /** Required only for differing nonempty descriptions; keeps other originals unchanged. */
  selected_description?: string
  confirm: true
}

export interface MediaDuplicateOrganizeApplyResult {
  keeper_node_id: number
  metadata_updated: boolean
  manual_albums_added: number
  durable_people_added: number
  original_files_retained: boolean
  original_edits_retained: boolean
  source_links_unchanged: boolean
  physical_bytes_reclaimed: number
}

export interface MediaBurstReview {
  id: string
  item_count: number
  recommended_node_id: number
  recommendation_reason: string
  cover_node_id?: number
  total_bytes: number
  potential_cleanup_bytes: number
  physical_reclaimable_bytes: number
  updated_at?: string
}

export interface MediaBurstReviewList {
  groups: MediaBurstReview[]
  offset?: number
  has_more?: boolean
  total_groups: number
  total_items: number
  potential_cleanup_bytes: number
  physical_reclaimable_bytes: number
}

export interface MediaPetFacet {
  id: 'dog' | 'cat' | string
  name: string
  item_count: number
  cover_node_id?: number
  updated_at?: string
}

export interface MediaPersonSuggestionReview {
  id: string
  review_state?: 'dismissed' | 'accepted' | string
  target_person_id?: string
}

export interface MediaSuggestedPerson {
  id: string
  face_count: number
  item_count: number
  cover_node_id?: number
  updated_at?: string
  review_state?: 'dismissed' | 'accepted' | string
  target_person_id?: string
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
