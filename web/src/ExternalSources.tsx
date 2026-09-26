import { useCallback, useEffect, useState } from 'react'
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Badge, Button, Card, Descriptions, Divider, Empty, Modal, Space, Spin, Typography } from 'antd'
import type { BadgeProps } from 'antd'
import type {
  ExternalSource,
  ExternalSourceCredentialStatus,
  ExternalSourceRun,
  XDriveApi,
} from './api'
import { formatSize } from '../../ui/shared/src'

type SourceRow = {
  source: ExternalSource
  latestRun?: ExternalSourceRun
  credential?: ExternalSourceCredentialStatus
}

function sourceStatus(row: SourceRow): { status: BadgeProps['status']; text: string } {
  const { source, latestRun, credential } = row
  if (source.status === 'paused') return { status: 'default', text: '已暂停' }
  if (latestRun?.status === 'running') return { status: 'processing', text: '运行中' }
  if (source.last_error) return { status: 'error', text: '异常' }
  if (source.kind === 'yike_photos') {
    return credential?.configured
      ? { status: 'success', text: 'Cookie 已配置' }
      : { status: 'warning', text: 'Cookie 未配置' }
  }
  if (source.last_success_at) return { status: 'success', text: '正常' }
  if (latestRun?.status === 'partial') return { status: 'warning', text: '部分完成' }
  return { status: 'default', text: '尚未运行' }
}

function formatRunTime(value?: string) {
  if (!value) return '尚无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚无记录'

  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((day.getTime() - targetDay.getTime()) / 86_400_000)
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  if (diffDays === 0) return `今天 ${time}`
  if (diffDays === 1) return `昨天 ${time}`
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function sourceMode(source: ExternalSource) {
  const direction = source.direction === 'push' ? 'Push' : 'Pull'
  const mode = source.run_mode === 'scan' ? '仅扫描' : '同步'
  return `${direction} · ${mode}`
}

function sourceKind(kind: string) {
  if (kind === 'synology_photos') return '群晖 Photos'
  if (kind === 'yike_photos') return '一刻相册'
  return kind
}

export default function ExternalSourcesPanel({
  open,
  api,
  onClose,
  onError,
}: {
  open: boolean
  api: XDriveApi
  onClose: () => void
  onError: (error: unknown) => void
}) {
  const [rows, setRows] = useState<SourceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<SourceRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sources = await api.sources()
      const next = await Promise.all(sources.map(async (source) => {
        const [runs, credential] = await Promise.all([
          api.sourceRuns(source.id, 1),
          source.kind === 'yike_photos'
            ? api.sourceCredentialStatus(source.id)
            : Promise.resolve(undefined),
        ])
        return { source, latestRun: runs[0], credential }
      }))
      setRows(next)
    } catch (error) {
      onError(error)
    } finally {
      setLoading(false)
    }
  }, [api, onError])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const selectedState = selected ? sourceStatus(selected) : null

  return (
    <>
      <Modal title="外部来源" open={open} onCancel={onClose} footer={null} width={760}>
      <div className="external-sources-toolbar">
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
      </div>
      <Spin spinning={loading && rows.length === 0}>
        {rows.length === 0 && !loading ? (
          <Empty className="external-source-empty" description="尚未添加外部来源" />
        ) : (
          <div className="external-source-list">
            {rows.map((row) => {
              const state = sourceStatus(row)
              const timeLabel = row.source.run_mode === 'scan' ? '上次扫描' : '上次成功'
              const timeValue = row.source.run_mode === 'scan'
                ? row.source.last_run_at
                : row.source.last_success_at
              const stats = row.latestRun
                ? `${row.latestRun.scanned_items.toLocaleString('zh-CN')} 项 · ${formatSize(row.latestRun.scanned_bytes)}`
                : '尚无扫描统计'

              return (
                <Card key={row.source.id} size="small" className="external-source-card">
                  <div className="external-source-card-header">
                    <div>
                      <Typography.Title level={4} style={{ margin: 0 }}>{row.source.name}</Typography.Title>
                      <div className="external-source-subtitle">{sourceMode(row.source)}</div>
                    </div>
                    <Badge status={state.status} text={state.text} />
                  </div>
                  <div className="external-source-time">{timeLabel}：{formatRunTime(timeValue)}</div>
                  <div className="external-source-card-meta">
                    <div className="external-source-stats">{stats}</div>
                    {row.source.last_error && (
                      <Space size={4}>
                        <Typography.Text type="danger" ellipsis={{ tooltip: row.source.last_error }} style={{ maxWidth: 360 }}>
                          {row.source.last_error}
                        </Typography.Text>
                      </Space>
                    )}
                  </div>
                  <div className="external-source-actions">
                    <Button size="small" onClick={() => setSelected(row)}>查看</Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </Spin>
      </Modal>

      <Modal
        title={selected ? `${selected.source.name} · 来源详情` : '来源详情'}
        open={!!selected}
        onCancel={() => setSelected(null)}
        footer={null}
        width={720}
      >
        {selected && selectedState && (
          <>
            {selected.source.last_error && (
              <Alert
                type="error"
                showIcon
                message="最近一次运行异常"
                description={selected.source.last_error}
                style={{ marginBottom: 16 }}
              />
            )}
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="来源类型">{sourceKind(selected.source.kind)}</Descriptions.Item>
              <Descriptions.Item label="工作方式">{sourceMode(selected.source)}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge status={selectedState.status} text={selectedState.text} />
              </Descriptions.Item>
              <Descriptions.Item label="目标目录">
                {selected.source.target_node_id ? `节点 #${selected.source.target_node_id}` : '未配置'}
              </Descriptions.Item>
              <Descriptions.Item label="上次运行">{formatRunTime(selected.source.last_run_at)}</Descriptions.Item>
              <Descriptions.Item label="上次成功">{formatRunTime(selected.source.last_success_at)}</Descriptions.Item>
              {selected.source.kind === 'yike_photos' && (
                <Descriptions.Item label="Cookie">
                  {selected.credential?.configured ? '已配置' : '未配置'}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Divider orientation="left">最近一次运行</Divider>
            {selected.latestRun ? (
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="运行状态">{selected.latestRun.status}</Descriptions.Item>
                <Descriptions.Item label="开始时间">{formatRunTime(selected.latestRun.started_at)}</Descriptions.Item>
                <Descriptions.Item label="扫描">
                  {selected.latestRun.scanned_items.toLocaleString('zh-CN')} 项 · {formatSize(selected.latestRun.scanned_bytes)}
                </Descriptions.Item>
                <Descriptions.Item label="计划传输">
                  {selected.latestRun.planned_transfer_items.toLocaleString('zh-CN')} 项 · {formatSize(selected.latestRun.planned_transfer_bytes)}
                </Descriptions.Item>
                <Descriptions.Item label="新增">{selected.latestRun.new_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
                <Descriptions.Item label="变更">{selected.latestRun.changed_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
                <Descriptions.Item label="移动">{selected.latestRun.moved_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
                <Descriptions.Item label="缺失">{selected.latestRun.missing_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
                <Descriptions.Item label="实际传输">
                  {selected.latestRun.transferred_items.toLocaleString('zh-CN')} 项 · {formatSize(selected.latestRun.transferred_bytes)}
                </Descriptions.Item>
                <Descriptions.Item label="失败">{selected.latestRun.failed_items.toLocaleString('zh-CN')} 项</Descriptions.Item>
              </Descriptions>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无运行记录" />
            )}
          </>
        )}
      </Modal>
    </>
  )
}
