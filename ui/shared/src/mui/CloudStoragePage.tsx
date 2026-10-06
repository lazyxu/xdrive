import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { QuotaUsage, StorageStats } from '../models'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
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
  const stats = snapshot?.stats

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="云端存储"
      subtitle="查看当前账号的云端容量、回收站、历史版本与 CAS 去重统计。"
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
  )
}
