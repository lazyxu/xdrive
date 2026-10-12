import type {
  AdminUser, AuditEventRange, StorageStats, StorageHealth, StorageHistory,
  StorageLegacyObjectPage, StorageUnreferencedBlobPage, UploadStagingDetail,
  StagingCleanupRun, StagingCleanupFailure, StorageCacheCleanupKind, StorageCacheCleanup,
  UploadStagingCleanup,
} from './models'

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
  adminUsers(): Promise<AdminUser[]>
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

/** Global Storage operations are administrator-owned and Server-authorized. */
export type XDriveAdminStorageOperation =
  | 'stats' | 'health' | 'history' | 'legacy' | 'unreferenced' | 'staging'
  | 'cleanup-runs' | 'cleanup-failures' | 'cleanup-staging' | 'cleanup-cache'
export type XDriveAdminStorageRequest = {
  operation: XDriveAdminStorageOperation
  limit?: number
  offset?: number
  cursor?: string
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
  adminStorageLegacyObjects(limit?: number, cursor?: string): Promise<StorageLegacyObjectPage>
  adminStorageUnreferencedBlobs(limit?: number, cursor?: string): Promise<StorageUnreferencedBlobPage>
  adminUploadStaging(limit?: number, cursor?: string, fresh?: boolean): Promise<UploadStagingDetail>
  adminStagingCleanupRuns(limit?: number, offset?: number): Promise<StagingCleanupRun[]>
  adminStagingCleanupFailures(runID: number, limit?: number, offset?: number): Promise<StagingCleanupFailure[]>
  adminCleanupUploadStaging(): Promise<UploadStagingCleanup>
  adminCleanupStorageCache(kind: StorageCacheCleanupKind): Promise<StorageCacheCleanup>
}
