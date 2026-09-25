import { useEffect, useState } from 'react'
import { Alert, Col, Modal, Row, Space, Statistic, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type {
  StorageDecision,
  StorageHealth,
  StorageHistory,
  StorageHistoryPoint,
  StorageSizeBucket,
  StorageStats,
} from '../../ui/shared/src'
import { formatSize } from '../../ui/shared/src'
import type { XDriveApi } from './api'

const columns: ColumnsType<StorageSizeBucket> = [
  { title: 'Blob 大小', dataIndex: 'label', key: 'label' },
  { title: '数量', dataIndex: 'count', key: 'count', align: 'right', render: (value: number) => value.toLocaleString() },
  { title: '物理容量', dataIndex: 'bytes', key: 'bytes', align: 'right', render: (value: number) => formatSize(value) },
]

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
    const request = scope === 'global' ? api.adminStorageStats() : api.storageStats()
    const healthRequest = scope === 'global'
      ? api.adminStorageHealth().catch(() => null)
      : Promise.resolve(null)
    const historyRequest = scope === 'global'
      ? api.adminStorageHistory(30).catch(() => null)
      : Promise.resolve(null)
    void Promise.all([request, healthRequest, historyRequest])
      .then(([value, healthValue, historyValue]) => {
        if (!active) return
        setStats(value)
        setHealth(healthValue)
        setHistory(historyValue)
      })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '加载存储统计失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, open, scope])

  const firstHistory = history?.samples[0]
  const lastHistory = history?.samples[history.samples.length - 1]

  return (
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
  )
}
