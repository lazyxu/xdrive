export type XDriveServiceDependencyState =
  | 'ready'
  | 'unavailable'
  | 'disabled'
  | 'unknown'
  | 'planned'

export type XDriveServiceDependencyGroup =
  | 'core'
  | 'media'
  | 'intelligence'
  | 'location'

export type XDriveServiceConfigMode = 'in-app' | 'deployment' | 'planned'
export type XDriveServiceApplyMode = 'immediate' | 'task-boundary' | 'manual-reload' | 'controlled-restart' | 'not-available'

export type XDriveServiceDependency = {
  id: string
  group: XDriveServiceDependencyGroup
  label: string
  status: XDriveServiceDependencyState
  detail: string
  version?: string
  model?: string
  config_mode?: XDriveServiceConfigMode
  apply_mode?: XDriveServiceApplyMode
  config_hint?: string
}

export type XDriveServiceDependenciesSnapshot = {
  checked_at: string
  services: XDriveServiceDependency[]
}

export type XDrivePostgresPoolValues = {
  max_open_connections: number
  max_idle_connections: number
}
export type XDrivePostgresPoolReplicaSummary = {
  state: 'unknown' | 'unavailable' | 'unmanaged' | 'pending' | 'applied'
  observed_instances: number
  applied_instances: number
  pending_instances: number
  unmanaged_instances: number
  truncated: boolean
  limits_consistent: boolean
  policy_groups: Array<{ revision: number; max_open_connections: number; max_idle_connections: number; count: number }>
}
export type XDrivePostgresPoolConfig = {
  desired: XDrivePostgresPoolValues
  effective?: XDrivePostgresPoolValues
  revision: number
  effective_revision: number
  source: 'default' | 'saved'
  apply_state: 'unmanaged' | 'pending' | 'applied'
  editable: boolean
  requires_restart: boolean
  updated_at?: string
  current_max_open_connections: number
  open_connections: number
  in_use_connections: number
  idle_connections: number
  replicas?: XDrivePostgresPoolReplicaSummary
}
export type XDrivePostgresPoolUpdate = { revision: number; desired: XDrivePostgresPoolValues }
export type XDrivePostgresPoolRevisionPage = {
  items: Array<{
    revision: number
    desired: XDrivePostgresPoolValues
    origin: 'default' | 'saved' | 'rollback'
    created_at: string
  }>
}
export type XDrivePostgresPoolRollbackInput = { revision: number; target_revision: number }

export type XDrivePhotoAutoKinds = {
  face: boolean
  smart: boolean
  semantic: boolean
  person_cluster: boolean
}

export type XDrivePhotoAutoConfig = {
  auto_enabled: boolean
  effective_auto_enabled: boolean
  kinds?: XDrivePhotoAutoKinds
  effective_kinds?: XDrivePhotoAutoKinds
  revision: number
  effective_revision: number
  source: 'default' | 'saved'
  apply_state: 'applied' | 'pending'
  editable: boolean
  requires_restart: boolean
  updated_at?: string
}

export type XDrivePhotoAutoUpdate = {
  revision: number
  auto_enabled: boolean
  kinds?: XDrivePhotoAutoKinds
}

export type XDrivePhotoAutoRevision = {
  revision: number
  auto_enabled: boolean
  kinds: XDrivePhotoAutoKinds
  origin: 'default' | 'saved' | 'rollback'
  created_at: string
}

export type XDrivePhotoAutoRevisionPage = { items: XDrivePhotoAutoRevision[] }

export type XDrivePhotoAutoRollbackInput = {
  revision: number
  target_revision: number
}

export type XDriveGeoNamesSnapshot = {
  fingerprint: string
  resolver_version: string
  checked_radius_km: number
  checked_revision: number
  total_bytes: number
  created_at: string
  locally_present: boolean
}
export type XDriveGeoNamesSnapshotInput = { revision: number; expected_version: string }
export type XDriveGeoNamesSnapshotResult = {
  staged: boolean
  applied: boolean
  snapshot: XDriveGeoNamesSnapshot
}
export type XDriveGeoNamesRestoreMissingInput = {
  revision: number
  expected_version: string
  expected_fingerprint: string
}
export type XDriveGeoNamesDatasetApplyInput = {
  revision: number
  expected_version: string
  expected_fingerprint: string
  target: string
}

export type XDriveGeoNamesConfig = {
  dataset_configured: boolean
  reload_supported: boolean
  source: 'environment' | 'saved'
  current_version: string
  max_distance_km: number
  effective_max_distance_km: number
  effective_revision?: number
  editable: boolean
  revision: number
  apply_state: 'applied' | 'pending' | 'unavailable'
  // Optional for older Servers/Agents; a missing field is not a green fleet.
  replica_apply_state?: 'unknown' | 'unmanaged' | 'unavailable' | 'pending' | 'applied'
  observed_instances?: number
  applied_instances?: number
  unconfigured_instances?: number
  replica_status_truncated?: boolean
  dataset_versions_consistent?: boolean
  dataset_versions?: Array<{ version: string; count: number }>
  snapshot_supported?: boolean
  snapshot_requirement?: string
  snapshot_history_known?: boolean
  snapshots?: XDriveGeoNamesSnapshot[]
  snapshot_apply_supported?: boolean
  missing_archive_state?: 'not-selected' | 'missing' | 'present-unverified' | 'invalid' | 'unavailable'
  restore_missing_enabled?: boolean
  restore_missing_hint?: string
  desired_dataset_fingerprint?: string
  active_dataset_fingerprint?: string
  active_dataset_source?: 'deployment' | 'snapshot'
  active_dataset_persistent?: boolean
  updated_at?: string
  requires_restart: boolean
}

export type XDriveGeoNamesRevision = {
  revision: number
  max_distance_km: number
  origin: 'environment' | 'saved' | 'rollback'
  created_at: string
}

export type XDriveGeoNamesRevisionPage = { items: XDriveGeoNamesRevision[] }

export type XDriveGeoNamesRollbackInput = {
  revision: number
  target_revision: number
}

export type XDriveGeoNamesUpdate = {
  revision: number
  max_distance_km: number
}
export type XDriveGeoNamesReloadResult = {
  applied: boolean
  changed: boolean
  previous_version: string
  current_version: string
  checked_at: string
}

export type XDriveBaiduMapAdminConfig = {
  enabled: boolean
  configured: boolean
  source: 'environment' | 'saved'
  editable: boolean
  requires_restart: boolean
  revision: number
  updated_at?: string
}

export type XDriveBaiduMapAKReveal = {
  field: 'ak'
  value: string
  expires_in_seconds: number
}

export type XDriveBaiduMapAdminUpdate = {
  enabled: boolean
  revision: number
  ak?: string
  clear_ak?: boolean
}

export type XDriveSourceWorkerValues = {
  scan_interval_seconds: number
  poll_interval_seconds: number
  max_concurrency: number
}

export type XDriveSourceWorkerEffectiveGroup = {
  config: XDriveSourceWorkerValues
  revision: number
  count: number
}

export type XDriveSourceWorkerConfig = {
  desired: XDriveSourceWorkerValues
  revision: number
  source: 'default' | 'saved'
  updated_at?: string
  effective: XDriveSourceWorkerEffectiveGroup[]
  active_instances: number
  applied_instances: number
  truncated: boolean
  apply_state: 'unmanaged' | 'unavailable' | 'pending' | 'applied'
  editable: boolean
  requires_restart: boolean
}

export type XDriveSourceWorkerUpdate = {
  revision: number
  desired: XDriveSourceWorkerValues
}

export type XDriveSourceWorkerRevision = {
  revision: number
  desired: XDriveSourceWorkerValues
  origin: 'default' | 'saved' | 'rollback'
  created_at: string
}

export type XDriveSourceWorkerRevisionPage = { items: XDriveSourceWorkerRevision[] }
export type XDriveSourceWorkerRollbackInput = { revision: number; target_revision: number }
