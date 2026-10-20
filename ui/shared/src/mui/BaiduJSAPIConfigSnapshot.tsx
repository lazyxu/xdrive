import { useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { XDriveBaiduJSAPIConfig } from '../service-dependencies'

// One truthful Server snapshot, mounted ONLY under Verify. The normal view
// has a compact release status; six raw read-only fields are a disclosure,
// never six editable switches nor a second copy in the Config section.
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const blockers = config.release_blockers
  const rows = [
    { key: 'configured', value: String(config.configured), note: config.configured ? 'Browser AK 已加密保存' : '未配置独立 Browser AK' },
    { key: 'desired_enabled', value: String(config.desired_enabled), note: '已保存期望开关' },
    { key: 'runtime_enabled', value: String(config.runtime_enabled), note: 'Server 当前签名放行结果' },
    { key: 'activation_state', value: config.activation_state, note: 'Server 当前发布状态' },
    { key: 'release_blockers', value: blockers === undefined ? '未返回' : JSON.stringify(blockers), note: '当前 Server 阻断代码' },
    { key: 'requires_restart', value: String(config.requires_restart), note: '当前配置的生效方式' },
  ]
  return (
    <Box data-xdrive-baidu-jsapi4-server-evidence sx={{
      border: 1, borderColor: 'divider', borderRadius: 1.5,
      p: { xs: 1.25, sm: 1.5 }, minWidth: 0,
    }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
        alignItems={{ sm: 'center' }} justifyContent="space-between">
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>发布证据</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            修订 #{config.revision}
            {' · '}{lastReadAt ? '读取于 ' + new Date(lastReadAt).toLocaleString('zh-CN') : '尚无有效读取时间'}
          </Typography>
        </Box>
        <Button size="small" variant="outlined" disabled={!canRefresh || refreshing}
          data-xdrive-jsapi-refresh-state onClick={onRefresh}>
          {refreshing ? '正在读取…' : '刷新 Server 状态'}
        </Button>
      </Stack>
      {dirty && (
        <Typography variant="caption" color="warning.main">
          有未保存的修改，保存后才能刷新。
        </Typography>
      )}
      <Button size="small" variant="text" color="inherit" sx={{ mt: 0.5, px: 0.5 }}
        data-xdrive-baidu-jsapi4-technical-toggle aria-expanded={detailsOpen}
        aria-controls="xdrive-baidu-jsapi4-technical-fields"
        onClick={() => setDetailsOpen((expanded) => !expanded)}>
        {detailsOpen ? '收起六项技术字段' : '查看六项技术字段'}
      </Button>
      {detailsOpen && (
        <Box component="dl" id="xdrive-baidu-jsapi4-technical-fields"
          data-xdrive-baidu-jsapi4-six-field-state sx={{ m: 0, mt: 1 }}>
          {rows.map(({ key, value, note }) => (
            <Box key={key} sx={{
              display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'minmax(165px,36%) minmax(0,1fr)' },
              gap: { xs: 0.25, sm: 1 }, py: 0.75, borderTop: 1, borderColor: 'divider',
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
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            六项为 Server 实际状态。仅 desired_enabled 和安全的 Browser AK 更新支持管理员修改；
            不能通过覆盖运行字段或手动清除阻断原因伪造授权。
          </Typography>
        </Box>
      )}
    </Box>
  )
}
