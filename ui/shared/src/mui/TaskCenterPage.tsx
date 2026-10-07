import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Box, CircularProgress, Divider, Stack, Tab, Tabs, Typography } from '@mui/material'
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
  onBackgroundScopeChange,
  backgroundControlKey = '',
  onBackgroundTaskControl,
  backgroundHasMore = false,
  backgroundLoadingMore = false,
  onLoadMoreBackground,
  subtitle = '统一查看文件操作、上传下载、同步文件夹和后台处理状态。',
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
  onRetryTransfer,
  onCancelOperation,
  onRetryOperation,
  onUndoOperation,
  onRedoOperation,
  onResolveOperationConflict,
}: XDriveTaskCenterPageProps) {
  const scope = globalTasksEnabled ? backgroundScope : 'mine'
  const syncTasks = backgroundTasks.filter(
    (task) => task.domain === 'sync_run' || task.kind === 'source.sync',
  )
  const derivedTasks = backgroundTasks.filter(
    (task) => task.domain === 'scheduler' && task.kind !== 'source.sync',
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
      title="任务中心"
      subtitle={subtitle}
      pageActions={actions}
    >
      <Stack spacing={3}>
        {globalTasksEnabled ? (
          <Tabs
            value={scope}
            onChange={(_event, value: 'mine' | 'global') => onBackgroundScopeChange?.(value)}
            aria-label="任务视图"
          >
            <Tab value="mine" label="我的任务" />
            <Tab value="global" label="全局任务" />
          </Tabs>
        ) : null}

        {scope === 'global' ? (
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
              全局任务
            </Typography>
            <XDriveBackgroundTaskTable
              tasks={globalBackgroundTasks}
              loading={globalBackgroundTasksLoading}
              controlKey={backgroundControlKey}
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
                onCancel={onCancelOperation}
                onRetry={onRetryOperation}
                onUndo={onUndoOperation}
                onRedo={onRedoOperation}
                onResolveConflict={onResolveOperationConflict}
              />
            </Box>
            <Divider />
            <Box>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
                上传与下载
              </Typography>
              <XDriveTransferCenter
                transfers={transfers}
                retryingID={transferRetryingID}
                retryDisabled={transferRetryDisabled}
                onRetry={onRetryTransfer}
              />
            </Box>
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
