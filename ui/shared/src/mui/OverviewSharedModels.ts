import {
  xDriveBackgroundTaskKindLabel,
  xDriveBackgroundTaskStateLabel,
} from '../background-tasks'
import type { XDriveBackgroundTask } from '../background-tasks'
import { xDriveFileOperationTypeLabel } from '../file-operations'
import type { XDriveFileOperation } from '../file-operations'
import { xDriveTransferKindLabel, xDriveTransferRootTasks } from '../transfers'
import type { XDriveTransferTask } from '../transfers'
import type { XDriveHomeAlert } from './HomePage'

/**
 * Read-only Home activity projection shared by Desktop/DSM and Web/PWA.
 * No mutable queue, Server authority, media IO or Owner/session state lives
 * here. Callers must supply events already scoped to the CURRENT Owner.
 *
 * Preserve transfer → file-operation → background-task alert precedence,
 * and the most recently completed/partial Source sync in the activity line.
 * Device-specific disk/conflict/paused alerts remain platform-owned.
 */
export function xDriveOverviewActivity({
  transfers,
  fileOperations,
  backgroundTasks,
}: {
  transfers: readonly XDriveTransferTask[]
  fileOperations: readonly XDriveFileOperation[]
  backgroundTasks: readonly XDriveBackgroundTask[]
}): {
  alerts: XDriveHomeAlert[]
  failedSync: boolean
  runningSync: boolean
  recentActivity?: string
} {
  const failedTransfer = xDriveTransferRootTasks(transfers).find(
    task => task.state === 'failed' || task.state === 'partial',
  )
  const failedOperation = fileOperations.find(operation => operation.status === 'failed')
  const failedBackgroundTask = backgroundTasks.find(task => task.state === 'failed')
  const syncTasks = backgroundTasks.filter(
    task => task.domain === 'sync_run' || task.kind === 'source.sync',
  )
  const failedSync = syncTasks.some(task => task.state === 'failed' || task.state === 'partial')
  const runningSync = syncTasks.some(
    task => task.state === 'running' || task.state === 'queued' || task.state === 'cancelling',
  )
  const recentSync = syncTasks.filter(
    task => task.state === 'completed' || task.state === 'partial',
  ).sort(
    (a, b) => Date.parse(b.finished_at || b.updated_at) -
      Date.parse(a.finished_at || a.updated_at),
  )[0]

  const alerts: XDriveHomeAlert[] = []
  if (failedTransfer) {
    alerts.push({
      key: 'transfer-failed',
      tone: 'bad',
      title: '传输失败',
      message: `${xDriveTransferKindLabel(failedTransfer.kind)} · ${failedTransfer.file_name}${failedTransfer.error ? ' · ' + failedTransfer.error : ''}`,
    })
  }
  if (failedOperation) {
    alerts.push({
      key: 'operation-failed',
      tone: 'bad',
      title: '文件操作失败',
      message: `${xDriveFileOperationTypeLabel(failedOperation.type)}${failedOperation.error ? ' · ' + failedOperation.error : ''}`,
    })
  }
  if (failedBackgroundTask) {
    alerts.push({
      key: 'background-failed',
      tone: 'bad',
      title: failedBackgroundTask.kind === 'source.sync' ||
        failedBackgroundTask.domain === 'sync_run' ? '同步任务失败' : '后台任务失败',
      message: `${xDriveBackgroundTaskKindLabel(failedBackgroundTask.kind)}${failedBackgroundTask.source_name ? ' · ' + failedBackgroundTask.source_name : ''}${failedBackgroundTask.error ? ' · ' + failedBackgroundTask.error : ''}`,
    })
  }

  const recentActivity = recentSync
    ? [
        xDriveBackgroundTaskKindLabel(recentSync.kind),
        recentSync.source_name,
        xDriveBackgroundTaskStateLabel(recentSync.state),
        overviewRecentTime(recentSync.finished_at || recentSync.updated_at),
      ].filter(Boolean).join(' · ')
    : undefined

  return { alerts, failedSync, runningSync, recentActivity }
}

function overviewRecentTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString()
}
