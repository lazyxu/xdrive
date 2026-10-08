import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { useEffect, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Dialog,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveConfirmDialog,
  XDriveDialogActions,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDriveMetricCard,
  XDriveMetricGrid,
  XDrivePaginationControls,
  XDriveSectionHeader,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStorageDistributionChart,
  XDriveStorageInventorySection,
  XDriveTableSurface,
  XDriveWorkspaceSurface,
  XDriveStatusBadge,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import type {
  StorageDecision,
  StorageHealth,
  StorageHistory,
  StorageHistoryPoint,
  StorageLegacyObjectPage,
  StorageUnreferencedBlob,
  StorageUnreferencedBlobPage,
  StorageStats,
  StagingCleanupFailure,
  StagingCleanupRun,
  UploadStagingDetail,
} from '../../ui/shared/src'
import { formatBytes, formatSignedBytes } from '../../ui/shared/src'
import type { XDriveApi } from './api'

const STAGING_PAGE_SIZE = 20
const STORAGE_DIAGNOSTIC_PAGE_SIZE = 20

type StorageMaintenanceKind = 'storage_verify' | 'storage_repair'

function unreferencedBlobStatus(blob: StorageUnreferencedBlob) {
  switch (blob.gc_status) {
    case 'awaiting_gc':
      return { label: '等待 Janitor', tone: 'busy' as const }
    case 'blocked_by_upload':
      return { label: '恢复上传占用', tone: 'warning' as const }
    case 'physical_missing':
      return { label: '仅剩元数据', tone: 'warning' as const }
    case 'metadata_inconsistent':
      return { label: '元数据状态异常', tone: 'bad' as const }
  }
}

function decisionMessage(decision: StorageDecision) {
  switch (decision.priority) {
    case 'small_file_packing':
      return '决策信号：优先 Small-file Packing'
    case 'cdc':
      return '决策信号：优先评估 CDC'
    case 'observe':
      return '决策信号：暂未出现明确的存储格式瓶颈'
    default:
      return '决策信号：历史样本仍在积累'
  }
}

function decisionTone(decision: StorageDecision): 'neutral' | 'warning' {
  if (decision.priority === 'collecting') return 'neutral'
  if (decision.priority === 'observe') return 'neutral'
  return 'warning'
}

function storageHistorySnapshotBytes(point: StorageHistoryPoint, value: number) {
  return point.anomaly_snapshot_available ? formatBytes(value) : '—'
}

function storageHistoryOtherCacheBytes(point: StorageHistoryPoint) {
  return point.media_other_bytes + point.preview_cache_bytes + point.video_transcode_bytes
}

function storageHistoryAnomalyDetail(anomaly: StorageHistory['anomalies'][number]) {
  const details: string[] = [anomaly.message]
  if (anomaly.current_count) details.push(`${anomaly.current_count.toLocaleString()} 项`)
  if (anomaly.current_bytes) details.push(formatBytes(anomaly.current_bytes))
  if (anomaly.delta_bytes) details.push(`变化 ${formatSignedBytes(anomaly.delta_bytes)}`)
  if (anomaly.age_hours) details.push(`距今 ${anomaly.age_hours.toFixed(1)} 小时`)
  return details.join(' · ')
}

function decisionDescription(decision: StorageDecision) {
  if (decision.priority === 'collecting') {
    return `已有 ${decision.sample_count} 个有效样本，跨度 ${decision.span_hours.toFixed(0)} 小时；至少需要 4 个样本且覆盖 24 小时。`
  }
  const common = `近 7 天平均：<64 KiB 数量占比 ${(decision.average_small_lt64_kib_count_share * 100).toFixed(1)}%，<256 KiB 数量占比 ${(decision.average_small_lt256_kib_count_share * 100).toFixed(1)}%，≥16 MiB 字节占比 ${(decision.average_large_ge16_mib_byte_share * 100).toFixed(1)}%，全文件去重倍率 ${decision.average_dedup_ratio.toFixed(2)}×。`
  if (decision.priority === 'small_file_packing') {
    return `${common} 小对象数量压力达到阈值，packing 对降低对象数/元数据压力的信号更强。`
  }
  if (decision.priority === 'cdc') {
    return `${common} 大文件字节占主导且全文件去重收益较低，下一步更适合先做 CDC 小规模评估；该信号不等同于已证明存在块级重复。`
  }
  return `${common} 当前数据不足以支持更换存储格式，继续采样更合理。`
}

export default function StorageStatsPanel({
  api,
  scope,
  onOpenTaskCenter,
  onRunStorageMaintenance,
}: {
  api: XDriveApi
  scope: 'self' | 'global'
  onOpenTaskCenter?: () => void
  onRunStorageMaintenance?: (kind: StorageMaintenanceKind) => Promise<void>
}) {
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [health, setHealth] = useState<StorageHealth | null>(null)
  const [history, setHistory] = useState<StorageHistory | null>(null)
  const [staging, setStaging] = useState<UploadStagingDetail | null>(null)
  const [stagingPage, setStagingPage] = useState(1)
  const [stagingCursors, setStagingCursors] = useState<string[]>([''])
  const [stagingLoading, setStagingLoading] = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const [cleanupActionError, setCleanupActionError] = useState('')
  const [cleanupResultWarning, setCleanupResultWarning] = useState('')
  const [stagingNotice, setStagingNotice] = useState('')
  const [cleanupRuns, setCleanupRuns] = useState<StagingCleanupRun[]>([])
  const [cleanupFailures, setCleanupFailures] = useState<Record<number, StagingCleanupFailure[]>>({})
  const [cleanupFailureLoading, setCleanupFailureLoading] = useState<number | null>(null)
  const [legacyPage, setLegacyPage] = useState<StorageLegacyObjectPage | null>(null)
  const [legacyPageNumber, setLegacyPageNumber] = useState(1)
  const [legacyCursors, setLegacyCursors] = useState<string[]>([''])
  const [legacyLoading, setLegacyLoading] = useState(false)
  const [unreferencedPage, setUnreferencedPage] = useState<StorageUnreferencedBlobPage | null>(null)
  const [unreferencedPageNumber, setUnreferencedPageNumber] = useState(1)
  const [unreferencedCursors, setUnreferencedCursors] = useState<string[]>([''])
  const [unreferencedLoading, setUnreferencedLoading] = useState(false)
  const [maintenanceLoading, setMaintenanceLoading] = useState<StorageMaintenanceKind | ''>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setStats(null)
    setHealth(null)
    setHistory(null)
    setStaging(null)
    setStagingPage(1)
    setStagingCursors([''])
    setStagingNotice('')
    setCleanupConfirmOpen(false)
    setCleanupActionError('')
    setCleanupResultWarning('')
    setCleanupRuns([])
    setCleanupFailures({})
    setLegacyPage(null)
    setLegacyPageNumber(1)
    setLegacyCursors([''])
    setUnreferencedPage(null)
    setUnreferencedPageNumber(1)
    setUnreferencedCursors([''])
    const request = scope === 'global' ? api.adminStorageStats() : api.storageStats()
    const healthRequest = scope === 'global'
      ? api.adminStorageHealth().catch(() => null)
      : Promise.resolve(null)
    const historyRequest = scope === 'global'
      ? api.adminStorageHistory(30).catch(() => null)
      : Promise.resolve(null)
    const cleanupRunsRequest = scope === 'global'
      ? api.adminStagingCleanupRuns(20, 0).catch(() => [])
      : Promise.resolve([])
    void Promise.all([request, healthRequest, historyRequest, cleanupRunsRequest])
      .then(([value, healthValue, historyValue, cleanupRunValues]) => {
        if (!active) return
        setStats(value)
        setHealth(healthValue)
        setHistory(historyValue)
        setCleanupRuns(cleanupRunValues)
      })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '加载存储统计失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, scope, reloadKey])

  const loadStagingPage = async (page: number, fresh = false) => {
    if (scope !== 'global') return
    const nextPage = Math.max(1, Math.trunc(page))
    const cursor = nextPage === 1 ? '' : stagingCursors[nextPage - 1]
    if (cursor === undefined) return
    setStagingLoading(true)
    try {
      const value = await api.adminUploadStaging(STAGING_PAGE_SIZE, cursor, fresh)
      setStaging(value)
      setStagingPage(nextPage)
      setStagingCursors((current) => {
        const next = [...current]
        next[nextPage - 1] = cursor
        if (value.next_cursor) next[nextPage] = value.next_cursor
        return next.slice(0, value.next_cursor ? nextPage + 1 : nextPage)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载上传临时空间失败')
    } finally {
      setStagingLoading(false)
    }
  }

  const loadLegacyPage = async (page: number) => {
    if (scope !== 'global') return
    const nextPage = Math.max(1, Math.trunc(page))
    const cursor = nextPage === 1 ? '' : legacyCursors[nextPage - 1]
    if (cursor === undefined) return
    setLegacyLoading(true)
    try {
      const value = await api.adminStorageLegacyObjects(STORAGE_DIAGNOSTIC_PAGE_SIZE, cursor)
      setLegacyPage(value)
      setLegacyPageNumber(nextPage)
      setLegacyCursors((current) => {
        const next = [...current]
        next[nextPage - 1] = cursor
        if (value.next_cursor) next[nextPage] = value.next_cursor
        return next.slice(0, value.next_cursor ? nextPage + 1 : nextPage)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 legacy 对象明细失败')
    } finally {
      setLegacyLoading(false)
    }
  }

  const loadUnreferencedPage = async (page: number) => {
    if (scope !== 'global') return
    const nextPage = Math.max(1, Math.trunc(page))
    const cursor = nextPage === 1 ? '' : unreferencedCursors[nextPage - 1]
    if (cursor === undefined) return
    setUnreferencedLoading(true)
    try {
      const value = await api.adminStorageUnreferencedBlobs(STORAGE_DIAGNOSTIC_PAGE_SIZE, cursor)
      setUnreferencedPage(value)
      setUnreferencedPageNumber(nextPage)
      setUnreferencedCursors((current) => {
        const next = [...current]
        next[nextPage - 1] = cursor
        if (value.next_cursor) next[nextPage] = value.next_cursor
        return next.slice(0, value.next_cursor ? nextPage + 1 : nextPage)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载待 GC Blob 明细失败')
    } finally {
      setUnreferencedLoading(false)
    }
  }

  const loadCleanupFailures = async (run: StagingCleanupRun) => {
    if (run.failed_files <= 0 || cleanupFailures[run.id] !== undefined) return
    setCleanupFailureLoading(run.id)
    try {
      const failures = await api.adminStagingCleanupFailures(run.id, 100, 0)
      setCleanupFailures((current) => ({ ...current, [run.id]: failures }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 staging 清理失败明细失败')
    } finally {
      setCleanupFailureLoading((current) => current === run.id ? null : current)
    }
  }

  const cleanupStaging = async () => {
    setCleanupLoading(true)
    setStagingNotice('')
    setCleanupActionError('')
    setCleanupResultWarning('')

    let result
    try {
      result = await api.adminCleanupUploadStaging()
    } catch (err) {
      setCleanupConfirmOpen(false)
      setCleanupActionError(err instanceof Error && err.message.trim() ? err.message : '清理上传临时空间失败，请稍后重试。')
      setCleanupLoading(false)
      return
    }

    setCleanupConfirmOpen(false)
    const notice = '已清理 ' + result.deleted_files.toLocaleString() + ' 个临时文件，共 ' + formatBytes(result.deleted_bytes)
    setStagingNotice(notice)
    if (result.failed_files > 0) {
      setCleanupResultWarning(
        '本次已清理 ' + result.deleted_files.toLocaleString() + ' 个文件，但仍有 ' +
        result.failed_files.toLocaleString() + ' 个文件删除失败。可在“最近 staging 清理”中展开本次记录查看逐文件错误。',
      )
    }

    try {
      const [nextStaging, nextCleanupRuns] = await Promise.all([
        api.adminUploadStaging(STAGING_PAGE_SIZE, ''),
        api.adminStagingCleanupRuns(20, 0),
      ])
      setStats((current) => current ? {
        ...current,
        upload_staging: result.stats,
        xdrive_physical_bytes: current.xdrive_physical_bytes === undefined
          ? undefined
          : Math.max(0, current.xdrive_physical_bytes - result.deleted_bytes),
      } : current)
      setStaging(nextStaging)
      setCleanupRuns(nextCleanupRuns)
      setCleanupFailures({})
      setStagingPage(1)
      setStagingCursors(nextStaging.next_cursor ? ['', nextStaging.next_cursor] : [''])
    } catch (err) {
      setError(err instanceof Error && err.message.trim()
        ? '清理已执行，但刷新存储统计失败：' + err.message
        : '清理已执行，但刷新存储统计失败，请手动刷新。')
    } finally {
      setCleanupLoading(false)
    }
  }

  const runStorageMaintenance = async (kind: StorageMaintenanceKind) => {
    if (!onRunStorageMaintenance || maintenanceLoading) return
    setMaintenanceLoading(kind)
    setError('')
    try {
      await onRunStorageMaintenance(kind)
      setMaintenanceLoading('')
      onOpenTaskCenter?.()
    } catch (err) {
      setMaintenanceLoading('')
      setError(err instanceof Error && err.message.trim()
        ? err.message
        : '提交存储维护任务失败，请稍后重试。')
    }
  }

  const firstHistory = history?.samples[0]
  const lastHistory = history?.samples[history.samples.length - 1]
  const otherDiskUsed = stats?.disk_used_bytes !== undefined && stats?.xdrive_physical_bytes !== undefined
    ? Math.max(0, stats.disk_used_bytes - stats.xdrive_physical_bytes)
    : undefined
  const casBlobCount = stats?.cas_blob_count ?? 0
  const casPhysicalBytes = stats?.cas_physical_bytes ?? 0
  const unreferencedBlobCount = stats?.unreferenced_blob_count ?? 0
  const unreferencedBlobBytes = stats?.unreferenced_blob_bytes ?? 0
  const casLogicalReferencedBytes = stats?.cas_logical_referenced_bytes ?? 0
  const casDedupSavedBytes = stats?.cas_dedup_saved_bytes ?? 0
  const casDedupRatio = stats?.cas_dedup_ratio ?? 0
  const casSavingsRatio = stats?.cas_savings_ratio ?? 0
  const averageBlobSizeBytes = stats?.average_blob_size_bytes ?? 0
  const p50BlobSizeBytes = stats?.p50_blob_size_bytes ?? 0
  const p90BlobSizeBytes = stats?.p90_blob_size_bytes ?? 0
  const p99BlobSizeBytes = stats?.p99_blob_size_bytes ?? 0
  const legacyBlobCount = stats?.legacy_blob_count ?? 0
  const legacyPhysicalBytes = stats?.legacy_physical_bytes ?? 0
  const casBuckets = stats?.buckets ?? []
  const stagingStats = staging?.stats ?? stats?.upload_staging ?? null

  return (
    <>
      <XDriveWorkspaceSurface
        presentation="page"
        title={scope === 'global' ? '全局存储' : '存储'}
        subtitle={
          scope === 'global'
            ? '查看全实例磁盘、CAS 物理对象、缓存、数据库、备份、上传临时空间与历史趋势。'
            : '查看当前账户存储统计。'
        }
        pageActions={
          <XDriveActionButton
            startIcon={<RefreshRoundedIcon />}
            loading={loading}
            loadingLabel="正在刷新…"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            刷新
          </XDriveActionButton>
        }
      >
          {error && <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>{error}</XDriveStatusAlert>}

          {scope === 'global' && (
            <XDriveStatusAlert tone="neutral" title="范围：全实例" sx={{ mb: 2 }}>
              CAS Blob 是去重后的共享物理对象，可能同时被多个用户引用，因此这里只按整个实例统计，不把 Blob 强行归属给某个账号。
            </XDriveStatusAlert>
          )}

          {!stats && !error ? (
            <XDriveStatePanel variant="plain" loading={loading} message={loading ? '正在加载存储统计…' : '暂无存储统计'} />
          ) : null}

          {stats && (
            <Stack spacing={3}>
              {scope === 'global' && health && (
                <XDriveStatusAlert
                  tone={health.status === 'fail' ? 'bad' : health.status === 'warning' ? 'warning' : 'good'}
                  title={health.status === 'fail' ? 'CAS 元数据存在一致性问题' : health.status === 'warning' ? 'CAS 元数据正常，但垃圾回收有积压' : 'CAS 元数据健康'}
                >
                  {`ready ${health.ready_blobs.toLocaleString()} · deleting ${health.deleting_blobs.toLocaleString()} · stale ${health.stale_deleting_blobs.toLocaleString()} · missing metadata ${health.missing_metadata.toLocaleString()} · refcount drift ${health.refcount_mismatches.toLocaleString()} · state drift ${health.state_mismatches.toLocaleString()} · size drift ${health.size_mismatches.toLocaleString()} · key/hash drift ${health.key_hash_mismatches.toLocaleString()} · invalid state ${health.invalid_states.toLocaleString()}`}
                </XDriveStatusAlert>
              )}

              {scope === 'global' && (onOpenTaskCenter || onRunStorageMaintenance) && (
                <Stack spacing={1.5}>
                  <XDriveSectionHeader
                    level="h3"
                    title="维护与修复"
                    subtitle="全局存储只负责发现问题；长时间校验、修复、取消和进度统一交给 Task Center。"
                    actions={onOpenTaskCenter ? (
                      <XDriveActionButton compact onClick={onOpenTaskCenter}>
                        查看维护任务
                      </XDriveActionButton>
                    ) : undefined}
                  />
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {onRunStorageMaintenance ? (
                      <>
                        <XDriveActionButton
                          loading={maintenanceLoading === 'storage_verify'}
                          loadingLabel="正在提交…"
                          disabled={Boolean(maintenanceLoading)}
                          onClick={() => { void runStorageMaintenance('storage_verify') }}
                        >
                          运行存储完整性校验
                        </XDriveActionButton>
                        <XDriveActionButton
                          intent="warning"
                          loading={maintenanceLoading === 'storage_repair'}
                          loadingLabel="正在提交…"
                          disabled={Boolean(maintenanceLoading)}
                          onClick={() => { void runStorageMaintenance('storage_repair') }}
                        >
                          运行存储修复
                        </XDriveActionButton>
                      </>
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    存储修复会先校验并迁移仍被引用的 legacy 对象到 CAS，再修复 CAS 元数据；CAS 物理删除仍由 Janitor 负责。每日存储快照和 Janitor 的运行状态也在全局 Task Center 中查看。
                  </Typography>
                </Stack>
              )}

              {scope === 'global' &&
                stats.disk_total_bytes !== undefined &&
                stats.disk_used_bytes !== undefined &&
                stats.disk_available_bytes !== undefined &&
                stats.xdrive_physical_bytes !== undefined && (
                  <Stack spacing={1.5}>
                    <XDriveSectionHeader level="h3" title="磁盘容量" />
                    <XDriveMetricGrid>
                      <XDriveMetricCard title="磁盘总容量" value={formatBytes(stats.disk_total_bytes)} />
                      <XDriveMetricCard title="磁盘已用" value={formatBytes(stats.disk_used_bytes)} />
                      <XDriveMetricCard title="磁盘可用" value={formatBytes(stats.disk_available_bytes)} />
                      <XDriveMetricCard title="xDrive 物理占用" value={formatBytes(stats.xdrive_physical_bytes)} />
                      {otherDiskUsed !== undefined && (
                        <XDriveMetricCard title="非 xDrive 占用（估算）" value={formatBytes(otherDiskUsed)} />
                      )}
                    </XDriveMetricGrid>
                  </Stack>
                )}

              {scope === 'global' && (
                <XDriveStatusAlert tone={stats.physical_snapshot_at ? 'neutral' : 'warning'}>
                  {stats.physical_snapshot_at
                    ? `物理统计快照：${new Date(stats.physical_snapshot_at).toLocaleString()}。每日后台任务更新；刷新页面不会触发全盘扫描。`
                    : '物理存储快照尚未生成。每日后台任务会自动补齐；当前页面不会为了统计而触发全盘扫描。'}
                </XDriveStatusAlert>
              )}

              {scope === 'global' && stats.inventory && (
                <XDriveStorageInventorySection
                  inventory={stats.inventory}
                  cleanupCache={(kind) => api.adminCleanupStorageCache(kind)}
                  onCleanupComplete={(result) => {
                    setStats((current) => current ? {
                      ...current,
                      inventory: result.inventory,
                      xdrive_physical_bytes: current.xdrive_physical_bytes === undefined
                        ? undefined
                        : Math.max(0, current.xdrive_physical_bytes - result.deleted_bytes),
                    } : current)
                  }}
                />
              )}

              {scope === 'global' && stagingStats && (
                <Stack spacing={1.5}>
                  <XDriveSectionHeader level="h3" title="上传临时空间" />
                  {stagingNotice && <XDriveStatusAlert tone="good">{stagingNotice}</XDriveStatusAlert>}
                  {!stagingStats.supported && (
                    <XDriveStatusAlert tone="neutral">当前存储后端不支持 staging 文件系统扫描，仅显示数据库侧会话信息。</XDriveStatusAlert>
                  )}
                  {(stagingStats.orphan_files > 0 || stagingStats.missing_part_files > 0 || stagingStats.recent_untracked_files > 0) && (
                    <XDriveStatusAlert
                      tone={stagingStats.missing_part_files > 0 || stagingStats.orphan_files > 0 ? 'warning' : 'neutral'}
                      title={
                        'orphan ' + stagingStats.orphan_files.toLocaleString() +
                        ' · 近期未登记 ' + stagingStats.recent_untracked_files.toLocaleString() +
                        ' · 缺失 part ' + stagingStats.missing_part_files.toLocaleString()
                      }
                    >
                      只有数据库无引用且超过 1 小时的临时文件才会作为 orphan 清理；近期未登记文件不会删除。
                    </XDriveStatusAlert>
                  )}
                  <XDriveMetricGrid>
                    <XDriveMetricCard title="活跃 Upload Session" value={stagingStats.active_sessions} />
                    <XDriveMetricCard title="容量 Reservation" value={formatBytes(stagingStats.reserved_bytes)} />
                    <XDriveMetricCard title="Staging 实际占用" value={formatBytes(stagingStats.staging_bytes)} />
                    <XDriveMetricCard title="Staging 文件" value={stagingStats.staging_files} />
                    <XDriveMetricCard title="已登记 Part" value={stagingStats.part_files} suffix={'/ ' + formatBytes(stagingStats.part_bytes)} />
                    <XDriveMetricCard title="近期未登记" value={stagingStats.recent_untracked_files} suffix={'/ ' + formatBytes(stagingStats.recent_untracked_bytes)} />
                    <XDriveMetricCard title="可回收临时空间" value={formatBytes(stagingStats.reclaimable_bytes)} />
                    <XDriveMetricCard title="Orphan" value={stagingStats.orphan_files} suffix={'/ ' + formatBytes(stagingStats.orphan_bytes)} />
                    <XDriveMetricCard title="过期 Session" value={stagingStats.expired_sessions} />
                    <XDriveMetricCard title="缺失 Part" value={stagingStats.missing_part_files} suffix={'/ ' + formatBytes(stagingStats.missing_part_bytes)} />
                  </XDriveMetricGrid>
                  <Typography variant="body2" color="text.secondary">
                    Reservation 表示活跃 resumable 上传未来仍可能需要写入的峰值空间，不等于当前物理占用；Staging 实际占用已计入 xDrive 物理占用。
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <XDriveActionButton
                      loading={stagingLoading}
                      loadingLabel="正在加载…"
                      onClick={() => void loadStagingPage(1, true)}
                    >
                      {staging ? '刷新 staging 明细' : '加载 staging 明细'}
                    </XDriveActionButton>
                    <XDriveActionButton
                      intent="danger"
                      loading={cleanupLoading}
                      loadingLabel="正在清理…"
                      disabled={stagingStats.reclaimable_files <= 0 && stagingStats.expired_sessions <= 0}
                      onClick={() => setCleanupConfirmOpen(true)}
                    >
                      清理可回收临时数据
                    </XDriveActionButton>
                  </Stack>

                  {staging && staging.orphans.length > 0 && (
                    <Stack spacing={1}>
                      <XDriveSectionHeader level="h3" title="Orphan staging" />
                      {stagingLoading ? <LinearProgress /> : null}
                      <XDriveTableSurface>
                        <Table size="small" aria-label="Orphan staging" sx={{ minWidth: 680 }}>
                          <TableHead>
                            <TableRow>
                              <TableCell>Staging 文件</TableCell>
                              <TableCell align="right" sx={{ width: 120 }}>大小</TableCell>
                              <TableCell sx={{ width: 190 }}>最后修改</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {staging.orphans.map((file) => (
                              <TableRow key={file.key} hover>
                                <TableCell sx={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{file.key}</TableCell>
                                <TableCell align="right">{formatBytes(file.size)}</TableCell>
                                <TableCell>{new Date(file.modified_at).toLocaleString()}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </XDriveTableSurface>
                      <XDrivePaginationControls
                        page={stagingPage}
                        pageSize={STAGING_PAGE_SIZE}
                        hasNext={staging.has_more}
                        loading={stagingLoading}
                        onPrevious={() => void loadStagingPage(stagingPage - 1)}
                        onNext={() => void loadStagingPage(stagingPage + 1)}
                      />
                    </Stack>
                  )}
                </Stack>
              )}

              {scope === 'global' && cleanupRuns.length > 0 && (
                <Stack spacing={1.5}>
                  <XDriveSectionHeader level="h3" title="最近 staging 清理" />
                  <Stack spacing={1}>
                    {cleanupRuns.map((run) => (
                      <Accordion
                        key={run.id}
                        disableGutters
                        onChange={(_, expanded) => {
                          if (expanded) void loadCleanupFailures(run)
                        }}
                      >
                        <AccordionSummary>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ width: '100%' }}>
                            <Typography variant="body2" fontWeight={600}>
                              {new Date(run.started_at).toLocaleString()}
                            </Typography>
                            <Chip size="small" label={run.trigger === 'manual' ? '手动' : '自动'} variant="outlined" />
                            <XDriveStatusBadge
                              tone={run.status === 'success' ? 'good' : run.status === 'partial' ? 'warning' : 'bad'}
                              label={run.status === 'success' ? '成功' : run.status === 'partial' ? '部分失败' : '失败'}
                            />
                            <Typography variant="body2" color="text.secondary">
                              删除 {run.deleted_files.toLocaleString()} 个 / {formatBytes(run.deleted_bytes)}
                              {run.failed_files > 0 ? ` · 失败 ${run.failed_files.toLocaleString()} 个` : ''}
                            </Typography>
                          </Stack>
                        </AccordionSummary>
                        <AccordionDetails>
                          {run.error && (
                            <Typography variant="body2" color="error" sx={{ mb: 1 }}>
                              {run.error}
                            </Typography>
                          )}
                          {run.failed_files <= 0 ? (
                            <Typography variant="body2" color="text.secondary">本次没有文件级失败。</Typography>
                          ) : cleanupFailureLoading === run.id && cleanupFailures[run.id] === undefined ? (
                            <XDriveStatePanel variant="plain" loading message="正在加载失败文件…" />
                          ) : (
                            <Stack spacing={1}>
                              {(cleanupFailures[run.id] ?? []).map((failure) => (
                                <Box key={failure.id}>
                                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                                    {failure.storage_key} · {formatBytes(failure.size)}
                                  </Typography>
                                  <Typography variant="caption" color="error" sx={{ wordBreak: 'break-word' }}>
                                    {failure.error}
                                  </Typography>
                                </Box>
                              ))}
                              {(cleanupFailures[run.id]?.length ?? 0) < run.failed_files && (
                                <Typography variant="caption" color="text.secondary">
                                  当前显示前 {cleanupFailures[run.id]?.length ?? 0} 条，完整失败数量为 {run.failed_files.toLocaleString()}。
                                </Typography>
                              )}
                            </Stack>
                          )}
                        </AccordionDetails>
                      </Accordion>
                    ))}
                  </Stack>
                </Stack>
              )}

              {scope === 'global' && history && (
                <Stack spacing={1.5}>
                  <Stack spacing={1}>
                    <XDriveSectionHeader
                      level="h3"
                      title="需要处理"
                      subtitle="基于已持久化的每日快照进行确定性异常判断；不会因为打开页面重新扫描存储。"
                    />
                    {history.anomalies.length > 0 ? history.anomalies.map((anomaly) => (
                      <XDriveStatusAlert
                        key={anomaly.key}
                        tone={anomaly.severity === 'bad' ? 'bad' : 'warning'}
                        title={anomaly.title}
                      >
                        {storageHistoryAnomalyDetail(anomaly)}
                      </XDriveStatusAlert>
                    )) : (
                      <XDriveStatusAlert tone="good" title="未发现存储异常">
                        最近的每日快照未命中物理缺失、CAS 元数据漂移、GC backlog、未分类数据或缓存突增规则。
                      </XDriveStatusAlert>
                    )}
                  </Stack>
                  <XDriveStatusAlert tone={decisionTone(history.decision)} title={decisionMessage(history.decision)}>
                    {decisionDescription(history.decision)}
                  </XDriveStatusAlert>
                  <XDriveMetricGrid>
                    <XDriveMetricCard title="历史样本" value={history.samples.length} suffix={`/ ${history.retention_days} 天`} />
                    <XDriveMetricCard
                      title="窗口内物理容量变化"
                      value={firstHistory && lastHistory ? formatSignedBytes(lastHistory.cas_physical_bytes - firstHistory.cas_physical_bytes) : '—'}
                    />
                    <XDriveMetricCard
                      title="窗口内逻辑容量变化"
                      value={firstHistory && lastHistory ? formatSignedBytes(lastHistory.cas_logical_referenced_bytes - firstHistory.cas_logical_referenced_bytes) : '—'}
                    />
                    <XDriveMetricCard title="最新去重倍率" value={lastHistory ? `${lastHistory.cas_dedup_ratio.toFixed(2)}×` : '—'} />
                  </XDriveMetricGrid>
                  <Stack spacing={1}>
                    <XDriveSectionHeader level="h3" title="历史趋势" />
                    <Typography variant="body2" color="text.secondary">
                      每 {history.sampling_interval_hours} 小时记录一次，保留 {history.retention_days} 天。下表显示最近 12 个快照。
                    </Typography>
                    <XDriveTableSurface>
                      <Table size="small" aria-label="存储历史趋势" sx={{ minWidth: 920 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell>时间</TableCell>
                            <TableCell align="right">CAS Blob</TableCell>
                            <TableCell align="right">物理容量</TableCell>
                            <TableCell align="right">逻辑容量</TableCell>
                            <TableCell align="right">去重倍率</TableCell>
                            <TableCell align="right">&lt;64 KiB 数量</TableCell>
                            <TableCell align="right">≥16 MiB 字节</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {history.samples.slice(-12).reverse().map((point) => (
                            <TableRow key={point.slot_at} hover>
                              <TableCell>{new Date(point.slot_at).toLocaleString()}</TableCell>
                              <TableCell align="right">{point.cas_blob_count.toLocaleString()}</TableCell>
                              <TableCell align="right">{formatBytes(point.cas_physical_bytes)}</TableCell>
                              <TableCell align="right">{formatBytes(point.cas_logical_referenced_bytes)}</TableCell>
                              <TableCell align="right">{point.cas_dedup_ratio.toFixed(2)}×</TableCell>
                              <TableCell align="right">{(point.small_lt64_kib_count_share * 100).toFixed(1)}%</TableCell>
                              <TableCell align="right">{(point.large_ge16_mib_byte_share * 100).toFixed(1)}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </XDriveTableSurface>
                  </Stack>
                  <Stack spacing={1}>
                    <XDriveSectionHeader
                      level="h3"
                      title="异常与缓存趋势"
                      subtitle="直接读取每日存储快照，不会为了历史页面重新扫描 Blob、缓存或 staging。"
                    />
                    <Typography variant="body2" color="text.secondary">
                      旧样本没有完整物理快照时，缓存、staging 和未分类项显示为 —；未引用 Blob 与 Legacy 仍读取历史样本中的独立统计列。
                    </Typography>
                    <XDriveTableSurface>
                      <Table size="small" aria-label="存储异常与缓存趋势" sx={{ minWidth: 1540 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell>时间</TableCell>
                            <TableCell align="right">未引用 Blob</TableCell>
                            <TableCell align="right">Legacy</TableCell>
                            <TableCell align="right">Staging orphan / 可回收</TableCell>
                            <TableCell align="right">图片缩略图</TableCell>
                            <TableCell align="right">视频 Poster</TableCell>
                            <TableCell align="right">分析预览</TableCell>
                            <TableCell align="right">其他媒体 / Preview / 转码</TableCell>
                            <TableCell align="right">存储临时文件</TableCell>
                            <TableCell align="right">未分类</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {history.samples.slice(-12).reverse().map((point) => (
                            <TableRow key={point.slot_at + ':anomaly'} hover>
                              <TableCell>{new Date(point.slot_at).toLocaleString()}</TableCell>
                              <TableCell align="right">
                                {formatBytes(point.unreferenced_blob_bytes)} · {point.unreferenced_blob_count.toLocaleString()} 个
                              </TableCell>
                              <TableCell align="right">
                                {formatBytes(point.legacy_physical_bytes)} · {point.legacy_blob_count.toLocaleString()} 个
                              </TableCell>
                              <TableCell align="right">
                                {point.anomaly_snapshot_available
                                  ? `${formatBytes(point.staging_orphan_bytes)} / ${formatBytes(point.staging_reclaimable_bytes)}`
                                  : '—'}
                              </TableCell>
                              <TableCell align="right">{storageHistorySnapshotBytes(point, point.media_thumbnail_bytes)}</TableCell>
                              <TableCell align="right">{storageHistorySnapshotBytes(point, point.video_poster_bytes)}</TableCell>
                              <TableCell align="right">{storageHistorySnapshotBytes(point, point.analysis_preview_bytes)}</TableCell>
                              <TableCell align="right">{storageHistorySnapshotBytes(point, storageHistoryOtherCacheBytes(point))}</TableCell>
                              <TableCell align="right">{storageHistorySnapshotBytes(point, point.storage_temp_bytes)}</TableCell>
                              <TableCell align="right">{storageHistorySnapshotBytes(point, point.unclassified_bytes)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </XDriveTableSurface>
                  </Stack>
                </Stack>
              )}

              {scope === 'global' && (
                <Stack spacing={1.5}>
                  <XDriveSectionHeader
                    level="h3"
                    title="CAS 全局物理对象"
                    subtitle="去重后的 CAS Blob 属于全实例物理层；用户页只显示账号逻辑文件分布。"
                  />
                  <XDriveMetricGrid>
                    <XDriveMetricCard title="CAS Blob" value={casBlobCount.toLocaleString()} />
                    <XDriveMetricCard title="CAS 物理容量" value={formatBytes(casPhysicalBytes)} />
                    <XDriveMetricCard
                      title="未引用 Blob"
                      value={unreferencedBlobCount.toLocaleString()}
                      suffix={`${formatBytes(unreferencedBlobBytes)} · ref_count = 0`}
                    />
                    <XDriveMetricCard title="逻辑引用容量" value={formatBytes(casLogicalReferencedBytes)} />
                    <XDriveMetricCard title="去重节省" value={formatBytes(casDedupSavedBytes)} />
                    <XDriveMetricCard title="去重倍率" value={`${casDedupRatio.toFixed(2)}×`} />
                    <XDriveMetricCard title="节省比例" value={`${(casSavingsRatio * 100).toFixed(1)}%`} />
                    <XDriveMetricCard title="平均 Blob" value={formatBytes(averageBlobSizeBytes)} />
                    <XDriveMetricCard title="P50 / P90 / P99" value={`${formatBytes(p50BlobSizeBytes)} / ${formatBytes(p90BlobSizeBytes)} / ${formatBytes(p99BlobSizeBytes)}`} />
                  </XDriveMetricGrid>

                  {unreferencedBlobCount > 0 && (
                    <Accordion
                      disableGutters
                      onChange={(_, expanded) => {
                        if (expanded && !unreferencedPage) void loadUnreferencedPage(1)
                      }}
                    >
                      <AccordionSummary>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ width: '100%' }}>
                          <Typography variant="body2" fontWeight={600}>待 GC Blob 明细</Typography>
                          <Chip size="small" variant="outlined" label={`${unreferencedBlobCount.toLocaleString()} 个 · ${formatBytes(unreferencedBlobBytes)}`} />
                          <Typography variant="caption" color="text.secondary">
                            按需检查当前页物理对象；不会重新扫描全部 Blob。
                          </Typography>
                        </Stack>
                      </AccordionSummary>
                      <AccordionDetails>
                        {unreferencedLoading && !unreferencedPage ? (
                          <XDriveStatePanel variant="plain" loading message="正在加载待 GC Blob…" />
                        ) : unreferencedPage ? (
                          <Stack spacing={1}>
                            {unreferencedLoading ? <LinearProgress /> : null}
                            <XDriveTableSurface>
                              <Table size="small" aria-label="待 GC Blob 明细" sx={{ minWidth: 980 }}>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Storage key</TableCell>
                                    <TableCell align="right">元数据大小</TableCell>
                                    <TableCell align="right">物理大小</TableCell>
                                    <TableCell>State</TableCell>
                                    <TableCell align="right">Reused Part</TableCell>
                                    <TableCell>GC 状态</TableCell>
                                    <TableCell>更新时间</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {unreferencedPage.items.map((blob) => {
                                    const status = unreferencedBlobStatus(blob)
                                    return (
                                      <TableRow key={blob.sha256} hover>
                                        <TableCell sx={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{blob.storage_key}</TableCell>
                                        <TableCell align="right">{formatBytes(blob.metadata_size)}</TableCell>
                                        <TableCell align="right">{blob.physical_exists ? formatBytes(blob.physical_size) : '不存在'}</TableCell>
                                        <TableCell>{blob.state}</TableCell>
                                        <TableCell align="right">{blob.reused_upload_parts.toLocaleString()}</TableCell>
                                        <TableCell><XDriveStatusBadge tone={status.tone} label={status.label} /></TableCell>
                                        <TableCell>{new Date(blob.updated_at).toLocaleString()}</TableCell>
                                      </TableRow>
                                    )
                                  })}
                                </TableBody>
                              </Table>
                            </XDriveTableSurface>
                            <XDrivePaginationControls
                              page={unreferencedPageNumber}
                              pageSize={STORAGE_DIAGNOSTIC_PAGE_SIZE}
                              hasNext={unreferencedPage.has_more}
                              loading={unreferencedLoading}
                              onPrevious={() => void loadUnreferencedPage(unreferencedPageNumber - 1)}
                              onNext={() => void loadUnreferencedPage(unreferencedPageNumber + 1)}
                            />
                          </Stack>
                        ) : null}
                      </AccordionDetails>
                    </Accordion>
                  )}

                  {legacyBlobCount > 0 && (
                    <Accordion
                      disableGutters
                      onChange={(_, expanded) => {
                        if (expanded && !legacyPage) void loadLegacyPage(1)
                      }}
                    >
                      <AccordionSummary>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ width: '100%' }}>
                          <Typography variant="body2" fontWeight={600}>Legacy 对象明细</Typography>
                          <Chip size="small" variant="outlined" label={`${legacyBlobCount.toLocaleString()} 个 · ${formatBytes(legacyPhysicalBytes)}`} />
                          <Typography variant="caption" color="text.secondary">
                            这些对象仍被当前文件或历史版本引用，不能作为垃圾直接删除。
                          </Typography>
                        </Stack>
                      </AccordionSummary>
                      <AccordionDetails>
                        {legacyLoading && !legacyPage ? (
                          <XDriveStatePanel variant="plain" loading message="正在加载 legacy 对象…" />
                        ) : legacyPage ? (
                          <Stack spacing={1}>
                            {legacyLoading ? <LinearProgress /> : null}
                            <XDriveTableSurface>
                              <Table size="small" aria-label="Legacy 对象明细" sx={{ minWidth: 900 }}>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Storage key</TableCell>
                                    <TableCell align="right">大小</TableCell>
                                    <TableCell align="right">当前文件引用</TableCell>
                                    <TableCell align="right">历史版本引用</TableCell>
                                    <TableCell>最后引用</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {legacyPage.items.map((item) => (
                                    <TableRow key={item.storage_key} hover>
                                      <TableCell sx={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{item.storage_key}</TableCell>
                                      <TableCell align="right">{formatBytes(item.size)}</TableCell>
                                      <TableCell align="right">{item.current_file_refs.toLocaleString()}</TableCell>
                                      <TableCell align="right">{item.history_version_refs.toLocaleString()}</TableCell>
                                      <TableCell>{new Date(item.last_referenced_at).toLocaleString()}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </XDriveTableSurface>
                            <XDrivePaginationControls
                              page={legacyPageNumber}
                              pageSize={STORAGE_DIAGNOSTIC_PAGE_SIZE}
                              hasNext={legacyPage.has_more}
                              loading={legacyLoading}
                              onPrevious={() => void loadLegacyPage(legacyPageNumber - 1)}
                              onNext={() => void loadLegacyPage(legacyPageNumber + 1)}
                            />
                          </Stack>
                        ) : null}
                      </AccordionDetails>
                    </Accordion>
                  )}

                  <Stack spacing={1}>
                    <XDriveSectionHeader
                      level="h3"
                      title="CAS Blob 尺寸分布"
                      subtitle="范围：全实例。数量图用于观察小对象压力，字节图用于判断真正占用磁盘的尺寸区间。"
                    />
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
                        gap: 2,
                      }}
                    >
                      <XDriveStorageDistributionChart
                        title="按 Blob 数量"
                        subtitle="每个尺寸区间包含多少个唯一物理对象"
                        buckets={casBuckets}
                        value="count"
                      />
                      <XDriveStorageDistributionChart
                        title="按物理字节"
                        subtitle="每个尺寸区间贡献多少 CAS 实际占用"
                        buckets={casBuckets}
                        value="bytes"
                      />
                    </Box>

                    <XDriveSectionHeader level="h3" title="精确分布明细" />
                    <Typography variant="body2" color="text.secondary">
                      区间按 [下界, 上界) 统计，用于判断后续 CDC 与 small-file packing 的实际收益。
                    </Typography>
                    <XDriveTableSurface>
                      <Table size="small" aria-label="CAS Blob 尺寸分布明细">
                        <TableHead>
                          <TableRow>
                            <TableCell>Blob 大小</TableCell>
                            <TableCell align="right">数量</TableCell>
                            <TableCell align="right">物理容量</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {casBuckets.map((bucket) => (
                            <TableRow key={bucket.key} hover>
                              <TableCell>{bucket.label}</TableCell>
                              <TableCell align="right">{bucket.count.toLocaleString()}</TableCell>
                              <TableCell align="right">{formatBytes(bucket.bytes)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </XDriveTableSurface>
                  </Stack>

                  <Typography variant="caption" color="text.secondary">
                    生成时间：{new Date(stats.generated_at).toLocaleString()}
                  </Typography>
                </Stack>
              )}
            </Stack>
          )}
      </XDriveWorkspaceSurface>

      <XDriveConfirmDialog
        open={cleanupConfirmOpen}
        title="清理可回收上传临时数据？"
        description={(
          <Stack spacing={2}>
            <Typography variant="body2">
              将清理过期 UploadSession，以及超过 1 小时且数据库没有任何引用的 orphan staging 文件。近期未登记文件不会删除。
            </Typography>
            {staging && stagingStats && (
              <XDriveStatusAlert
                tone="warning"
                title={`预计可回收 ${stagingStats.reclaimable_files.toLocaleString()} 个临时文件 / ${formatBytes(stagingStats.reclaimable_bytes)}`}
              >
                另有 {stagingStats.expired_sessions.toLocaleString()} 个过期 UploadSession 将被回收。
              </XDriveStatusAlert>
            )}
          </Stack>
        )}
        confirmLabel="确认清理"
        confirmIntent="danger"
        loading={cleanupLoading}
        loadingLabel="正在清理…"
        onCancel={() => setCleanupConfirmOpen(false)}
        onConfirm={() => void cleanupStaging()}
      />

      <Dialog
        open={Boolean(cleanupResultWarning)}
        onClose={() => setCleanupResultWarning('')}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle title="staging 清理部分完成" onClose={() => setCleanupResultWarning('')} />
        <XDriveDialogContent>
          <XDriveStatusAlert tone="warning">{cleanupResultWarning}</XDriveStatusAlert>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton intent="primary" onClick={() => setCleanupResultWarning('')}>知道了</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Dialog
        open={Boolean(cleanupActionError)}
        onClose={() => setCleanupActionError('')}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle title="清理 staging 失败" onClose={() => setCleanupActionError('')} />
        <XDriveDialogContent>
          <XDriveStatusAlert tone="bad">{cleanupActionError}</XDriveStatusAlert>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton intent="primary" onClick={() => setCleanupActionError('')}>知道了</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>
    </>
  )
}
