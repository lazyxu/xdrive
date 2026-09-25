import { useEffect, useState } from 'react'
import { Alert, Col, Modal, Row, Space, Statistic, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { StorageSizeBucket, StorageStats } from '../../ui/shared/src'
import { formatSize } from '../../ui/shared/src'
import type { XDriveApi } from './api'

const columns: ColumnsType<StorageSizeBucket> = [
  { title: 'Blob 大小', dataIndex: 'label', key: 'label' },
  { title: '数量', dataIndex: 'count', key: 'count', align: 'right', render: (value: number) => value.toLocaleString() },
  { title: '物理容量', dataIndex: 'bytes', key: 'bytes', align: 'right', render: (value: number) => formatSize(value) },
]

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    setStats(null)
    const request = scope === 'global' ? api.adminStorageStats() : api.storageStats()
    void request
      .then((value) => { if (active) setStats(value) })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '加载存储统计失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, open, scope])

  return (
    <Modal
      title={scope === 'global' ? '全局存储统计' : '我的存储统计'}
      open={open}
      onCancel={onClose}
      footer={null}
      width={920}
      destroyOnClose
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {stats && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
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
