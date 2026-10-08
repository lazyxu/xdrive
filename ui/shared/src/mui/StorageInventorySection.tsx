import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded'
import { Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import type {
  StorageCacheCleanup,
  StorageCacheCleanupKind,
  StorageInventory,
  StorageInventoryItem,
} from '../models'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveMetricCard, XDriveMetricGrid } from './MetricCards'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveTableSurface } from './TableSurface'

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
      return '删除分析/创作预览缓存'
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

export function XDriveStorageInventorySection({
  inventory,
  cleanupCache,
  onCleanupComplete,
}: {
  inventory: StorageInventory
  cleanupCache?: (kind: StorageCacheCleanupKind) => Promise<StorageCacheCleanup>
  onCleanupComplete?: (result: StorageCacheCleanup) => void
}) {
  const [displayInventory, setDisplayInventory] = useState(inventory)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupRequest, setCleanupRequest] = useState<{
    kind: StorageCacheCleanupKind
    itemKey?: string
  } | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setDisplayInventory(inventory)
  }, [inventory])

  const cleanupTarget = useMemo(
    () => displayInventory.items.find((item) => (
      cleanupRequest?.itemKey
        ? item.key === cleanupRequest.itemKey
        : item.cleanup_kind === cleanupRequest?.kind
    )),
    [cleanupRequest, displayInventory.items],
  )

  const runCleanup = async () => {
    if (!cleanupRequest || !cleanupCache) return
    setCleanupLoading(true)
    setNotice('')
    setError('')
    try {
      const result = await cleanupCache(cleanupRequest.kind)
      setDisplayInventory(result.inventory)
      setNotice(
        `已删除 ${result.deleted_files.toLocaleString()} 个文件，共 ${formatBytes(result.deleted_bytes)}` +
        (result.failed_files > 0 ? `；${result.failed_files.toLocaleString()} 个文件删除失败` : ''),
      )
      onCleanupComplete?.(result)
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : '清理缓存失败')
    } finally {
      setCleanupLoading(false)
      setCleanupRequest(null)
    }
  }

  return (
    <>
      <Stack spacing={1.5}>
        <XDriveSectionHeader
          level="h3"
          title="物理存储组成与缓存"
          subtitle="范围：全实例。按真实落盘文件统计；数据库、备份和主数据只读，只有明确可再生成或可安全回收的数据允许清理。"
          actions={cleanupCache && displayInventory.reclaimable_bytes > 0 ? (
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

        {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}
        {notice ? <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert> : null}

        <XDriveMetricGrid>
          <XDriveMetricCard title="xDrive 管理总占用" value={formatBytes(displayInventory.total_managed_bytes)} />
          <XDriveMetricCard title="文件数据目录" value={formatBytes(displayInventory.storage_root_bytes)} />
          <XDriveMetricCard title="数据库" value={formatBytes(displayInventory.database_bytes)} suffix="不可删除" />
          <XDriveMetricCard title="备份" value={formatBytes(displayInventory.backup_bytes)} suffix="不可作为缓存删除" />
          <XDriveMetricCard title="服务与运行文件" value={formatBytes(displayInventory.host_service_bytes)} />
          <XDriveMetricCard title="可释放缓存" value={formatBytes(displayInventory.reclaimable_bytes)} />
          <XDriveMetricCard title="未分类文件数据" value={formatBytes(displayInventory.unclassified_bytes)} suffix="不可自动删除" />
        </XDriveMetricGrid>

        <XDriveTableSurface>
          <Table size="small" aria-label="全实例物理存储占用明细" sx={{ minWidth: 1040 }}>
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
              {displayInventory.items.map((item) => (
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
                  <TableCell align="right">{item.files > 0 ? item.files.toLocaleString() : '—'}</TableCell>
                  <TableCell align="right">{formatBytes(item.bytes)}</TableCell>
                  <TableCell align="right">
                    {item.reclaimable_bytes > 0 ? formatBytes(item.reclaimable_bytes) : '—'}
                  </TableCell>
                  <TableCell>{inventoryStatus(item)}</TableCell>
                  <TableCell align="right">
                    {cleanupCache && item.deletable && item.cleanup_kind ? (
                      <XDriveActionButton
                        compact
                        intent="danger"
                        disabled={cleanupLoading || item.reclaimable_bytes <= 0}
                        onClick={() => setCleanupRequest({ kind: item.cleanup_kind!, itemKey: item.key })}
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
          生成时间：{new Date(displayInventory.generated_at).toLocaleString()}
        </Typography>
      </Stack>

      <XDriveConfirmDialog
        open={cleanupRequest !== null}
        title={cleanupLabel(cleanupRequest?.kind)}
        description={
          cleanupRequest?.kind === 'all'
            ? `将删除所有可再生成媒体缓存和安全可回收临时文件，预计最多释放 ${formatBytes(displayInventory.reclaimable_bytes)}。原始文件、数据库、备份、回收站和历史版本不会删除。`
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
