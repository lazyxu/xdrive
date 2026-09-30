import { useEffect, useState } from 'react'
import {
  Autocomplete,
  Dialog,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
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
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import type { XDriveApi } from './api'
import type { AuditEvent } from '../../ui/shared/src'

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

export default function AdminAuditPanel({
  api,
}: {
  api: XDriveApi
}) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState<string>()
  const [result, setResult] = useState<'success' | 'failure'>()
  const [actor, setActor] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [detailEvent, setDetailEvent] = useState<AuditEvent | null>(null)

  type Filters = {
    action?: string
    result?: 'success' | 'failure'
    actor?: string
  }

  const load = async (reset = true, filters: Filters = { action, result, actor }) => {
    setLoading(true)
    setError('')
    try {
      const batch = await api.adminAudit({
        limit: 100,
        before_id: reset ? undefined : events.at(-1)?.id,
        action: filters.action,
        result: filters.result,
        actor: filters.actor?.trim() || undefined,
      })
      setEvents((current) => reset ? batch : [...current, ...batch])
      setHasMore(batch.length === 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审计日志失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(true)
    // Filters are applied explicitly with the Apply button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

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
                if (event.key === 'Enter') void load(true)
              }}
              sx={{ width: { xs: '100%', sm: 220 } }}
            />
            <XDriveActionButton intent="primary" loading={loading} loadingLabel="正在加载…" onClick={() => void load(true)}>
              应用
            </XDriveActionButton>
            <XDriveActionButton
              disabled={loading}
              onClick={() => {
                const cleared: Filters = { action: undefined, result: undefined, actor: '' }
                setAction(undefined)
                setResult(undefined)
                setActor('')
                void load(true, cleared)
              }}
            >
              清除
            </XDriveActionButton>
          </Stack>

          {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
          {loading && events.length > 0 ? <LinearProgress /> : null}

          {loading && events.length === 0 ? (
            <XDriveStatePanel variant="plain" loading message="正在加载审计日志…" />
          ) : events.length === 0 ? (
            <XDriveStatePanel variant="plain" message="未找到审计事件" />
          ) : (
            <XDriveTableSurface>
              <Table size="small" aria-label="审计日志" sx={{ minWidth: 880 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 180 }}>时间</TableCell>
                    <TableCell sx={{ width: 140 }}>操作者</TableCell>
                    <TableCell sx={{ width: 220 }}>操作</TableCell>
                    <TableCell sx={{ width: 200 }}>目标</TableCell>
                    <TableCell sx={{ width: 90 }}>结果</TableCell>
                    <TableCell sx={{ width: 80 }}>详情</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {events.map((event) => {
                    const targetLabel = event.target_label || event.target_id || '—'
                    const targetSuffix = event.target_label && event.target_id ? ' · ' + event.target_id : ''
                    return (
                      <TableRow key={event.id} hover>
                        <TableCell>{new Date(event.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <Stack spacing={0.2}>
                            <Typography variant="body2">{event.actor_username || '匿名'}</Typography>
                            {event.actor_role && (
                              <Typography variant="caption" color="text.secondary">
                                {actorRoleLabel(event.actor_role)}
                              </Typography>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Stack spacing={0.2}>
                            <Typography variant="body2">{actionLabel(event.action)}</Typography>
                            <Typography component="code" variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                              {event.action}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Stack spacing={0.2}>
                            <Typography variant="body2">{targetLabel}{targetSuffix}</Typography>
                            {event.target_type && <Typography variant="caption" color="text.secondary">{event.target_type}</Typography>}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <XDriveStatusBadge
                            tone={event.result === 'success' ? 'good' : 'bad'}
                            label={event.result === 'success' ? '成功' : '失败'}
                          />
                        </TableCell>
                        <TableCell>
                          <XDriveActionButton compact onClick={() => setDetailEvent(event)}>
                            查看
                          </XDriveActionButton>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </XDriveTableSurface>
          )}

          {hasMore && (
            <Stack alignItems="center">
              <XDriveActionButton loading={loading} loadingLabel="正在加载…" onClick={() => void load(false)}>
                加载更早记录
              </XDriveActionButton>
            </Stack>
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
