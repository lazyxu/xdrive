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
  // Old Agent versions omit these axes: unknown is the only safe fallback.
  configuration_state?: 'configured' | 'unconfigured' | 'unknown'
  installation_state?: 'observed' | 'external' | 'unknown'
  health_state?: 'ready' | 'failed' | 'not-checked' | 'unknown'
  activation_state?: 'verified' | 'local-effective' | 'pending' | 'deployment-only' | 'unknown'
  automatic_policy_state?: 'enabled' | 'paused' | 'partial' | 'pending' | 'unmanaged' | 'unknown' | 'not-applicable'
  automatic_policy_desired_revision?: number
  automatic_policy_effective_revision?: number
  // Only Caddy reports these trusted host observations, never the domain itself.
  https_configured?: boolean
  local_tls_state?: 'disabled' | 'verified' | 'failed' | 'unavailable' | 'invalid-config'
  // Trusted Host Manager observation of one fixed photo-face container;
  // NEVER a saved/effective model revision or a model Info health response.
  photo_host_runtime_state?: 'healthy' | 'unhealthy' | 'starting' | 'running-unverified' | 'stopped' | 'unknown'
  photo_host_profile_configured?: boolean
}

export type XDriveServiceDependenciesSnapshot = {
  checked_at: string
  services: XDriveServiceDependency[]
}

// Administrator-only Caddy HTTPS intent, never evidence of installed host configuration.
export type XDriveCaddyHTTPSConfig = {
  desired_enabled: boolean
  desired_domain: string
  revision: number
  source: 'default' | 'saved'
  updated_at?: string
  apply_state: 'unmanaged' | 'pending'
  editable: boolean
  apply_supported: boolean
  requires_restricted_maintenance: boolean
  requirement: string
  host_observed: boolean
  host_https_configured: boolean
  host_tls_state: 'unknown' | 'disabled' | 'verified' | 'failed' | 'unavailable' | 'invalid-config'
}
export type XDriveCaddyHTTPSUpdate = { revision: number; enabled: boolean; domain: string }
export type XDriveCaddyHTTPSRevision = {
  revision: number
  enabled: boolean
  domain: string
  origin: 'default' | 'saved' | 'rollback'
  created_at: string
}
export type XDriveCaddyHTTPSRevisionPage = { items: XDriveCaddyHTTPSRevision[] }
export type XDriveCaddyHTTPSRollbackInput = { revision: number; target_revision: number }

// AliDNS DNS-01 pair is staged encrypted for the administrator, not applied to Caddy.
export type XDriveCaddyAliDNSConfig = {
  configured: boolean
  revision: number
  source: 'unset' | 'saved'
  updated_at?: string
  editable: boolean
  apply_state: 'unmanaged' | 'pending'
  apply_supported: false
  requirement: string
}
export type XDriveCaddyAliDNSUpdate = {
  revision: number
  access_key_id?: string
  access_key_secret?: string
  clear?: boolean
}
export type XDriveCaddyAliDNSReveal = {
  access_key_id: string
  access_key_secret: string
  expires_in_seconds: number
}

// Read-only, sanitized local prerequisite report; no Caddy or DNS apply.
// A live fixed AliDNS DescribeSubDomainRecords probe, not DNS write authorization.
export type XDriveCaddyAliDNSReadVerifyInput = {
  desired_revision: number
  credential_revision: number
}
export type XDriveCaddyAliDNSReadVerify = {
  state: 'read_authorized' | 'denied' | 'unavailable'
  desired_revision: number
  credential_revision: number
  checked_at: string
  read_permission_verified: boolean
  write_permission_verified: false
  apply_supported: false
  public_https_verified: false
  detail: string
}

export type XDriveCaddyPreflightCheck = {
  id: 'desired' | 'domain' | 'alidns' | 'host-manager' | 'ingress' | 'restricted-apply' | 'public-https'
  state: 'pass' | 'missing' | 'blocked' | 'unknown' | 'not-required'
  detail: string
}
export type XDriveCaddyHTTPSPreflight = {
  checked_at: string
  action: 'enable' | 'disable' | 'unset'
  desired_revision: number
  credential_revision: number
  configuration_complete: boolean
  host_observed: boolean
  host_ingress_ready: boolean
  host_local_tls_verified: boolean
  // Only host-configured SNI matched a successful local TLS handshake.
  // Not a desired revision receipt, public DNS/HTTPS or safe Caddy apply.
  desired_domain_local_match?: 'matched-local' | 'mismatch-local' | 'unverified'
  apply_supported: boolean
  checks: XDriveCaddyPreflightCheck[]
}

export type XDriveMediaWorkerHostStatus = {
  supported: boolean
  state: 'unavailable' | 'idle' | 'queued' | 'running' | 'success' | 'failed'
  revision: number
  applied_revision: number
  enabled: boolean
  observed_enabled: boolean
  memory_mib: number
  observed_memory_mib: number
  memory_verified: boolean
  cpu_milli: number
  observed_cpu_milli: number
  cpu_verified: boolean
  cpu_control_supported: boolean
  pids_limit: number
  observed_pids_limit: number
  pids_verified: boolean
  pids_control_supported: boolean
  request_id?: string
  updated_at?: string
}
export type XDriveMediaWorkerConfig = {
  desired_enabled: boolean
  desired_memory_mib: number
  desired_cpu_milli: number
  desired_pids_limit: number
  revision: number
  source: 'default' | 'saved'
  updated_at?: string
  apply_state: 'unmanaged' | 'pending' | 'applied' | 'failed' | 'unavailable'
  host: XDriveMediaWorkerHostStatus
  runtime_ready: boolean
  editable: boolean
  apply_supported: boolean
  requires_restart: boolean
}
export type XDriveMediaWorkerUpdate = { revision: number; enabled: boolean; memory_mib: number; cpu_milli: number; pids_limit: number }
export type XDriveMediaWorkerApplyResult = {
  state: 'queued'
  revision: number
  enabled: boolean
  memory_mib: number
  cpu_milli: number
  pids_limit: number
  request_id: string
}
export type XDriveMediaWorkerRevisionPage = {
  items: Array<{ revision: number; enabled: boolean; memory_mib: number; cpu_milli: number; pids_limit: number; origin: 'default' | 'saved' | 'rollback'; created_at: string }>
}
export type XDriveMediaWorkerRollbackInput = { revision: number; target_revision: number }

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

// This contract is for the ONE shared Photo Intelligence host. It is
// independent from the per-kind automatic-analysis scheduling policy.
export type XDrivePhotoHostConfig = {
  desired_enabled: boolean
  revision: number
  source: 'default' | 'saved'
  updated_at?: string
  apply_state: 'unmanaged' | 'pending' | 'queued' | 'host-verified' | 'failed'
  editable: boolean
  apply_supported: boolean
  apply_request_id?: string
  apply_revision?: number
  requirement: string
  host_observed: boolean
  host_runtime_state: 'healthy' | 'unhealthy' | 'starting' | 'running-unverified' | 'stopped' | 'unknown'
  host_profile_configured?: boolean
  // Host Manager capability/revision observation only. No admin /apply yet.
  host_control_supported?: boolean
  host_control_state?: 'unavailable' | 'idle' | 'queued' | 'running' | 'success' | 'failed'
  host_control_revision?: number
  host_applied_revision?: number
  host_control_profile_verified?: boolean
}
export type XDrivePhotoHostModelInfoCheck = {
  id: 'photo-face' | 'photo-smart' | 'photo-semantic' | 'photo-creative'
  state: 'ready' | 'failed' | 'unconfigured' | 'unknown'
  detail: string
}
export type XDrivePhotoHostPreflight = {
  checked_at: string
  action: 'unset' | 'enable' | 'disable'
  desired_revision: number
  local_checks_complete: boolean
  host_observed: boolean
  host_control_observed: boolean
  apply_supported: boolean
  // Optional for older Server/Agent versions; independent model Info is NOT
  // same-host revision attestation or a successful media analysis job.
  host_revision_verified?: boolean
  model_info_checks?: XDrivePhotoHostModelInfoCheck[]
  // Four Info endpoints self-report one process boot ID, not a Host Manager
  // container/request attestation, real task completion or fleet readiness.
  model_instance_coherent?: boolean
  // Docker's fixed-container healthcheck output agrees with all four Info
  // process hashes. NOT kernel-level socket ownership or real task success.
  docker_healthcheck_matched?: boolean
  // Linux kernel listener/FD evidence of fixed Docker PID, requires four
  // Info + digest agreement. Not a real task or stop/restart authorization.
  socket_owner_verified?: boolean
  // One audited Host Manager enable-revision/request receipt pinned an earlier
  // same-session model digest, still matching today's owner/digest/Info check.
  // Not cryptographic model request attestation or a completed photo job.
  request_generation_correlated?: boolean
  // All four Info endpoints echo the same audited model-side host request.
  // This is request acknowledgment, NOT a successful model/media task.
  model_request_ack_verified?: boolean
  // Running persisted photo analyses, clustering or queued/running Creative
  // can block stop; no rows/old Server/DB errors NEVER prove fleet idle.
  durable_work_blocker_state?: 'blocked' | 'unverified'
  // Fresh cross-Server background-runtime presence can veto stop; missing or
  // expired reports never certify all Server replicas are drained.
  runtime_work_blocker_state?: 'blocked' | 'unverified'
  // Stale previously registered Server -> blocked; even fresh/empty members
  // cannot certify cluster membership or a global admission fence.
  replica_membership_blocker_state?: 'blocked' | 'unverified'
  // No safe/verified value. Configured model Bearer cannot approve stop.
  private_ingress_auth_blocker_state?: 'blocked' | 'unverified'
  // Only the current four same-process Info and audited Host ACK are observed.
  // No positive stop or cross-Server inference-admission state exists.
  private_ingress_policy_observation?: 'strict-local' | 'legacy-local' | 'inconsistent' | 'unverified'
  // Deployment-supplied public file/hash integrity only, never runtime or fleet trust.
  trust_material_observation?: 'material-only' | 'root-pin-match-local' | 'blocked' | 'unverified'
  // Only ONE fixed synthetic semantic text inference; not a media/image,
  // Face, OCR, Creative, fleet activation or safe-stop proof.
  semantic_text_task_state?: 'verified' | 'failed' | 'throttled' | 'unverified'
  // Actual semantic image encoder on fixed model-local synthetic pixels.
  // Does not prove real gallery images, other models or fleet activation.
  semantic_image_task_state?: 'verified' | 'failed' | 'throttled' | 'unverified'
  // YuNet executed on fixed NON-person pixels; zero faces is acceptable.
  // Not a SFace identification, real-photo or model accuracy proof.
  face_detector_task_state?: 'verified' | 'failed' | 'throttled' | 'unverified'
  // Fixed non-person SFace feature vector validation, not genuine face
  // recognition correctness or identification of any person.
  sface_task_state?: 'verified' | 'failed' | 'throttled' | 'unverified'
  // Model-local real EfficientSAM cutout/PNG geometry check only; no media
  // quality, other Creative tasks, fleet activation or host stop authority.
  creative_cutout_task_state?: 'verified' | 'failed' | 'throttled' | 'unverified'
  // Synthetic classifier, PP-OCR detector and CRNN calls executed; no
  // classification or OCR accuracy / real media / fleet claim.
  smart_model_task_state?: 'verified' | 'failed' | 'throttled' | 'unverified'
  // An optional known-text CRNN match from the SAME verified synthetic probe.
  // Absence is explicitly unverified for an older model or Server.
  smart_ocr_fixture_state?: 'verified' | 'mismatch' | 'throttled' | 'unverified'
  checks: Array<{
    id: 'desired' | 'direction' | 'host-manager' | 'runtime' | 'work-queue' | 'admin-dispatch' | 'effect-proof'
    state: 'pass' | 'missing' | 'blocked' | 'unknown'
    detail: string
  }>
}
export type XDrivePhotoHostApplyInput = { revision: number }
export type XDrivePhotoHostApplyResult = { state: 'queued'; revision: number; request_id: string }
export type XDrivePhotoHostUpdate = { revision: number; enabled: boolean }
export type XDrivePhotoHostRevisionPage = {
  items: Array<{
    revision: number
    enabled: boolean
    origin: 'default' | 'saved' | 'rollback'
    created_at: string
  }>
}
export type XDrivePhotoHostRollbackInput = { revision: number; target_revision: number }

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

export type XDriveBaiduMapVerification = {
  state: 'verified' | 'denied' | 'unavailable'
  revision: number
  checked_at: string
  image_verified: boolean
  detail: string
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
