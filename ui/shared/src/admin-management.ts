import type {
  AdminUser, AuditEventRange, StorageStats, StorageHealth, StorageHistory,
  StorageLegacyObjectPage, StorageUnreferencedBlobPage, StorageOptimizationAdvice, UploadStagingDetail,
  StagingCleanupRun, StagingCleanupFailure, StorageCacheCleanupKind, StorageCacheCleanup,
  UploadStagingCleanup,
} from './models'
import type { XDriveStorageIntegrityEvidence } from './background-tasks'

export type XDriveAdminCreateUserInput = {
  username: string
  password: string
  role: 'user' | 'admin'
  must_change_password: boolean
  quota_bytes: number
}
export type XDriveAdminUpdateUserInput = {
  role?: 'user' | 'admin'
  disabled?: boolean
  quota_bytes?: number
}
/** One full CRUD and identity-administration contract for Web and Desktop. */
export type XDriveAdminUsersPort = {
  adminUsers(signal?: AbortSignal): Promise<AdminUser[]>
  adminCreateUser(input: XDriveAdminCreateUserInput): Promise<AdminUser>
  adminUpdateUser(id: number, input: XDriveAdminUpdateUserInput): Promise<AdminUser>
  adminResetPassword(id: number, password: string, mustChangePassword?: boolean): Promise<void>
  adminRevokeSessions(id: number): Promise<void>
  adminDeleteUser(id: number): Promise<void>
}

/** Shared snapshot-bound admin audit pages, scoped to the authenticated session. */
export type XDriveAdminAuditRangeQuery = {
  limit: number
  offset: number
  snapshot_max_id?: number
  action?: string
  result?: 'success' | 'failure'
  actor?: string
}
export type XDriveAdminAuditPort = {
  adminAuditRange(query: XDriveAdminAuditRangeQuery, signal?: AbortSignal): Promise<AuditEventRange>
}

export type XDriveStorageVerificationRun = {
  /** Decimal identity retained as a string to avoid JavaScript uint64 loss. */
  run_id: string
  mode: 'fast' | 'deep'
  state: 'success' | 'issues' | 'failed' | 'partial' | 'cancelled'
  started_at: string
  finished_at: string
}
export type XDriveStorageVerificationRunPage = {
  protocol: 'xdrive-storage-verification-history-v1'
  items: XDriveStorageVerificationRun[]
  next_cursor?: string
}
/** Fixed read-only, privacy-safe detail of one terminal integrity check. */
export type XDriveStorageVerificationRunDetail = {
  protocol: 'xdrive-storage-verification-detail-v1'
  run: XDriveStorageVerificationRun
  evidence?: XDriveStorageIntegrityEvidence
}

/** Global Storage operations are administrator-owned and Server-authorized. */
export type XDriveAdminStorageOperation =
  | 'stats' | 'health' | 'history' | 'verification-runs' | 'verification-run-detail' | 'legacy' | 'unreferenced' | 'staging'
  | 'cleanup-runs' | 'cleanup-failures' | 'cleanup-staging' | 'cleanup-cache'
  | 'optimization-advice'
export type XDriveAdminStorageRequest = {
  operation: XDriveAdminStorageOperation
  limit?: number
  offset?: number
  cursor?: string
  verification_run_id?: string
  days?: 30 | 90 | 180
  run_id?: number
  fresh?: boolean
  kind?: StorageCacheCleanupKind
}
export type XDriveAdminStoragePort = {
  storageStats(): Promise<StorageStats>
  adminStorageStats(): Promise<StorageStats>
  adminStorageHealth(): Promise<StorageHealth>
  adminStorageHistory(days?: number): Promise<StorageHistory>
  adminStorageVerificationRuns(limit?: number, cursor?: string): Promise<XDriveStorageVerificationRunPage>
  /** Optional while older Agents/Server images still lack the detail endpoint. */
  adminStorageVerificationRunDetail?(runID: string): Promise<XDriveStorageVerificationRunDetail>
  adminStorageOptimizationAdvice(): Promise<StorageOptimizationAdvice>
  adminStorageLegacyObjects(limit?: number, cursor?: string): Promise<StorageLegacyObjectPage>
  adminStorageUnreferencedBlobs(limit?: number, cursor?: string): Promise<StorageUnreferencedBlobPage>
  adminUploadStaging(limit?: number, cursor?: string, fresh?: boolean): Promise<UploadStagingDetail>
  adminStagingCleanupRuns(limit?: number, offset?: number): Promise<StagingCleanupRun[]>
  adminStagingCleanupFailures(runID: number, limit?: number, offset?: number): Promise<StagingCleanupFailure[]>
  adminCleanupUploadStaging(): Promise<UploadStagingCleanup>
  adminCleanupStorageCache(kind: StorageCacheCleanupKind): Promise<StorageCacheCleanup>
}
