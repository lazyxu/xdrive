import { useCallback, useEffect, useRef, useState } from 'react'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Box, Button, Chip, CircularProgress, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import type {
  XDriveBaiduMapAdminConfig,
  XDriveBaiduMapAdminUpdate,
  XDriveBaiduMapAKReveal,
  XDriveServiceDependenciesSnapshot,
  XDriveServiceDependency,
  XDriveServiceDependencyGroup,
  XDriveServiceDependencyState,
  XDriveServiceApplyMode,
} from '../service-dependencies'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStoredCredentialField } from './SourceCredentialFields'

export type XDriveServiceDependenciesPort = {
  load: () => Promise<XDriveServiceDependenciesSnapshot>
  loadBaiduMapConfig?: () => Promise<XDriveBaiduMapAdminConfig>
  saveBaiduMapConfig?: (input: XDriveBaiduMapAdminUpdate) => Promise<XDriveBaiduMapAdminConfig>
  revealBaiduMapAK?: (revision: number) => Promise<XDriveBaiduMapAKReveal>
}

const groups: Array<{ id: XDriveServiceDependencyGroup; label: string; description: string }> = [
  { id: 'core', label: '基础服务', description: '核心数据库与文件存储的实时就绪探针。' },
  { id: 'media', label: '媒体处理', description: '独立 FFmpeg Media Worker 尚未进入生产服务合同。' },
  { id: 'intelligence', label: '照片智能分析', description: '共享 Photo Intelligence 容器；分别探测已配置的分析能力。' },
  { id: 'location', label: '地理位置与地图', description: 'GeoNames 只提供可选地名标签；百度地图是唯一地图 Provider。' },
]

const statusLabels: Record<XDriveServiceDependencyState, { label: string; color: 'success' | 'error' | 'warning' | 'default' }> = {
  ready: { label: '可用', color: 'success' },
  unavailable: { label: '不可用', color: 'error' },
  disabled: { label: '未启用', color: 'default' },
  unknown: { label: '无法检测', color: 'warning' },
  planned: { label: '尚未接入', color: 'default' },
}

const applyModeLabels: Record<XDriveServiceApplyMode, string> = {
  immediate: '保存后立即生效',
  'controlled-restart': '受控重启／重新部署后生效',
  'not-available': '尚无安全配置执行接口',
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
          {service.config_hint && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', overflowWrap: 'anywhere' }}>
              {service.config_hint}
            </Typography>
          )}
          {service.apply_mode && (
            <Chip size="small" variant="outlined" sx={{ mt: 1 }}
              label={applyModeLabels[service.apply_mode] ?? '配置生效模式待确认'} />
          )}
        </Box>
        <Chip size="small" color={state.color} variant="outlined" label={state.label} />
      </Stack>
    </Box>
  )
}

/** Administrator-only status and encrypted Baidu AK management. No Docker control socket. */
export function XDriveServiceDependenciesPage({
  source,
}: {
  source: XDriveServiceDependenciesPort
}) {
  const [snapshot, setSnapshot] = useState<XDriveServiceDependenciesSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshID, setRefreshID] = useState(0)
  const [baiduConfig, setBaiduConfig] = useState<XDriveBaiduMapAdminConfig | null>(null)
  const [baiduEnabled, setBaiduEnabled] = useState(false)
  const [baiduAK, setBaiduAK] = useState('')
  const [baiduError, setBaiduError] = useState('')
  const [baiduNotice, setBaiduNotice] = useState('')
  const [baiduBusy, setBaiduBusy] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [baiduReveal, setBaiduReveal] = useState<XDriveBaiduMapAKReveal | null>(null)
  const [revealingAK, setRevealingAK] = useState(false)
  const revealEpochRef = useRef(0)

  const hideBaiduAK = useCallback(() => {
    ++revealEpochRef.current
    setBaiduReveal(null)
    setRevealingAK(false)
  }, [])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'visible') hideBaiduAK()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', hideBaiduAK)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', hideBaiduAK)
    }
  }, [hideBaiduAK])

  useEffect(() => {
    let active = true
    ++revealEpochRef.current
    setBaiduReveal(null)
    setRevealingAK(false)
    setLoading(true)
    setError('')
    // Do not retain an old server/account snapshot while a different source loads.
    setSnapshot(null)
    setBaiduConfig(null)
    setBaiduEnabled(false)
    setBaiduAK('')
    setBaiduError('')
    setBaiduNotice('')
    if (source.loadBaiduMapConfig) {
      void source.loadBaiduMapConfig().then((config) => {
        if (!active) return
        setBaiduConfig(config)
        setBaiduEnabled(config.enabled)
      }).catch(() => {
        if (active) setBaiduError('无法读取百度地图管理配置，请检查 Server 或更新客户端。')
      })
    }
    void source.load().then((next) => {
      if (active) setSnapshot(next)
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : '读取依赖状态失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      ++revealEpochRef.current
    }
  }, [source, refreshID])

  const revealBaiduAK = async () => {
    if (!baiduConfig?.configured || !source.revealBaiduMapAK || revealingAK || baiduBusy) return
    const epoch = ++revealEpochRef.current
    setBaiduReveal(null)
    setRevealingAK(true)
    setBaiduError('')
    try {
      const revealed = await source.revealBaiduMapAK(baiduConfig.revision)
      if (epoch !== revealEpochRef.current) return
      if (revealed.field !== 'ak' || !revealed.value) throw new Error('读取 AK 响应无效')
      setBaiduReveal(revealed)
    } catch (err) {
      if (epoch !== revealEpochRef.current) return
      setBaiduReveal(null)
      setBaiduError(err instanceof Error ? err.message : '显示 AK 失败，请重试。')
    } finally {
      if (epoch === revealEpochRef.current) setRevealingAK(false)
    }
  }

  const applyBaiduMap = async (clearAK = false) => {
    if (!baiduConfig || !source.saveBaiduMapConfig || baiduBusy) return
    hideBaiduAK()
    const ak = baiduAK.trim()
    if (!clearAK && baiduEnabled && !baiduConfig.configured && !ak) {
      setBaiduError('启用百度地图前，请先填写有效的 Server AK。')
      return
    }
    setBaiduBusy(true)
    setBaiduError('')
    setBaiduNotice('')
    try {
      const next = await source.saveBaiduMapConfig({
        enabled: clearAK ? false : baiduEnabled,
        revision: baiduConfig.revision,
        ...(clearAK ? { clear_ak: true } : ak ? { ak } : {}),
      })
      setBaiduConfig(next)
      setBaiduEnabled(next.enabled)
      setBaiduAK('')
      setBaiduNotice('已保存并生效。无需重启 xDrive Server；新请求会使用当前设置。')
      const status = await source.load()
      setSnapshot(status)
    } catch (err) {
      setBaiduError(err instanceof Error ? err.message : '保存百度地图配置失败；请刷新后重试。')
    } finally {
      setBaiduBusy(false)
      setClearConfirmOpen(false)
    }
  }

  const checkedAt = snapshot?.checked_at
    ? new Date(snapshot.checked_at).toLocaleString()
    : ''
  // Ignore user-level connector rows returned by older Server versions.
  const systemServices = snapshot?.services.filter((item) => groups.some((group) => group.id === item.group)) ?? []
  const healthy = systemServices.filter((item) => item.status === 'ready').length

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="服务与依赖"
      subtitle="仅管理整个 xDrive 实例的系统服务：查看配置来源、生效方式与真实健康状态；用户同步文件夹不在此管理。"
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
              ? '检测时间：' + checkedAt + ' · 已就绪 ' + healthy + ' 项 · 已登记服务 ' + systemServices.length + ' 项'
              : '尚未取得服务检测结果'}
        </Typography>
        {loading && <CircularProgress size={22} aria-label="正在加载服务状态" />}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {!loading && snapshot && groups.map((group) => {
          const items = systemServices.filter((item) => item.group === group.id)
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
              {group.id === 'location' && (
                <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" fontWeight={700}>百度地图 Server AK</Typography>
                    <Typography variant="body2" color="text.secondary">
                      仅用于百度地图服务端静态图。AK 在 Server 安全保存；只有主动点击“显示”才会临时读取，30 秒后自动隐藏。
                      保存后立即生效，不会重启 Server，也不会中断上传、下载或同步。
                    </Typography>
                    {baiduConfig && (
                      <Typography variant="caption" color="text.secondary">
                        {baiduConfig.configured ? '已配置 AK' : '尚未配置 AK'}
                        {' · '}
                        {baiduConfig.source === 'environment' ? '当前来源：部署环境变量' : '当前来源：管理员持久化设置'}
                        {' · '}
                        {baiduConfig.requires_restart ? '需要重启' : '修改后无需重启'}
                      </Typography>
                    )}
                    {baiduConfig && (
                      <XDriveStoredCredentialField
                        label="当前 Server AK"
                        configured={baiduConfig.configured}
                        revealedValue={baiduReveal?.field === 'ak' ? baiduReveal.value : ''}
                        loading={revealingAK}
                        expiresInSeconds={Math.min(30, Math.max(1, baiduReveal?.expires_in_seconds ?? 30))}
                        updatedAtLabel={baiduConfig.updated_at ? new Date(baiduConfig.updated_at).toLocaleString('zh-CN') : undefined}
                        configuredDescription={baiduConfig.source === 'environment'
                          ? 'AK 来自部署环境变量；只有管理员主动点击“显示”才会临时读取。'
                          : 'AK 已加密保存；只有管理员主动点击“显示”才会临时读取。'}
                        onReveal={() => { void revealBaiduAK() }}
                        onHide={hideBaiduAK}
                      />
                    )}
                    {baiduConfig?.editable ? (
                      <>
                        <FormControlLabel
                          label="启用百度地图"
                          control={
                            <Switch checked={baiduEnabled} onChange={(_event, value) => setBaiduEnabled(value)}
                              disabled={baiduBusy} />
                          }
                        />
                        <TextField
                          label="Server AK"
                          type="password"
                          size="small"
                          fullWidth
                          autoComplete="new-password"
                          value={baiduAK}
                          onChange={(event) => setBaiduAK(event.target.value)}
                          placeholder={baiduConfig.configured ? '留空则保留当前 AK' : '请输入百度地图 Server 类型 AK'}
                          inputProps={{ maxLength: 256 }}
                          disabled={baiduBusy}
                          helperText="只在保存时发送新 AK；主动显示的 AK 不会自动填入替换输入框。"
                        />
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button variant="contained" size="small" disabled={baiduBusy}
                            onClick={() => { void applyBaiduMap() }}>
                            {baiduBusy ? '正在保存…' : '保存并立即生效'}
                          </Button>
                          <Button color="error" variant="outlined" size="small"
                            disabled={baiduBusy || !baiduConfig.configured}
                            onClick={() => setClearConfirmOpen(true)}>
                            清除 AK
                          </Button>
                        </Stack>
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {baiduConfig
                          ? '当前部署尚未配置服务端凭据加密密钥环，无法在线修改 AK。请先配置 XD_CONNECTOR_SECRET_KEYS 并重新部署一次。'
                          : '当前 Server/Agent 不支持在线配置 AK；更新后即可在此编辑。'}
                      </Typography>
                    )}
                    {baiduError && <XDriveStatusAlert tone="bad">{baiduError}</XDriveStatusAlert>}
                    {baiduNotice && <XDriveStatusAlert tone="good">{baiduNotice}</XDriveStatusAlert>}
                  </Stack>
                  <XDriveConfirmDialog
                    open={clearConfirmOpen}
                    title="确认清除百度地图 AK"
                    description="清除后百度地图将立即停用，但不会回退到其他地图。普通图库、文件服务及同步不受影响。"
                    confirmLabel="清除 AK 并停用地图"
                    confirmIntent="danger"
                    loading={baiduBusy}
                    onCancel={() => setClearConfirmOpen(false)}
                    onConfirm={() => { void applyBaiduMap(true) }}
                  />
                </Paper>
              )}
            </Box>
          )
        })}
        <Typography variant="caption" color="text.secondary">
          “尚未接入”表示功能尚未实现；“无法检测”表示没有可靠的实时健康探针。只有支持在线配置的服务才开放保存操作。容器重启、数据迁移和镜像升级必须由受限部署流程执行，不会仅凭保存表单宣称生效。
        </Typography>
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
