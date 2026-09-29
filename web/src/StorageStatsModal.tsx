import { useEffect, useState } from 'react'
import { Alert, Button, Col, Modal, Row, Space, Statistic, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Accordion, AccordionDetails, AccordionSummary, Chip, Stack, Typography as MuiTypography } from '@mui/material'
import { XDriveStatusBadge } from '@xdrive/ui/mui'
import type {
  StorageDecision,
  StorageHealth,
  StorageHistory,
  StorageHistoryPoint,
  StorageSizeBucket,
  StorageStats,
  StagingCleanupFailure,
  StagingCleanupRun,
  UploadStagingDetail,
  UploadStagingFile,
} from '../../ui/shared/src'
import { formatSize } from '../../ui/shared/src'
import type { XDriveApi } from './api'

const columns: ColumnsType<StorageSizeBucket> = [
  { title: 'Blob 大小', dataIndex: 'label', key: 'label' },
  { title: '数量', dataIndex: 'count', key: 'count', align: 'right', render: (value: number) => value.toLocaleString() },
  { title: '物理容量', dataIndex: 'bytes', key: 'bytes', align: 'right', render: (value: number) => formatSize(value) },
]

const stagingColumns: ColumnsType<UploadStagingFile> = [
  { title: 'Staging 文件', dataIndex: 'key', key: 'key', ellipsis: true },
  { title: '大小', dataIndex: 'size', key: 'size', align: 'right', width: 120, render: (value: number) => formatSize(value) },
  { title: '最后修改', dataIndex: 'modified_at', key: 'modified_at', width: 190, render: (value: string) => new Date(value).toLocaleString() },
]

const STAGING_PAGE_SIZE = 20

const historyColumns: ColumnsType<StorageHistoryPoint> = [
  {
    title: '时间',
    dataIndex: 'slot_at',
    key: 'slot_at',
    render: (value: string) => new Date(value).toLocaleString(),
  },
  {
    title: 'CAS Blob',
    dataIndex: 'cas_blob_count',
    key: 'cas_blob_count',
    align: 'right',
    render: (value: number) => value.toLocaleString(),
  },
  {
    title: '物理容量',
    dataIndex: 'cas_physical_bytes',
    key: 'cas_physical_bytes',
    align: 'right',
    render: (value: number) => formatSize(value),
  },
  {
    title: '逻辑容量',
    dataIndex: 'cas_logical_referenced_bytes',
    key: 'cas_logical_referenced_bytes',
    align: 'right',
    render: (value: number) => formatSize(value),
  },
  {
    title: '去重倍率',
    dataIndex: 'cas_dedup_ratio',
    key: 'cas_dedup_ratio',
    align: 'right',
    render: (value: number) => `${value.toFixed(2)}×`,
  },
  {
    title: '<64 KiB 数量',
    dataIndex: 'small_lt64_kib_count_share',
    key: 'small_lt64_kib_count_share',
    align: 'right',
    render: (value: number) => `${(value * 100).toFixed(1)}%`,
  },
  {
    title: '≥16 MiB 字节',
    dataIndex: 'large_ge16_mib_byte_share',
    key: 'large_ge16_mib_byte_share',
    align: 'right',
    render: (value: number) => `${(value * 100).toFixed(1)}%`,
  },
]

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

function decisionType(decision: StorageDecision): 'info' | 'success' | 'warning' {
  if (decision.priority === 'collecting') return 'info'
  if (decision.priority === 'observe') return 'info'
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

export default function StorageStatsModal({
  api,
  scope,
  open,
  onClose,
}: {
  api: XDriveApi
  scope: 'self' | 'global'
  open: boolean
  onClose: () => void
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
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
  }, [api, open, scope])

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
    <Modal
      title={scope === 'global' ? '全局存储统计' : '我的存储统计'}
      open={open}
      onCancel={onClose}
      footer={null}
      width={1040}
      destroyOnClose
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {stats && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {scope === 'global' && health && (
            <Alert
              type={health.status === 'fail' ? 'error' : health.status === 'warning' ? 'warning' : 'success'}
              showIcon
              message={health.status === 'fail' ? 'CAS 元数据存在一致性问题' : health.status === 'warning' ? 'CAS 元数据正常，但垃圾回收有积压' : 'CAS 元数据健康'}
              description={
                `ready ${health.ready_blobs.toLocaleString()} · deleting ${health.deleting_blobs.toLocaleString()} · stale ${health.stale_deleting_blobs.toLocaleString()} · missing metadata ${health.missing_metadata.toLocaleString()} · refcount drift ${health.refcount_mismatches.toLocaleString()} · state drift ${health.state_mismatches.toLocaleString()} · size drift ${health.size_mismatches.toLocaleString()} · key/hash drift ${health.key_hash_mismatches.toLocaleString()} · invalid state ${health.invalid_states.toLocaleString()}`
              }
            />
          )}

          {scope === 'global' &&
            stats.disk_total_bytes !== undefined &&
            stats.disk_used_bytes !== undefined &&
            stats.disk_available_bytes !== undefined &&
            stats.xdrive_physical_bytes !== undefined && (
              <>
                <Typography.Title level={5} style={{ margin: 0 }}>磁盘容量</Typography.Title>
                <Row gutter={[16, 16]}>
                  <Col xs={12} md={6}><Statistic title="磁盘总容量" value={formatSize(stats.disk_total_bytes)} /></Col>
                  <Col xs={12} md={6}><Statistic title="磁盘已用" value={formatSize(stats.disk_used_bytes)} /></Col>
                  <Col xs={12} md={6}><Statistic title="磁盘可用" value={formatSize(stats.disk_available_bytes)} /></Col>
                  <Col xs={12} md={6}><Statistic title="xDrive 物理占用" value={formatSize(stats.xdrive_physical_bytes)} /></Col>
                  {otherDiskUsed !== undefined && (
                    <Col xs={12} md={6}><Statistic title="非 xDrive 占用（估算）" value={formatSize(otherDiskUsed)} /></Col>
                  )}
                </Row>
              </>
            )}

          {scope === 'global' && staging && (
            <>
              <Typography.Title level={5} style={{ margin: 0 }}>上传临时空间</Typography.Title>
              {stagingNotice && <Alert type="success" showIcon message={stagingNotice} />}
              {!staging.stats.supported && (
                <Alert type="info" showIcon message="当前存储后端不支持 staging 文件系统扫描，仅显示数据库侧会话信息。" />
              )}
              {(staging.stats.orphan_files > 0 || staging.stats.missing_part_files > 0 || staging.stats.recent_untracked_files > 0) && (
                <Alert
                  type={staging.stats.missing_part_files > 0 || staging.stats.orphan_files > 0 ? 'warning' : 'info'}
                  showIcon
                  message={
                    'orphan ' + staging.stats.orphan_files.toLocaleString() +
                    ' · 近期未登记 ' + staging.stats.recent_untracked_files.toLocaleString() +
                    ' · 缺失 part ' + staging.stats.missing_part_files.toLocaleString()
                  }
                  description="只有数据库无引用且超过 1 小时的临时文件才会作为 orphan 清理；近期未登记文件不会删除。"
                />
              )}
              <Row gutter={[16, 16]}>
                <Col xs={12} md={6}><Statistic title="活跃 Upload Session" value={staging.stats.active_sessions} /></Col>
                <Col xs={12} md={6}><Statistic title="容量 Reservation" value={formatSize(staging.stats.reserved_bytes)} /></Col>
                <Col xs={12} md={6}><Statistic title="Staging 实际占用" value={formatSize(staging.stats.staging_bytes)} /></Col>
                <Col xs={12} md={6}><Statistic title="Staging 文件" value={staging.stats.staging_files} /></Col>
                <Col xs={12} md={6}><Statistic title="已登记 Part" value={staging.stats.part_files} suffix={'/ ' + formatSize(staging.stats.part_bytes)} /></Col>
                <Col xs={12} md={6}><Statistic title="近期未登记" value={staging.stats.recent_untracked_files} suffix={'/ ' + formatSize(staging.stats.recent_untracked_bytes)} /></Col>
                <Col xs={12} md={6}><Statistic title="可回收临时空间" value={formatSize(staging.stats.reclaimable_bytes)} /></Col>
                <Col xs={12} md={6}><Statistic title="Orphan" value={staging.stats.orphan_files} suffix={'/ ' + formatSize(staging.stats.orphan_bytes)} /></Col>
                <Col xs={12} md={6}><Statistic title="过期 Session" value={staging.stats.expired_sessions} /></Col>
                <Col xs={12} md={6}><Statistic title="缺失 Part" value={staging.stats.missing_part_files} suffix={'/ ' + formatSize(staging.stats.missing_part_bytes)} /></Col>
              </Row>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Reservation 表示活跃 resumable 上传未来仍可能需要写入的峰值空间，不等于当前物理占用；Staging 实际占用已计入 xDrive 物理占用。
              </Typography.Paragraph>
              <Space wrap>
                <Button loading={stagingLoading} onClick={() => void loadStagingPage(1, true)}>刷新 staging</Button>
                <Button
                  danger
                  loading={cleanupLoading}
                  disabled={staging.stats.reclaimable_files <= 0 && staging.stats.expired_sessions <= 0}
                  onClick={() => setCleanupConfirmOpen(true)}
                >
                  清理可回收临时数据
                </Button>
              </Space>
              {staging.orphans.length > 0 && (
                <div>
                  <Typography.Title level={5}>Orphan staging</Typography.Title>
                  <Table<UploadStagingFile>
                    rowKey="key"
                    size="small"
                    dataSource={staging.orphans}
                    columns={stagingColumns}
                    pagination={false}
                    loading={stagingLoading}
                    scroll={{ x: 680 }}
                  />
                  <Space style={{ marginTop: 12 }}>
                    <Button size="small" disabled={stagingLoading || stagingPage <= 1} onClick={() => void loadStagingPage(stagingPage - 1)}>上一页</Button>
                    <Typography.Text type="secondary">第 {stagingPage} 页 · 每页 {STAGING_PAGE_SIZE} 条</Typography.Text>
                    <Button size="small" disabled={stagingLoading || !staging.has_more} onClick={() => void loadStagingPage(stagingPage + 1)}>下一页</Button>
                  </Space>
                </div>
              )}
            </>
          )}

          {scope === 'global' && cleanupRuns.length > 0 && (
            <>
              <Typography.Title level={5} style={{ margin: 0 }}>最近 staging 清理</Typography.Title>
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
                        <MuiTypography variant="body2" sx={{ fontWeight: 600 }}>
                          {new Date(run.started_at).toLocaleString()}
                        </MuiTypography>
                        <Chip
                          size="small"
                          label={run.trigger === 'manual' ? '手动' : '自动'}
                          variant="outlined"
                        />
                        <XDriveStatusBadge
                          tone={run.status === 'success' ? 'good' : run.status === 'partial' ? 'warning' : 'bad'}
                          label={run.status === 'success' ? '成功' : run.status === 'partial' ? '部分失败' : '失败'}
                        />
                        <MuiTypography variant="body2" color="text.secondary">
                          删除 {run.deleted_files.toLocaleString()} 个 / {formatSize(run.deleted_bytes)}
                          {run.failed_files > 0 ? ` · 失败 ${run.failed_files.toLocaleString()} 个` : ''}
                        </MuiTypography>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      {run.error && (
                        <MuiTypography variant="body2" color="error" sx={{ mb: 1 }}>
                          {run.error}
                        </MuiTypography>
                      )}
                      {run.failed_files <= 0 ? (
                        <MuiTypography variant="body2" color="text.secondary">本次没有文件级失败。</MuiTypography>
                      ) : cleanupFailureLoading === run.id && cleanupFailures[run.id] === undefined ? (
                        <MuiTypography variant="body2" color="text.secondary">正在加载失败文件…</MuiTypography>
                      ) : (
                        <Stack spacing={1}>
                          {(cleanupFailures[run.id] ?? []).map((failure) => (
                            <div key={failure.id}>
                              <MuiTypography variant="body2" sx={{ wordBreak: 'break-all' }}>
                                {failure.storage_key} · {formatSize(failure.size)}
                              </MuiTypography>
                              <MuiTypography variant="caption" color="error" sx={{ wordBreak: 'break-word' }}>
                                {failure.error}
                              </MuiTypography>
                            </div>
                          ))}
                          {(cleanupFailures[run.id]?.length ?? 0) < run.failed_files && (
                            <MuiTypography variant="caption" color="text.secondary">
                              当前显示前 {cleanupFailures[run.id]?.length ?? 0} 条，完整失败数量为 {run.failed_files.toLocaleString()}。
                            </MuiTypography>
                          )}
                        </Stack>
                      )}
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Stack>
            </>
          )}

          {scope === 'global' && history && (
            <>
              <Alert
                type={decisionType(history.decision)}
                showIcon
                message={decisionMessage(history.decision)}
                description={decisionDescription(history.decision)}
              />
              <Row gutter={[16, 16]}>
                <Col xs={12} md={6}>
                  <Statistic title="历史样本" value={history.samples.length} suffix={`/ ${history.retention_days} 天`} />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic
                    title="窗口内物理容量变化"
                    value={firstHistory && lastHistory ? signedSize(lastHistory.cas_physical_bytes - firstHistory.cas_physical_bytes) : '—'}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic
                    title="窗口内逻辑容量变化"
                    value={firstHistory && lastHistory ? signedSize(lastHistory.cas_logical_referenced_bytes - firstHistory.cas_logical_referenced_bytes) : '—'}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic
                    title="最新去重倍率"
                    value={lastHistory ? `${lastHistory.cas_dedup_ratio.toFixed(2)}×` : '—'}
                  />
                </Col>
              </Row>
              <div>
                <Typography.Title level={5} style={{ marginTop: 0 }}>历史趋势</Typography.Title>
                <Typography.Paragraph type="secondary">
                  每 {history.sampling_interval_hours} 小时记录一次，保留 {history.retention_days} 天。下表显示最近 12 个快照。
                </Typography.Paragraph>
                <Table<StorageHistoryPoint>
                  rowKey="slot_at"
                  size="small"
                  dataSource={history.samples.slice(-12).reverse()}
                  columns={historyColumns}
                  pagination={false}
                  scroll={{ x: 920 }}
                />
              </div>
            </>
          )}

          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}><Statistic title="CAS Blob" value={stats.cas_blob_count} /></Col>
            <Col xs={12} md={6}><Statistic title="CAS 物理容量" value={formatSize(stats.cas_physical_bytes)} /></Col>
            <Col xs={12} md={6}><Statistic title="逻辑引用容量" value={formatSize(stats.cas_logical_referenced_bytes)} /></Col>
            <Col xs={12} md={6}><Statistic title="去重节省" value={formatSize(stats.cas_dedup_saved_bytes)} /></Col>
            <Col xs={12} md={6}><Statistic title="去重倍率" value={`${stats.cas_dedup_ratio.toFixed(2)}×`} /></Col>
            <Col xs={12} md={6}><Statistic title="节省比例" value={`${(stats.cas_savings_ratio * 100).toFixed(1)}%`} /></Col>
            <Col xs={12} md={6}><Statistic title="平均 Blob" value={formatSize(stats.average_blob_size_bytes)} /></Col>
            <Col xs={12} md={6}><Statistic title="P50 / P90 / P99" value={`${formatSize(stats.p50_blob_size_bytes)} / ${formatSize(stats.p90_blob_size_bytes)} / ${formatSize(stats.p99_blob_size_bytes)}`} /></Col>
          </Row>

          {stats.legacy_blob_count > 0 && (
            <Alert
              type="info"
              showIcon
              message={`仍有 ${stats.legacy_blob_count.toLocaleString()} 个 legacy 对象，共 ${formatSize(stats.legacy_physical_bytes)}。它们不计入 CAS 尺寸分布。`}
            />
          )}

          <div>
            <Typography.Title level={5} style={{ marginTop: 0 }}>CAS Blob 尺寸分布</Typography.Title>
            <Typography.Paragraph type="secondary">
              区间按 [下界, 上界) 统计，用于判断后续 CDC 与 small-file packing 的实际收益。
            </Typography.Paragraph>
            <Table<StorageSizeBucket>
              rowKey="key"
              size="small"
              loading={loading}
              dataSource={stats.buckets}
              columns={columns}
              pagination={false}
            />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            生成时间：{new Date(stats.generated_at).toLocaleString()}
          </Typography.Text>
        </Space>
      )}
      {!stats && !error && <Table loading={loading} dataSource={[]} columns={columns} pagination={false} />}
    </Modal>

    <Modal
      title="清理可回收上传临时数据？"
      open={cleanupConfirmOpen}
      onCancel={() => !cleanupLoading && setCleanupConfirmOpen(false)}
      closable={!cleanupLoading}
      maskClosable={!cleanupLoading}
      footer={[
        <Button key="cancel" disabled={cleanupLoading} onClick={() => setCleanupConfirmOpen(false)}>取消</Button>,
        <Button key="cleanup" type="primary" danger loading={cleanupLoading} onClick={() => void cleanupStaging()}>
          确认清理
        </Button>,
      ]}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          将清理过期 UploadSession，以及超过 1 小时且数据库没有任何引用的 orphan staging 文件。
          近期未登记文件不会删除。
        </Typography.Paragraph>
        {staging && (
          <Alert
            type="warning"
            showIcon
            message={`预计可回收 ${staging.stats.reclaimable_files.toLocaleString()} 个临时文件 / ${formatSize(staging.stats.reclaimable_bytes)}`}
            description={`另有 ${staging.stats.expired_sessions.toLocaleString()} 个过期 UploadSession 将被回收。`}
          />
        )}
      </Space>
    </Modal>

    <Modal
      title="staging 清理部分完成"
      open={!!cleanupResultWarning}
      onCancel={() => setCleanupResultWarning('')}
      footer={<Button type="primary" onClick={() => setCleanupResultWarning('')}>知道了</Button>}
    >
      <Alert type="warning" showIcon message={cleanupResultWarning} />
    </Modal>

    <Modal
      title="清理 staging 失败"
      open={!!cleanupActionError}
      onCancel={() => setCleanupActionError('')}
      footer={<Button type="primary" onClick={() => setCleanupActionError('')}>知道了</Button>}
    >
      <Typography.Text type="danger">{cleanupActionError}</Typography.Text>
    </Modal>
    </>
  )
}
