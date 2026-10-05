import { xDriveFileOperationActive } from '../file-operations'
import type {
  XDriveFileOperation,
  XDriveFileOperationConflictResolution,
} from '../file-operations'
import type { XDriveTransferTask } from '../transfers'
import type { XDriveTaskCenterPageProps } from './TaskCenterPage'

export type XDriveTaskCenterOperationActions = {
  busy: boolean
  cancellingID: string
  retryingID: string
  resolvingID: string
  resolvingPolicy: XDriveFileOperationConflictResolution | ''
  clearHistoryLoading: boolean
  cancelOperation: (id: string) => Promise<boolean>
  retryOperation: (id: string) => Promise<boolean>
  resolveConflict: (
    id: string,
    policy: XDriveFileOperationConflictResolution,
  ) => Promise<boolean>
  clearHistory: () => Promise<boolean>
}

export function useXDriveTaskCenterController({
  transfers,
  operations,
  operationActions,
  externalBusy = false,
  transferRetryingID = '',
  transferRetryDisabled = false,
  onRetryTransfer,
  conflictResolutionEnabled = true,
}: {
  transfers: XDriveTransferTask[]
  operations: XDriveFileOperation[]
  operationActions: XDriveTaskCenterOperationActions
  externalBusy?: boolean
  transferRetryingID?: string
  transferRetryDisabled?: boolean
  onRetryTransfer?: (id: string) => void | Promise<void>
  conflictResolutionEnabled?: boolean
}) {
  const activeTransferCount = transfers.filter(
    (item) => item.state === 'running' || item.state === 'retrying',
  ).length
  const activeOperationCount = operations.filter(
    (item) => xDriveFileOperationActive(item.status),
  ).length
  const hasHistory = (
    transfers.some((item) => item.state === 'completed' || item.state === 'failed') ||
    operations.some((item) => !xDriveFileOperationActive(item.status))
  )
  const badgeCount = activeTransferCount + activeOperationCount

  const pageProps: XDriveTaskCenterPageProps = {
    transfers,
    operations,
    clearHistory: {
      disabled: !hasHistory || externalBusy || operationActions.busy,
      loading: operationActions.clearHistoryLoading,
      onClear: () => {
        void operationActions.clearHistory()
      },
    },
    transferRetryingID,
    transferRetryDisabled,
    operationCancellingID: operationActions.cancellingID,
    operationRetryingID: operationActions.retryingID,
    operationResolvingID: operationActions.resolvingID,
    operationResolvingPolicy: operationActions.resolvingPolicy,
    operationDisabled: operationActions.busy,
    onRetryTransfer: onRetryTransfer
      ? (id) => {
          void onRetryTransfer(id)
        }
      : undefined,
    onCancelOperation: (id) => {
      void operationActions.cancelOperation(id)
    },
    onRetryOperation: (id) => {
      void operationActions.retryOperation(id)
    },
    onResolveOperationConflict: conflictResolutionEnabled
      ? (id, policy) => {
          void operationActions.resolveConflict(id, policy)
        }
      : undefined,
  }

  return {
    activeTransferCount,
    activeOperationCount,
    badgeCount,
    badge: badgeCount || undefined,
    hasHistory,
    pageProps,
  }
}
