import type { XDriveFileExplorerSearchAvailabilityOption } from './file-explorer-search'

/**
 * UI-owned native file state presentation policy. A Host must obtain file
 * availability from its own authenticated Agent; these labels do not imply
 * that another Host (DSM/Web) has local hydration or mutation permissions.
 */
export const XDRIVE_NATIVE_FILE_AVAILABILITY_OPTIONS: readonly XDriveFileExplorerSearchAvailabilityOption[] = [
  { value: 'local', label: '本地可用' },
  { value: 'always-local', label: '始终保留在此设备上' },
  { value: 'online-only', label: '仅联机' },
  { value: 'cloud', label: '云端' },
  { value: 'mixed', label: '混合' },
  { value: 'syncing', label: '正在同步' },
]

/**
 * A cancelled upload is a cancellation, never a generic failed upload.
 * Keep the exact Host error message for the existing caller-side feedback,
 * and do not turn a Host's cancellation or failure into an ACK/success.
 * Authentication, Owner/Root admission and request redaction remain in the
 * owning Host adapter; this function does not accept arbitrary native calls.
 */
export function xDriveFileExplorerThrowUploadFailure(
  failure: { code?: string; message: string },
): never {
  const error = new Error(failure.message)
  if (failure.code === 'transfer_cancelled') error.name = 'AbortError'
  throw error
}
