import { readFile } from 'node:fs/promises'

export type AgentHello = {
  discovery_version: number
  protocol_min: number
  protocol_max: number
  agent_version: string
  pid: number
  platform: string
  arch: string
  capabilities: string[]
}

export type AgentBuildInfo = {
  version: string
  channel?: string
  commit?: string
  commit_message?: string
  commit_time?: string
  build_time?: string
}

export type AgentStatus = {
  revision: number
  configured: boolean
  username?: string
  role?: 'user' | 'admin' | string
  server?: string
  mount_path?: string
  auth_status: string
  sync_status: string
  paused: boolean
  must_change_password: boolean
  last_error?: string
  has_conflict: boolean
  conflict_count: number
  version: string
  server_build?: AgentBuildInfo
}

export type AgentSettings = {
  mount_path: string
  cache_limit_bytes: number
  sync_rules: Array<{ path: string; mode: string }>
}

export type AgentUpdateMode = 'manual' | 'check' | 'download' | 'install'
export type AgentUpdateSource = 'github' | 'gitlab'

export type AgentServerUpdateState = {
  supported: boolean
  state: 'unavailable' | 'idle' | 'queued' | 'running' | 'success' | 'failed'
  source: 'github' | 'gitlab'
  channel: 'stable' | 'master'
  request_id?: string
  stage?: string
  stage_current?: number
  stage_total?: number
  bytes_done?: number
  bytes_total?: number
  message?: string
  error?: string
  started_at?: string
  updated_at?: string
  finished_at?: string
  runner_heartbeat_at?: string
}

export type AgentUpdateState = {
  mode: AgentUpdateMode
  source: AgentUpdateSource
  status: 'idle' | 'checking' | 'available' | 'up_to_date' | 'downloading' | 'downloaded' | 'installing' | 'error' | string
  current_version: string
  latest_version?: string
  release_name?: string
  published_at?: string
  release_notes?: string
  release_url?: string
  channel?: string
  update_available: boolean
  downloaded: boolean
  install_supported: boolean
  last_checked_at?: string
  message?: string
  last_error?: string
  bytes_done?: number
  bytes_total?: number
  bytes_per_second?: number
}

export type AgentFileAvailability = {
  Path: string
  Mode: string
  Placeholder: boolean
  Pinned: boolean
  OnlineOnly: boolean
  Mixed: boolean
  AvailableOffline: boolean
  InSync: boolean
  Syncing: boolean
}

export type AgentFileAvailabilityBatchItem = {
  path: string
  availability?: AgentFileAvailability
  error?: string
}

export type AgentFileAvailabilityBatch = {
  items: AgentFileAvailabilityBatchItem[]
}

export type AgentConflict = {
  id: string
  server?: string
  username?: string
  original_path: string
  conflict_path: string
  original_node_id?: number
  conflict_node_id?: number
  created_at: string
}

export type AgentStatusEvent = {
  type: 'status.changed'
  revision: number
  status: AgentStatus
}

export type AgentTransfer = {
  id: string
  parent_id?: string
  root_id?: string
  scope?: 'item' | 'group'
  phase?: 'scanning' | 'queued' | 'transferring' | 'finalizing' | string
  scan_complete?: boolean
  file_name: string
  path?: string
  relative_path?: string
  kind: 'upload' | 'download' | 'hydration' | 'dehydration' | string
  direction: 'upload' | 'download' | 'local' | string
  state: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'retrying' | 'cancelling' | 'cancelled' | string
  bytes_done: number
  bytes_total: number
  percent: number
  items_total?: number
  items_completed?: number
  items_failed?: number
  items_running?: number
  items_queued?: number
  instant_bytes_per_second: number
  average_bytes_per_second: number
  speed_source?: 'client' | 'server'
  speed_updated_at?: string
  elapsed_ms: number
  error?: string
  retry_count: number
  retryable: boolean
  started_at: string
  updated_at: string
  completed_at?: string
}

export type AgentTransfers = {
  revision: number
  transfers: AgentTransfer[]
}

export type AgentTransferLifecycleInput = {
  action: 'start_group' | 'start_child' | 'start_children' | 'begin' | 'progress' | 'update_group' | 'finish'
  id?: string
  parent_id?: string
  file_name?: string
  path?: string
  relative_path?: string
  kind?: string
  direction?: string
  bytes_done?: number
  bytes_total?: number
  items_total?: number
  items_completed?: number
  items_failed?: number
  items_running?: number
  items_queued?: number
  scan_complete?: boolean
  state?: 'completed' | 'partial' | 'failed' | 'cancelled'
  error?: string
  skipped?: boolean
  children?: Array<{
    file_name: string
    path?: string
    relative_path?: string
    kind?: string
    direction?: string
    bytes_total?: number
    items_total?: number
  }>
}

export type AgentTransferEvent = {
  type: 'transfers.changed'
  revision: number
  transfers: AgentTransfer[]
}

export type AgentSource = {
  id: number
  name: string
  kind: string
  direction: 'push' | 'pull'
  sync_mode: 'backup' | 'mirror'
  run_mode: 'scan' | 'sync'
  status: 'active' | 'paused'
  schedule_type?: 'interval' | 'cron' | 'manual'
  schedule_expression?: string
  schedule_timezone?: string
  revision: number
  target_node_id?: number
  target_path?: string
  ignore_rules?: string
  checkpoint?: string
  last_run_at?: string
  last_success_at?: string
  last_error?: string
  run_requested_at?: string
  created_at: string
  updated_at: string
}

export type AgentCreateSourceInput = {
  name: string
  kind: string
  direction: 'push' | 'pull'
  sync_mode: 'backup'
  run_mode: 'scan' | 'sync'
  schedule_type?: 'interval' | 'cron' | 'manual'
  schedule_expression?: string
  schedule_timezone?: string
  target_node_id: number
  ignore_rules?: string
}

export type AgentUpdateSourceInput = {
  name?: string
  run_mode?: 'scan' | 'sync'
  status?: 'active' | 'paused'
  schedule_type?: 'interval' | 'cron' | 'manual'
  schedule_expression?: string
  schedule_timezone?: string
  target_node_id?: number
  ignore_rules?: string
}

export type AgentSourceRunFailure = {
  id: number
  source_item_id: number
  external_id: string
  kind: string
  path: string
  size: number
  error: string
  failed_at: string
}

export type AgentSourceRun = {
  id: string
  source_id: number
  source_revision: number
  target_node_id?: number
  mode: 'scan' | 'sync'
  trigger: string
  status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  scanned_items: number
  scanned_bytes: number
  scanned_file_items: number
  scanned_directory_items: number
  ignored_items: number
  ignored_bytes: number
  new_items: number
  new_bytes: number
  changed_items: number
  changed_bytes: number
  moved_items: number
  unchanged_items: number
  unchanged_bytes: number
  missing_items: number
  missing_bytes: number
  planned_transfer_items: number
  planned_transfer_bytes: number
  processed_transfer_items?: number
  processed_transfer_bytes?: number
  synced_file_items: number
  synced_directory_items: number
  synced_bytes: number
  created_items: number
  updated_items: number
  skipped_items: number
  transferred_items: number
  transferred_bytes: number
  failed_items: number
  active_transfer_path?: string
  active_transfer_bytes?: number
  active_transfer_total_bytes?: number
  cancel_requested_at?: string
  error?: string
  started_at: string
  finished_at?: string
}

export type AgentSourceItemMetadata = {
  original_path?: string
  owner_external_id?: string
  captured_at?: string
  remote_created_at?: string
  content_md5?: string
  thumbnail_url?: string
  pair_group_id?: string
  pair_role?: string
}

export type AgentSourceItem = {
  source_item_id: number
  external_id: string
  node_id?: number
  kind: string
  path: string
  size: number
  modified_at?: string
  sha256?: string
  remote_revision?: string
  state: string
  last_error?: string
  metadata?: AgentSourceItemMetadata
}

export type AgentSourceCollection = {
  id: number
  external_id: string
  kind: string
  name: string
  state: string
  remote_revision?: string
  item_count: number
  last_seen_at: string
  created_at: string
  updated_at: string
}

export type AgentSourceCollectionItem = AgentSourceItem & {
  position: number
}

export type AgentSourceCredentialStatus = {
  configured: boolean
  key_version?: number
  updated_at?: string
}

export type AgentSourceCredentialReveal = {
  field: 'cookie' | 'password'
  value: string
  expires_in_seconds: number
}

export type AgentSourceConnectorConfig = {
  configured: boolean
  revision: number
  payload: Record<string, unknown>
  updated_at?: string
}

export type AgentSourceBrowseDirectory = {
  name: string
  path: string
}

export type AgentSourceBrowsePage = {
  path?: string
  items: AgentSourceBrowseDirectory[]
  total: number
  next_offset?: number
}

export type AgentSourceCredentialTestResult = {
  valid: boolean
  kind: string
  account_external_id?: string
  account_name?: string
}

export type AgentCloudNode = {
  id: number
  parent_id?: number
  name: string
  type: 'dir' | 'file'
  size: number
  revision: number
  sha256?: string
  deleted_at?: string
  created_at: string
  updated_at: string
}

export type AgentCloudBatchNodeRef = {
  id: number
  revision: number
}

export type AgentCloudBatchResult = {
  operation_id: string
  items?: AgentCloudNode[]
  deleted_ids?: number[]
}

export type AgentCloudFilePropertiesStats = {
  selected_count: number
  effective_root_count: number
  total_bytes: number
  file_count: number
  folder_count: number
  sources?: Array<{
    id: number
    name: string
    kind: string
  }>
}

export type AgentCloudFileMediaDetails = {
  id: number
  revision: number
  width?: number
  height?: number
  duration_ms?: number
}

export type AgentCloudUploadConflictPreflight = {
  conflict: boolean
  target_type?: 'file' | 'dir'
  can_overwrite?: boolean
  error?: string
}

export type AgentCloudFileTextPreview = {
  text: string
  truncated: boolean
  size: number
}

export type AgentFilePreviewTicket = {
  url: string
  expires_at: string
  kind: 'image' | 'video' | 'audio' | 'pdf'
  mime_type: string
}

export type AgentCloudUploadResult = {
  node: AgentCloudNode
  skipped: boolean
  transferred_bytes: number
}

export type AgentCloudArchiveExtractResult = {
  downloaded: string[]
}

export type AgentCloudFolderDownloadResult = {
  root: string
  downloaded: number
  failed: number
}

export type AgentBackgroundTaskControlResult = {
  task_id: string
  action: string
  result_task_id?: string
  accepted: boolean
}

export type AgentBackgroundTaskPage = {
  current_items: AgentBackgroundTask[]
  history_items: AgentBackgroundTask[]
  next_cursor?: string
}

export type AgentBackgroundTaskActiveSummary = {
  active_total: number
  file_operation: number
  sync_run: number
  archive_prepare: number
  scheduler: number
}

export type AgentBackgroundTask = {
  id: string
  kind: string
  domain: string
  scope: string
  owner_id?: number
  owner_username?: string
  state: string
  trigger?: string
  initiator?: string
  priority?: number
  resource?: string
  source_id?: number
  source_name?: string
  source_kind?: string
  progress: {
    phase?: string
    current?: number
    total?: number
    unit?: string
    percent?: number
    current_item?: string
  }
  active_count?: number
  queued_count?: number
  running_count?: number
  instance_count?: number
  attempt?: number
  retry_at?: string
  trace_id?: string
  parent_key?: string
  control_actions?: string[]
  started_at?: string
  updated_at: string
  finished_at?: string
  error?: string
}

export type AgentCloudFileOperation = {
  id: string
  type: 'copy' | 'move' | 'delete' | 'undo' | 'redo'
  status: 'queued' | 'running' | 'cancel_requested' | 'cancelled' | 'completed' | 'failed'
  parent_id?: number
  retry_of_id?: string
  undo_of_id?: string
  undone_by_id?: string
  redo_of_id?: string
  redone_by_id?: string
  undoable?: boolean
  redoable?: boolean
  conflict_policy?: 'fail' | 'skip' | 'keep_both' | 'replace'
  total_items: number
  processed_items: number
  total_bytes: number
  processed_bytes: number
  percent: number
  current_item?: string
  failed_item_id?: number
  failure_code?: string
  error?: string
  retryable: boolean
  cancel_requested_at?: string
  started_at?: string
  finished_at?: string
  created_at: string
  updated_at: string
}

export type AgentCloudChildrenPage = {
  items: AgentCloudNode[]
  next_cursor?: string
  has_more: boolean
  sort: 'name' | 'updated' | 'size' | 'type'
  order: 'asc' | 'desc'
}

export type AgentFileExplorerGroupIndex = {
  key: string
  item_count: number
  start_index: number
}

export type AgentFileExplorerGrouping = {
  groupBy: 'none' | 'type' | 'modified' | 'size'
  foldersFirst: boolean
}

export type AgentCloudTrashRange = {
  items: AgentCloudNode[]
  total_count: number
  total_count_included?: boolean
  offset: number
  limit: number
  sort: 'name' | 'updated' | 'size' | 'type'
  order: 'asc' | 'desc'
}

export type AgentCloudChildrenRange = {
  items: AgentCloudNode[]
  total_count: number
  total_count_included?: boolean
  offset: number
  limit: number
  sort: 'name' | 'updated' | 'size' | 'type'
  order: 'asc' | 'desc'
  groups?: AgentFileExplorerGroupIndex[]
}

export type AgentCloudNodeChange = {
  cursor: number
  node_id: number
  operation: 'upsert' | 'delete'
  affected_parent_ids: number[]
  path?: string
  node?: AgentCloudNode
}

export type AgentCloudNodeChangePage = {
  changes: AgentCloudNodeChange[]
  next_cursor: number
  latest_cursor: number
  has_more: boolean
  reset_required?: boolean
}

export type AgentMediaMetadata = {
  media_kind: 'image' | 'video'
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
  index_state: string
  index_error?: string
  has_thumbnail: boolean
  thumbnail_mime_type?: string
  thumbnail_width?: number
  thumbnail_height?: number
}

export type AgentMediaDerivedResource = {
  role: string
  name: string
  media_kind: 'image' | 'video'
  mime_type: string
  size: number
}

export type AgentMediaResource = {
  kind: string
  node_id: number
  role: string
  name: string
  media_kind: string
  mime_type?: string
  size: number
}

export type AgentMediaEditRecipe = {
  version: number
  revision: number
  source_current: boolean
  media_kind: string
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

export type AgentMediaEditRecipeInput = {
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

export type AgentMediaCreativePoint = {
  x: number
  y: number
  foreground: boolean
}

export type AgentMediaCreativeStrokePoint = {
  x: number
  y: number
}

export type AgentMediaCreativeStroke = {
  radius: number
  points: AgentMediaCreativeStrokePoint[]
}

export type AgentMediaCreativeInput = {
  kind: 'cutout' | 'erase' | 'movie' | 'collage'
  output_name?: string
  cutout_mode?: 'object'
  cutout_expand?: number
  cutout_feather?: number
  points?: AgentMediaCreativePoint[]
  strokes?: AgentMediaCreativeStroke[]
  source_node_ids?: number[]
  movie_template?: 'classic' | 'fill' | 'ken_burns'
  music_node_id?: number
  collage_template?: 'grid' | 'featured' | 'columns' | 'rows'
  frame_duration_ms?: number
  transition_ms?: number
}

export type AgentMediaCreativeGeneration = {
  id: string
  kind: string
  state: string
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

export type AgentMediaItem = {
  node: AgentCloudNode
  metadata: AgentMediaMetadata
  asset_kind?: string
  favorite: boolean
  tags?: string[]
  people?: string[]
  description?: string
  edit_recipe?: AgentMediaEditRecipe
  resources?: AgentMediaResource[]
  derived_resources?: AgentMediaDerivedResource[]
  live_photo?: boolean
  trash_root?: AgentCloudNode
}

export type AgentMediaTimelineGroupIndex = {
  key: string
  item_count: number
  start_index: number
}

export type AgentMediaTimelineGroupSets = {
  year: AgentMediaTimelineGroupIndex[]
  month: AgentMediaTimelineGroupIndex[]
  day: AgentMediaTimelineGroupIndex[]
}

export type AgentMediaItemRange = {
  items: AgentMediaItem[]
  total_count: number
  offset: number
  limit: number
  timeline_groups?: AgentMediaTimelineGroupIndex[]
  timeline_group_sets?: AgentMediaTimelineGroupSets
}

export type AgentMediaQuery = {
  search?: string
  asset_kind?: string
  category?: string
  cameras?: string[]
  formats?: string[]
  captured_from?: string
  captured_to?: string
  has_location?: boolean
  favorite?: boolean
  tag?: string
  person?: string
  person_identity?: string
  place?: string
}

function appendAgentMediaQuery(
  query: URLSearchParams,
  filters: AgentMediaQuery = {},
) {
  if (filters.search?.trim()) query.set('q', filters.search.trim())
  if (filters.asset_kind) query.set('asset_kind', filters.asset_kind)
  if (filters.category?.trim()) query.set('category', filters.category.trim())
  for (const camera of filters.cameras ?? []) {
    if (camera.trim()) query.append('camera', camera.trim())
  }
  for (const format of filters.formats ?? []) {
    if (format.trim()) query.append('format', format.trim())
  }
  if (filters.captured_from) query.set('captured_from', filters.captured_from)
  if (filters.captured_to) query.set('captured_to', filters.captured_to)
  if (filters.has_location !== undefined) {
    query.set('has_location', String(filters.has_location))
  }
  if (filters.favorite !== undefined) {
    query.set('favorite', String(filters.favorite))
  }
  if (filters.tag?.trim()) query.set('tag', filters.tag.trim())
  if (filters.person?.trim()) query.set('person', filters.person.trim())
  if (filters.person_identity?.trim()) {
    query.set('person_identity', filters.person_identity.trim())
  }
  if (filters.place?.trim()) query.set('place', filters.place.trim())
}

export type AgentMediaFacetOption = {
  value: string
  label: string
  item_count: number
}

export type AgentMediaGalleryFacets = {
  cameras: AgentMediaFacetOption[]
  formats: AgentMediaFacetOption[]
}

export type AgentMediaAlbum = {
  id: string
  kind: string
  name: string
  revision?: number
  item_count: number
  cover_node_id?: number
  updated_at?: string
  query?: AgentMediaQuery
}

export type AgentMediaPlaceFacet = {
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

export type AgentMediaMemory = {
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

export type AgentMediaDuplicateGroup = {
  id: string
  item_count: number
  file_size_bytes: number
  logical_duplicate_bytes: number
  physical_reclaimable_bytes: number
  recommended_keep_node_id: number
  recommendation_reason: string
  cover_node_id?: number
  updated_at?: string
}

export type AgentMediaDuplicateGroupList = {
  groups: AgentMediaDuplicateGroup[]
  total_groups: number
  total_items: number
  logical_duplicate_bytes: number
  physical_reclaimable_bytes: number
}

export type AgentMediaBurstReview = {
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

export type AgentMediaBurstReviewList = {
  groups: AgentMediaBurstReview[]
  total_groups: number
  total_items: number
  potential_cleanup_bytes: number
  physical_reclaimable_bytes: number
}

export type AgentMediaPetFacet = {
  id: 'dog' | 'cat' | string
  name: string
  item_count: number
  cover_node_id?: number
  updated_at?: string
}

export type AgentMediaPersonSuggestionReview = {
  id: string
  review_state?: 'dismissed' | 'accepted' | string
  target_person_id?: string
}

export type AgentMediaSuggestedPerson = {
  id: string
  face_count: number
  item_count: number
  cover_node_id?: number
  updated_at?: string
  review_state?: 'dismissed' | 'accepted' | string
  target_person_id?: string
}

export type AgentMediaPersonIdentity = {
  id: string
  name: string
  hidden: boolean
  revision: number
  item_count: number
  cover_node_id?: number
  updated_at?: string
}

export type AgentMediaPersonSplit = {
  source: AgentMediaPersonIdentity
  created: AgentMediaPersonIdentity
}

export type AgentUpdateMediaPersonInput = {
  name?: string
  hidden?: boolean
  cover_node_id?: number
}

export type AgentMediaFavorite = {
  favorite: boolean
}

export type AgentMediaBatchFavorite = {
  updated: number
  favorite: boolean
}

export type AgentMediaBatchTags = {
  updated: number
  tags: string[]
}

export type AgentMediaTags = {
  tags: string[]
}

export type AgentMediaPeople = {
  people: string[]
}

export type AgentMediaDescription = {
  description: string
}

export type AgentMediaThumbnail = {
  content_type: string
  data: ArrayBuffer
}

export type AgentBinaryProgressHandler = (
  loadedBytes: number,
  totalBytes?: number,
) => void

export type AgentCloudQuota = {
  quota_bytes: number
  physical_used_bytes: number
  reserved_bytes: number
  available_bytes: number
  disk_available_bytes?: number
  logical_file_bytes: number
  trash_bytes: number
  history_bytes: number
  over_quota: boolean
}

export type AgentStorageCacheCleanupKind =
  | 'media_thumbnail'
  | 'video_poster'
  | 'analysis_preview'
  | 'upload_staging'
  | 'storage_temp'
  | 'all'

export type AgentStorageInventoryItem = {
  key: string
  label: string
  category: string
  path: string
  files: number
  bytes: number
  reclaimable_files: number
  reclaimable_bytes: number
  deletable: boolean
  cleanup_kind?: AgentStorageCacheCleanupKind
  status: string
}

export type AgentStorageInventory = {
  items: AgentStorageInventoryItem[]
  storage_root_bytes: number
  database_bytes: number
  backup_bytes: number
  host_service_bytes: number
  total_managed_bytes: number
  reclaimable_bytes: number
  unclassified_bytes: number
  generated_at: string
}

export type AgentStorageCacheCleanup = {
  kind: AgentStorageCacheCleanupKind
  deleted_files: number
  deleted_bytes: number
  failed_files: number
  inventory: AgentStorageInventory
}

export type AgentCloudStorageStats = {
  scope: 'self' | 'global'
  disk_total_bytes?: number
  disk_used_bytes?: number
  disk_available_bytes?: number
  xdrive_physical_bytes?: number
  inventory?: AgentStorageInventory
  file_count?: number
  logical_file_bytes?: number
  average_file_size_bytes?: number
  p50_file_size_bytes?: number
  p90_file_size_bytes?: number
  p99_file_size_bytes?: number
  file_buckets?: Array<{ key: string; label: string; count: number; bytes: number }>
  cas_blob_count?: number
  cas_physical_bytes?: number
  unreferenced_blob_count?: number
  unreferenced_blob_bytes?: number
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
  buckets?: Array<{ key: string; label: string; count: number; bytes: number }>
  generated_at: string
}

export type AgentCloudVersion = {
  id: number
  node_id: number
  revision: number
  size: number
  sha256?: string
  created_at: string
}

export type AgentCloudShare = {
  id: number
  node_id: number
  has_password: boolean
  expires_at?: string
  max_downloads: number
  download_count: number
  revoked_at?: string
  status: 'active' | 'expired' | 'exhausted' | 'revoked' | string
  created_at: string
  updated_at: string
}

export type AgentCreatedCloudShare = {
  share: AgentCloudShare & { token: string }
  url: string
}

export type AgentCloudCrumb = { id: number; name: string }

export type AgentCloudSearchResult = {
  node: AgentCloudNode
  path: string
  crumbs: AgentCloudCrumb[]
}

export type AgentCloudSearchPage = {
  items: AgentCloudSearchResult[]
  next_cursor?: string
}

export type AgentCloudSearchRange = {
  items: AgentCloudSearchResult[]
  total_count: number
  offset: number
  limit: number
  sort: 'name' | 'updated' | 'size' | 'type'
  order: 'asc' | 'desc'
  groups?: AgentFileExplorerGroupIndex[]
}

export type AgentCloudSearchFilters = {
  kind?: 'folder' | 'file' | 'image' | 'video' | 'audio' | 'pdf' | 'document' |
    'spreadsheet' | 'presentation' | 'archive' | 'code' | 'text' | 'other'
  modifiedFrom?: string
  modifiedTo?: string
  minSize?: number
  maxSize?: number
  sourceID?: number
  tagID?: number
  availability?: 'local' | 'always-local' | 'online-only' | 'cloud' | 'mixed' | 'syncing'
}

function appendAgentFileExplorerGrouping(
  query: URLSearchParams,
  grouping: AgentFileExplorerGrouping | undefined,
) {
  if (!grouping) return
  if (grouping.groupBy !== 'none') query.set('group', grouping.groupBy)
  if (!grouping.foldersFirst) query.set('folders_first', 'false')
}

function appendAgentCloudSearchFilters(
  query: URLSearchParams,
  filters: AgentCloudSearchFilters,
) {
  if (filters.kind) query.set('kind', filters.kind)
  if (filters.modifiedFrom) query.set('modified_from', filters.modifiedFrom)
  if (filters.modifiedTo) query.set('modified_to', filters.modifiedTo)
  if (filters.minSize !== undefined) query.set('min_size', String(Math.max(0, Math.trunc(filters.minSize))))
  if (filters.maxSize !== undefined) query.set('max_size', String(Math.max(0, Math.trunc(filters.maxSize))))
  if (filters.sourceID) query.set('source_id', String(Math.max(1, Math.trunc(filters.sourceID))))
  if (filters.tagID) query.set('tag_id', String(Math.max(1, Math.trunc(filters.tagID))))
  if (filters.availability) query.set('availability', filters.availability)
}

export type AgentCloudQuickAccessItem = {
  node: AgentCloudNode
  path: string
  crumbs: AgentCloudCrumb[]
  position: number
  pinned_at: string
}

export type AgentFileTag = {
  id: number
  name: string
  color?: string
  item_count: number
  created_at: string
  updated_at: string
}

export type AgentFileNodeTags = {
  node_id: number
  tags: AgentFileTag[]
}

export type AgentFileSavedSearch = {
  id: number
  name: string
  query: string
  filters: AgentCloudSearchFilters
  position: number
  created_at: string
  updated_at: string
}

export type AgentFileSavedSearchInput = {
  name: string
  query: string
  filters: AgentCloudSearchFilters
}

export type AgentCloudFavoriteItem = {
  node: AgentCloudNode
  path: string
  crumbs: AgentCloudCrumb[]
  favorited_at: string
}

export type AgentCloudRecentItem = {
  node: AgentCloudNode
  path: string
  crumbs: AgentCloudCrumb[]
  accessed_at: string
}

export type AgentDiagnosticCheck = {
  name: string
  status: 'PASS' | 'WARN' | 'FAIL'
  detail: string
}

export type AgentDiagnosticReport = {
  generated_at: string
  platform: string
  arch: string
  checks: AgentDiagnosticCheck[]
  summary: { pass: number; warn: number; fail: number }
}

export type AgentStorageTreeNode = {
  path: string
  name: string
  mode: 'default' | 'exclude' | 'always-local'
  effective_mode: 'default' | 'exclude' | 'always-local'
  file_count: number
  total_bytes: number
  children?: AgentStorageTreeNode[]
}

export type AgentCacheStats = {
  supported: boolean
  reason?: string
  used_bytes: number
  limit_bytes: number
  reclaimable_bytes: number
  pinned_bytes: number
  cached_files: number
  reclaimable_files: number
  pinned_files: number
}

export type AgentCacheReleaseResult = {
  stats: AgentCacheStats
  released_bytes: number
  released_files: number
  failed_files: number
}

export type AgentLocalDiskSpace = {
  supported: boolean
  reason?: string
  free_bytes: number
  total_bytes: number
  status: 'PASS' | 'WARN' | 'FAIL' | string
}

type AgentDiscovery = {
  version: number
  base_url: string
  token: string
  pid: number
}

export class AgentIPCError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: string

  constructor(code: string, status: number, message: string, detail?: string) {
    super(message)
    this.name = 'AgentIPCError'
    this.code = code
    this.status = status
    this.detail = detail?.trim() || undefined
  }
}

export class AgentIPCClient {
  static readonly protocolMin = 2
  static readonly protocolMax = 2

  private readonly discoveryPath: string
  private discovery: AgentDiscovery | null = null

  constructor(discoveryPath: string) {
    this.discoveryPath = discoveryPath
  }

  invalidate() {
    this.discovery = null
  }

  async hello(signal?: AbortSignal) {
    let hello: AgentHello
    try {
      hello = await this.request<AgentHello>('GET', '/v1/hello', undefined, 10_000, signal)
    } catch (error) {
      if (error instanceof AgentIPCError && error.status === 404) {
        throw new AgentIPCError(
          'incompatible_agent',
          404,
          'xdrive-agent is too old for this xDrive Desktop version. Update the xDrive Core package.',
        )
      }
      throw error
    }
    if (
      hello.protocol_max < AgentIPCClient.protocolMin ||
      hello.protocol_min > AgentIPCClient.protocolMax
    ) {
      throw new AgentIPCError(
        'incompatible_agent',
        0,
        `Desktop IPC protocol mismatch: desktop supports ${AgentIPCClient.protocolMin}-${AgentIPCClient.protocolMax}, agent supports ${hello.protocol_min}-${hello.protocol_max}.`,
      )
    }
    return hello
  }

  status(signal?: AbortSignal) {
    return this.request<AgentStatus>('GET', '/v1/status', undefined, 10_000, signal)
  }

  events(afterRevision: number, timeoutMs = 25_000, signal?: AbortSignal) {
    const query = new URLSearchParams({
      after_revision: String(afterRevision),
      timeout_ms: String(timeoutMs),
    })
    return this.request<AgentStatusEvent | null>(
      'GET',
      `/v1/events?${query.toString()}`,
      undefined,
      Math.min(timeoutMs + 5_000, 35_000),
      signal,
    )
  }

  login(input: { server: string; username: string; password: string; mount_path?: string }) {
    return this.request<AgentStatus>('POST', '/v1/auth/login', input, 35_000)
  }

  logout() {
    return this.request<AgentStatus>('POST', '/v1/auth/logout')
  }

  changePassword(input: { current_password: string; new_password: string }) {
    return this.request<AgentStatus>('POST', '/v1/auth/change-password', input, 35_000)
  }

  setPaused(paused: boolean) {
    return this.request<AgentStatus>('POST', paused ? '/v1/sync/pause' : '/v1/sync/resume')
  }

  syncNow() {
    return this.request<AgentStatus>('POST', '/v1/sync/now')
  }

  settings() {
    return this.request<AgentSettings>('GET', '/v1/settings')
  }

  updateSettings(input: { mount_path?: string; cache_limit_bytes?: number }) {
    return this.request<AgentSettings>('PATCH', '/v1/settings', input)
  }

  updateState() {
    return this.request<AgentUpdateState>('GET', '/v1/update')
  }

  setUpdateMode(mode: AgentUpdateMode) {
    return this.request<AgentUpdateState>('PATCH', '/v1/update/settings', { mode })
  }

  setUpdateSource(source: AgentUpdateSource) {
    return this.request<AgentUpdateState>('PATCH', '/v1/update/settings', { source })
  }

  checkUpdate() {
    return this.request<AgentUpdateState>('POST', '/v1/update/check', undefined, 90_000)
  }

  downloadUpdate() {
    return this.request<AgentUpdateState>('POST', '/v1/update/download', undefined, 30 * 60_000)
  }

  installUpdate() {
    return this.request<AgentUpdateState>('POST', '/v1/update/install', undefined, 30 * 60_000)
  }

  cancelUpdate() {
    return this.request<AgentUpdateState>('POST', '/v1/update/cancel')
  }

  setSyncRule(path: string, mode: 'exclude' | 'always-local' | 'default') {
    return this.request<AgentSettings>('PUT', '/v1/settings/sync-rule', { path, mode })
  }

  storageTree() {
    return this.request<AgentStorageTreeNode>('GET', '/v1/storage-tree', undefined, 45_000)
  }

  cacheStats() {
    return this.request<AgentCacheStats>('GET', '/v1/cache')
  }

  localDiskSpace() {
    return this.request<AgentLocalDiskSpace>('GET', '/v1/local-disk-space')
  }

  releaseCache() {
    return this.request<AgentCacheReleaseResult>('POST', '/v1/cache/release', undefined, 130_000)
  }

  mediaItems(
    kind = '',
    limit = 100,
    offset = 0,
    filters: AgentMediaQuery = {},
  ) {
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    if (kind) query.set('kind', kind)
    appendAgentMediaQuery(query, filters)
    return this.request<AgentMediaItem[]>('GET', `/v1/media/items?${query.toString()}`)
  }
  mediaItemRange(
    kind = '',
    limit = 200,
    offset = 0,
    filters: AgentMediaQuery = {},
  ) {
    const query = new URLSearchParams({
      range: 'true',
      limit: String(limit),
      offset: String(offset),
    })
    if (kind) query.set('kind', kind)
    appendAgentMediaQuery(query, filters)
    return this.request<AgentMediaItemRange>('GET', `/v1/media/items?${query.toString()}`)
  }



  mediaFacets(filters: AgentMediaQuery = {}, albumID = '') {
    const query = new URLSearchParams()
    appendAgentMediaQuery(query, filters)
    if (albumID.trim()) query.set('album_id', albumID.trim())
    const encoded = query.toString()
    return this.request<AgentMediaGalleryFacets>(
      'GET',
      `/v1/media/facets${encoded ? `?${encoded}` : ''}`,
    )
  }

  mediaTrash(limit = 200, offset = 0) {
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentMediaItemRange>(
      'GET',
      `/v1/media/trash?${query.toString()}`,
    )
  }

  mediaAlbums() {
    return this.request<AgentMediaAlbum[]>('GET', '/v1/media/albums')
  }

  mediaPlaces(limit = 24) {
    const query = new URLSearchParams({ limit: String(limit) })
    return this.request<AgentMediaPlaceFacet[]>('GET', `/v1/media/places?${query.toString()}`)
  }

  mediaMemories(anchorDate = '', limit = 24) {
    const query = new URLSearchParams({ limit: String(limit) })
    if (anchorDate.trim()) query.set('anchor_date', anchorDate.trim())
    return this.request<AgentMediaMemory[]>(
      'GET',
      `/v1/media/memories?${query.toString()}`,
    )
  }

  mediaMemoryItemRange(
    memoryID: string,
    limit = 200,
    offset = 0,
  ) {
    const query = new URLSearchParams({
      memory_id: memoryID,
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentMediaItemRange>(
      'GET',
      `/v1/media/memory-items?${query.toString()}`,
    )
  }

  mediaDuplicateGroups(limit = 24) {
    const query = new URLSearchParams({ limit: String(limit) })
    return this.request<AgentMediaDuplicateGroupList>(
      'GET',
      `/v1/media/duplicates?${query.toString()}`,
    )
  }

  mediaDuplicateItemRange(
    duplicateID: string,
    limit = 200,
    offset = 0,
  ) {
    const query = new URLSearchParams({
      duplicate_id: duplicateID,
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentMediaItemRange>(
      'GET',
      `/v1/media/duplicate-items?${query.toString()}`,
    )
  }

  mediaBurstReviews(limit = 24) {
    const query = new URLSearchParams({ limit: String(limit) })
    return this.request<AgentMediaBurstReviewList>(
      'GET',
      `/v1/media/bursts?${query.toString()}`,
    )
  }

  mediaBurstReviewItemRange(
    burstID: string,
    limit = 200,
    offset = 0,
  ) {
    const query = new URLSearchParams({
      burst_id: burstID,
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentMediaItemRange>(
      'GET',
      `/v1/media/burst-items?${query.toString()}`,
    )
  }

  mediaPets() {
    return this.request<AgentMediaPetFacet[]>('GET', '/v1/media/pets')
  }

  mediaPetItemRange(
    petKind: string,
    limit = 200,
    offset = 0,
  ) {
    const query = new URLSearchParams({
      pet_kind: petKind,
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentMediaItemRange>(
      'GET',
      `/v1/media/pet-items?${query.toString()}`,
    )
  }

  mediaEditRecipe(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentMediaEditRecipe>(
      'GET',
      `/v1/media/edit?${query.toString()}`,
    )
  }

  saveMediaEditRecipe(
    nodeID: number,
    input: AgentMediaEditRecipeInput,
  ) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentMediaEditRecipe>(
      'PUT',
      `/v1/media/edit?${query.toString()}`,
      input,
    )
  }

  resetMediaEditRecipe(nodeID: number, revision: number) {
    const query = new URLSearchParams({
      node_id: String(nodeID),
      revision: String(revision),
    })
    return this.request<AgentMediaEditRecipe>(
      'DELETE',
      `/v1/media/edit?${query.toString()}`,
    )
  }

  createMediaCreativeGeneration(
    nodeID: number,
    input: AgentMediaCreativeInput,
  ) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentMediaCreativeGeneration>(
      'POST',
      `/v1/media/creative?${query.toString()}`,
      input,
    )
  }

  mediaCreativeGeneration(generationID: string) {
    const query = new URLSearchParams({ generation_id: generationID })
    return this.request<AgentMediaCreativeGeneration>(
      'GET',
      `/v1/media/creative?${query.toString()}`,
    )
  }

  cancelMediaCreativeGeneration(generationID: string) {
    const query = new URLSearchParams({ generation_id: generationID })
    return this.request<AgentMediaCreativeGeneration>(
      'POST',
      `/v1/media/creative/cancel?${query.toString()}`,
    )
  }

  mediaSuggestedPeople(limit = 24) {
    const query = new URLSearchParams({ limit: String(limit) })
    return this.request<AgentMediaSuggestedPerson[]>(
      'GET',
      `/v1/media/people/suggestions?${query.toString()}`,
    )
  }

  mediaSuggestedPeopleWithReview(includeReviewed = false, limit = 24) {
    const query = new URLSearchParams({
      include_reviewed: String(includeReviewed),
      limit: String(limit),
    })
    return this.request<AgentMediaSuggestedPerson[]>(
      'GET',
      `/v1/media/people/suggestions?${query.toString()}`,
    )
  }

  mediaSuggestedPersonItems(
    personID: string,
    limit = 100,
    offset = 0,
    filters: AgentMediaQuery = {},
  ) {
    const query = new URLSearchParams({
      person_id: personID,
      limit: String(limit),
      offset: String(offset),
    })
    appendAgentMediaQuery(query, filters)
    return this.request<AgentMediaItem[]>(
      'GET',
      `/v1/media/people/suggestion-items?${query.toString()}`,
    )
  }
  mediaSuggestedPersonItemRange(
    personID: string,
    limit = 200,
    offset = 0,
    filters: AgentMediaQuery = {},
  ) {
    const query = new URLSearchParams({
      range: 'true',
      person_id: personID,
      limit: String(limit),
      offset: String(offset),
    })
    appendAgentMediaQuery(query, filters)
    return this.request<AgentMediaItemRange>(
      'GET',
      `/v1/media/people/suggestion-items?${query.toString()}`,
    )
  }



  reviewMediaSuggestedPerson(
    suggestionID: string,
    state: 'pending' | 'dismissed',
  ) {
    return this.request<AgentMediaPersonSuggestionReview>(
      'PATCH',
      '/v1/media/people/suggestion-review',
      { suggestion_id: suggestionID, state },
    )
  }

  addMediaSuggestedPersonToPerson(
    personID: string,
    revision: number,
    suggestionID: string,
  ) {
    return this.request<AgentMediaPersonIdentity>(
      'POST',
      '/v1/media/people/add-suggestion',
      { person_id: personID, revision, suggestion_id: suggestionID },
    )
  }

  mediaPeople(includeHidden = false, limit = 100, offset = 0) {
    const query = new URLSearchParams({
      include_hidden: String(includeHidden),
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentMediaPersonIdentity[]>(
      'GET',
      `/v1/media/people/identities?${query.toString()}`,
    )
  }

  mediaPersonItems(
    personID: string,
    limit = 100,
    offset = 0,
    filters: AgentMediaQuery = {},
  ) {
    const query = new URLSearchParams({
      person_id: personID,
      limit: String(limit),
      offset: String(offset),
    })
    appendAgentMediaQuery(query, filters)
    return this.request<AgentMediaItem[]>(
      'GET',
      `/v1/media/people/identity-items?${query.toString()}`,
    )
  }
  mediaPersonItemRange(
    personID: string,
    limit = 200,
    offset = 0,
    filters: AgentMediaQuery = {},
  ) {
    const query = new URLSearchParams({
      range: 'true',
      person_id: personID,
      limit: String(limit),
      offset: String(offset),
    })
    appendAgentMediaQuery(query, filters)
    return this.request<AgentMediaItemRange>(
      'GET',
      `/v1/media/people/identity-items?${query.toString()}`,
    )
  }



  adoptMediaSuggestedPerson(suggestionID: string, name: string) {
    return this.request<AgentMediaPersonIdentity>(
      'POST',
      '/v1/media/people/adopt',
      { suggestion_id: suggestionID, name },
    )
  }

  updateMediaPerson(
    personID: string,
    revision: number,
    input: AgentUpdateMediaPersonInput,
  ) {
    return this.request<AgentMediaPersonIdentity>(
      'PATCH',
      '/v1/media/person',
      { person_id: personID, revision, ...input },
    )
  }

  mergeMediaPeople(targetID: string, revision: number, sourceIDs: string[]) {
    return this.request<AgentMediaPersonIdentity>(
      'POST',
      '/v1/media/person/merge',
      { target_id: targetID, revision, source_ids: sourceIDs },
    )
  }

  splitMediaPerson(
    personID: string,
    revision: number,
    nodeIDs: number[],
    name: string,
  ) {
    return this.request<AgentMediaPersonSplit>(
      'POST',
      '/v1/media/person/split',
      { person_id: personID, revision, node_ids: nodeIDs, name },
    )
  }

  createMediaAlbum(name: string) {
    return this.request<AgentMediaAlbum>('POST', '/v1/media/albums', { name })
  }

  renameMediaAlbum(albumID: string, revision: number, name: string) {
    return this.request<AgentMediaAlbum>('PATCH', '/v1/media/album', {
      album_id: albumID,
      revision,
      name,
    })
  }

  deleteMediaAlbum(albumID: string, revision: number) {
    return this.request<null>('DELETE', '/v1/media/album', {
      album_id: albumID,
      revision,
    })
  }

  addMediaAlbumItems(albumID: string, revision: number, nodeIDs: number[]) {
    return this.request<AgentMediaAlbum>('POST', '/v1/media/album/items', {
      album_id: albumID,
      revision,
      node_ids: nodeIDs,
    })
  }

  removeMediaAlbumItem(albumID: string, revision: number, nodeID: number) {
    return this.request<AgentMediaAlbum>('DELETE', '/v1/media/album/item', {
      album_id: albumID,
      revision,
      node_id: nodeID,
    })
  }

  createSmartMediaAlbum(name: string, query: AgentMediaQuery) {
    return this.request<AgentMediaAlbum>('POST', '/v1/media/smart-albums', { name, query })
  }

  updateSmartMediaAlbum(
    albumID: string,
    revision: number,
    input: { name?: string; query?: AgentMediaQuery },
  ) {
    return this.request<AgentMediaAlbum>('PATCH', '/v1/media/smart-album', {
      album_id: albumID,
      revision,
      ...input,
    })
  }

  deleteSmartMediaAlbum(albumID: string, revision: number) {
    return this.request<null>('DELETE', '/v1/media/smart-album', {
      album_id: albumID,
      revision,
    })
  }

  mediaAlbumItems(
    albumID: string,
    limit = 100,
    offset = 0,
    filters: AgentMediaQuery = {},
  ) {
    const query = new URLSearchParams({
      album_id: albumID,
      limit: String(limit),
      offset: String(offset),
    })
    appendAgentMediaQuery(query, filters)
    return this.request<AgentMediaItem[]>('GET', `/v1/media/albums/items?${query.toString()}`)
  }
  mediaAlbumItemRange(
    albumID: string,
    limit = 200,
    offset = 0,
    filters: AgentMediaQuery = {},
  ) {
    const query = new URLSearchParams({
      range: 'true',
      album_id: albumID,
      limit: String(limit),
      offset: String(offset),
    })
    appendAgentMediaQuery(query, filters)
    return this.request<AgentMediaItemRange>(
      'GET',
      `/v1/media/albums/items?${query.toString()}`,
    )
  }



  setMediaFavorite(nodeID: number, favorite: boolean) {
    return this.request<AgentMediaFavorite>(
      'PATCH',
      '/v1/media/favorite',
      { node_id: nodeID, favorite },
    )
  }

  setMediaFavoriteBatch(nodeIDs: number[], favorite: boolean) {
    return this.request<AgentMediaBatchFavorite>(
      'PATCH',
      '/v1/media/favorites',
      { node_ids: nodeIDs, favorite },
    )
  }

  addMediaTagsBatch(nodeIDs: number[], tags: string[]) {
    return this.request<AgentMediaBatchTags>(
      'POST',
      '/v1/media/tags/batch',
      { node_ids: nodeIDs, tags },
    )
  }

  setMediaTags(nodeID: number, tags: string[]) {
    return this.request<AgentMediaTags>(
      'PATCH',
      '/v1/media/tags',
      { node_id: nodeID, tags },
    )
  }

  setMediaPeople(nodeID: number, people: string[]) {
    return this.request<AgentMediaPeople>(
      'PATCH',
      '/v1/media/people',
      { node_id: nodeID, people },
    )
  }

  setMediaDescription(nodeID: number, description: string) {
    return this.request<AgentMediaDescription>(
      'PATCH',
      '/v1/media/description',
      { node_id: nodeID, description },
    )
  }

  mediaThumbnail(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.requestBinary(
      `/v1/media/thumbnail?${query.toString()}`,
      45_000,
    )
  }

  mediaVideoPoster(nodeID: number, revision: number, data: ArrayBuffer) {
    const query = new URLSearchParams({
      node_id: String(nodeID),
      revision: String(revision),
    })
    return this.requestBinaryUpload(
      `/v1/media/video-poster?${query.toString()}`,
      data,
      45_000,
    )
  }

  mediaLivePhotoStillTicket(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentFilePreviewTicket>(
      'GET',
      `/v1/media/live-photo-still-ticket?${query.toString()}`,
      undefined,
      45_000,
    )
  }

  mediaLivePhotoMotionTicket(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentFilePreviewTicket>(
      'GET',
      `/v1/media/live-photo-motion-ticket?${query.toString()}`,
      undefined,
      45_000,
    )
  }

  sources() {
    return this.request<AgentSource[]>('GET', '/v1/sources')
  }

  sourceRuns(sourceID: number, limit = 1, offset = 0) {
    const query = new URLSearchParams({
      source_id: String(sourceID),
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentSourceRun[]>('GET', `/v1/sources/runs?${query.toString()}`)
  }

  sourceRunFailures(sourceID: number, runID: string, limit = 20, offset = 0) {
    const query = new URLSearchParams({
      source_id: String(sourceID),
      run_id: runID,
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentSourceRunFailure[]>('GET', `/v1/sources/runs/failures?${query.toString()}`)
  }

  cancelSourceRun(sourceID: number, runID: string) {
    return this.request<AgentSourceRun>('POST', '/v1/sources/runs/cancel', {
      source_id: sourceID,
      run_id: runID,
    })
  }

  sourceItems(sourceID: number, state = '', limit = 1000, offset = 0) {
    const query = new URLSearchParams({
      source_id: String(sourceID),
      limit: String(limit),
      offset: String(offset),
    })
    if (state) query.set('state', state)
    return this.request<AgentSourceItem[]>('GET', `/v1/sources/items?${query.toString()}`)
  }

  sourceCollections(sourceID: number, state = '') {
    const query = new URLSearchParams({ source_id: String(sourceID) })
    if (state) query.set('state', state)
    return this.request<AgentSourceCollection[]>('GET', `/v1/sources/collections?${query.toString()}`)
  }

  sourceCollectionItems(sourceID: number, collectionID: number, limit = 100, offset = 0) {
    const query = new URLSearchParams({
      source_id: String(sourceID),
      collection_id: String(collectionID),
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentSourceCollectionItem[]>('GET', `/v1/sources/collections/items?${query.toString()}`)
  }

  sourceCredentialStatus(sourceID: number) {
    const query = new URLSearchParams({ source_id: String(sourceID) })
    return this.request<AgentSourceCredentialStatus>('GET', `/v1/sources/credential?${query.toString()}`)
  }

  revealSourceCredential(sourceID: number) {
    return this.request<AgentSourceCredentialReveal>('POST', '/v1/sources/credential/reveal', { source_id: sourceID })
  }

  testSourceCredential(kind: string, payload: string | Record<string, string>) {
    const normalized = typeof payload === 'string' ? { cookie: payload } : payload
    return this.request<AgentSourceCredentialTestResult>('POST', '/v1/source-credentials/test', { kind, payload: normalized }, 20_000)
  }

  testStoredSourceCredential(sourceID: number) {
    return this.request<AgentSourceCredentialTestResult>('POST', '/v1/sources/credential/test', { source_id: sourceID }, 20_000)
  }

  setSourceCredential(sourceID: number, payload: string | Record<string, string>) {
    const normalized = typeof payload === 'string' ? { cookie: payload } : payload
    return this.request<AgentSourceCredentialStatus>('PUT', '/v1/sources/credential', {
      source_id: sourceID,
      payload: normalized,
    })
  }

  deleteSourceCredential(sourceID: number) {
    return this.request<{ ok: boolean }>('DELETE', '/v1/sources/credential', { source_id: sourceID })
  }

  sourceConnectorConfig(sourceID: number) {
    const query = new URLSearchParams({ source_id: String(sourceID) })
    return this.request<AgentSourceConnectorConfig>('GET', `/v1/sources/connector-config?${query.toString()}`)
  }

  browseSourceDirectories(sourceID: number, path = '', limit = 200, offset = 0) {
    const query = new URLSearchParams({
      source_id: String(sourceID),
      limit: String(limit),
      offset: String(offset),
    })
    if (path) query.set('path', path)
    return this.request<AgentSourceBrowsePage>('GET', `/v1/sources/browse?${query.toString()}`)
  }

  setSourceConnectorConfig(sourceID: number, revision: number, payload: Record<string, unknown>) {
    return this.request<AgentSourceConnectorConfig>('PUT', '/v1/sources/connector-config', {
      source_id: sourceID,
      revision,
      payload,
    })
  }

  createSource(input: AgentCreateSourceInput) {
    return this.request<AgentSource>('POST', '/v1/sources', input)
  }

  updateSource(sourceID: number, revision: number, input: AgentUpdateSourceInput) {
    return this.request<AgentSource>('PATCH', '/v1/sources', {
      source_id: sourceID,
      revision,
      update: input,
    })
  }

  deleteSource(sourceID: number, revision: number) {
    return this.request<{ ok: boolean }>('DELETE', '/v1/sources', { source_id: sourceID, revision })
  }

  triggerSource(sourceID: number) {
    return this.request<AgentSource>('POST', '/v1/sources/trigger', { source_id: sourceID })
  }

  cloudRoot() {
    return this.request<AgentCloudNode>('GET', '/v1/cloud/root')
  }

  cloudChildren(parentID: number) {
    const query = new URLSearchParams({ parent_id: String(parentID) })
    return this.request<AgentCloudNode[]>('GET', `/v1/cloud/children?${query.toString()}`)
  }

  cloudChildrenPage(parentID: number, options: {
    limit?: number
    cursor?: string
    sort?: 'name' | 'updated' | 'size' | 'type'
    order?: 'asc' | 'desc'
    name?: string
    nameInsensitive?: string
  } = {}) {
    const query = new URLSearchParams({
      parent_id: String(parentID),
      limit: String(Math.min(500, Math.max(1, Math.trunc(options.limit ?? 200)))),
      sort: options.sort ?? 'name',
      order: options.order ?? 'asc',
    })
    if (options.cursor?.trim()) query.set('cursor', options.cursor.trim())
    if (options.name) query.set('name', options.name)
    if (options.nameInsensitive) query.set('name_ci', options.nameInsensitive)
    return this.request<AgentCloudChildrenPage>('GET', `/v1/cloud/children?${query.toString()}`)
  }

  cloudChildrenRange(
    parentID: number,
    offset: number,
    limit = 200,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    includeCount = true,
    grouping?: AgentFileExplorerGrouping,
  ) {
    const query = new URLSearchParams({
      parent_id: String(parentID),
      offset: String(Math.max(0, Math.trunc(offset))),
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      sort,
      order,
    })
    if (!includeCount) query.set('include_count', 'false')
    appendAgentFileExplorerGrouping(query, grouping)
    return this.request<AgentCloudChildrenRange>('GET', `/v1/cloud/children?${query.toString()}`)
  }

  cloudChanges(after = 0, limit = 200) {
    const query = new URLSearchParams({
      after: String(Math.max(0, Math.trunc(after))),
      limit: String(Math.min(1000, Math.max(1, Math.trunc(limit)))),
    })
    return this.request<AgentCloudNodeChangePage>('GET', `/v1/cloud/changes?${query.toString()}`)
  }

  cloudFileQuickAccess() {
    return this.request<AgentCloudQuickAccessItem[]>('GET', '/v1/cloud/quick-access')
  }

  cloudPinFileQuickAccess(nodeID: number) {
    return this.request<AgentCloudQuickAccessItem>('POST', '/v1/cloud/quick-access/pin', { id: nodeID })
  }

  cloudUnpinFileQuickAccess(nodeID: number) {
    return this.request<{ ok: boolean }>('POST', '/v1/cloud/quick-access/unpin', { id: nodeID })
  }


  cloudReorderFileQuickAccess(nodeIDs: number[]) {
    return this.request<{ ok: boolean }>('PUT', '/v1/cloud/quick-access/order', { node_ids: nodeIDs })
  }

  cloudFileTags() {
    return this.request<AgentFileTag[]>('GET', '/v1/cloud/tags')
  }

  cloudCreateFileTag(name: string, color: string) {
    return this.request<AgentFileTag>('POST', '/v1/cloud/tags', { name, color })
  }

  cloudUpdateFileTag(id: number, input: { name?: string; color?: string }) {
    return this.request<AgentFileTag>('PATCH', '/v1/cloud/tags', { id, ...input })
  }

  cloudDeleteFileTag(id: number) {
    return this.request<{ ok: boolean }>('DELETE', '/v1/cloud/tags', { id })
  }

  cloudQueryFileNodeTags(nodeIDs: number[]) {
    return this.request<AgentFileNodeTags[]>('POST', '/v1/cloud/tags/query', { node_ids: nodeIDs })
  }

  cloudSetFileTagNodes(tagID: number, nodeIDs: number[], assigned: boolean) {
    return this.request<{ ok: boolean }>(assigned ? 'PUT' : 'DELETE', '/v1/cloud/tags/nodes', {
      tag_id: tagID,
      node_ids: nodeIDs,
    })
  }

  cloudFileSavedSearches() {
    return this.request<AgentFileSavedSearch[]>('GET', '/v1/cloud/saved-searches')
  }

  cloudCreateFileSavedSearch(input: AgentFileSavedSearchInput) {
    return this.request<AgentFileSavedSearch>('POST', '/v1/cloud/saved-searches', input)
  }

  cloudUpdateFileSavedSearch(id: number, input: AgentFileSavedSearchInput) {
    return this.request<AgentFileSavedSearch>('PATCH', '/v1/cloud/saved-searches', { id, value: input })
  }

  cloudDeleteFileSavedSearch(id: number) {
    return this.request<{ ok: boolean }>('DELETE', '/v1/cloud/saved-searches', { id })
  }

  cloudReorderFileSavedSearches(ids: number[]) {
    return this.request<{ ok: boolean }>('PUT', '/v1/cloud/saved-searches/order', { ids })
  }

  cloudFileFavorites() {
    return this.request<AgentCloudFavoriteItem[]>('GET', '/v1/cloud/favorites')
  }

  cloudFavoriteFile(nodeID: number) {
    return this.request<AgentCloudFavoriteItem>('POST', '/v1/cloud/favorites/favorite', { id: nodeID })
  }

  cloudUnfavoriteFile(nodeID: number) {
    return this.request<{ ok: boolean }>('POST', '/v1/cloud/favorites/unfavorite', { id: nodeID })
  }

  cloudFileRecent(limit = 16) {
    const query = new URLSearchParams({ limit: String(Math.min(50, Math.max(1, Math.trunc(limit)))) })
    return this.request<AgentCloudRecentItem[]>('GET', `/v1/cloud/recent?${query.toString()}`)
  }

  cloudTouchFileRecent(nodeID: number) {
    return this.request<AgentCloudRecentItem>('POST', '/v1/cloud/recent/touch', { id: nodeID })
  }

  cloudClearFileRecent() {
    return this.request<{ ok: boolean }>('DELETE', '/v1/cloud/recent')
  }

  cloudCreateDirectory(parentID: number, name: string) {
    return this.request<AgentCloudNode>('POST', '/v1/cloud/directories', { parent_id: parentID, name }, 45_000)
  }

  cloudRename(id: number, revision: number, name: string) {
    return this.request<AgentCloudNode>('PATCH', '/v1/cloud/nodes', { id, revision, name }, 45_000)
  }

  cloudCopy(id: number, parentID: number) {
    return this.request<AgentCloudNode>('POST', '/v1/cloud/copy', { id, parent_id: parentID }, 45_000)
  }

  cloudMove(id: number, revision: number, parentID: number) {
    return this.request<AgentCloudNode>('PATCH', '/v1/cloud/move', { id, revision, parent_id: parentID }, 45_000)
  }

  cloudDelete(id: number, revision: number) {
    return this.request<{ ok: boolean }>('DELETE', '/v1/cloud/nodes', { id, revision }, 45_000)
  }

  cloudBatchCopy(items: AgentCloudBatchNodeRef[], parentID: number) {
    return this.request<AgentCloudBatchResult>('POST', '/v1/cloud/batch/copy', { items, parent_id: parentID }, 45_000)
  }

  cloudBatchMove(items: AgentCloudBatchNodeRef[], parentID: number) {
    return this.request<AgentCloudBatchResult>('POST', '/v1/cloud/batch/move', { items, parent_id: parentID }, 45_000)
  }

  cloudBatchDelete(items: AgentCloudBatchNodeRef[]) {
    return this.request<AgentCloudBatchResult>('POST', '/v1/cloud/batch/delete', { items }, 45_000)
  }

  cloudFilePropertiesStats(
    items: AgentCloudBatchNodeRef[],
    signal?: AbortSignal,
  ) {
    return this.request<AgentCloudFilePropertiesStats>(
      'POST',
      '/v1/cloud/properties/stats',
      { items },
      5 * 60_000,
      signal,
    )
  }

  cloudFileMediaDetails(items: AgentCloudBatchNodeRef[]) {
    return this.request<AgentCloudFileMediaDetails[]>(
      'POST',
      '/v1/cloud/media-details',
      { items },
      10_000,
    )
  }

  cloudCreateFileOperation(type: 'copy' | 'move' | 'delete', items: AgentCloudBatchNodeRef[], parentID?: number) {
    return this.request<AgentCloudFileOperation>('POST', '/v1/cloud/file-operations', {
      type,
      items,
      ...(parentID ? { parent_id: parentID } : {}),
    }, 45_000)
  }

  cloudBackgroundTaskActiveSummary() {
    return this.request<AgentBackgroundTaskActiveSummary>(
      'GET',
      '/v1/cloud/background-task-summary',
    )
  }

  cloudBackgroundTaskPage(global = false, limit = 50, cursor = '') {
    const query = new URLSearchParams({
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
      ...(global ? { global: 'true' } : {}),
    })
    if (cursor.trim()) query.set('cursor', cursor.trim())
    return this.request<AgentBackgroundTaskPage>(
      'GET',
      `/v1/cloud/background-task-page?${query.toString()}`,
    )
  }

  cloudBackgroundTasks(global = false, limit = 100) {
    const query = new URLSearchParams({
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
      ...(global ? { global: 'true' } : {}),
    })
    return this.request<AgentBackgroundTask[]>('GET', `/v1/cloud/background-tasks?${query.toString()}`)
  }

  cloudBackgroundTaskControl(id: string, action: string, global = false) {
    return this.request<AgentBackgroundTaskControlResult>(
      'POST',
      '/v1/cloud/background-task-control',
      { id, action, global },
      45_000,
    )
  }

  cloudFileOperations(limit = 100) {
    const query = new URLSearchParams({ limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))) })
    return this.request<AgentCloudFileOperation[]>('GET', `/v1/cloud/file-operations?${query.toString()}`)
  }

  cloudClearFileOperationHistory() {
    return this.request<void>('DELETE', '/v1/cloud/file-operations')
  }

  cloudFileOperation(id: string) {
    const query = new URLSearchParams({ id })
    return this.request<AgentCloudFileOperation>('GET', `/v1/cloud/file-operation?${query.toString()}`)
  }

  cloudCancelFileOperation(id: string) {
    return this.request<AgentCloudFileOperation>('POST', '/v1/cloud/file-operation/cancel', { id }, 45_000)
  }

  cloudRetryFileOperation(id: string) {
    return this.request<AgentCloudFileOperation>('POST', '/v1/cloud/file-operation/retry', { id }, 45_000)
  }

  cloudUndoFileOperation(id: string) {
    return this.request<AgentCloudFileOperation>('POST', '/v1/cloud/file-operation/undo', { id }, 45_000)
  }

  cloudRedoFileOperation(id: string) {
    return this.request<AgentCloudFileOperation>('POST', '/v1/cloud/file-operation/redo', { id }, 45_000)
  }

  cloudResolveFileOperationConflict(id: string, conflictPolicy: 'skip' | 'keep_both' | 'replace') {
    return this.request<AgentCloudFileOperation>('POST', '/v1/cloud/file-operation/resolve', {
      id,
      conflict_policy: conflictPolicy,
    }, 45_000)
  }

  cloudUploadPreflight(parentID: number, name: string) {
    return this.request<AgentCloudUploadConflictPreflight>('POST', '/v1/cloud/upload/preflight', {
      parent_id: parentID,
      name,
    }, 45_000)
  }

  cloudUploadPreflightBatch(items: Array<{ parent_id: number; name: string }>) {
    return this.request<AgentCloudUploadConflictPreflight[]>(
      'POST',
      '/v1/cloud/upload/preflight/batch',
      { items },
      45_000,
    )
  }

  cloudUploadWithConflictPolicy(
    parentID: number,
    localPath: string,
    name: string,
    conflictPolicy: 'fail' | 'skip' | 'keep_both' | 'overwrite',
    transferID = '',
  ) {
    return this.request<AgentCloudUploadResult>('POST', '/v1/cloud/upload/conflict', {
      parent_id: parentID,
      local_path: localPath,
      name,
      conflict_policy: conflictPolicy,
      ...(transferID ? { transfer_id: transferID } : {}),
    }, 6 * 60 * 60 * 1000)
  }

  cloudUpload(parentID: number, localPath: string, name: string) {
    return this.request<AgentCloudNode>('POST', '/v1/cloud/upload', {
      parent_id: parentID,
      local_path: localPath,
      name,
    }, 6 * 60 * 60 * 1000)
  }

  cloudFileTextPreview(id: number) {
    return this.request<AgentCloudFileTextPreview>('GET', `/v1/cloud/text-preview?id=${encodeURIComponent(String(id))}`)
  }

  cloudFilePreviewTicket(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentFilePreviewTicket>(
      'GET',
      `/v1/cloud/file-preview-ticket?${query.toString()}`,
      undefined,
      45_000,
    )
  }

  cloudDownload(id: number, destination: string) {
    return this.request<{ ok: boolean }>('POST', '/v1/cloud/download', {
      id,
      destination,
    }, 6 * 60 * 60 * 1000)
  }

  cloudDownloadFolder(id: number, parentID: number, destination: string) {
    return this.request<AgentCloudFolderDownloadResult>('POST', '/v1/cloud/download/folder', {
      id,
      parent_id: parentID,
      destination,
    }, 6 * 60 * 60 * 1000)
  }

  cloudDownloadArchive(ids: number[], destination: string) {
    return this.request<AgentCloudArchiveExtractResult>('POST', '/v1/cloud/download/archive', {
      ids,
      destination,
    }, 6 * 60 * 60 * 1000)
  }

  cloudSearch(
    queryText: string,
    cursor = '',
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    filters: AgentCloudSearchFilters = {},
  ) {
    const query = new URLSearchParams({ q: queryText, sort, order })
    if (cursor.trim()) query.set('cursor', cursor.trim())
    appendAgentCloudSearchFilters(query, filters)
    return this.request<AgentCloudSearchPage>('GET', `/v1/cloud/search?${query.toString()}`, undefined, 45_000)
  }

  cloudSearchRange(
    queryText: string,
    offset: number,
    limit = 200,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    filters: AgentCloudSearchFilters = {},
    grouping?: AgentFileExplorerGrouping,
  ) {
    const query = new URLSearchParams({
      q: queryText,
      offset: String(Math.max(0, Math.trunc(offset))),
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
      sort,
      order,
    })
    appendAgentCloudSearchFilters(query, filters)
    appendAgentFileExplorerGrouping(query, grouping)
    return this.request<AgentCloudSearchRange>(
      'GET',
      `/v1/cloud/search?${query.toString()}`,
      undefined,
      filters.availability ? 130_000 : 45_000,
    )
  }

  cloudQuota() {
    return this.request<AgentCloudQuota>('GET', '/v1/cloud/quota')
  }

  serverUpdate() {
    return this.request<AgentServerUpdateState>('GET', '/v1/server-update')
  }

  startServerUpdate(source: 'github' | 'gitlab', channel: 'stable' | 'master', backupFileData: boolean) {
    return this.request<AgentServerUpdateState>('POST', '/v1/server-update', {
      source,
      channel,
      backup_file_data: backupFileData,
    }, 45_000)
  }

  cloudStorageStats() {
    return this.request<AgentCloudStorageStats>('GET', '/v1/cloud/storage-stats')
  }

  cloudCleanupStorageCache(kind: AgentStorageCacheCleanupKind) {
    return this.request<AgentStorageCacheCleanup>(
      'POST',
      '/v1/cloud/storage-cache/cleanup',
      { kind },
      130_000,
    )
  }

  cloudTrash() {
    return this.request<AgentCloudNode[]>('GET', '/v1/cloud/trash')
  }

  cloudTrashRange(
    offset: number,
    limit = 200,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    includeCount = true,
  ) {
    const query = new URLSearchParams({
      offset: String(Math.max(0, Math.trunc(offset))),
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      sort,
      order,
      include_count: String(includeCount),
    })
    return this.request<AgentCloudTrashRange>('GET', `/v1/cloud/trash/range?${query.toString()}`)
  }

  cloudRestoreTrash(id: number, revision: number) {
    return this.request<AgentCloudNode>('POST', '/v1/cloud/trash/restore', { id, revision }, 45_000)
  }

  cloudDeleteTrash(id: number, revision: number) {
    return this.request<{ ok: boolean }>('POST', '/v1/cloud/trash/delete', { id, revision }, 45_000)
  }

  cloudVersions(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentCloudVersion[]>('GET', `/v1/cloud/versions?${query.toString()}`)
  }

  cloudRestoreVersion(nodeID: number, currentRevision: number, versionID: number) {
    return this.request<AgentCloudNode>('POST', '/v1/cloud/versions/restore', {
      node_id: nodeID,
      current_revision: currentRevision,
      version_id: versionID,
    }, 45_000)
  }

  cloudShares(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentCloudShare[]>('GET', `/v1/cloud/shares?${query.toString()}`)
  }

  cloudCreateShare(nodeID: number, input: { expires_at?: string; password?: string; max_downloads?: number }) {
    return this.request<AgentCreatedCloudShare>('POST', '/v1/cloud/shares', {
      node_id: nodeID,
      expires_at: input.expires_at || '',
      password: input.password || '',
      max_downloads: input.max_downloads ?? 0,
    })
  }

  cloudRevokeShare(id: number) {
    return this.request<{ ok: boolean }>('POST', '/v1/cloud/shares/revoke', { id })
  }

  fileAvailability(path: string) {
    const query = new URLSearchParams({ path })
    return this.request<AgentFileAvailability>('GET', `/v1/file-availability?${query.toString()}`)
  }

  fileAvailabilityBatch(paths: string[]) {
    return this.request<AgentFileAvailabilityBatch>(
      'POST',
      '/v1/file-availability/batch',
      { paths },
      30_000,
    )
  }

  setFileAvailability(path: string, action: 'keep' | 'release' | 'online' | 'sync') {
    return this.request<AgentFileAvailability | { ok: boolean }>('POST', '/v1/file-availability', { path, action }, 130_000)
  }

  transfers() {
    return this.request<AgentTransfers>('GET', '/v1/transfers')
  }

  transferEvents(afterRevision: number, timeoutMs = 25_000, signal?: AbortSignal) {
    const query = new URLSearchParams({
      after_revision: String(afterRevision),
      timeout_ms: String(timeoutMs),
    })
    return this.request<AgentTransferEvent | null>(
      'GET',
      `/v1/transfer-events?${query.toString()}`,
      undefined,
      Math.min(timeoutMs + 5_000, 35_000),
      signal,
    )
  }

  retryTransfer(id: string) {
    return this.request<AgentTransfers>('POST', '/v1/transfers/retry', { id }, 130_000)
  }

  transferLifecycle(input: AgentTransferLifecycleInput) {
    return this.request<{ id?: string; ids?: string[]; ok?: boolean }>('POST', '/v1/transfers/lifecycle', input)
  }

  clearTransferHistory(scope: 'all' | 'network' | 'local' = 'all') {
    return this.request<AgentTransfers>('DELETE', scope === 'all' ? '/v1/transfers' : `/v1/transfers?scope=${scope}`)
  }

  diagnostics() {
    return this.request<AgentDiagnosticReport>('GET', '/v1/diagnostics', undefined, 60_000)
  }

  diagnosticReport() {
    return this.request<{ report: string }>('GET', '/v1/diagnostics/report', undefined, 60_000)
  }

  reconnect() {
    return this.request<AgentStatus>('POST', '/v1/diagnostics/reconnect', undefined, 45_000)
  }

  repairSyncRoot() {
    return this.request<AgentStatus>('POST', '/v1/diagnostics/repair-sync-root', undefined, 45_000)
  }

  openLogs() {
    return this.request<{ ok: boolean }>('POST', '/v1/diagnostics/open-logs')
  }

  async conflicts() {
    const result = await this.request<{ conflicts: AgentConflict[] }>('GET', '/v1/conflicts')
    return result.conflicts
  }

  openConflict(id: string, both: boolean) {
    return this.request<{ ok: boolean }>('POST', '/v1/conflicts/open', { id, both })
  }

  resolveConflict(id: string, choice: 'server' | 'local') {
    return this.request<{ ok: boolean }>('POST', '/v1/conflicts/resolve', { id, choice }, 130_000)
  }

  openFolder() {
    return this.request<{ ok: boolean }>('POST', '/v1/open-folder')
  }

  openPath(path: string, reveal = false) {
    return this.request<{ ok: boolean }>('POST', '/v1/open-path', { path, reveal })
  }

  openWith(path: string) {
    return this.request<{ ok: boolean }>('POST', '/v1/open-with', { path })
  }

  shutdown() {
    return this.request<{ ok: boolean }>('POST', '/v1/lifecycle/shutdown')
  }

  private async loadDiscovery(force = false): Promise<AgentDiscovery> {
    if (this.discovery && !force) return this.discovery
    let raw: string
    try {
      raw = await readFile(this.discoveryPath, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      throw new AgentIPCError(
        'agent_unavailable',
        0,
        code === 'ENOENT'
          ? 'xdrive-agent is not running or has not published Desktop IPC yet.'
          : 'Unable to read xdrive-agent Desktop IPC discovery data.',
      )
    }

    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new AgentIPCError('invalid_discovery', 0, 'xdrive-agent Desktop IPC discovery data is invalid.')
    }
    const discovery = validateDiscovery(value)
    this.discovery = discovery
    return discovery
  }

  private async requestBinaryUpload(
    endpoint: string,
    data: ArrayBuffer,
    timeoutMs = 10_000,
  ): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const discovery = await this.loadDiscovery(attempt > 0)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetch(new URL(endpoint, discovery.base_url), {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${discovery.token}`,
            Accept: 'application/json',
            'Content-Type': 'image/jpeg',
          },
          body: data,
          cache: 'no-store',
          signal: controller.signal,
        })
        if (response.ok) return

        const raw = await response.text()
        let payload: unknown = {}
        if (raw) {
          try {
            payload = JSON.parse(raw)
          } catch {
            payload = {}
          }
        }
        const errorPayload = payload as { error?: unknown; message?: unknown; detail?: unknown }
        const code = typeof errorPayload.error === 'string' ? errorPayload.error : 'agent_error'
        const message = typeof errorPayload.message === 'string'
          ? errorPayload.message
          : `xdrive-agent request failed with HTTP ${response.status}.`
        const detail = typeof errorPayload.detail === 'string' ? errorPayload.detail : undefined
        const apiError = new AgentIPCError(code, response.status, message, detail)
        if (response.status === 401 && attempt === 0) {
          this.invalidate()
          lastError = apiError
          continue
        }
        throw apiError
      } catch (error) {
        if (error instanceof AgentIPCError) throw error
        lastError = error
        this.invalidate()
        if (attempt === 0) continue
      } finally {
        clearTimeout(timer)
      }
    }

    throw new AgentIPCError(
      'agent_unavailable',
      0,
      lastError instanceof Error ? `xdrive-agent is not reachable: ${lastError.message}` : 'xdrive-agent is not reachable.',
    )
  }

  private async requestBinary(
    endpoint: string,
    timeoutMs = 10_000,
    externalSignal?: AbortSignal,
    onProgress?: AgentBinaryProgressHandler,
  ): Promise<AgentMediaThumbnail> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const discovery = await this.loadDiscovery(attempt > 0)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const abort = () => controller.abort()
      externalSignal?.addEventListener('abort', abort, { once: true })

      try {
        const response = await fetch(new URL(endpoint, discovery.base_url), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${discovery.token}`,
            Accept: 'image/*, application/octet-stream',
          },
          cache: 'no-store',
          signal: controller.signal,
        })

        if (!response.ok) {
          const text = await response.text()
          let payload: unknown = {}
          if (text) {
            try {
              payload = JSON.parse(text)
            } catch {
              payload = {}
            }
          }
          const errorPayload = payload as { error?: unknown; message?: unknown; detail?: unknown }
          const code = typeof errorPayload.error === 'string' ? errorPayload.error : 'agent_error'
          const message = typeof errorPayload.message === 'string'
            ? errorPayload.message
            : `xdrive-agent request failed with HTTP ${response.status}.`
          const detail = typeof errorPayload.detail === 'string' ? errorPayload.detail : undefined
          const apiError = new AgentIPCError(code, response.status, message, detail)
          if (response.status === 401 && attempt === 0) {
            this.invalidate()
            lastError = apiError
            continue
          }
          throw apiError
        }

        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() || 'application/octet-stream'
        if (!onProgress) {
          return {
            content_type: contentType,
            data: await response.arrayBuffer(),
          }
        }

        const rawTotal = Number(response.headers.get('content-length') || '')
        const totalBytes = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : undefined
        onProgress(0, totalBytes)
        if (!response.body) {
          const data = await response.arrayBuffer()
          onProgress(data.byteLength, totalBytes ?? data.byteLength)
          return { content_type: contentType, data }
        }

        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let loadedBytes = 0
        let lastProgressAt = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value?.byteLength) continue
          chunks.push(value)
          loadedBytes += value.byteLength
          const now = Date.now()
          if (now - lastProgressAt >= 100) {
            lastProgressAt = now
            onProgress(loadedBytes, totalBytes)
          }
        }

        const data = new Uint8Array(loadedBytes)
        let offset = 0
        for (const chunk of chunks) {
          data.set(chunk, offset)
          offset += chunk.byteLength
        }
        onProgress(loadedBytes, totalBytes)
        return {
          content_type: contentType,
          data: data.buffer,
        }
      } catch (error) {
        if (externalSignal?.aborted) {
          throw new AgentIPCError('aborted', 0, 'Desktop IPC request was cancelled.')
        }
        if (error instanceof AgentIPCError) throw error
        lastError = error
        this.invalidate()
        if (attempt === 0) continue
      } finally {
        clearTimeout(timer)
        externalSignal?.removeEventListener('abort', abort)
      }
    }

    throw new AgentIPCError(
      'agent_unavailable',
      0,
      lastError instanceof Error ? `xdrive-agent is not reachable: ${lastError.message}` : 'xdrive-agent is not reachable.',
    )
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    timeoutMs = 10_000,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const discovery = await this.loadDiscovery(attempt > 0)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const abort = () => controller.abort()
      externalSignal?.addEventListener('abort', abort, { once: true })

      try {
        const response = await fetch(new URL(endpoint, discovery.base_url), {
          method,
          headers: {
            Authorization: `Bearer ${discovery.token}`,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          signal: controller.signal,
        })

        if (response.status === 204) return null as T

        const text = await response.text()
        let payload: unknown = {}
        if (text) {
          try {
            payload = JSON.parse(text)
          } catch {
            throw new AgentIPCError('invalid_response', response.status, 'xdrive-agent returned invalid JSON.')
          }
        }

        if (!response.ok) {
          const errorPayload = payload as { error?: unknown; message?: unknown; detail?: unknown }
          const code = typeof errorPayload.error === 'string' ? errorPayload.error : 'agent_error'
          const message = typeof errorPayload.message === 'string'
            ? errorPayload.message
            : `xdrive-agent request failed with HTTP ${response.status}.`
          const detail = typeof errorPayload.detail === 'string' ? errorPayload.detail : undefined
          const apiError = new AgentIPCError(code, response.status, message, detail)
          if (response.status === 401 && attempt === 0) {
            this.invalidate()
            lastError = apiError
            continue
          }
          throw apiError
        }
        return payload as T
      } catch (error) {
        if (externalSignal?.aborted) {
          throw new AgentIPCError('aborted', 0, 'Desktop IPC request was cancelled.')
        }
        if (error instanceof AgentIPCError) throw error
        lastError = error
        this.invalidate()
        if (attempt === 0) continue
      } finally {
        clearTimeout(timer)
        externalSignal?.removeEventListener('abort', abort)
      }
    }

    throw new AgentIPCError(
      'agent_unavailable',
      0,
      lastError instanceof Error ? `xdrive-agent is not reachable: ${lastError.message}` : 'xdrive-agent is not reachable.',
    )
  }
}

function validateDiscovery(value: unknown): AgentDiscovery {
  if (!value || typeof value !== 'object') {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC discovery must be an object.')
  }
  const discovery = value as Partial<AgentDiscovery>
  if (discovery.version !== 1) {
    throw new AgentIPCError('unsupported_ipc_version', 0, 'Unsupported xdrive-agent Desktop IPC version.')
  }
  if (typeof discovery.base_url !== 'string' || typeof discovery.token !== 'string' || typeof discovery.pid !== 'number') {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC discovery is missing required fields.')
  }
  if (
    !/^[0-9a-f]{64}$/i.test(discovery.token) ||
    !Number.isInteger(discovery.pid) ||
    discovery.pid <= 0
  ) {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC discovery credentials are invalid.')
  }

  let url: URL
  try {
    url = new URL(discovery.base_url)
  } catch {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC base URL is invalid.')
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC must use an ephemeral 127.0.0.1 HTTP endpoint.')
  }
  return discovery as AgentDiscovery
}
