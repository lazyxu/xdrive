/** Administrator-only offline transport. Upload receipts are NOT publisher trust. */
export interface XDriveOfflineImportFile {
  name: string
  state: 'uploading' | 'ready'
  size: number
  uploaded_bytes: number
  upload_sha256?: string
}

export interface XDriveOfflineImportStatus {
  id: string
  files: XDriveOfflineImportFile[]
  chunk_bytes: number
  ready_to_verify: boolean
}

export interface XDriveOfflineImportSummary {
  id: string
  modified_at: string
}

export type XDriveOfflineTrustMode = 'sigstore' | 'sha256'

export type XDriveOfflineHostPlanPhase = 'idle' | 'queued' | 'running' | 'success' | 'failed' | 'unavailable'

export interface XDriveOfflinePlanComponent {
  name: string
  filename: string
  target_sha256: string
  target_fingerprint?: string
  target_build_commit?: string
  action: 'verify_and_install' | 'not_selected' | 'not_supplied'
  archive_present: boolean
  recorded_sha256?: string
  recorded_fingerprint?: string
  recorded_match: boolean
  archive_bytes: number
  expanded_bytes: number
}

export interface XDriveOfflineHostImageObservation {
  name: string
  reference: string
  expected_id?: string
  observed_id?: string
  status: string
}

export interface XDriveOfflineHostRuntimeProbe {
  schema: number
  read_only: boolean
  platform: string
  docker_status: string
  running_server_image_ref?: string
  running_server_image_id?: string
  running_server_evidence: string
  temporary_free_bytes: number | null
  temporary_required_min_bytes: number
  temporary_space_status: string
  docker_storage_free_bytes: number | null
  images: XDriveOfflineHostImageObservation[]
  blockers: string[]
  remaining_host_checks: string[]
}

export interface XDriveOfflineUpgradePlan {
  schema: number
  read_only: boolean
  trust_basis: string
  source: string
  channel: string
  platform: string
  target_source_commit: string
  recorded_source_commit?: string
  current_version_evidence: string
  components: XDriveOfflinePlanComponent[]
  selected_archive_bytes: number
  selected_expanded_bytes: number
  minimum_temporary_bytes: number
  estimated_full_disk_bytes: number | null
  host_probe?: XDriveOfflineHostRuntimeProbe
  requires_host_verification: string[]
}

export interface XDriveOfflineHostPlanStatus {
  supported: boolean
  state: XDriveOfflineHostPlanPhase
  request_id?: string
  offline_id?: string
  offline_trust_mode?: XDriveOfflineTrustMode
  trusted_manifest_sha256?: string
  trusted_installer_sha256?: string
  message?: string
  error?: string
  started_at?: string
  updated_at?: string
  finished_at?: string
  plan?: XDriveOfflineUpgradePlan
}

export interface XDriveOfflineImportPort {
  list: () => Promise<{ items: XDriveOfflineImportSummary[] }>
  create: () => Promise<{ id: string; chunk_bytes: number }>
  get: (id: string) => Promise<XDriveOfflineImportStatus>
  register: (id: string, name: string, size: number, uploadSHA256?: string) => Promise<void>
  putChunk: (id: string, name: string, index: number, data: Blob, chunkSHA256: string, signal?: AbortSignal) => Promise<void>
  finalize: (id: string, name: string) => Promise<{ name: string; state: 'ready'; upload_sha256: string }>
  remove: (id: string) => Promise<void>
  getPlan: (id: string) => Promise<XDriveOfflineHostPlanStatus>
  startPlan: (id: string, manifestSHA256: string, goSHA256: string, trustMode: XDriveOfflineTrustMode) => Promise<XDriveOfflineHostPlanStatus>
  start: (id: string, manifestSHA256: string, goSHA256: string, backupFileData: boolean, trustMode: XDriveOfflineTrustMode) => Promise<void>
}

export const XDRIVE_OFFLINE_CHUNK_BYTES = 8 * 1024 * 1024

const fileName = /^xdrive-(app|postgres|media-worker|ai-runtime|ai-models)-[0-9a-f]{12}\.tar\.gz$/
const digest = /^[0-9a-f]{64}$/
const importID = /^[0-9a-f]{32}$/

export function xDriveValidOfflineFilename(name: string): boolean {
  return ['manifest.json', 'xdrive-offline-linux-amd64',
    'delivery.json', 'delivery-attestation.jsonl'].includes(name) || fileName.test(name)
}

export function xDriveValidOfflineDigest(value: string): boolean {
  return digest.test(value)
}

export function xDriveValidOfflineImportID(value: string): boolean {
  return importID.test(value)
}
