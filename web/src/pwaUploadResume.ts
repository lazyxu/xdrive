import type { XDriveTransferTask } from '../../ui/shared/src'

const RESUME_WINDOW_MS = 23 * 60 * 60 * 1000 // Server sessions expire after 24h.

/** Only recent browser uploads with a real cloud parent, exact source fingerprint
 * and fail-on-conflict policy: standalone files or safely bound folder children.
 * Group roots, canceled siblings and destructive policies never qualify. */
export function xDriveCanResumeBrowserUpload(
  task: XDriveTransferTask | null | undefined, now = Date.now(),
): task is XDriveTransferTask & {
  cloud_parent_id: number
  resume_file_last_modified: number
  resume_conflict_policy: 'fail'
  resume_manifest_sha256: string
} {
  if (!task || task.state !== 'failed' || task.direction !== 'upload' ||
      task.kind !== 'upload' || task.scope !== 'item' ||
      task.resume_conflict_policy !== 'fail' ||
      typeof task.resume_manifest_sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(task.resume_manifest_sha256) ||
      !Number.isSafeInteger(task.cloud_parent_id) || !(task.cloud_parent_id! > 0) ||
      !Number.isSafeInteger(task.bytes_total) || task.bytes_total < 0 ||
      !Number.isSafeInteger(task.resume_file_last_modified) ||
      task.resume_file_last_modified! < 0 ||
      typeof task.file_name !== 'string' || task.file_name.length === 0) return false
  const started = Date.parse(task.started_at)
  return Number.isFinite(started) && now >= started && now - started < RESUME_WINDOW_MS
}

/** Validation is done BEFORE any upload or create/finalize request. */
export function xDrivePwaResumeFileError(
  task: XDriveTransferTask | null | undefined,
  file: Pick<File, 'name' | 'size' | 'lastModified'> | null | undefined,
  now = Date.now(),
): string | null {
  if (!xDriveCanResumeBrowserUpload(task, now)) {
    return '原上传任务已过期或不支持直接续传。请在目标文件夹重新上传。'
  }
  if (!file) return '未选择文件。'
  if (file.name !== task.file_name || file.size !== task.bytes_total ||
      file.lastModified !== task.resume_file_last_modified) {
    return '所选文件与原任务的名称、大小或修改时间不一致；未发送任何上传请求。'
  }
  return null
}
