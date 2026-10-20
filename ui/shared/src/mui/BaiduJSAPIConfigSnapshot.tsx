import { Box, Button, Stack, Typography } from '@mui/material'
import type { XDriveBaiduJSAPIConfig } from '../service-dependencies'

// The six fields are all returned by the authenticated Server config endpoint.
// Only desired_enabled and encrypted Browser AK have an administrative write API.
// Runtime, release authority, blockers and restart flags MUST remain Server-derived.
export function XDriveBaiduJSAPIConfigSnapshot({
  config, lastReadAt, refreshing, canRefresh, dirty, onRefresh,
}: {
  config: XDriveBaiduJSAPIConfig
  lastReadAt: string | null
  refreshing: boolean
  canRefresh: boolean
  dirty: boolean
  onRefresh: () => void
}) {
  const blockers = config.release_blockers
  const rows = [
    { key: 'configured', value: String(config.configured), note: config.configured ? 'Browser AK 已加密保存' : '请设置独立 Browser AK' },
    { key: 'desired_enabled', value: String(config.desired_enabled), note: '管理员保存的期望开关；下方可修改' },
    { key: 'runtime_enabled', value: String(config.runtime_enabled), note: '当前 Server 实际签名授权；只读' },
    { key: 'activation_state', value: config.activation_state, note: 'Server 计算的发布状态；只读' },
    { key: 'release_blockers', value: blockers === undefined ? '未返回' : JSON.stringify(blockers), note: 'Server 返回的阻断代码；无法直接覆盖' },
    { key: 'requires_restart', value: String(config.requires_restart), note: '本配置的 Server 生效要求；只读' },
  ]
  return (
    <Box data-xdrive-baidu-jsapi4-six-field-state sx={{
      border: 1, borderColor: 'divider', borderRadius: 1.5, p: { xs: 1.5, sm: 2 },
      minWidth: 0,
    }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}
        justifyContent="space-between">
        <Typography variant="subtitle2" fontWeight={700}>Server 配置与运行状态</Typography>
        <Button size="small" variant="outlined" disabled={!canRefresh || refreshing}
          data-xdrive-jsapi-refresh-state onClick={onRefresh}>
          {refreshing ? '正在读取…' : '刷新 Server 实时状态'}
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, mb: 1.25 }}>
        {lastReadAt ? `最近成功读取：${new Date(lastReadAt).toLocaleString('zh-CN')}` : '尚无有效读取时间'}
        {' · '}保存修订 #{config.revision}
        {dirty ? ' · 存在未保存修改，保存后才能刷新' : ''}
      </Typography>
      <Box component="dl" sx={{ m: 0 }}>
        {rows.map(({ key, value, note }) => (
          <Box key={key} sx={{
            display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(155px, 34%) minmax(0, 1fr)' },
            gap: { xs: 0.25, sm: 1 }, py: 0.85, borderTop: 1, borderColor: 'divider',
          }}>
            <Typography component="dt" variant="body2" sx={{
              m: 0, fontFamily: 'monospace', overflowWrap: 'anywhere',
            }}>{key}</Typography>
            <Box component="dd" sx={{ m: 0, minWidth: 0 }}>
              <Typography variant="body2" data-xdrive-jsapi-state-value={key} sx={{
                fontFamily: 'monospace', overflowWrap: 'anywhere',
                color: key === 'runtime_enabled' && !config.runtime_enabled ? 'text.secondary' : 'text.primary',
              }}>{value}</Typography>
              <Typography variant="caption" color="text.secondary">{note}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        可修改：desired_enabled，以及通过下方密码输入框设置或清除 Browser AK。
        其余字段为 Server 实际状态，无法通过手动设置 true、删除阻断原因或编辑 JSON 绕过发布门禁。
      </Typography>
    </Box>
  )
}
