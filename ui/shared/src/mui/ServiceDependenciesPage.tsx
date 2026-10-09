import { useEffect, useState } from 'react'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import type {
  XDriveServiceDependenciesSnapshot,
  XDriveServiceDependency,
  XDriveServiceDependencyGroup,
  XDriveServiceDependencyState,
} from '../service-dependencies'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { XDriveStatusAlert } from './StatusAlert'

export type XDriveServiceDependenciesPort = {
  load: () => Promise<XDriveServiceDependenciesSnapshot>
}

const groups: Array<{ id: XDriveServiceDependencyGroup; label: string; description: string }> = [
  { id: 'core', label: '基础服务', description: '核心数据库与文件存储的实时就绪探针。' },
  { id: 'media', label: '媒体处理', description: '独立 FFmpeg Media Worker 尚未进入生产服务合同。' },
  { id: 'intelligence', label: '照片智能分析', description: '共享 Photo Intelligence 容器；分别探测已配置的分析能力。' },
  { id: 'location', label: '地理位置与地图', description: '离线地名解析与地图瓦片 Provider 是两个独立依赖。' },
]

const statusLabels: Record<XDriveServiceDependencyState, { label: string; color: 'success' | 'error' | 'warning' | 'default' }> = {
  ready: { label: '可用', color: 'success' },
  unavailable: { label: '不可用', color: 'error' },
  disabled: { label: '未启用', color: 'default' },
  unknown: { label: '无法检测', color: 'warning' },
  planned: { label: '尚未接入', color: 'default' },
}

function ServiceRow({ service }: { service: XDriveServiceDependency }) {
  const state = statusLabels[service.status] ?? statusLabels.unknown
  return (
    <Box
      data-xdrive-service-id={service.id}
      sx={{ px: { xs: 1.5, sm: 2 }, py: 1.75, '& + &': { borderTop: 1, borderColor: 'divider' } }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" spacing={1}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" component="h3" sx={{ overflowWrap: 'anywhere' }}>
            {service.label}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
            {service.detail}
          </Typography>
          {(service.version || service.model) && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', overflowWrap: 'anywhere' }}>
              {service.version ? '版本：' + service.version : ''}
              {service.version && service.model ? ' · ' : ''}
              {service.model ? '模型：' + service.model : ''}
            </Typography>
          )}
        </Box>
        <Chip size="small" color={state.color} variant="outlined" label={state.label} />
      </Stack>
    </Box>
  )
}

/** Read-only service status. No Docker control socket, model secrets, or fake configuration toggles. */
export function XDriveServiceDependenciesPage({
  source,
}: {
  source: XDriveServiceDependenciesPort
}) {
  const [snapshot, setSnapshot] = useState<XDriveServiceDependenciesSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshID, setRefreshID] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    // Do not retain an old server/account snapshot while a different source loads.
    setSnapshot(null)
    void source.load().then((next) => {
      if (active) setSnapshot(next)
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : '读取依赖状态失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [source, refreshID])

  const checkedAt = snapshot?.checked_at
    ? new Date(snapshot.checked_at).toLocaleString()
    : ''
  const healthy = snapshot?.services.filter((item) => item.status === 'ready').length ?? 0

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="服务与依赖"
      subtitle="只读查看实际运行状态。容器部署参数仍由管理员通过 Compose 与环境变量管理。"
      pageActions={(
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshRoundedIcon fontSize="small" />}
          onClick={() => setRefreshID((value) => value + 1)}
          disabled={loading}
        >
          刷新状态
        </Button>
      )}
    >
      <Stack spacing={2.5} data-xdrive-admin-service-dependencies>
        <Typography variant="body2" color="text.secondary">
          {loading
            ? '正在检查服务…'
            : snapshot
              ? '检测时间：' + checkedAt + ' · 已就绪 ' + healthy + ' / ' + snapshot.services.length + ' 项'
              : '尚未取得服务检测结果'}
        </Typography>
        {loading && <CircularProgress size={22} aria-label="正在加载服务状态" />}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {!loading && snapshot && groups.map((group) => {
          const items = snapshot.services.filter((item) => item.group === group.id)
          if (!items.length) return null
          return (
            <Box key={group.id} component="section" aria-label={group.label}>
              <Typography variant="subtitle1" fontWeight={700}>{group.label}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {group.description}
              </Typography>
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                {items.map((service) => <ServiceRow key={service.id} service={service} />)}
              </Paper>
            </Box>
          )
        })}
        <Typography variant="caption" color="text.secondary">
          “尚未接入”表示服务或状态探针尚未实现，不代表已安装或健康。“未启用”表示当前 Server 未配置对应功能。本页面不会自动启停容器、修改密钥或触发全库重分析。
        </Typography>
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
