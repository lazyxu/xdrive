import { useEffect, useState } from 'react'
import {
  Autocomplete,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStatusBadge,
  XDriveWorkspaceSurface,
} from '@xdrive/ui/mui'
import type { XDriveApi } from './api'
import type { AuditEvent } from '../../ui/shared/src'

const ACTION_OPTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.password.change',
  'admin.user.create',
  'admin.user.role_change',
  'admin.user.disable',
  'admin.user.enable',
  'admin.user.quota_change',
  'admin.user.password_reset',
  'admin.user.sessions_revoke',
  'admin.user.delete',
  'file.permanent_delete',
  'file.version_restore',
  'system.backup',
  'system.restore',
  'system.update',
]

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
    <XDriveWorkspaceSurface presentation="page" title="审计日志">
      <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
            <Autocomplete
              size="small"
              options={ACTION_OPTIONS}
              value={action ?? null}
              onChange={(_event, value) => setAction(value ?? undefined)}
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
            <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflowX: 'auto' }}>
              <Table size="small" aria-label="审计日志" sx={{ minWidth: 1300 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 190 }}>时间</TableCell>
                    <TableCell sx={{ width: 150 }}>操作者</TableCell>
                    <TableCell sx={{ width: 220 }}>操作</TableCell>
                    <TableCell sx={{ width: 190 }}>目标</TableCell>
                    <TableCell sx={{ width: 100 }}>结果</TableCell>
                    <TableCell sx={{ width: 220 }}>来源</TableCell>
                    <TableCell>详情</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {events.map((event) => {
                    const targetLabel = event.target_label || event.target_id || '—'
                    const targetSuffix = event.target_label && event.target_id ? ' · ' + event.target_id : ''
                    const metadata = metadataText(event.metadata)
                    return (
                      <TableRow key={event.id} hover>
                        <TableCell>{new Date(event.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <Stack spacing={0.2}>
                            <Typography variant="body2">{event.actor_username || '匿名'}</Typography>
                            {event.actor_role && <Typography variant="caption" color="text.secondary">{event.actor_role}</Typography>}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography component="code" variant="body2">{event.action}</Typography>
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
                          <Stack spacing={0.2}>
                            <Typography variant="body2">{event.ip_address || '—'}</Typography>
                            {event.request_id && (
                              <Tooltip title={event.request_id}>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  noWrap
                                  sx={{ maxWidth: 200, display: 'block' }}
                                >
                                  {event.request_id}
                                </Typography>
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Tooltip title={metadata}>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              noWrap
                              sx={{ maxWidth: 360 }}
                            >
                              {metadata}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
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
  )
}
