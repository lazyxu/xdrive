import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Box, CircularProgress, Divider, Stack, Typography } from '@mui/material'
import type {
  XDriveBackgroundTask,
  XDriveBackgroundTaskControlAction,
  XDriveFileOperation,
  XDriveFileOperationConflictResolution,
  XDriveTransferTask,
} from '..'
import { XDriveActionButton } from './ActionButton'
import { XDriveBackgroundTaskList, XDriveBackgroundTaskTable } from './BackgroundTaskCenter'
import { XDriveFileOperationCenter } from './FileOperationCenter'
import { XDriveTransferCenter } from './TransferCenter'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

function XDriveTaskHistorySentinel({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean
  loading: boolean
  onLoadMore?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasMore || loading || !onLoadMore || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [hasMore, loading, onLoadMore])

  if (!hasMore) return null
  return (
    <Box
      ref={ref}
      aria-label="继续加载任务历史"
      sx={{
        minHeight: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {loading ? <CircularProgress size={18} /> : null}
    </Box>
  )
}

export interface XDriveTaskCenterClearHistory {
  disabled?: boolean
  loading?: boolean
  onClear: () => void
}

export interface XDriveTaskCenterPageProps {
  transfers: XDriveTransferTask[]
  operations: XDriveFileOperation[]
  backgroundTasks?: XDriveBackgroundTask[]
  globalBackgroundTasks?: XDriveBackgroundTask[]
  backgroundTasksLoading?: boolean
  globalBackgroundTasksLoading?: boolean
  backgroundTasksAvailable?: boolean
  globalTasksEnabled?: boolean
  backgroundScope?: 'mine' | 'global'
  onBackgroundScopeChange?: (scope: 'mine' | 'global') => void
  backgroundControlKey?: string
  onBackgroundTaskControl?: (
    task: XDriveBackgroundTask,
    action: XDriveBackgroundTaskControlAction,
  ) => void
  backgroundHasMore?: boolean
  backgroundLoadingMore?: boolean
  onLoadMoreBackground?: () => void
  backgroundFocusTaskID?: string
  backgroundFocusRequestID?: number
  subtitle?: ReactNode
  pageActions?: ReactNode
  clearHistory?: XDriveTaskCenterClearHistory
  transferRetryingID?: string
  transferRetryDisabled?: boolean
  operationCancellingID?: string
  operationRetryingID?: string
  operationUndoingID?: string
  operationRedoingID?: string
  operationResolvingID?: string
  operationResolvingPolicy?: XDriveFileOperationConflictResolution | ''
  operationDisabled?: boolean
  operationFocusID?: string
  operationFocusRequestID?: number
  onRetryTransfer?: (id: string) => void
  onCancelOperation?: (id: string) => void
  onRetryOperation?: (id: string) => void
  onUndoOperation?: (id: string) => void
  onRedoOperation?: (id: string) => void
  onResolveOperationConflict?: (id: string, policy: XDriveFileOperationConflictResolution) => void
}

export function XDriveTaskCenterPage({
  transfers,
  operations,
  backgroundTasks = [],
  globalBackgroundTasks = [],
  backgroundTasksLoading = false,
  globalBackgroundTasksLoading = false,
  backgroundTasksAvailable = false,
  globalTasksEnabled = false,
  backgroundScope = 'mine',
  backgroundControlKey = '',
  onBackgroundTaskControl,
  backgroundHasMore = false,
  backgroundLoadingMore = false,
  onLoadMoreBackground,
  backgroundFocusTaskID = '',
  backgroundFocusRequestID = 0,
  subtitle = '查看文件操作、同步文件夹和后台处理状态。',
  pageActions,
  clearHistory,
  transferRetryingID = '',
  transferRetryDisabled = false,
  operationCancellingID = '',
  operationRetryingID = '',
  operationUndoingID = '',
  operationRedoingID = '',
  operationResolvingID = '',
  operationResolvingPolicy = '',
  operationDisabled = false,
  operationFocusID = '',
  operationFocusRequestID = 0,
  onRetryTransfer,
  onCancelOperation,
  onRetryOperation,
  onUndoOperation,
  onRedoOperation,
  onResolveOperationConflict,
}: XDriveTaskCenterPageProps) {
  const scope = globalTasksEnabled ? backgroundScope : 'mine'
  const contentRef = useRef<HTMLDivElement>(null)
  const focusedRequestRef = useRef(0)

  useEffect(() => {
    if (
      !backgroundFocusTaskID ||
      backgroundFocusRequestID <= 0 ||
      focusedRequestRef.current === backgroundFocusRequestID ||
      !contentRef.current
    ) return
    const target = Array.from(
      contentRef.current.querySelectorAll<HTMLElement>('[data-xdrive-background-task-id]'),
    ).find((element) => element.dataset.xdriveBackgroundTaskId === backgroundFocusTaskID)
    if (!target) return
    focusedRequestRef.current = backgroundFocusRequestID
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.focus({ preventScroll: true })
  }, [
    backgroundFocusRequestID,
    backgroundFocusTaskID,
    backgroundTasks,
    globalBackgroundTasks,
    scope,
  ])

  const syncTasks = backgroundTasks.filter(
    (task) => task.domain === 'sync_run' || task.kind === 'source.sync',
  )
  const derivedTasks = backgroundTasks.filter(
    (task) => task.domain !== 'file_operation' && task.domain !== 'sync_run' && task.kind !== 'source.sync',
  )
  const actions = scope === 'mine'
    ? pageActions ?? (clearHistory ? (
      <XDriveActionButton
        disabled={clearHistory.disabled || clearHistory.loading}
        loading={clearHistory.loading}
        loadingLabel="正在清空…"
        onClick={clearHistory.onClear}
      >
        清空历史
      </XDriveActionButton>
    ) : undefined)
    : undefined

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title={scope === 'global' ? '全局任务' : '任务'}
      subtitle={scope === 'global' ? '查看所有用户及系统的后台任务，按权限执行控制操作。' : subtitle}
      pageActions={actions}
    >
      <Stack ref={contentRef} spacing={3}>
        {scope === 'global' ? (
          <Box>
            <XDriveBackgroundTaskTable
              tasks={globalBackgroundTasks}
              loading={globalBackgroundTasksLoading}
              controlKey={backgroundControlKey}
              focusedTaskID={backgroundFocusTaskID}
              onControl={onBackgroundTaskControl}
            />
            <XDriveTaskHistorySentinel
              hasMore={backgroundHasMore}
              loading={backgroundLoadingMore}
              onLoadMore={onLoadMoreBackground}
            />
          </Box>
        ) : (
          <>
            <Box>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
                文件操作
              </Typography>
              <XDriveFileOperationCenter
                operations={operations}
                cancellingID={operationCancellingID}
                retryingID={operationRetryingID}
                undoingID={operationUndoingID}
                redoingID={operationRedoingID}
                resolvingID={operationResolvingID}
                resolvingPolicy={operationResolvingPolicy}
                disabled={operationDisabled}
                operationFocusID={operationFocusID}
                operationFocusRequestID={operationFocusRequestID}
                onCancel={onCancelOperation}
                onRetry={onRetryOperation}
                onUndo={onUndoOperation}
                onRedo={onRedoOperation}
                onResolveConflict={onResolveOperationConflict}
              />
            </Box>
            {transfers.length > 0 ? (
              <>
                <Divider />
                <Box>
                  <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
                    本机任务
                  </Typography>
                  <XDriveTransferCenter
                    transfers={transfers}
                    retryingID={transferRetryingID}
                    retryDisabled={transferRetryDisabled}
                    onRetry={onRetryTransfer}
                  />
                </Box>
              </>
            ) : null}
            {backgroundTasksAvailable ? (
              <>
                <Divider />
                <Box>
                  <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
                    同步文件夹
                  </Typography>
                  <XDriveBackgroundTaskList
                    tasks={syncTasks}
                    loading={backgroundTasksLoading}
                    emptyMessage="暂无同步文件夹任务"
                    controlKey={backgroundControlKey}
                    focusedTaskID={backgroundFocusTaskID}
                    onControl={onBackgroundTaskControl}
                  />
                </Box>
                <Divider />
                <Box>
                  <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
                    后台处理
                  </Typography>
                  <XDriveBackgroundTaskList
                    tasks={derivedTasks}
                    loading={backgroundTasksLoading}
                    emptyMessage="暂无后台处理任务"
                    controlKey={backgroundControlKey}
                    focusedTaskID={backgroundFocusTaskID}
                    onControl={onBackgroundTaskControl}
                  />
                </Box>
                <XDriveTaskHistorySentinel
                  hasMore={backgroundHasMore}
                  loading={backgroundLoadingMore}
                  onLoadMore={onLoadMoreBackground}
                />
              </>
            ) : null}
          </>
        )}
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
