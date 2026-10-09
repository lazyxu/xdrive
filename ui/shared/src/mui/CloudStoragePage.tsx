import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Box, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { QuotaUsage, StorageStats } from '../models'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveMetricCard, XDriveMetricGrid } from './MetricCards'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStorageDistributionChart } from './StorageDistributionChart'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

export type XDriveCloudStorageSnapshot = {
  quota: QuotaUsage
  stats?: StorageStats | null
  statsUnavailableMessage?: string
}

export type XDriveCloudStorageDataSource = {
  load: () => Promise<XDriveCloudStorageSnapshot>
}

export function XDriveCloudStoragePage({
  source,
}: {
  source: XDriveCloudStorageDataSource
}) {
  const [snapshot, setSnapshot] = useState<XDriveCloudStorageSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
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
  const stats = snapshot?.stats?.scope === 'self' ? snapshot.stats : null
  const fileBuckets = stats?.file_buckets ?? []

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="云端存储"
      subtitle="查看当前账号的容量、重复内容、回收站、历史版本与文件大小分布。"
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

      {!snapshot && !error ? (
        <XDriveStatePanel
          variant="plain"
          loading={loading}
          message={loading ? '正在加载云端存储信息…' : '暂无云端存储信息'}
        />
      ) : null}

      {snapshot ? (
        <Stack spacing={3}>
          <XDriveStatusAlert tone="neutral" title="范围：当前账号">
            这里展示账号配额与逻辑文件视角。CAS Blob、宿主机路径、数据库、备份和可清理缓存属于全实例物理存储，只在管理员“全局存储”中展示。
          </XDriveStatusAlert>

          {quota ? (
            <Stack spacing={1.5}>
              <XDriveSectionHeader level="h3" title="账号容量" />
              {quota.over_quota ? (
                <XDriveStatusAlert tone="warning">
                  当前账号已超过云端存储配额，请释放空间或调整配额后再上传新内容。
                </XDriveStatusAlert>
              ) : null}
              <XDriveMetricGrid>
                <XDriveMetricCard
                  title="配额计入占用"
                  value={formatBytes(quota.physical_used_bytes)}
                  suffix={quota.quota_bytes > 0 ? `配额 ${formatBytes(quota.quota_bytes)}` : '不限配额'}
                />
                <XDriveMetricCard
                  title="可用空间"
                  value={formatBytes(quota.available_bytes)}
                  suffix={quota.quota_bytes > 0 ? '用户配额可用' : '服务器可用空间'}
                />
                <XDriveMetricCard title="当前文件" value={formatBytes(quota.logical_file_bytes)} suffix="有效逻辑内容" />
                <XDriveMetricCard title="文件数量" value={stats?.file_count?.toLocaleString() ?? '—'} suffix="当前有效文件" />
                <XDriveMetricCard title="回收站" value={formatBytes(quota.trash_bytes)} suffix="计入账号占用" />
                <XDriveMetricCard title="历史版本" value={formatBytes(quota.history_bytes)} suffix="已保存的历史内容" />
                <XDriveMetricCard title="上传预占" value={formatBytes(quota.reserved_bytes)} suffix="进行中上传预留空间" />
              </XDriveMetricGrid>
            </Stack>
          ) : null}

          {stats ? (
            <Stack spacing={1.5} data-xdrive-cloud-duplicate-stats>
              <XDriveSectionHeader level="h3" title="重复文件与 CAS 节省" subtitle="当前账号有效文件按完整 SHA-256 与大小分组；不会删除或合并文件。" />
              <XDriveMetricGrid>
                <XDriveMetricCard title="重复内容组" value={(stats.duplicate_group_count ?? 0).toLocaleString('zh-CN')} />
                <XDriveMetricCard title="额外重复文件" value={(stats.duplicate_file_count ?? 0).toLocaleString('zh-CN')} suffix="每组除第一份以外的文件数" />
                <XDriveMetricCard title="已节省原始内容" value={formatBytes(stats.duplicate_logical_bytes ?? 0)} suffix="当前有效文件的理论去重收益，非删除后可释放空间" />
              </XDriveMetricGrid>
            </Stack>
          ) : null}

          {stats && fileBuckets.length > 0 ? (
            <Stack spacing={1.5}>
              <XDriveSectionHeader
                level="h3"
                title="文件大小分布"
                subtitle="按当前账号的有效逻辑文件大小统计；这不是 CAS Blob 分布。"
              />
              <XDriveMetricGrid>
                <XDriveMetricCard title="平均文件" value={formatBytes(stats.average_file_size_bytes ?? 0)} />
                <XDriveMetricCard title="P50" value={formatBytes(stats.p50_file_size_bytes ?? 0)} suffix="中位文件大小" />
                <XDriveMetricCard title="P90" value={formatBytes(stats.p90_file_size_bytes ?? 0)} suffix="90% 文件不超过" />
                <XDriveMetricCard title="P99" value={formatBytes(stats.p99_file_size_bytes ?? 0)} suffix="99% 文件不超过" />
              </XDriveMetricGrid>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                }}
              >
                <XDriveStorageDistributionChart
                  title="按文件数量"
                  subtitle="每个大小区间包含多少个当前文件"
                  buckets={fileBuckets}
                  value="count"
                />
                <XDriveStorageDistributionChart
                  title="按逻辑字节"
                  subtitle="每个大小区间贡献多少逻辑文件容量"
                  buckets={fileBuckets}
                  value="bytes"
                />
              </Box>
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
  )
}
