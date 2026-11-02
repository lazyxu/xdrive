import { Box, Button, Chip, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material'
import type { XDriveBaiduMapAdminConfig, XDriveServiceDependency } from '../service-dependencies'
import { xDriveDashboardAssessment, xDriveSystemDependencyOverviewSignals } from '../system-dependencies-overview'
import { XDriveSensitiveField } from './SensitiveField'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'

/** Shared Web/Mobile Web/Desktop: Server API coordinates only.
 * This does NOT own Browser AK, JSAPI4 licensing, Loader probes or an SDK Host. */
export function XDriveBaiduServerAPIDetail({
  service, checkedAt, config, enabled, draftAK, revealedAK, loading,
  refreshing, busy, otherBusy = false, revealingAK, hasUnsavedEdits, dirty, error, notice,
  clearOpen, canReadConfig, canSaveConfig, canRevealAK,
  onRefreshStatus, onEnabledChange, onAKChange, onRevealAK, onHideAK,
  onSave, onDiscard, onClearRequest, onClearCancel, onClearConfirm,
}: {
  service: XDriveServiceDependency
  checkedAt: string
  config: XDriveBaiduMapAdminConfig | null
  enabled: boolean
  draftAK: string
  revealedAK: string
  loading: boolean
  refreshing: boolean
  busy: boolean
  otherBusy?: boolean
  revealingAK: boolean
  hasUnsavedEdits: boolean
  dirty: boolean
  error: string
  notice: string
  clearOpen: boolean
  canReadConfig: boolean
  canSaveConfig: boolean
  canRevealAK: boolean
  onRefreshStatus: () => void
  onEnabledChange: (enabled: boolean) => void
  onAKChange: (value: string) => void
  onRevealAK: () => void
  onHideAK: () => void
  onSave: () => void
  onDiscard: () => void
  onClearRequest: () => void
  onClearCancel: () => void
  onClearConfirm: () => void
}) {
  const assessment = xDriveDashboardAssessment(service)
  const axes = xDriveSystemDependencyOverviewSignals(service)
  const checking = loading || refreshing || busy || otherBusy || revealingAK
  const editable = config?.editable === true && canSaveConfig
  const canSave = editable && dirty && !checking && !clearOpen
  // Administrator inventory is automatically loaded on page entry; it NEVER
  // makes a quota-consuming Baidu request. Don't label the local-read time as
  // provider verification or turn an enabled AK into green remote health.
  const health = service.health_state === 'ready' ? '检查通过'
    : service.health_state === 'failed' ? '检查异常'
      : service.health_state === 'not-checked' ? '百度上游未检测' : '无法确认'
  const stateLabel = service.health_state === 'not-checked' &&
    assessment.state === 'attention' ? '上游未验证' : assessment.label

  return (
    <Box data-xdrive-baidu-server-flat="true" sx={{ width: '100%', minWidth: 0 }}>
      <Paper variant="outlined" id="dependency-baidu-map-status-header"
        sx={{ borderRadius: 2, p: { xs: 1.5, sm: 2 }, scrollMarginTop: 72 }}>
        <Stack spacing={1}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
            <Typography variant="subtitle2" fontWeight={700}>Server API · 当前状态</Typography>
            <Button size="small" variant="outlined" data-xdrive-baidu-server-refresh
              onClick={onRefreshStatus} disabled={checking || hasUnsavedEdits || clearOpen}
              aria-busy={refreshing || undefined}>
              刷新本机状态
            </Button>
          </Stack>
          <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
            <Chip size="small" color={assessment.state === 'healthy' ? 'success' :
              assessment.state === 'failed' ? 'error' : 'default'}
              variant="outlined" label={stateLabel} data-xdrive-baidu-server-state={assessment.state} />
            <Typography variant="body2" color="text.secondary">
              健康：{health} · {axes[3].label}：{axes[3].value}
            </Typography>
          </Stack>
          {checkedAt && <Typography variant="caption" color="text.secondary">
            本机状态读取时间：{checkedAt}
          </Typography>}
          <Typography variant="body2" color="text.secondary" data-xdrive-baidu-server-evidence-scope>
            进入页面会自动读取 Server 本机配置与运行状态；「刷新本机状态」只重新读取，不会请求百度上游或消耗坐标转换配额。
            百度上游是否接受 Server AK 尚未在线核验；动态地图的 Browser AK 与 Loader 状态另行显示。
          </Typography>
          {(service.health_state === 'failed' || service.status === 'unavailable') && service.detail && (
            <Typography variant="body2" color={service.health_state === 'failed' ? 'error.main' : 'text.secondary'}>
              {service.detail}
            </Typography>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" id="dependency-baidu-map-config-header"
        data-xdrive-baidu-server-config sx={{ mt: 1.5, borderRadius: 2,
          p: { xs: 1.5, sm: 2 }, scrollMarginTop: 72 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
            <Typography variant="subtitle2" fontWeight={700}>Server API 配置</Typography>
            {config && <Chip size="small" variant="outlined"
              color={config.configured ? 'success' : 'default'}
              label={config.configured ? 'Server AK 已保存' : 'Server AK 未配置'} />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Server AK 仅用于坐标转换；动态地图 JSAPI 4.0 使用另一套 Browser AK。
          </Typography>
          {config ? (
            <>
              <FormControlLabel label="启用坐标转换"
                control={<Switch checked={enabled} onChange={(_event, value) => onEnabledChange(value)}
                  disabled={!editable || checking} />} />
              <XDriveSensitiveField label="Server AK" value={draftAK} configured={config.configured}
                revealedValue={revealedAK} onReveal={onRevealAK} onHide={onHideAK}
                revealLoading={revealingAK} revealDisabled={!canRevealAK}
                disabled={!editable || checking} maxLength={256}
                onChange={onAKChange} />
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button size="small" variant="contained" disabled={!canSave}
                  onClick={onSave}>{busy ? '正在保存…' : '保存配置'}</Button>
                {dirty && <Button size="small" variant="text" disabled={checking}
                  onClick={onDiscard}>放弃修改</Button>}
                <Button size="small" variant="outlined" color="error"
                  disabled={!editable || !config.configured || checking || dirty}
                  onClick={onClearRequest}>清除 AK</Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {config.source === 'environment' ? '部署环境变量配置' : '管理员保存配置'}
                {' · '}{config.requires_restart ? 'Server 指示需要重启' : '新请求即时使用新配置'}
                {' · '}点击“显示”仅短暂读取已保存的 AK。
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary" data-xdrive-baidu-server-unverified>
              {loading ? '正在读取配置…' : canReadConfig
                ? '当前无法确认已保存的 Server AK；不会显示不可验证的编辑入口。'
                : '当前 Server / Desktop Agent 不支持在线管理 Server AK。'}
            </Typography>
          )}
          {config && !config.editable && (
            <Typography variant="caption" color="text.secondary">
              当前部署不允许在线编辑；如需管理加密凭据，请检查服务端密钥环与管理员权限。
            </Typography>
          )}
          {hasUnsavedEdits && !dirty && (
            <Typography variant="caption" color="text.secondary">
              其他地图配置尚未保存；请先保存或放弃再刷新。
            </Typography>
          )}
          {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
          {notice && <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert>}
        </Stack>
      </Paper>
      <XDriveConfirmDialog open={clearOpen} title="确认清除 Server API AK"
        description="将清除 Server AK 并停用坐标转换；独立 Browser AK 和 JSAPI 4.0 的签名发布不受影响。"
        confirmLabel="确认清除并停用" confirmIntent="danger"
        loading={busy} onCancel={onClearCancel} onConfirm={onClearConfirm} />
    </Box>
  )
}
