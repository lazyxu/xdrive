import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, CircularProgress, Divider, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
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
import { XDriveMediaSelectionJobCenter } from './MediaSelectionJobCenter'
import type { XDriveMediaSelectionJobPort } from './MediaSelectionJobCenter'
import { XDriveTransferCenter } from './TransferCenter'
import { XDriveTaskCenterSection } from './TaskPresentation'
import { XDriveStatePanel } from './StatePanel'
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
  mediaSelectionJobPort?: XDriveMediaSelectionJobPort
  backgroundTasks?: XDriveBackgroundTask[]
  globalBackgroundTasks?: XDriveBackgroundTask[]
  backgroundTasksLoading?: boolean
  globalBackgroundTasksLoading?: boolean
  backgroundTasksAvailable?: boolean
  globalTasksEnabled?: boolean
  globalTasksAvailable?: boolean
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
  mediaSelectionJobPort,
  backgroundTasks = [],
  globalBackgroundTasks = [],
  backgroundTasksLoading = false,
  globalBackgroundTasksLoading = false,
  backgroundTasksAvailable = false,
  globalTasksEnabled = false,
  globalTasksAvailable = globalTasksEnabled,
  backgroundScope = 'mine',
  onBackgroundScopeChange,
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
  const [globalTaskView, setGlobalTaskView] = useState<'cards' | 'table'>('cards')

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
      title={scope === 'global' ? '全局后台任务' : '任务'}
      subtitle={scope === 'global' ? '查看所有用户及系统的后台任务，按权限执行控制操作。' : subtitle}
      pageActions={actions}
    >
      <Stack ref={contentRef} spacing={2.75}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}
          alignItems={{ md: 'center' }} justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {scope === 'global'
              ? '管理员视图：跨用户和系统的服务器后台任务，不包含其他设备的本机传输。'
              : '我的任务：当前用户的文件操作、同步与后台处理；实时上传下载请查看传输入口。'}
          </Typography>
          {globalTasksEnabled && onBackgroundScopeChange ? (
            <ToggleButtonGroup size="small" exclusive value={scope} aria-label="任务查看范围"
              onChange={(_event, next: 'mine' | 'global' | null) => {
                if (next && next !== scope) onBackgroundScopeChange(next)
              }}
              sx={{
                alignSelf: { xs: 'stretch', md: 'auto' },
                '& .MuiToggleButton-root': {
                  minHeight: 44, flex: { xs: 1, md: 'none' }, whiteSpace: 'nowrap',
                },
              }}
            >
              <ToggleButton value="mine" aria-label="我的任务">我的任务</ToggleButton>
              <ToggleButton value="global" aria-label="全局后台任务">全局后台任务</ToggleButton>
            </ToggleButtonGroup>
          ) : null}
        </Stack>
        {scope === 'global' ? (
          <XDriveTaskCenterSection title="服务器后台任务"
            loadedCount={globalTasksAvailable ? globalBackgroundTasks.length : undefined}
            description="管理员可查看跨用户与系统任务；控制操作由服务端授权决定。">
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}
              justifyContent="space-between" sx={{ mb: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                与个人后台任务使用同一任务卡片；全局任务额外显示用户和系统归属。
              </Typography>
              {globalTasksAvailable ? <ToggleButtonGroup
                size="small"
                exclusive
                value={globalTaskView}
                aria-label="全局后台任务显示方式"
                sx={{ display: { xs: 'none', md: 'inline-flex' } }}
                onChange={(_event, next: 'cards' | 'table' | null) => {
                  if (next) setGlobalTaskView(next)
                }}
              >
                <ToggleButton value="cards" aria-label="卡片视图">卡片</ToggleButton>
                <ToggleButton value="table" aria-label="表格视图">表格</ToggleButton>
              </ToggleButtonGroup> : null}
            </Stack>
            {!globalTasksAvailable ? (
              <XDriveStatePanel variant="plain"
                message="当前客户端、xdrive-agent 或服务端尚不支持全局后台任务，请更新相应组件后重试。" />
            ) : globalTaskView === 'cards' ? (
              <XDriveBackgroundTaskList
                tasks={globalBackgroundTasks}
                loading={globalBackgroundTasksLoading}
                emptyMessage="暂无全局后台任务"
                controlKey={backgroundControlKey}
                focusedTaskID={backgroundFocusTaskID}
                showOwners
                onControl={onBackgroundTaskControl}
              />
            ) : (
              <XDriveBackgroundTaskTable
                tasks={globalBackgroundTasks}
                loading={globalBackgroundTasksLoading}
                controlKey={backgroundControlKey}
                focusedTaskID={backgroundFocusTaskID}
                onControl={onBackgroundTaskControl}
              />
            )}
            {globalTasksAvailable ? <XDriveTaskHistorySentinel
              hasMore={backgroundHasMore}
              loading={backgroundLoadingMore}
              onLoadMore={onLoadMoreBackground}
            /> : null}
          </XDriveTaskCenterSection>
        ) : (
          <>
            {mediaSelectionJobPort ? (
              <Box>
                <XDriveMediaSelectionJobCenter port={mediaSelectionJobPort} />
              </Box>
            ) : null}
            {mediaSelectionJobPort ? <Divider /> : null}
            <XDriveTaskCenterSection title="文件操作" loadedCount={operations.length}
              description="当前用户文件操作；撤销、重做和冲突处理仅在个人任务中提供。">
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
            </XDriveTaskCenterSection>
            {transfers.length > 0 ? (
              <>
                <Divider />
                <XDriveTaskCenterSection title="本机任务" loadedCount={transfers.length}
                  description="当前客户端的本地处理，不属于跨用户服务器任务。">
                  <XDriveTransferCenter
                    transfers={transfers}
                    retryingID={transferRetryingID}
                    retryDisabled={transferRetryDisabled}
                    onRetry={onRetryTransfer}
                  />
                </XDriveTaskCenterSection>
              </>
            ) : null}
            {backgroundTasksAvailable ? (
              <>
                <Divider />
                <XDriveTaskCenterSection title="同步文件夹" loadedCount={syncTasks.length}>
                  <XDriveBackgroundTaskList
                    tasks={syncTasks}
                    loading={backgroundTasksLoading}
                    emptyMessage="暂无同步文件夹任务"
                    controlKey={backgroundControlKey}
                    focusedTaskID={backgroundFocusTaskID}
                    onControl={onBackgroundTaskControl}
                  />
                </XDriveTaskCenterSection>
                <Divider />
                <XDriveTaskCenterSection title="后台处理" loadedCount={derivedTasks.length}>
                  <XDriveBackgroundTaskList
                    tasks={derivedTasks}
                    loading={backgroundTasksLoading}
                    emptyMessage="暂无后台处理任务"
                    controlKey={backgroundControlKey}
                    focusedTaskID={backgroundFocusTaskID}
                    onControl={onBackgroundTaskControl}
                  />
                </XDriveTaskCenterSection>
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
