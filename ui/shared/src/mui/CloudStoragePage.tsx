import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  QuotaUsage,
  StorageCacheCleanup,
  StorageCacheCleanupKind,
  StorageInventoryItem,
  StorageStats,
} from '../models'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveMetricCard, XDriveMetricGrid } from './MetricCards'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveTableSurface } from './TableSurface'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

export type XDriveCloudStorageSnapshot = {
  quota: QuotaUsage
  stats?: StorageStats | null
  statsUnavailableMessage?: string
}

export type XDriveCloudStorageDataSource = {
  load: () => Promise<XDriveCloudStorageSnapshot>
  cleanupCache?: (kind: StorageCacheCleanupKind) => Promise<StorageCacheCleanup>
}

function inventoryStatus(item: StorageInventoryItem) {
  switch (item.status) {
    case 'regenerable':
      return '可再生成'
    case 'reclaimable_by_age':
      return '过期后可回收'
    case 'not_enabled':
      return '未启用'
    case 'read_only':
      return '只读统计'
    case 'review':
      return '需审查'
    case 'unknown':
      return '未知派生文件'
    default:
      return '使用中'
  }
}

function cleanupLabel(kind?: StorageCacheCleanupKind) {
  switch (kind) {
    case 'media_thumbnail':
      return '删除缩略图缓存'
    case 'analysis_preview':
      return '删除分析预览缓存'
    case 'upload_staging':
      return '清理上传临时文件'
    case 'storage_temp':
      return '清理过期临时文件'
    case 'all':
      return '清理全部可回收缓存'
    default:
      return '清理缓存'
  }
}

export function XDriveCloudStoragePage({
  source,
}: {
  source: XDriveCloudStorageDataSource
}) {
  const [snapshot, setSnapshot] = useState<XDriveCloudStorageSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupRequest, setCleanupRequest] = useState<{
    kind: StorageCacheCleanupKind
    itemKey?: string
  } | null>(null)
  const [cleanupNotice, setCleanupNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setSnapshot(await source.load())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载云端存储信息失败')
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => {
    void load()
  }, [load])

  const quota = snapshot?.quota
  const stats = snapshot?.stats
  const inventory = stats?.inventory
  const cleanupKind = cleanupRequest?.kind ?? null
  const cleanupTarget = useMemo(
    () => inventory?.items.find((item) => (
      cleanupRequest?.itemKey
        ? item.key === cleanupRequest.itemKey
        : item.cleanup_kind === cleanupRequest?.kind
    )),
    [cleanupRequest, inventory],
  )

  const runCleanup = useCallback(async () => {
    if (!cleanupRequest || !source.cleanupCache) return
    setCleanupLoading(true)
    setCleanupNotice('')
    setError('')
    try {
      const result = await source.cleanupCache(cleanupRequest.kind)
      setCleanupNotice(
        `已删除 ${result.deleted_files.toLocaleString()} 个文件，共 ${formatBytes(result.deleted_bytes)}` +
        (result.failed_files > 0 ? `；${result.failed_files.toLocaleString()} 个文件删除失败` : ''),
      )
      await load()
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : '清理缓存失败')
    } finally {
      setCleanupLoading(false)
      setCleanupRequest(null)
    }
  }, [cleanupRequest, load, source])

  return (
    <>
      <XDriveWorkspaceSurface
        presentation="page"
        title="云端存储"
        subtitle="查看账号容量；管理员还可查看 Server 全部持久文件、缓存、数据库与备份的物理占用和宿主机绝对路径。"
        pageActions={(
          <XDriveActionButton
            startIcon={<RefreshRoundedIcon />}
            loading={loading}
            loadingLabel="正在刷新…"
            onClick={() => { void load() }}
          >
            刷新
          </XDriveActionButton>
        )}
      >
        {error ? <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>{error}</XDriveStatusAlert> : null}
        {cleanupNotice ? <XDriveStatusAlert tone="good" sx={{ mb: 2 }}>{cleanupNotice}</XDriveStatusAlert> : null}

        {!snapshot && !error ? (
          <XDriveStatePanel
            variant="plain"
            loading={loading}
            message={loading ? '正在加载云端存储信息…' : '暂无云端存储信息'}
          />
        ) : null}

        {snapshot ? (
          <Stack spacing={3}>
            {quota ? (
              <Stack spacing={1.5}>
                <XDriveSectionHeader level="h3" title="云端容量" />
                {quota.over_quota ? (
                  <XDriveStatusAlert tone="warning">
                    当前账号已超过云端存储配额，请释放空间或调整配额后再上传新内容。
                  </XDriveStatusAlert>
                ) : null}
                <XDriveMetricGrid>
                  <XDriveMetricCard
                    title="物理占用"
                    value={formatBytes(quota.physical_used_bytes)}
                    suffix={quota.quota_bytes > 0 ? `配额 ${formatBytes(quota.quota_bytes)}` : '不限配额'}
                  />
                  <XDriveMetricCard
                    title="可用空间"
                    value={formatBytes(quota.available_bytes)}
                    suffix={quota.quota_bytes > 0 ? '用户配额可用' : '服务器可用空间'}
                  />
                  <XDriveMetricCard title="当前文件" value={formatBytes(quota.logical_file_bytes)} suffix="有效逻辑内容" />
                  <XDriveMetricCard title="回收站" value={formatBytes(quota.trash_bytes)} suffix="计入物理占用" />
                  <XDriveMetricCard title="历史版本" value={formatBytes(quota.history_bytes)} suffix="已保存的历史内容" />
                  <XDriveMetricCard title="上传预占" value={formatBytes(quota.reserved_bytes)} suffix="进行中上传预留空间" />
                </XDriveMetricGrid>
              </Stack>
            ) : null}

            {inventory ? (
              <Stack spacing={1.5}>
                <XDriveSectionHeader
                  level="h3"
                  title="Server 文件占用"
                  subtitle="按真实落盘文件统计。每类均显示安装器解析后的宿主机绝对路径；数据库、备份和主数据只读，只有明确可再生成或可安全回收的数据允许清理。"
                  actions={source.cleanupCache && inventory.reclaimable_bytes > 0 ? (
                    <XDriveActionButton
                      intent="danger"
                      startIcon={<DeleteSweepRoundedIcon />}
                      disabled={cleanupLoading}
                      onClick={() => setCleanupRequest({ kind: 'all' })}
                    >
                      清理全部可回收缓存
                    </XDriveActionButton>
                  ) : undefined}
                />
                <XDriveMetricGrid>
                  <XDriveMetricCard title="xDrive 管理总占用" value={formatBytes(inventory.total_managed_bytes)} />
                  <XDriveMetricCard title="文件数据目录" value={formatBytes(inventory.storage_root_bytes)} />
                  <XDriveMetricCard title="数据库" value={formatBytes(inventory.database_bytes)} suffix="不可删除" />
                  <XDriveMetricCard title="备份" value={formatBytes(inventory.backup_bytes)} suffix="不可作为缓存删除" />
                  <XDriveMetricCard title="服务与运行文件" value={formatBytes(inventory.host_service_bytes)} />
                  <XDriveMetricCard title="可释放缓存" value={formatBytes(inventory.reclaimable_bytes)} />
                  <XDriveMetricCard title="未分类文件数据" value={formatBytes(inventory.unclassified_bytes)} suffix="不可自动删除" />
                </XDriveMetricGrid>

                <XDriveTableSurface>
                  <Table size="small" aria-label="Server 文件占用明细" sx={{ minWidth: 1040 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>数据类型</TableCell>
                        <TableCell>宿主机绝对路径</TableCell>
                        <TableCell align="right">文件数</TableCell>
                        <TableCell align="right">占用</TableCell>
                        <TableCell align="right">可回收</TableCell>
                        <TableCell>状态</TableCell>
                        <TableCell align="right">操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {inventory.items.map((item) => (
                        <TableRow key={item.key} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>{item.label}</Typography>
                          </TableCell>
                          <TableCell sx={{ maxWidth: 420 }}>
                            <Typography
                              component="code"
                              variant="caption"
                              sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
                            >
                              {item.path}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            {item.files > 0 ? item.files.toLocaleString() : '—'}
                          </TableCell>
                          <TableCell align="right">{formatBytes(item.bytes)}</TableCell>
                          <TableCell align="right">
                            {item.reclaimable_bytes > 0 ? formatBytes(item.reclaimable_bytes) : '—'}
                          </TableCell>
                          <TableCell>{inventoryStatus(item)}</TableCell>
                          <TableCell align="right">
                            {source.cleanupCache && item.deletable && item.cleanup_kind ? (
                              <XDriveActionButton
                                compact
                                intent="danger"
                                disabled={cleanupLoading || item.reclaimable_bytes <= 0}
                                onClick={() => setCleanupRequest({
                                  kind: item.cleanup_kind!,
                                  itemKey: item.key,
                                })}
                              >
                                清理
                              </XDriveActionButton>
                            ) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </XDriveTableSurface>

                <Typography variant="caption" color="text.secondary">
                  生成时间：{new Date(inventory.generated_at).toLocaleString()}
                </Typography>
              </Stack>
            ) : null}

            {stats ? (
              <Stack spacing={1.5}>
                <XDriveSectionHeader
                  level="h3"
                  title="CAS 存储情报"
                  subtitle="用于观察当前账号内容的物理对象、逻辑引用和去重收益。"
                />
                <XDriveMetricGrid>
                  <XDriveMetricCard title="CAS Blob" value={stats.cas_blob_count.toLocaleString()} suffix="唯一物理对象" />
                  <XDriveMetricCard title="CAS 物理容量" value={formatBytes(stats.cas_physical_bytes)} suffix="实际占用" />
                  <XDriveMetricCard title="逻辑引用容量" value={formatBytes(stats.cas_logical_referenced_bytes)} suffix="含重复引用" />
                  <XDriveMetricCard
                    title="去重节省"
                    value={formatBytes(stats.cas_dedup_saved_bytes)}
                    suffix={`${stats.cas_dedup_ratio.toFixed(2)}× · ${(stats.cas_savings_ratio * 100).toFixed(1)}%`}
                  />
                  <XDriveMetricCard title="平均 Blob" value={formatBytes(stats.average_blob_size_bytes)} suffix="算术平均" />
                  <XDriveMetricCard title="P50" value={formatBytes(stats.p50_blob_size_bytes)} suffix="中位尺寸" />
                  <XDriveMetricCard title="P90" value={formatBytes(stats.p90_blob_size_bytes)} suffix="90% Blob 不超过" />
                  <XDriveMetricCard title="P99" value={formatBytes(stats.p99_blob_size_bytes)} suffix="99% Blob 不超过" />
                </XDriveMetricGrid>

                {stats.legacy_blob_count > 0 ? (
                  <XDriveStatusAlert tone="neutral">
                    仍有 {stats.legacy_blob_count.toLocaleString()} 个 legacy 对象（{formatBytes(stats.legacy_physical_bytes)}），未计入 CAS 尺寸分布。
                  </XDriveStatusAlert>
                ) : null}

                <Stack spacing={1}>
                  <XDriveSectionHeader level="h3" title="CAS Blob 尺寸分布" />
                  <Typography variant="body2" color="text.secondary">
                    区间按 [下界, 上界) 统计，用于判断后续 CDC 与 small-file packing 的实际收益。
                  </Typography>
                  <XDriveTableSurface>
                    <Table size="small" aria-label="CAS Blob 尺寸分布">
                      <TableHead>
                        <TableRow>
                          <TableCell>Blob 大小</TableCell>
                          <TableCell align="right">数量</TableCell>
                          <TableCell align="right">物理容量</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {stats.buckets.map((bucket) => (
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
            ) : snapshot.statsUnavailableMessage ? (
              <XDriveStatusAlert tone="neutral">{snapshot.statsUnavailableMessage}</XDriveStatusAlert>
            ) : null}
          </Stack>
        ) : null}
      </XDriveWorkspaceSurface>

      <XDriveConfirmDialog
        open={cleanupRequest !== null}
        title={cleanupLabel(cleanupKind ?? undefined)}
        description={
          cleanupKind === 'all'
            ? `将删除所有可再生成媒体缓存和安全可回收临时文件，预计最多释放 ${formatBytes(inventory?.reclaimable_bytes ?? 0)}。原始文件、数据库、备份、回收站和历史版本不会删除。`
            : `${cleanupTarget?.label ?? '该类缓存'}将从 ${cleanupTarget?.path ?? '对应路径'} 删除；需要时会自动重新生成。原始文件不会删除。`
        }
        confirmLabel="确认清理"
        confirmIntent="danger"
        loading={cleanupLoading}
        loadingLabel="正在清理…"
        onCancel={() => {
          if (!cleanupLoading) setCleanupRequest(null)
        }}
        onConfirm={() => { void runCleanup() }}
      />
    </>
  )
}
