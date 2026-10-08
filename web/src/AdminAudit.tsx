import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Autocomplete,
  Box,
  Dialog,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveDescriptionGrid,
  XDriveDescriptionItem,
  XDriveDialogActions,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStatusBadge,
  XDriveTableSurface,
  XDriveWorkspaceSurface,
  useXDriveVirtualCollection,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import {
  xDriveVirtualCollectionFixedRowWindow,
} from '../../ui/shared/src'
import type { XDriveApi } from './api'
import type { AuditEvent } from '../../ui/shared/src'

const AUDIT_PAGE_SIZE = 100
const AUDIT_ROW_HEIGHT = 64
const AUDIT_HEADER_HEIGHT = 40
const AUDIT_OVERSCAN_ROWS = 8

const ACTION_LABELS: Record<string, string> = {
  'auth.login.success': '登录成功',
  'auth.login.failure': '登录失败',
  'auth.password.change': '修改密码',
  'admin.user.create': '创建用户',
  'admin.user.role_change': '变更用户角色',
  'admin.user.disable': '停用用户',
  'admin.user.enable': '启用用户',
  'admin.user.quota_change': '调整存储配额',
  'admin.user.password_reset': '重置用户密码',
  'admin.user.sessions_revoke': '撤销用户会话',
  'admin.user.delete': '删除用户',
  'admin.background_task.control': '后台任务控制',
  'source.credential.update': '更新同步文件夹凭据',
  'source.credential.delete': '清除同步文件夹凭据',
  'source.credential.reveal': '查看同步文件夹凭据',
  'file.permanent_delete': '永久删除文件',
  'file.version_restore': '恢复文件版本',
  'system.backup': '系统备份',
  'system.restore': '系统恢复',
  'system.update': '系统更新',
}

const ACTION_OPTIONS = Object.keys(ACTION_LABELS)

type AuditFilters = {
  action?: string
  result?: 'success' | 'failure'
  actor?: string
}

function actionLabel(value: string) {
  return ACTION_LABELS[value] ?? value
}

function actorRoleLabel(value: string) {
  if (value === 'admin') return '管理员'
  if (value === 'user') return '普通用户'
  return value
}

function metadataText(metadata?: Record<string, unknown>) {
  if (!metadata || Object.keys(metadata).length === 0) return '—'
  return JSON.stringify(metadata)
}

function normalizeAuditFilters(filters: AuditFilters): AuditFilters {
  return {
    action: filters.action || undefined,
    result: filters.result || undefined,
    actor: filters.actor?.trim() || undefined,
  }
}

function auditQueryKey(filters: AuditFilters, revision: number) {
  return [
    'admin-audit',
    revision,
    filters.action ?? '',
    filters.result ?? '',
    filters.actor?.toLocaleLowerCase() ?? '',
  ].join(':')
}

export default function AdminAuditPanel({
  api,
}: {
  api: XDriveApi
}) {
  const compactViewport = useMediaQuery('(max-width:899.95px)')
  const auditRowHeight = compactViewport ? 152 : AUDIT_ROW_HEIGHT
  const auditHeaderHeight = compactViewport ? 0 : AUDIT_HEADER_HEIGHT
  const [action, setAction] = useState<string>()
  const [result, setResult] = useState<'success' | 'failure'>()
  const [actor, setActor] = useState('')
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>({})
  const [queryRevision, setQueryRevision] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailEvent, setDetailEvent] = useState<AuditEvent | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const tableContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)
  const snapshotMaxIDRef = useRef(0)

  const queryKey = useMemo(
    () => auditQueryKey(appliedFilters, queryRevision),
    [appliedFilters, queryRevision],
  )

  const handleRangeError = useCallback((nextError: unknown) => {
    setError(nextError instanceof Error ? nextError.message : '加载审计日志失败')
  }, [])

  const loadRange = useCallback(async (
    range: { offset: number; limit: number },
    signal: AbortSignal,
  ) => {
    const snapshotMaxID = snapshotMaxIDRef.current
    if (snapshotMaxID <= 0) {
      return {
        items: [] as AuditEvent[],
        offset: range.offset,
        limit: range.limit,
        totalCount: 0,
      }
    }
    const page = await api.adminAuditRange({
      ...appliedFilters,
      limit: range.limit,
      offset: range.offset,
      snapshot_max_id: snapshotMaxID,
    }, signal)
    if (page.snapshot_max_id !== snapshotMaxID) {
      throw new Error('审计日志快照发生变化，请重新应用筛选。')
    }
    return {
      items: page.items,
      offset: page.offset,
      limit: page.limit,
      totalCount: page.total_count,
    }
  }, [api, appliedFilters])

  const virtualCollection = useXDriveVirtualCollection<AuditEvent>({
    queryKey,
    loadRange,
    onError: handleRangeError,
    pageSize: AUDIT_PAGE_SIZE,
    overscanPages: 1,
    retentionOverscanPages: 2,
  })

  useEffect(() => {
    const controller = new AbortController()
    snapshotMaxIDRef.current = 0
    setLoading(true)
    setError('')
    setDetailEvent(null)

    void api.adminAuditRange({
      ...appliedFilters,
      limit: AUDIT_PAGE_SIZE,
      offset: 0,
    }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        snapshotMaxIDRef.current = page.snapshot_max_id
        virtualCollection.primePage({
          items: page.items,
          offset: page.offset,
          limit: page.limit,
          totalCount: page.total_count,
        })
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted) return
        handleRangeError(nextError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [
    api,
    appliedFilters,
    handleRangeError,
    queryKey,
    virtualCollection.primePage,
  ])

  useEffect(() => {
    const host = tableContainerRef.current
    if (!host || virtualCollection.totalCount === null) return
    const update = () => setViewportHeight(host.clientHeight)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [virtualCollection.totalCount])

  useEffect(() => {
    const host = tableContainerRef.current
    if (host) host.scrollTop = 0
    pendingScrollTopRef.current = 0
    setScrollTop(0)
  }, [queryKey])

  useEffect(() => () => {
    if (typeof window !== 'undefined' && scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [])

  const totalCount = virtualCollection.totalCount
  const logicalCount = totalCount ?? 0
  const virtualWindow = useMemo(() => xDriveVirtualCollectionFixedRowWindow({
    itemCount: logicalCount,
    scrollTop,
    viewportHeight,
    rowHeight: auditRowHeight,
    headerHeight: auditHeaderHeight,
    overscanRows: AUDIT_OVERSCAN_ROWS,
  }), [auditHeaderHeight, auditRowHeight, logicalCount, scrollTop, viewportHeight])

  useEffect(() => {
    if (totalCount === null || virtualWindow.end <= virtualWindow.start) return
    void virtualCollection.ensureViewport(
      virtualWindow.start,
      virtualWindow.end - 1,
    )
  }, [
    totalCount,
    virtualCollection.ensureViewport,
    virtualWindow.end,
    virtualWindow.start,
  ])

  const applyFilters = useCallback((filters: AuditFilters) => {
    setLoading(true)
    setAppliedFilters(normalizeAuditFilters(filters))
    setQueryRevision((current) => current + 1)
  }, [])

  const visibleRows: Array<{ index: number; event?: AuditEvent }> = []
  for (let index = virtualWindow.start; index < virtualWindow.end; index += 1) {
    visibleRows.push({
      index,
      event: virtualCollection.loadedItems.get(index),
    })
  }

  return (
    <>
      <XDriveWorkspaceSurface
        presentation="page"
        title="审计日志"
        subtitle="记录登录、账户管理、文件与系统操作；可按操作、结果和操作者筛选。"
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
            <Autocomplete
              size="small"
              options={ACTION_OPTIONS}
              value={action ?? null}
              getOptionLabel={actionLabel}
              onChange={(_event, value) => setAction(value ?? undefined)}
              renderOption={(props, option) => (
                <li {...props}>
                  <Stack spacing={0.15}>
                    <Typography variant="body2">{actionLabel(option)}</Typography>
                    <Typography variant="caption" color="text.secondary">{option}</Typography>
                  </Stack>
                </li>
              )}
              renderInput={(params) => <TextField {...params} label="操作" />}
              sx={{ width: { xs: '100%', sm: 280 } }}
            />
            <TextField
              select
              size="small"
              label="结果"
              value={result ?? ''}
              onChange={(event) => setResult(event.target.value ? event.target.value as 'success' | 'failure' : undefined)}
              sx={{ width: { xs: '100%', sm: 150 } }}
            >
              <MenuItem value="">全部结果</MenuItem>
              <MenuItem value="success">成功</MenuItem>
              <MenuItem value="failure">失败</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="操作者用户名"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  applyFilters({ action, result, actor })
                }
              }}
              sx={{ width: { xs: '100%', sm: 220 } }}
            />
            <XDriveActionButton
              intent="primary"
              loading={loading}
              loadingLabel="正在加载…"
              onClick={() => applyFilters({ action, result, actor })}
            >
              应用
            </XDriveActionButton>
            <XDriveActionButton
              disabled={loading}
              onClick={() => {
                setAction(undefined)
                setResult(undefined)
                setActor('')
                applyFilters({})
              }}
            >
              清除
            </XDriveActionButton>
            {totalCount !== null ? (
              <Typography variant="caption" color="text.secondary">
                共 {totalCount.toLocaleString('zh-CN')} 条
              </Typography>
            ) : null}
          </Stack>

          {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}

          {totalCount === null ? (
            <XDriveStatePanel
              variant="plain"
              loading={loading}
              message={loading ? '正在加载审计日志…' : '审计日志尚未加载'}
            />
          ) : totalCount === 0 ? (
            <XDriveStatePanel variant="plain" message="未找到审计事件" />
          ) : (
            <XDriveTableSurface
              containerRef={tableContainerRef}
              onScroll={(event) => {
                pendingScrollTopRef.current = event.currentTarget.scrollTop
                if (typeof window === 'undefined') {
                  setScrollTop(pendingScrollTopRef.current)
                  return
                }
                if (scrollFrameRef.current !== null) return
                scrollFrameRef.current = window.requestAnimationFrame(() => {
                  scrollFrameRef.current = null
                  setScrollTop(pendingScrollTopRef.current)
                })
              }}
              sx={{
                maxHeight: 'min(68vh, 720px)',
                overflow: 'auto',
              }}
            >
              {compactViewport ? (
                <Box
                  role="list"
                  aria-label="审计日志"
                  aria-setsize={totalCount}
                  data-xdrive-admin-audit-mobile-list
                >
                  {virtualWindow.before > 0 ? (
                    <Box aria-hidden sx={{ height: virtualWindow.before }} />
                  ) : null}

                  {visibleRows.map(({ index, event }) => {
                    if (!event) {
                      return (
                        <Box
                          key={`audit-placeholder-${index}`}
                          aria-hidden
                          data-xdrive-admin-audit-placeholder
                          sx={{ height: auditRowHeight, p: 0.5, boxSizing: 'border-box' }}
                        >
                          <Box
                            sx={{
                              height: '100%',
                              border: 1,
                              borderColor: 'divider',
                              borderRadius: 2,
                              p: 1.25,
                            }}
                          >
                            <Box sx={{ width: '72%', height: 8, borderRadius: 1, bgcolor: 'action.hover' }} />
                          </Box>
                        </Box>
                      )
                    }

                    const targetLabel = event.target_label || event.target_id || '—'
                    const targetSuffix = event.target_label && event.target_id ? ' · ' + event.target_id : ''
                    return (
                      <Box
                        key={event.id}
                        role="listitem"
                        data-xdrive-admin-audit-row
                        sx={{ height: auditRowHeight, p: 0.5, boxSizing: 'border-box' }}
                      >
                        <Box
                          sx={{
                            height: '100%',
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: 2,
                            p: 1.25,
                            overflow: 'hidden',
                            boxSizing: 'border-box',
                          }}
                        >
                          <Stack spacing={0.75} sx={{ height: '100%' }}>
                            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {new Date(event.created_at).toLocaleString()}
                              </Typography>
                              <XDriveStatusBadge
                                tone={event.result === 'success' ? 'good' : 'bad'}
                                label={event.result === 'success' ? '成功' : '失败'}
                              />
                            </Stack>
                            <Stack direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={700} noWrap sx={{ minWidth: 0, flex: 1 }}>
                                {actionLabel(event.action)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {event.actor_username || '匿名'}
                                {event.actor_role ? ` · ${actorRoleLabel(event.actor_role)}` : ''}
                              </Typography>
                            </Stack>
                            <Typography variant="body2" color="text.secondary" noWrap title={targetLabel + targetSuffix}>
                              目标：{targetLabel}{targetSuffix}
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mt: 'auto' }}>
                              <Typography component="code" variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flex: 1 }}>
                                {event.action}
                              </Typography>
                              <XDriveActionButton compact onClick={() => setDetailEvent(event)}>
                                查看
                              </XDriveActionButton>
                            </Stack>
                          </Stack>
                        </Box>
                      </Box>
                    )
                  })}

                  {virtualWindow.after > 0 ? (
                    <Box aria-hidden sx={{ height: virtualWindow.after }} />
                  ) : null}
                </Box>
              ) : (
                <Table
                  stickyHeader
                  size="small"
                  aria-label="审计日志"
                  aria-rowcount={totalCount + 1}
                  sx={{ minWidth: 880, tableLayout: 'fixed' }}
                >
                  <TableHead>
                    <TableRow sx={{ height: AUDIT_HEADER_HEIGHT }}>
                      <TableCell sx={{ width: 180, height: AUDIT_HEADER_HEIGHT, py: 0.5 }}>时间</TableCell>
                      <TableCell sx={{ width: 140, height: AUDIT_HEADER_HEIGHT, py: 0.5 }}>操作者</TableCell>
                      <TableCell sx={{ width: 220, height: AUDIT_HEADER_HEIGHT, py: 0.5 }}>操作</TableCell>
                      <TableCell sx={{ width: 200, height: AUDIT_HEADER_HEIGHT, py: 0.5 }}>目标</TableCell>
                      <TableCell sx={{ width: 90, height: AUDIT_HEADER_HEIGHT, py: 0.5 }}>结果</TableCell>
                      <TableCell sx={{ width: 80, height: AUDIT_HEADER_HEIGHT, py: 0.5 }}>详情</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {virtualWindow.before > 0 ? (
                      <TableRow aria-hidden sx={{ height: virtualWindow.before }}>
                        <TableCell colSpan={6} sx={{ p: 0, border: 0, height: virtualWindow.before }} />
                      </TableRow>
                    ) : null}

                    {visibleRows.map(({ index, event }) => {
                      if (!event) {
                        return (
                          <TableRow
                            key={`audit-placeholder-${index}`}
                            aria-hidden
                            data-xdrive-admin-audit-placeholder
                            sx={{ height: AUDIT_ROW_HEIGHT }}
                          >
                            <TableCell colSpan={6} sx={{ py: 0.5, height: AUDIT_ROW_HEIGHT }}>
                              <Box
                                sx={{
                                  width: '72%',
                                  height: 8,
                                  borderRadius: 1,
                                  bgcolor: 'action.hover',
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      }

                      const targetLabel = event.target_label || event.target_id || '—'
                      const targetSuffix = event.target_label && event.target_id ? ' · ' + event.target_id : ''
                      const cellSx = {
                        py: 0.5,
                        height: AUDIT_ROW_HEIGHT,
                        maxHeight: AUDIT_ROW_HEIGHT,
                        overflow: 'hidden',
                      } as const
                      return (
                        <TableRow
                          key={event.id}
                          hover
                          data-xdrive-admin-audit-row
                          sx={{ height: AUDIT_ROW_HEIGHT }}
                        >
                          <TableCell sx={cellSx}>
                            <Typography variant="body2" noWrap>
                              {new Date(event.created_at).toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell sx={cellSx}>
                            <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                              <Typography variant="body2" noWrap>{event.actor_username || '匿名'}</Typography>
                              {event.actor_role ? (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {actorRoleLabel(event.actor_role)}
                                </Typography>
                              ) : null}
                            </Stack>
                          </TableCell>
                          <TableCell sx={cellSx}>
                            <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                              <Typography variant="body2" noWrap>{actionLabel(event.action)}</Typography>
                              <Typography component="code" variant="caption" color="text.secondary" noWrap>
                                {event.action}
                              </Typography>
                            </Stack>
                          </TableCell>
                          <TableCell sx={cellSx}>
                            <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                              <Typography variant="body2" noWrap>{targetLabel}{targetSuffix}</Typography>
                              {event.target_type ? (
                                <Typography variant="caption" color="text.secondary" noWrap>{event.target_type}</Typography>
                              ) : null}
                            </Stack>
                          </TableCell>
                          <TableCell sx={cellSx}>
                            <XDriveStatusBadge
                              tone={event.result === 'success' ? 'good' : 'bad'}
                              label={event.result === 'success' ? '成功' : '失败'}
                            />
                          </TableCell>
                          <TableCell sx={cellSx}>
                            <XDriveActionButton compact onClick={() => setDetailEvent(event)}>
                              查看
                            </XDriveActionButton>
                          </TableCell>
                        </TableRow>
                      )
                    })}

                    {virtualWindow.after > 0 ? (
                      <TableRow aria-hidden sx={{ height: virtualWindow.after }}>
                        <TableCell colSpan={6} sx={{ p: 0, border: 0, height: virtualWindow.after }} />
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              )}
            </XDriveTableSurface>
          )}
        </Stack>
      </XDriveWorkspaceSurface>

      <Dialog
        open={Boolean(detailEvent)}
        onClose={() => setDetailEvent(null)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle title="审计事件详情" onClose={() => setDetailEvent(null)} />
        <XDriveDialogContent dividers>
          {detailEvent ? (
            <XDriveDescriptionGrid>
              <XDriveDescriptionItem label="时间">
                <Typography variant="body2">{new Date(detailEvent.created_at).toLocaleString()}</Typography>
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="操作者">
                <Typography variant="body2">
                  {detailEvent.actor_username || '匿名'}
                  {detailEvent.actor_role ? ` · ${actorRoleLabel(detailEvent.actor_role)}` : ''}
                </Typography>
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="操作">
                <Stack spacing={0.25}>
                  <Typography variant="body2">{actionLabel(detailEvent.action)}</Typography>
                  <Typography component="code" variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {detailEvent.action}
                  </Typography>
                </Stack>
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="目标">
                <Stack spacing={0.25}>
                  <Typography variant="body2">
                    {detailEvent.target_label || detailEvent.target_id || '—'}
                    {detailEvent.target_label && detailEvent.target_id ? ` · ${detailEvent.target_id}` : ''}
                  </Typography>
                  {detailEvent.target_type ? (
                    <Typography variant="caption" color="text.secondary">{detailEvent.target_type}</Typography>
                  ) : null}
                </Stack>
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="结果">
                <XDriveStatusBadge
                  tone={detailEvent.result === 'success' ? 'good' : 'bad'}
                  label={detailEvent.result === 'success' ? '成功' : '失败'}
                />
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="来源 IP">
                <Typography variant="body2">{detailEvent.ip_address || '—'}</Typography>
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="Request ID">
                <Typography component="code" variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {detailEvent.request_id || '—'}
                </Typography>
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="Metadata" fullWidth>
                <Typography
                  component="pre"
                  variant="body2"
                  sx={{
                    m: 0,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    fontFamily: 'monospace',
                    fontWeight: 400,
                  }}
                >
                  {metadataText(detailEvent.metadata)}
                </Typography>
              </XDriveDescriptionItem>
            </XDriveDescriptionGrid>
          ) : null}
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton intent="primary" onClick={() => setDetailEvent(null)}>关闭</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>
    </>
  )
}
