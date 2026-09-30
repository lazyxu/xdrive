import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
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
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveDialogActions,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDrivePaginationControls,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStatusBadge,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import type {
  StorageDecision,
  StorageHealth,
  StorageHistory,
  StorageStats,
  StagingCleanupFailure,
  StagingCleanupRun,
  UploadStagingDetail,
} from '../../ui/shared/src'
import { formatSize } from '../../ui/shared/src'
import type { XDriveApi } from './api'
import WorkspaceSurface from './WorkspaceSurface'

const STAGING_PAGE_SIZE = 20

function signedSize(value: number) {
  if (value === 0) return '0 B'
  return `${value > 0 ? '+' : '-'}${formatSize(Math.abs(value))}`
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

function StorageStatGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
        gap: 2,
      }}
    >
      {children}
    </Box>
  )
}

function StorageStat({ title, value, suffix }: { title: ReactNode; value: ReactNode; suffix?: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="h6" component="div" sx={{ lineHeight: 1.3, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
      {suffix ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>
          {suffix}
        </Typography>
      ) : null}
    </Box>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <Typography component="h3" variant="subtitle1" fontWeight={700}>{children}</Typography>
}

export default function StorageStatsModal({
  api,
  scope,
  open,
  presentation = 'dialog',
  onClose,
}: {
  api: XDriveApi
  scope: 'self' | 'global'
  open: boolean
  presentation?: 'dialog' | 'page'
  onClose: () => void
}) {
  const surfaceOpen = presentation === 'page' || open
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!surfaceOpen) return
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
    const request = scope === 'global' ? api.adminStorageStats() : api.storageStats()
    const healthRequest = scope === 'global'
      ? api.adminStorageHealth().catch(() => null)
      : Promise.resolve(null)
    const historyRequest = scope === 'global'
      ? api.adminStorageHistory(30).catch(() => null)
      : Promise.resolve(null)
    const stagingRequest = scope === 'global'
      ? api.adminUploadStaging(STAGING_PAGE_SIZE, '').catch(() => null)
      : Promise.resolve(null)
    const cleanupRunsRequest = scope === 'global'
      ? api.adminStagingCleanupRuns(20, 0).catch(() => [])
      : Promise.resolve([])
    void Promise.all([request, healthRequest, historyRequest, stagingRequest, cleanupRunsRequest])
      .then(([value, healthValue, historyValue, stagingValue, cleanupRunValues]) => {
        if (!active) return
        setStats(value)
        setHealth(healthValue)
        setHistory(historyValue)
        setStaging(stagingValue)
        setCleanupRuns(cleanupRunValues)
        if (stagingValue?.next_cursor) setStagingCursors(['', stagingValue.next_cursor])
      })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '加载存储统计失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, surfaceOpen, scope])

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
    const notice = '已清理 ' + result.deleted_files.toLocaleString() + ' 个临时文件，共 ' + formatSize(result.deleted_bytes)
    setStagingNotice(notice)
    if (result.failed_files > 0) {
      setCleanupResultWarning(
        '本次已清理 ' + result.deleted_files.toLocaleString() + ' 个文件，但仍有 ' +
        result.failed_files.toLocaleString() + ' 个文件删除失败。可在“最近 staging 清理”中展开本次记录查看逐文件错误。',
      )
    }

    try {
      const [nextStats, nextStaging, nextCleanupRuns] = await Promise.all([
        api.adminStorageStats(),
        api.adminUploadStaging(STAGING_PAGE_SIZE, ''),
        api.adminStagingCleanupRuns(20, 0),
      ])
      setStats(nextStats)
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

  const firstHistory = history?.samples[0]
  const lastHistory = history?.samples[history.samples.length - 1]
  const otherDiskUsed = stats?.disk_used_bytes !== undefined && stats?.xdrive_physical_bytes !== undefined
    ? Math.max(0, stats.disk_used_bytes - stats.xdrive_physical_bytes)
    : undefined

  return (
    <>
      <WorkspaceSurface
        presentation={presentation}
        open={open}
        onClose={onClose}
        maxWidth="lg"
        title={scope === 'global' ? '全局存储统计' : '我的存储统计'}
      >
          {error && <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>{error}</XDriveStatusAlert>}

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

              {scope === 'global' &&
                stats.disk_total_bytes !== undefined &&
                stats.disk_used_bytes !== undefined &&
                stats.disk_available_bytes !== undefined &&
                stats.xdrive_physical_bytes !== undefined && (
                  <Stack spacing={1.5}>
                    <SectionTitle>磁盘容量</SectionTitle>
                    <StorageStatGrid>
                      <StorageStat title="磁盘总容量" value={formatSize(stats.disk_total_bytes)} />
                      <StorageStat title="磁盘已用" value={formatSize(stats.disk_used_bytes)} />
                      <StorageStat title="磁盘可用" value={formatSize(stats.disk_available_bytes)} />
                      <StorageStat title="xDrive 物理占用" value={formatSize(stats.xdrive_physical_bytes)} />
                      {otherDiskUsed !== undefined && (
                        <StorageStat title="非 xDrive 占用（估算）" value={formatSize(otherDiskUsed)} />
                      )}
                    </StorageStatGrid>
                  </Stack>
                )}

              {scope === 'global' && staging && (
                <Stack spacing={1.5}>
                  <SectionTitle>上传临时空间</SectionTitle>
                  {stagingNotice && <XDriveStatusAlert tone="good">{stagingNotice}</XDriveStatusAlert>}
                  {!staging.stats.supported && (
                    <XDriveStatusAlert tone="neutral">当前存储后端不支持 staging 文件系统扫描，仅显示数据库侧会话信息。</XDriveStatusAlert>
                  )}
                  {(staging.stats.orphan_files > 0 || staging.stats.missing_part_files > 0 || staging.stats.recent_untracked_files > 0) && (
                    <XDriveStatusAlert
                      tone={staging.stats.missing_part_files > 0 || staging.stats.orphan_files > 0 ? 'warning' : 'neutral'}
                      title={
                        'orphan ' + staging.stats.orphan_files.toLocaleString() +
                        ' · 近期未登记 ' + staging.stats.recent_untracked_files.toLocaleString() +
                        ' · 缺失 part ' + staging.stats.missing_part_files.toLocaleString()
                      }
                    >
                      只有数据库无引用且超过 1 小时的临时文件才会作为 orphan 清理；近期未登记文件不会删除。
                    </XDriveStatusAlert>
                  )}
                  <StorageStatGrid>
                    <StorageStat title="活跃 Upload Session" value={staging.stats.active_sessions} />
                    <StorageStat title="容量 Reservation" value={formatSize(staging.stats.reserved_bytes)} />
                    <StorageStat title="Staging 实际占用" value={formatSize(staging.stats.staging_bytes)} />
                    <StorageStat title="Staging 文件" value={staging.stats.staging_files} />
                    <StorageStat title="已登记 Part" value={staging.stats.part_files} suffix={'/ ' + formatSize(staging.stats.part_bytes)} />
                    <StorageStat title="近期未登记" value={staging.stats.recent_untracked_files} suffix={'/ ' + formatSize(staging.stats.recent_untracked_bytes)} />
                    <StorageStat title="可回收临时空间" value={formatSize(staging.stats.reclaimable_bytes)} />
                    <StorageStat title="Orphan" value={staging.stats.orphan_files} suffix={'/ ' + formatSize(staging.stats.orphan_bytes)} />
                    <StorageStat title="过期 Session" value={staging.stats.expired_sessions} />
                    <StorageStat title="缺失 Part" value={staging.stats.missing_part_files} suffix={'/ ' + formatSize(staging.stats.missing_part_bytes)} />
                  </StorageStatGrid>
                  <Typography variant="body2" color="text.secondary">
                    Reservation 表示活跃 resumable 上传未来仍可能需要写入的峰值空间，不等于当前物理占用；Staging 实际占用已计入 xDrive 物理占用。
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <XDriveActionButton
                      loading={stagingLoading}
                      loadingLabel="正在刷新…"
                      onClick={() => void loadStagingPage(1, true)}
                    >
                      刷新 staging
                    </XDriveActionButton>
                    <XDriveActionButton
                      intent="danger"
                      loading={cleanupLoading}
                      loadingLabel="正在清理…"
                      disabled={staging.stats.reclaimable_files <= 0 && staging.stats.expired_sessions <= 0}
                      onClick={() => setCleanupConfirmOpen(true)}
                    >
                      清理可回收临时数据
                    </XDriveActionButton>
                  </Stack>

                  {staging.orphans.length > 0 && (
                    <Stack spacing={1}>
                      <SectionTitle>Orphan staging</SectionTitle>
                      {stagingLoading ? <LinearProgress /> : null}
                      <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflowX: 'auto' }}>
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
                                <TableCell align="right">{formatSize(file.size)}</TableCell>
                                <TableCell>{new Date(file.modified_at).toLocaleString()}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
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
                  <SectionTitle>最近 staging 清理</SectionTitle>
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
                              删除 {run.deleted_files.toLocaleString()} 个 / {formatSize(run.deleted_bytes)}
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
                                    {failure.storage_key} · {formatSize(failure.size)}
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
                  <XDriveStatusAlert tone={decisionTone(history.decision)} title={decisionMessage(history.decision)}>
                    {decisionDescription(history.decision)}
                  </XDriveStatusAlert>
                  <StorageStatGrid>
                    <StorageStat title="历史样本" value={history.samples.length} suffix={`/ ${history.retention_days} 天`} />
                    <StorageStat
                      title="窗口内物理容量变化"
                      value={firstHistory && lastHistory ? signedSize(lastHistory.cas_physical_bytes - firstHistory.cas_physical_bytes) : '—'}
                    />
                    <StorageStat
                      title="窗口内逻辑容量变化"
                      value={firstHistory && lastHistory ? signedSize(lastHistory.cas_logical_referenced_bytes - firstHistory.cas_logical_referenced_bytes) : '—'}
                    />
                    <StorageStat title="最新去重倍率" value={lastHistory ? `${lastHistory.cas_dedup_ratio.toFixed(2)}×` : '—'} />
                  </StorageStatGrid>
                  <Stack spacing={1}>
                    <SectionTitle>历史趋势</SectionTitle>
                    <Typography variant="body2" color="text.secondary">
                      每 {history.sampling_interval_hours} 小时记录一次，保留 {history.retention_days} 天。下表显示最近 12 个快照。
                    </Typography>
                    <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflowX: 'auto' }}>
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
                              <TableCell align="right">{formatSize(point.cas_physical_bytes)}</TableCell>
                              <TableCell align="right">{formatSize(point.cas_logical_referenced_bytes)}</TableCell>
                              <TableCell align="right">{point.cas_dedup_ratio.toFixed(2)}×</TableCell>
                              <TableCell align="right">{(point.small_lt64_kib_count_share * 100).toFixed(1)}%</TableCell>
                              <TableCell align="right">{(point.large_ge16_mib_byte_share * 100).toFixed(1)}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Stack>
                </Stack>
              )}

              <StorageStatGrid>
                <StorageStat title="CAS Blob" value={stats.cas_blob_count} />
                <StorageStat title="CAS 物理容量" value={formatSize(stats.cas_physical_bytes)} />
                <StorageStat title="逻辑引用容量" value={formatSize(stats.cas_logical_referenced_bytes)} />
                <StorageStat title="去重节省" value={formatSize(stats.cas_dedup_saved_bytes)} />
                <StorageStat title="去重倍率" value={`${stats.cas_dedup_ratio.toFixed(2)}×`} />
                <StorageStat title="节省比例" value={`${(stats.cas_savings_ratio * 100).toFixed(1)}%`} />
                <StorageStat title="平均 Blob" value={formatSize(stats.average_blob_size_bytes)} />
                <StorageStat title="P50 / P90 / P99" value={`${formatSize(stats.p50_blob_size_bytes)} / ${formatSize(stats.p90_blob_size_bytes)} / ${formatSize(stats.p99_blob_size_bytes)}`} />
              </StorageStatGrid>

              {stats.legacy_blob_count > 0 && (
                <XDriveStatusAlert tone="neutral">
                  {`仍有 ${stats.legacy_blob_count.toLocaleString()} 个 legacy 对象，共 ${formatSize(stats.legacy_physical_bytes)}。它们不计入 CAS 尺寸分布。`}
                </XDriveStatusAlert>
              )}

              <Stack spacing={1}>
                <SectionTitle>CAS Blob 尺寸分布</SectionTitle>
                <Typography variant="body2" color="text.secondary">
                  区间按 [下界, 上界) 统计，用于判断后续 CDC 与 small-file packing 的实际收益。
                </Typography>
                <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
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
                          <TableCell align="right">{formatSize(bucket.bytes)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                生成时间：{new Date(stats.generated_at).toLocaleString()}
              </Typography>
            </Stack>
          )}
      </WorkspaceSurface>

      <Dialog
        open={cleanupConfirmOpen}
        onClose={() => {
          if (!cleanupLoading) setCleanupConfirmOpen(false)
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="清理可回收上传临时数据？"
          onClose={() => setCleanupConfirmOpen(false)}
          closeDisabled={cleanupLoading}
        />
        <XDriveDialogContent>
          <Stack spacing={2}>
            <Typography variant="body2">
              将清理过期 UploadSession，以及超过 1 小时且数据库没有任何引用的 orphan staging 文件。近期未登记文件不会删除。
            </Typography>
            {staging && (
              <XDriveStatusAlert
                tone="warning"
                title={`预计可回收 ${staging.stats.reclaimable_files.toLocaleString()} 个临时文件 / ${formatSize(staging.stats.reclaimable_bytes)}`}
              >
                另有 {staging.stats.expired_sessions.toLocaleString()} 个过期 UploadSession 将被回收。
              </XDriveStatusAlert>
            )}
          </Stack>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton disabled={cleanupLoading} onClick={() => setCleanupConfirmOpen(false)}>取消</XDriveActionButton>
          <XDriveActionButton
            intent="danger"
            loading={cleanupLoading}
            loadingLabel="正在清理…"
            onClick={() => void cleanupStaging()}
          >
            确认清理
          </XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

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
