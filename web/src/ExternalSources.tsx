import { useCallback, useEffect, useState } from 'react'
import { ReloadOutlined } from '@ant-design/icons'
import { Badge, Button, Card, Empty, Modal, Space, Spin, Typography } from 'antd'
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

  return (
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
                </Card>
              )
            })}
          </div>
        )}
      </Spin>
    </Modal>
  )
}
