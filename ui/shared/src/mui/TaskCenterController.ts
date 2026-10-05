import {
  xDriveActiveFileOperationCount,
  xDriveFileOperationHasHistory,
} from '../file-operations'
import type {
  XDriveFileOperation,
  XDriveFileOperationConflictResolution,
} from '../file-operations'
import {
  xDriveActiveTransferCount,
  xDriveTransferHasHistory,
} from '../transfers'
import type { XDriveTransferTask } from '../transfers'
import type { XDriveTaskCenterPageProps } from './TaskCenterPage'

export type XDriveTaskCenterOperationActions = {
  busy: boolean
  cancellingID: string
  retryingID: string
  undoingID: string
  resolvingID: string
  resolvingPolicy: XDriveFileOperationConflictResolution | ''
  clearHistoryLoading: boolean
  cancelOperation: (id: string) => Promise<boolean>
  retryOperation: (id: string) => Promise<boolean>
  undoOperation: (id: string) => Promise<boolean>
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
  const activeTransferCount = xDriveActiveTransferCount(transfers)
  const activeOperationCount = xDriveActiveFileOperationCount(operations)
  const hasHistory = (
    xDriveTransferHasHistory(transfers) ||
    xDriveFileOperationHasHistory(operations)
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
    operationUndoingID: operationActions.undoingID,
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
    onUndoOperation: (id) => {
      void operationActions.undoOperation(id)
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
