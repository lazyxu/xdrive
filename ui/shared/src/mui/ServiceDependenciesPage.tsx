import { useCallback, useEffect, useRef, useState } from 'react'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Box, Button, Chip, CircularProgress, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import type {
  XDriveBaiduMapAdminConfig,
  XDriveBaiduMapAdminUpdate,
  XDriveBaiduMapAKReveal,
  XDrivePhotoAutoConfig,
  XDrivePhotoAutoKinds,
  XDrivePhotoAutoUpdate,
  XDrivePhotoAutoRevision,
  XDrivePhotoAutoRevisionPage,
  XDrivePhotoAutoRollbackInput,
  XDriveGeoNamesConfig,
  XDriveGeoNamesReloadResult,
  XDriveGeoNamesUpdate,
  XDriveGeoNamesRevision,
  XDriveGeoNamesRevisionPage,
  XDriveGeoNamesRollbackInput,
  XDriveGeoNamesSnapshotInput,
  XDriveGeoNamesSnapshotResult,
  XDriveGeoNamesDatasetApplyInput,
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
import { XDriveSourceWorkerConfigPanel } from './SourceWorkerConfigPanel'

export type XDriveServiceDependenciesPort = {
  load: () => Promise<XDriveServiceDependenciesSnapshot>
  loadSourceWorkerConfig?: () => Promise<import('../service-dependencies').XDriveSourceWorkerConfig>
  saveSourceWorkerConfig?: (input: import('../service-dependencies').XDriveSourceWorkerUpdate) => Promise<import('../service-dependencies').XDriveSourceWorkerConfig>
  loadSourceWorkerRevisions?: () => Promise<import('../service-dependencies').XDriveSourceWorkerRevisionPage>
  rollbackSourceWorker?: (input: import('../service-dependencies').XDriveSourceWorkerRollbackInput) => Promise<import('../service-dependencies').XDriveSourceWorkerConfig>
  loadBaiduMapConfig?: () => Promise<XDriveBaiduMapAdminConfig>
  saveBaiduMapConfig?: (input: XDriveBaiduMapAdminUpdate) => Promise<XDriveBaiduMapAdminConfig>
  revealBaiduMapAK?: (revision: number) => Promise<XDriveBaiduMapAKReveal>
  loadPhotoAutoConfig?: () => Promise<XDrivePhotoAutoConfig>
  savePhotoAutoConfig?: (input: XDrivePhotoAutoUpdate) => Promise<XDrivePhotoAutoConfig>
  loadPhotoAutoRevisions?: () => Promise<XDrivePhotoAutoRevisionPage>
  rollbackPhotoAuto?: (input: XDrivePhotoAutoRollbackInput) => Promise<XDrivePhotoAutoConfig>
  loadGeoNamesConfig?: () => Promise<XDriveGeoNamesConfig>
  saveGeoNamesConfig?: (input: XDriveGeoNamesUpdate) => Promise<XDriveGeoNamesConfig>
  reloadGeoNames?: (expectedVersion: string) => Promise<XDriveGeoNamesReloadResult>
  stageGeoNamesSnapshot?: (input: XDriveGeoNamesSnapshotInput) => Promise<XDriveGeoNamesSnapshotResult>
  applyGeoNamesDataset?: (input: XDriveGeoNamesDatasetApplyInput) => Promise<XDriveGeoNamesConfig>
  loadGeoNamesRevisions?: () => Promise<XDriveGeoNamesRevisionPage>
  rollbackGeoNames?: (input: XDriveGeoNamesRollbackInput) => Promise<XDriveGeoNamesConfig>
}

const defaultPhotoAutoKinds: XDrivePhotoAutoKinds = {
  face: true, smart: true, semantic: true, person_cluster: true,
}

// These correspond to existing Server task groups. Visual/OCR is one shared
// scheduler kind and must not be represented as separately controllable jobs.
const photoAutoKindChoices = [
  { key: 'face', title: '人脸检测与特征', description: '仅限制后续自动人脸处理' },
  { key: 'smart', title: '视觉识别 / OCR', description: '动物、物体识别与 OCR 共用当前自动任务队列' },
  { key: 'semantic', title: '语义向量与搜索索引', description: '仅限制后续自动语义分析' },
  { key: 'person_cluster', title: '人物聚类', description: '仅限制后续自动人物整理' },
] as const

function photoAutoKindSummary(kinds: XDrivePhotoAutoKinds): string {
  return photoAutoKindChoices.map((kind) => `${kind.title}：${kinds[kind.key] ? '开启' : '暂停'}`).join('、')
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
  'task-boundary': '运行批次完成后安全生效',
  'manual-reload': '管理员校验后手动热加载',
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
  const geoNamesEpochRef = useRef(0)
  const [geoNamesConfig, setGeoNamesConfig] = useState<XDriveGeoNamesConfig | null>(null)
  const [geoNamesDraftDistance, setGeoNamesDraftDistance] = useState('')
  const [geoNamesBusy, setGeoNamesBusy] = useState(false)
  const [geoNamesError, setGeoNamesError] = useState('')
  const [geoNamesNotice, setGeoNamesNotice] = useState('')
  const [geoNamesRevisions, setGeoNamesRevisions] = useState<XDriveGeoNamesRevision[]>([])
  const [geoNamesHistoryError, setGeoNamesHistoryError] = useState('')
  const [geoNamesRollbackTarget, setGeoNamesRollbackTarget] = useState('')
  const [geoNamesRollbackConfirmOpen, setGeoNamesRollbackConfirmOpen] = useState(false)
  const [geoNamesSnapshotConfirmOpen, setGeoNamesSnapshotConfirmOpen] = useState(false)
  const [geoNamesDatasetTarget, setGeoNamesDatasetTarget] = useState('')
  const [geoNamesDatasetConfirmOpen, setGeoNamesDatasetConfirmOpen] = useState(false)
  const photoPolicyEpochRef = useRef(0)
  const photoHistoryEpochRef = useRef(0)
  const [photoPolicy, setPhotoPolicy] = useState<XDrivePhotoAutoConfig | null>(null)
  const [photoAutoDraft, setPhotoAutoDraft] = useState(true)
  const [photoKindsDraft, setPhotoKindsDraft] = useState<XDrivePhotoAutoKinds>(defaultPhotoAutoKinds)
  const [photoPolicyBusy, setPhotoPolicyBusy] = useState(false)
  const [photoPolicyError, setPhotoPolicyError] = useState('')
  const [photoPolicyNotice, setPhotoPolicyNotice] = useState('')
  const [photoRevisions, setPhotoRevisions] = useState<XDrivePhotoAutoRevision[]>([])
  const [photoHistoryError, setPhotoHistoryError] = useState('')
  const [photoRollbackTarget, setPhotoRollbackTarget] = useState('')
  const [photoRollbackConfirmOpen, setPhotoRollbackConfirmOpen] = useState(false)

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
    ++geoNamesEpochRef.current
    ++photoPolicyEpochRef.current
    const photoHistoryEpoch = ++photoHistoryEpochRef.current
    setPhotoPolicy(null)
    setPhotoAutoDraft(true)
    setPhotoKindsDraft(defaultPhotoAutoKinds)
    setPhotoPolicyBusy(false)
    setPhotoPolicyError('')
    setPhotoPolicyNotice('')
    setPhotoRevisions([])
    setPhotoHistoryError('')
    setPhotoRollbackTarget('')
    setPhotoRollbackConfirmOpen(false)
    setBaiduReveal(null)
    setRevealingAK(false)
    setGeoNamesBusy(false)
    setGeoNamesConfig(null)
    setGeoNamesDraftDistance('')
    setGeoNamesError('')
    setGeoNamesNotice('')
    setGeoNamesRevisions([])
    setGeoNamesHistoryError('')
    setGeoNamesRollbackTarget('')
    setGeoNamesRollbackConfirmOpen(false)
    setGeoNamesSnapshotConfirmOpen(false)
    setGeoNamesDatasetTarget('')
    setGeoNamesDatasetConfirmOpen(false)
    setLoading(true)
    setError('')
    // Do not retain an old server/account snapshot while a different source loads.
    setSnapshot(null)
    setBaiduConfig(null)
    setBaiduEnabled(false)
    setBaiduAK('')
    setBaiduError('')
    setBaiduNotice('')
    if (source.loadPhotoAutoConfig) {
      void source.loadPhotoAutoConfig().then((policy) => {
        if (!active) return
        setPhotoPolicy(policy)
        setPhotoAutoDraft(policy.auto_enabled)
        setPhotoKindsDraft(policy.kinds ?? defaultPhotoAutoKinds)
      }).catch(() => {
        if (active) setPhotoPolicyError('无法读取照片智能分析策略，请检查 Server 或更新客户端。')
      })
    }
    if (source.loadPhotoAutoRevisions) {
      void source.loadPhotoAutoRevisions().then((page) => {
        if (active && photoHistoryEpoch === photoHistoryEpochRef.current) {
          setPhotoRevisions(page.items)
          setPhotoHistoryError('')
        }
      }).catch(() => {
        if (active && photoHistoryEpoch === photoHistoryEpochRef.current) {
          setPhotoHistoryError('无法读取照片智能分析配置历史，请检查 Server/Agent 版本。')
        }
      })
    }
    if (source.loadBaiduMapConfig) {
      void source.loadBaiduMapConfig().then((config) => {
        if (!active) return
        setBaiduConfig(config)
        setBaiduEnabled(config.enabled)
      }).catch(() => {
        if (active) setBaiduError('无法读取百度地图管理配置，请检查 Server 或更新客户端。')
      })
    }
    if (source.loadGeoNamesRevisions) {
      void source.loadGeoNamesRevisions().then((page) => {
        if (active) setGeoNamesRevisions(page.items)
      }).catch(() => {
        if (active) setGeoNamesHistoryError('当前服务尚无法读取 GeoNames 配置历史，请检查 Server/Agent 版本。')
      })
    }
    if (source.loadGeoNamesConfig) {
      void source.loadGeoNamesConfig().then((config) => {
        if (active) {
          setGeoNamesConfig(config)
          setGeoNamesDraftDistance(String(config.max_distance_km))
        }
      }).catch(() => {
        if (active) setGeoNamesError('无法读取 GeoNames 管理配置，请检查 Server 或更新客户端。')
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
      ++geoNamesEpochRef.current
      ++photoPolicyEpochRef.current
      ++photoHistoryEpochRef.current
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

  // This administrator command validates the deployment-mounted dataset and
  // swaps the fully loaded resolver. It does not edit a user sync folder, choose
  // an arbitrary Server filesystem path, or claim online env-variable editing.
  const saveGeoNamesConfig = async () => {
    if (!geoNamesConfig?.editable || !source.saveGeoNamesConfig || geoNamesBusy) return
    const distance = Number(geoNamesDraftDistance)
    if (!geoNamesDraftDistance.trim() || !Number.isFinite(distance) || distance <= 0 || distance > 500) {
      setGeoNamesError('匹配距离必须大于 0 且不超过 500 km。')
      return
    }
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const updated = await source.saveGeoNamesConfig({
        revision: geoNamesConfig.revision,
        max_distance_km: distance,
      })
      if (epoch !== geoNamesEpochRef.current) return
      setGeoNamesConfig(updated)
      setGeoNamesDraftDistance(String(updated.max_distance_km))
      setGeoNamesNotice(updated.apply_state === 'applied'
        ? '已持久化配置并写入审计，当前 Server 新索引立即生效；其他实例每 30 秒尝试自动校验并应用，失败时仍显示待生效。'
        : '配置已保存，但当前 Server 尚未确认生效，请校验并热加载。')
      if (source.loadGeoNamesRevisions) {
        const history = await source.loadGeoNamesRevisions().catch(() => null)
        if (epoch === geoNamesEpochRef.current && history) {
          setGeoNamesRevisions(history.items)
          setGeoNamesRollbackTarget('')
          setGeoNamesHistoryError('')
        }
      }
      const next = await source.load()
      if (epoch === geoNamesEpochRef.current) setSnapshot(next)
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 配置未保存，原索引继续生效。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) setGeoNamesBusy(false)
    }
  }

  const applyGeoNamesDataset = async () => {
    if (!geoNamesConfig || geoNamesConfig.desired_dataset_fingerprint === undefined ||
        !geoNamesDatasetTarget || !source.applyGeoNamesDataset || geoNamesBusy ||
        (!geoNamesConfig.snapshot_apply_supported && geoNamesDatasetTarget !== 'deployment')) return
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const next = await source.applyGeoNamesDataset({
        revision: geoNamesConfig.revision,
        expected_version: geoNamesConfig.current_version,
        expected_fingerprint: geoNamesConfig.active_dataset_fingerprint ?? '',
        target: geoNamesDatasetTarget,
      })
      if (epoch !== geoNamesEpochRef.current) return
      const expected = geoNamesDatasetTarget === 'deployment' ? '' : geoNamesDatasetTarget
      if (next.active_dataset_fingerprint !== expected ||
          next.desired_dataset_fingerprint !== expected || next.active_dataset_persistent !== true ||
          next.apply_state !== 'applied') {
        throw new Error('GeoNames 数据集未能确认当前 Server 实际热加载状态。')
      }
      setGeoNamesConfig(next)
      setGeoNamesDraftDistance(String(next.max_distance_km))
      setGeoNamesDatasetTarget('')
      setGeoNamesNotice(geoNamesDatasetTarget === 'deployment'
        ? '已持久保存部署数据源为目标，当前实例校验后热生效；其他实例仍需分别确认。'
        : '已持久保存归档指纹并热应用到当前实例；重启会重新验证快照完整性，缺失时保持待生效，其他实例仍需单独校验。')
      const latest = await source.load()
      if (epoch === geoNamesEpochRef.current) setSnapshot(latest)
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 数据集校验或热应用失败，原索引继续生效。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesBusy(false)
        setGeoNamesDatasetConfirmOpen(false)
      }
    }
  }

  const stageGeoNamesSnapshot = async () => {
    if (!geoNamesConfig?.snapshot_supported || !source.stageGeoNamesSnapshot || geoNamesBusy) return
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const result = await source.stageGeoNamesSnapshot({
        revision: geoNamesConfig.revision,
        expected_version: geoNamesConfig.current_version,
      })
      if (epoch !== geoNamesEpochRef.current) return
      if (!result.staged || result.applied || !result.snapshot.fingerprint) {
        throw new Error('GeoNames 版本快照未完成验证，当前运行索引不变。')
      }
      const next = await source.loadGeoNamesConfig?.()
      if (epoch !== geoNamesEpochRef.current) return
      if (next) setGeoNamesConfig(next)
      setGeoNamesNotice('数据集已完成有界复制、完整索引校验和审计，并保存为不可变快照；尚未应用，不影响现有地名解析。')
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 版本快照创建失败；当前索引不变。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesBusy(false)
        setGeoNamesSnapshotConfirmOpen(false)
      }
    }
  }

  const reloadGeoNames = async () => {
    if (!geoNamesConfig?.reload_supported || !source.reloadGeoNames || geoNamesBusy) return
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const result = await source.reloadGeoNames(geoNamesConfig.current_version)
      if (epoch !== geoNamesEpochRef.current) return
      if (!result.applied || !result.current_version) throw new Error('GeoNames 未能完成生效校验。')
      const effective = source.loadGeoNamesConfig ? await source.loadGeoNamesConfig() : null
      if (epoch !== geoNamesEpochRef.current) return
      if (effective) {
        setGeoNamesConfig(effective)
        setGeoNamesDraftDistance(String(effective.max_distance_km))
      } else {
        setGeoNamesConfig((old) => old ? { ...old, current_version: result.current_version } : old)
      }
      setGeoNamesNotice(result.changed
        ? '已验证并热加载新索引。后续地名任务使用新版本，运行中的任务保持旧快照。'
        : '数据集验证通过，版本未变化，无需替换当前索引。')
      const next = await source.load()
      if (epoch === geoNamesEpochRef.current) setSnapshot(next)
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 数据校验失败，当前已生效索引未改变。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) setGeoNamesBusy(false)
    }
  }

  const savePhotoAutoPolicy = async () => {
    if (!photoPolicy?.editable || !source.savePhotoAutoConfig || photoPolicyBusy) return
    const epoch = ++photoPolicyEpochRef.current
    setPhotoPolicyBusy(true)
    setPhotoPolicyError('')
    setPhotoPolicyNotice('')
    try {
      const next = await source.savePhotoAutoConfig({
        revision: photoPolicy.revision,
        auto_enabled: photoAutoDraft,
        ...(photoPolicy.kinds ? { kinds: photoKindsDraft } : {}),
      })
      if (epoch !== photoPolicyEpochRef.current) return
      setPhotoPolicy(next)
      setPhotoAutoDraft(next.auto_enabled)
      setPhotoKindsDraft(next.kinds ?? defaultPhotoAutoKinds)
      setPhotoRollbackTarget('')
      setPhotoRollbackConfirmOpen(false)
      setPhotoPolicyNotice(next.apply_state === 'applied'
        ? '设置已持久化并审计，当前 Server 的新自动分析任务立即遵循此策略；其他实例将定期同步。'
        : '设置已保存，但当前 Server 尚未确认生效，请刷新状态。')
      if (source.loadPhotoAutoRevisions) {
        const historyEpoch = ++photoHistoryEpochRef.current
        try {
          const history = await source.loadPhotoAutoRevisions()
          if (epoch === photoPolicyEpochRef.current && historyEpoch === photoHistoryEpochRef.current) {
            setPhotoRevisions(history.items)
            setPhotoHistoryError('')
          }
        } catch {
          if (epoch === photoPolicyEpochRef.current && historyEpoch === photoHistoryEpochRef.current) {
            setPhotoHistoryError('策略已保存，但无法刷新历史修订。请刷新页面后重试。')
          }
        }
      }
    } catch (err) {
      if (epoch === photoPolicyEpochRef.current) {
        setPhotoPolicyError(err instanceof Error ? err.message : '保存失败，当前运行策略未确认更新。')
      }
    } finally {
      if (epoch === photoPolicyEpochRef.current) setPhotoPolicyBusy(false)
    }
  }

  const rollbackPhotoAuto = async () => {
    if (!photoPolicy?.editable || !source.rollbackPhotoAuto || photoPolicyBusy) return
    const target = photoRevisions.find(
      (item) => String(item.revision) === photoRollbackTarget && item.revision < photoPolicy.revision,
    )
    if (!target) {
      setPhotoPolicyError('请选择一个比当前配置更早的有效修订。')
      setPhotoRollbackConfirmOpen(false)
      return
    }
    const epoch = ++photoPolicyEpochRef.current
    const historyEpoch = ++photoHistoryEpochRef.current
    setPhotoPolicyBusy(true)
    setPhotoPolicyError('')
    setPhotoPolicyNotice('')
    try {
      const effective = await source.rollbackPhotoAuto({
        revision: photoPolicy.revision,
        target_revision: target.revision,
      })
      if (epoch !== photoPolicyEpochRef.current) return
      setPhotoPolicy(effective)
      setPhotoAutoDraft(effective.auto_enabled)
      setPhotoKindsDraft(effective.kinds ?? defaultPhotoAutoKinds)
      setPhotoRollbackTarget('')
      setPhotoHistoryError('')
      setPhotoPolicyNotice(effective.apply_state === 'applied'
        ? '历史自动分析策略已写入新修订并通过审计，当前 Server 已热生效；其他实例需按策略周期刷新。'
        : '历史策略已保存为新修订，但当前实例仍待生效，请刷新检查。')
      if (source.loadPhotoAutoRevisions) {
        try {
          const history = await source.loadPhotoAutoRevisions()
          if (epoch === photoPolicyEpochRef.current && historyEpoch === photoHistoryEpochRef.current) {
            setPhotoRevisions(history.items)
            setPhotoHistoryError('')
          }
        } catch {
          if (epoch === photoPolicyEpochRef.current && historyEpoch === photoHistoryEpochRef.current) {
            setPhotoHistoryError('回滚已完成，但历史记录刷新失败。请手动刷新页面。')
          }
        }
      }
      const status = await source.load().catch(() => null)
      if (status && epoch === photoPolicyEpochRef.current) setSnapshot(status)
    } catch (err) {
      if (epoch === photoPolicyEpochRef.current) {
        setPhotoPolicyError(err instanceof Error ? err.message : '历史策略回滚失败，请刷新后重试。')
        // A 409 or an interrupted response makes the displayed revision stale.
        // Read the authoritative desired/effective policy again, never assume rollback succeeded.
        if (source.loadPhotoAutoConfig) {
          const actual = await source.loadPhotoAutoConfig().catch(() => null)
          if (actual && epoch === photoPolicyEpochRef.current) {
            setPhotoPolicy(actual)
            setPhotoAutoDraft(actual.auto_enabled)
            setPhotoKindsDraft(actual.kinds ?? defaultPhotoAutoKinds)
          }
        }
      }
    } finally {
      if (epoch === photoPolicyEpochRef.current) {
        setPhotoPolicyBusy(false)
        setPhotoRollbackConfirmOpen(false)
      }
    }
  }

  const rollbackGeoNames = async () => {
    if (!geoNamesConfig?.editable || !source.rollbackGeoNames || geoNamesBusy) return
    const target = geoNamesRevisions.find(
      (item) => String(item.revision) === geoNamesRollbackTarget && item.revision < geoNamesConfig.revision,
    )
    if (!target) {
      setGeoNamesError('请选择一个比当前配置更早的有效修订。')
      setGeoNamesRollbackConfirmOpen(false)
      return
    }
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const effective = await source.rollbackGeoNames({
        revision: geoNamesConfig.revision,
        target_revision: target.revision,
      })
      if (epoch !== geoNamesEpochRef.current) return
      setGeoNamesConfig(effective)
      setGeoNamesDraftDistance(String(effective.max_distance_km))
      setGeoNamesRollbackTarget('')
      setGeoNamesNotice(effective.apply_state === 'applied'
        ? '历史距离已回滚、审计并热应用至当前 Server；其他实例每 30 秒尝试自动校验并应用，失败时仍显示待生效。'
        : '已保存回滚配置；当前实例尚未确认生效，请执行校验并热加载。')
      if (source.loadGeoNamesRevisions) {
        const history = await source.loadGeoNamesRevisions().catch(() => null)
        if (history && epoch === geoNamesEpochRef.current) setGeoNamesRevisions(history.items)
      }
      const status = await source.load().catch(() => null)
      if (status && epoch === geoNamesEpochRef.current) setSnapshot(status)
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 回滚失败，已生效配置保持不变。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesBusy(false)
        setGeoNamesRollbackConfirmOpen(false)
      }
    }
  }

  const checkedAt = snapshot?.checked_at
    ? new Date(snapshot.checked_at).toLocaleString()
    : ''
  // Ignore user-level connector rows returned by older Server versions.
  const systemServices = snapshot?.services.filter((item) => groups.some((group) => group.id === item.group)) ?? []
  const photoKindsChanged = !!photoPolicy?.kinds && photoAutoKindChoices.some(
    (kind) => photoPolicy.kinds![kind.key] !== photoKindsDraft[kind.key],
  )
  const selectedPhotoRevision = photoRevisions.find(
    (item) => String(item.revision) === photoRollbackTarget && item.revision < (photoPolicy?.revision ?? 0),
  )
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
              {group.id === 'core' && <XDriveSourceWorkerConfigPanel source={source} refreshID={refreshID} />}
              {group.id === 'intelligence' && (
                <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" fontWeight={700}>全局自动分析调度</Typography>
                    <Typography variant="body2" color="text.secondary">
                      仅控制新的人脸检测、人物聚类、动物/物体与 OCR、语义分析自动任务。
                      已运行的任务正常完成；手动重分析和独立 GeoNames 地名解析不受影响。
                      此开关不会安装、启动或停止 AI 容器。
                    </Typography>
                    {photoPolicy ? (
                      <Typography variant="body2" color={photoPolicy.apply_state === 'pending' ? 'warning.main' : 'text.secondary'}>
                        期望状态：{photoPolicy.auto_enabled ? '自动分析开启' : '自动分析暂停'}
                        {' · '}当前实例：{photoPolicy.effective_auto_enabled ? '开启' : '暂停'}
                        {' · '}修订号：{photoPolicy.revision}
                        {' · '}{photoPolicy.apply_state === 'applied' ? '当前实例已生效' : '当前实例待生效'}
                        {' · '}来源：{photoPolicy.source === 'saved' ? '管理员持久化设置' : '默认策略'}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        当前 Server/Agent 暂不支持管理全局自动分析策略；请检查版本。
                      </Typography>
                    )}
                    <FormControlLabel
                      label="自动安排照片智能分析"
                      control={<Switch checked={photoAutoDraft}
                        onChange={(_event, value) => setPhotoAutoDraft(value)}
                        disabled={!photoPolicy?.editable || !source.savePhotoAutoConfig || photoPolicyBusy} />}
                    />
                    {photoPolicy?.kinds && photoPolicy.effective_kinds ? (
                      <Stack spacing={0.5} sx={{ pl: 1.5, borderLeft: '2px solid', borderColor: 'divider' }}>
                        <Typography variant="body2" fontWeight={600}>自动分析分项策略</Typography>
                        {photoAutoKindChoices.map((kind) => (
                          <FormControlLabel key={kind.key}
                            control={<Switch size="small" checked={photoKindsDraft[kind.key]}
                              onChange={(_event, value) => setPhotoKindsDraft((old) => ({ ...old, [kind.key]: value }))}
                              disabled={!photoPolicy.editable || !source.savePhotoAutoConfig || photoPolicyBusy} />}
                            label={(
                              <Stack spacing={0}>
                                <Typography variant="body2">{kind.title} · 当前实例分项策略：{photoPolicy.effective_kinds![kind.key] ? '开启（全局开关优先）' : '暂停'}</Typography>
                                <Typography variant="caption" color="text.secondary">{kind.description}</Typography>
                              </Stack>
                            )} />
                        ))}
                        <Typography variant="caption" color="text.secondary">
                          全局暂停优先于分项开关。分项状态只代表任务准入策略是否生效，
                          不代表模型已安装或容器健康；实际健康以每项服务探针为准。
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        当前 Server 尚不支持分项自动分析设置，请升级 Server 后使用。现有全局开关仍可操作。
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Button variant="contained" size="small"
                        disabled={!photoPolicy?.editable || !source.savePhotoAutoConfig || photoPolicyBusy ||
                          (photoPolicy.auto_enabled === photoAutoDraft && !photoKindsChanged)}
                        onClick={() => { void savePhotoAutoPolicy() }}>
                        {photoPolicyBusy ? '正在保存…' : '保存并应用到当前实例'}
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        保存后当前 Server 立即按新的准入策略执行；其他实例在周期刷新后尝试生效。模型与资源仍由受控部署管理。
                      </Typography>
                    </Stack>
                    {source.loadPhotoAutoRevisions && source.rollbackPhotoAuto && (
                      <Stack spacing={1.25}>
                        <Typography variant="subtitle2" fontWeight={700}>配置历史与安全回滚</Typography>
                        <TextField select fullWidth size="small" label="回滚至历史自动分析策略"
                          value={photoRollbackTarget}
                          onChange={(event) => setPhotoRollbackTarget(event.target.value)}
                          disabled={photoPolicyBusy || !photoPolicy?.editable || !photoPolicy.kinds ||
                            !photoRevisions.some((item) => item.revision < (photoPolicy?.revision ?? 0))}
                          helperText="回滚完整的全局与四类任务准入配置，另存为新修订并审计；不会重启模型或停止运行中任务。">
                          <MenuItem value="">请选择较早的配置版本</MenuItem>
                          {photoRevisions.filter((item) => item.revision < (photoPolicy?.revision ?? 0))
                            .map((item) => (
                              <MenuItem key={item.revision} value={String(item.revision)}>
                                <Stack spacing={0}>
                                  <Typography variant="body2">
                                    修订 #{item.revision} · {item.auto_enabled ? '全局自动开启' : '全局自动暂停'}
                                    {' · '}{item.origin === 'default' ? '初始默认' : item.origin === 'rollback' ? '历史回滚' : '管理员保存'}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {photoAutoKindSummary(item.kinds)} · {new Date(item.created_at).toLocaleString()}
                                  </Typography>
                                </Stack>
                              </MenuItem>
                            ))}
                        </TextField>
                        <Button variant="outlined" size="small"
                          disabled={photoPolicyBusy || !photoPolicy?.editable || !selectedPhotoRevision}
                          onClick={() => setPhotoRollbackConfirmOpen(true)}>
                          确认回滚自动分析策略
                        </Button>
                        {photoHistoryError && (
                          <Typography variant="caption" color="warning.main">{photoHistoryError}</Typography>
                        )}
                        <XDriveConfirmDialog
                          open={photoRollbackConfirmOpen}
                          title="确认回滚照片智能分析调度策略"
                          description={selectedPhotoRevision
                            ? `将回滚到修订 #${selectedPhotoRevision.revision}：
全局自动分析${selectedPhotoRevision.auto_enabled ? '开启' : '暂停'}；${photoAutoKindSummary(selectedPhotoRevision.kinds)}。
将重新保存完整策略、写入审计并应用到当前 Server，之前未保存的编辑会被覆盖。
已运行分析任务不会中断，用户/管理员手动重分析及 GeoNames 不受影响；其他实例可能尚待刷新。`
                            : '历史修订已失效，请刷新配置后重新选择。'}
                          confirmLabel="确认并回滚完整策略"
                          loading={photoPolicyBusy}
                          onCancel={() => setPhotoRollbackConfirmOpen(false)}
                          onConfirm={() => { void rollbackPhotoAuto() }}
                        />
                      </Stack>
                    )}
                    {photoPolicyError && <XDriveStatusAlert tone="bad">{photoPolicyError}</XDriveStatusAlert>}
                    {photoPolicyNotice && <XDriveStatusAlert tone="good">{photoPolicyNotice}</XDriveStatusAlert>}
                  </Stack>
                </Paper>
              )}
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
              {group.id === 'location' && (
                <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" fontWeight={700}>GeoNames 地名索引</Typography>
                    <Typography variant="body2" color="text.secondary">
                      GeoNames 只负责地名标签，地图仍只使用百度地图。数据文件位置保持受信任的只读部署挂载；
                      匹配距离可在本页修改并持久化，验证完整索引后在当前 Server 热生效，运行中批次不受影响。
                    </Typography>
                    {geoNamesConfig ? (
                      <Stack spacing={1}>
                        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                          {geoNamesConfig.dataset_configured ? '索引已加载' : '未加载地名索引'}
                          {' · '}当前索引版本：{geoNamesConfig.current_version || '无'}
                          {' · '}配置来源：{geoNamesConfig.source === 'saved' ? '管理员持久化设置' : '部署环境'}
                          {' · '}修订号：{geoNamesConfig.revision}
                        </Typography>
                        <Typography variant="body2" color={geoNamesConfig.apply_state === 'pending' ? 'warning.main' : 'text.secondary'}>
                          期望匹配距离：{geoNamesConfig.max_distance_km} km
                          {' · '}当前实例实际距离：{geoNamesConfig.effective_max_distance_km || '不可用'} km
                          {' · '}{geoNamesConfig.apply_state === 'applied'
                            ? '当前实例已生效（不代表其他实例）'
                            : geoNamesConfig.apply_state === 'pending' ? '当前实例待生效' : '索引不可用'}
                          {typeof geoNamesConfig.effective_revision === 'number'
                            ? ` · 当前实例实际修订 #${geoNamesConfig.effective_revision}` : ''}
                        </Typography>
                        {geoNamesConfig.replica_apply_state ? (
                          <Stack spacing={0.5} data-xdrive-geonames-replica-status>
                            <Typography variant="body2"
                              color={geoNamesConfig.replica_apply_state === 'pending' ? 'warning.main' : 'text.secondary'}>
                              已观察的在线 Server：{geoNamesConfig.observed_instances ?? 0} 个
                              {' · '}半径修订已确认：{geoNamesConfig.applied_instances ?? 0} 个
                              {' · '}未加载数据集：{geoNamesConfig.unconfigured_instances ?? 0} 个
                              {' · '}{geoNamesConfig.replica_apply_state === 'applied'
                                ? '已观察实例的修订和数据集版本一致'
                                : geoNamesConfig.replica_apply_state === 'pending'
                                  ? '部分在线实例尚未生效或数据集版本不一致'
                                  : geoNamesConfig.replica_apply_state === 'unmanaged'
                                    ? '尚无管理员持久化修订；不能确认集群生效'
                                    : geoNamesConfig.replica_apply_state === 'unavailable'
                                      ? '没有有效的在线实例心跳'
                                      : '跨实例状态暂不可验证'}
                            </Typography>
                            {geoNamesConfig.dataset_versions?.map((item) => (
                              <Typography key={item.version} variant="caption" color="text.secondary">
                                数据集指纹 {item.version} · {item.count} 个在线实例
                              </Typography>
                            ))}
                            <Typography variant="caption" color="text.secondary">
                              仅汇总最近 20 秒内有心跳的实例，不是部署节点名册；
                              未观测的实例不能判定为已生效。心跳约每 5 秒更新。
                              {geoNamesConfig.replica_status_truncated
                                ? ' 在线实例超过 100 个观测上限，不能声明全部已生效。' : ''}
                            </Typography>
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            当前 Server/Agent 未提供跨实例应用确认；只能验证当前 Server。
                          </Typography>
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        当前 Server/Agent 尚未提供 GeoNames 配置状态，请检查版本或连接。
                      </Typography>
                    )}
                    <TextField
                      label="地名匹配最大距离（km）"
                      size="small"
                      type="number"
                      fullWidth
                      value={geoNamesDraftDistance}
                      onChange={(event) => setGeoNamesDraftDistance(event.target.value)}
                      inputProps={{ min: 0.001, max: 500, step: 'any' }}
                      disabled={geoNamesBusy || !geoNamesConfig?.editable || !source.saveGeoNamesConfig}
                      helperText="范围 (0, 500] km；保存会验证只读数据集并立即应用到当前实例，不改变百度地图。"
                    />
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Button variant="contained" size="small"
                        disabled={geoNamesBusy || !geoNamesConfig?.editable || !source.saveGeoNamesConfig}
                        onClick={() => { void saveGeoNamesConfig() }}>
                        {geoNamesBusy ? '正在验证并保存…' : '保存距离并应用'}
                      </Button>
                      <Button variant="outlined" size="small"
                        disabled={geoNamesBusy || !geoNamesConfig?.reload_supported || !source.reloadGeoNames}
                        onClick={() => { void reloadGeoNames() }}>
                        {geoNamesBusy ? '正在验证和热加载…' : '校验并热加载 GeoNames 数据'}
                      </Button>
                    </Stack>
                    <Stack spacing={1} data-xdrive-geonames-dataset-snapshots>
                      <Typography variant="subtitle2" fontWeight={700}>
                        GeoNames 数据集版本快照
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        只对已挂载的受信任 GeoNames 三文件进行限额复制和完整索引校验，
                        保存为本 Server 可读取的历史快照。创建快照不会切换当前索引；
                        在线上传及跨实例文件分发仍待后续安全控制；历史快照可经验证后选为持久化目标。
                      </Typography>
                      {geoNamesConfig?.active_dataset_source && (
                        <Typography variant="body2" color="text.secondary">
                          当前 Server 实际数据来源：{geoNamesConfig.active_dataset_source === 'snapshot'
                            ? '历史快照' : '部署只读挂载'}
                          {geoNamesConfig.active_dataset_fingerprint
                            ? ` · 指纹 ${geoNamesConfig.active_dataset_fingerprint.slice(0, 16)}…` : ''}
                          {' · '}{geoNamesConfig.active_dataset_persistent
                            ? '已匹配持久化目标；重启后重新校验' : '与期望配置不一致，等待本实例校验应用'}
                        </Typography>
                      )}
                      {geoNamesConfig?.desired_dataset_fingerprint !== undefined && (
                        <Typography variant="body2" color={geoNamesConfig.apply_state === 'applied' ? 'text.secondary' : 'warning.main'}>
                          期望版本：{geoNamesConfig.desired_dataset_fingerprint
                            ? '已存档指纹 ' + geoNamesConfig.desired_dataset_fingerprint.slice(0, 16) + '…' : '部署只读挂载'}
                          {' · '}当前实例：{geoNamesConfig.apply_state === 'applied' ? '已校验生效' : '待验证或未生效'}
                          {' · '}重启重新校验，归档缺失时不得标记为已生效。
                        </Typography>
                      )}
                      <Button variant="outlined" size="small"
                        disabled={geoNamesBusy || !geoNamesConfig?.snapshot_supported ||
                          !source.stageGeoNamesSnapshot}
                        onClick={() => setGeoNamesSnapshotConfirmOpen(true)}>
                        {geoNamesBusy ? '正在校验并保存快照…' : '建立不可变数据集快照'}
                      </Button>
                      {!geoNamesConfig?.snapshot_supported && (
                        <Typography variant="caption" color="text.secondary">
                          {geoNamesConfig?.snapshot_requirement ??
                            '当前 Server/Agent 尚未支持数据集快照；需先配置独立可写的持久目录。'}
                        </Typography>
                      )}
                      {geoNamesConfig?.snapshot_history_known && (geoNamesConfig.snapshots?.length ?? 0) === 0 && (
                        <Typography variant="caption" color="text.secondary">当前还没有保存数据集快照。</Typography>
                      )}
                      {geoNamesConfig?.snapshots?.map((entry) => (
                        <Box key={entry.fingerprint} sx={{
                          border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1,
                          overflowWrap: 'anywhere',
                        }}>
                          <Typography variant="caption" fontWeight={700}>
                            数据集指纹 {entry.fingerprint.slice(0, 16)}…
                            {' · '}{entry.fingerprint === geoNamesConfig?.active_dataset_fingerprint
                              ? (geoNamesConfig.active_dataset_persistent ? '当前实例已生效且目标持久化' : '当前实例已生效')
                              : entry.fingerprint === geoNamesConfig?.desired_dataset_fingerprint ? '目标已保存，本实例待生效' : '已暂存，未应用'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {entry.total_bytes} 字节 · 验证时匹配距离 {entry.checked_radius_km} km
                            {' · '}配置修订 #{entry.checked_revision}
                            {' · '}{entry.locally_present ? '本 Server 存储目录存在（未重新验签）' : '本 Server 未确认存储目录'}
                            {' · '}{new Date(entry.created_at).toLocaleString('zh-CN')}
                          </Typography>
                        </Box>
                      ))}
                      {source.applyGeoNamesDataset && geoNamesConfig?.snapshot_apply_supported &&
                        geoNamesConfig.desired_dataset_fingerprint !== undefined && (
                        <Stack spacing={1}>
                          <TextField select fullWidth size="small"
                            label="校验并持久保存目标版本，应用到当前 Server"
                            value={geoNamesDatasetTarget}
                            onChange={(event) => setGeoNamesDatasetTarget(event.target.value)}
                            disabled={geoNamesBusy}
                            helperText="目标与审计持久保存，当前实例热应用；重启需重新验证。不会修改部署目录或跨实例分发。">
                            <MenuItem value="">选择要重新验证并加载的数据源</MenuItem>
                            <MenuItem value="deployment">恢复部署只读数据集</MenuItem>
                            {geoNamesConfig.snapshots?.filter((entry) => entry.locally_present)
                              .map((entry) => (
                                <MenuItem key={entry.fingerprint} value={entry.fingerprint}>
                                  历史版本 {entry.fingerprint.slice(0, 16)}… · {entry.total_bytes} 字节
                                </MenuItem>
                              ))}
                          </TextField>
                          <Button variant="outlined" size="small"
                            disabled={geoNamesBusy || !geoNamesDatasetTarget ||
                              (geoNamesDatasetTarget === 'deployment'
                                ? geoNamesConfig.active_dataset_source !== 'snapshot' &&
                                  geoNamesConfig.desired_dataset_fingerprint === ''
                                : geoNamesDatasetTarget === geoNamesConfig.active_dataset_fingerprint &&
                                  geoNamesDatasetTarget === geoNamesConfig.desired_dataset_fingerprint)}
                            onClick={() => setGeoNamesDatasetConfirmOpen(true)}>
                            校验并应用到当前 Server
                          </Button>
                          <XDriveConfirmDialog
                            open={geoNamesDatasetConfirmOpen}
                            title="确认持久保存并热应用 GeoNames 数据集"
                            description="校验目标归档真实内容，在一个事务内保存目标指纹与审计，再热切换当前实例。重启会重新校验；缺失时保持待生效，不代表其他实例已应用。"
                            confirmLabel="确认保存并热应用"
                            loading={geoNamesBusy}
                            onCancel={() => setGeoNamesDatasetConfirmOpen(false)}
                            onConfirm={() => { void applyGeoNamesDataset() }}
                          />
                        </Stack>
                      )}
                      <XDriveConfirmDialog
                        open={geoNamesSnapshotConfirmOpen}
                        title="建立 GeoNames 数据集历史快照"
                        description="从已有只读挂载复制三个 GeoNames 文件到独立持久目录，并完成实际索引校验后记录审计。不会修改当前索引或影响同步；不会分发、应用或回滚至该快照。"
                        confirmLabel="确认校验并暂存"
                        loading={geoNamesBusy}
                        onCancel={() => setGeoNamesSnapshotConfirmOpen(false)}
                        onConfirm={() => { void stageGeoNamesSnapshot() }}
                      />
                    </Stack>
                    {source.loadGeoNamesRevisions && source.rollbackGeoNames && (
                      <Stack spacing={1.25}>
                        <TextField select fullWidth size="small" label="回滚至历史匹配距离"
                          value={geoNamesRollbackTarget}
                          onChange={(event) => setGeoNamesRollbackTarget(event.target.value)}
                          disabled={geoNamesBusy || !geoNamesConfig?.editable ||
                            !geoNamesRevisions.some((item) => item.revision < (geoNamesConfig?.revision ?? 0))}
                          helperText="仅回滚匹配距离；会重新校验当前只读数据集并产生新的修订，不会回滚磁盘数据文件。">
                          <MenuItem value="">请选择较早的配置版本</MenuItem>
                          {geoNamesRevisions.filter((item) => item.revision < (geoNamesConfig?.revision ?? 0))
                            .map((item) => (
                              <MenuItem key={item.revision} value={String(item.revision)}>
                                修订 #{item.revision} · {item.max_distance_km} km · {item.origin === 'environment'
                                  ? '初始部署' : item.origin === 'rollback' ? '历史回滚' : '管理员保存'}
                              </MenuItem>
                            ))}
                        </TextField>
                        <Button variant="outlined" size="small"
                          disabled={geoNamesBusy || !geoNamesConfig?.editable || !geoNamesRollbackTarget}
                          onClick={() => setGeoNamesRollbackConfirmOpen(true)}>
                          确认回滚历史配置
                        </Button>
                        {geoNamesHistoryError ? (
                          <Typography variant="caption" color="warning.main">{geoNamesHistoryError}</Typography>
                        ) : null}
                        <XDriveConfirmDialog
                          open={geoNamesRollbackConfirmOpen}
                          title="确认回滚 GeoNames 匹配距离"
                          description={`将回滚到修订 #${geoNamesRollbackTarget} 的匹配距离，重新验证当前只读数据集，
并在通过审计后立即应用到当前 Server。已有地名任务保持原快照；其他实例可能需要单独重载。`}
                          confirmLabel="校验并回滚配置"
                          loading={geoNamesBusy}
                          onCancel={() => setGeoNamesRollbackConfirmOpen(false)}
                          onConfirm={() => { void rollbackGeoNames() }}
                        />
                      </Stack>
                    )}
                    {!geoNamesConfig?.reload_supported && (
                      <Typography variant="caption" color="text.secondary">
                        需先部署只读 GeoNames 数据集并加载初始索引。本页不提供任意宿主路径修改，也不宣称所有 Server 实例已同时生效。
                      </Typography>
                    )}
                    {geoNamesError && <XDriveStatusAlert tone="bad">{geoNamesError}</XDriveStatusAlert>}
                    {geoNamesNotice && <XDriveStatusAlert tone="good">{geoNamesNotice}</XDriveStatusAlert>}
                  </Stack>
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
