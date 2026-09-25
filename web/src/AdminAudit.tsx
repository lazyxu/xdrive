import { useEffect, useState } from 'react'
import { Button, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { XDriveApi } from './api'
import type { AuditEvent } from '../../ui/shared/src'

const ACTION_OPTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.password.change',
  'admin.user.create',
  'admin.user.role_change',
  'admin.user.disable',
  'admin.user.enable',
  'admin.user.quota_change',
  'admin.user.password_reset',
  'admin.user.sessions_revoke',
  'admin.user.delete',
  'file.permanent_delete',
  'file.version_restore',
  'system.backup',
  'system.restore',
  'system.update',
]

function metadataText(metadata?: Record<string, unknown>) {
  if (!metadata || Object.keys(metadata).length === 0) return '—'
  return JSON.stringify(metadata)
}

export default function AdminAuditPanel({
  api,
  open,
  onClose,
}: {
  api: XDriveApi
  open: boolean
  onClose: () => void
}) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState<string>()
  const [result, setResult] = useState<'success' | 'failure'>()
  const [actor, setActor] = useState('')
  const [hasMore, setHasMore] = useState(false)

  type Filters = {
    action?: string
    result?: 'success' | 'failure'
    actor?: string
  }

  const load = async (reset = true, filters: Filters = { action, result, actor }) => {
    setLoading(true)
    try {
      const batch = await api.adminAudit({
        limit: 100,
        before_id: reset ? undefined : events.at(-1)?.id,
        action: filters.action,
        result: filters.result,
        actor: filters.actor?.trim() || undefined,
      })
      setEvents((current) => reset ? batch : [...current, ...batch])
      setHasMore(batch.length === 100)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载审计日志失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load(true)
    // Filters are applied explicitly with the Apply button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const columns: ColumnsType<AuditEvent> = [
    {
      title: '时间',
      width: 190,
      render: (_, event) => new Date(event.created_at).toLocaleString(),
    },
    {
      title: '操作者',
      width: 150,
      render: (_, event) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{event.actor_username || '匿名'}</Typography.Text>
          {event.actor_role && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{event.actor_role}</Typography.Text>}
        </Space>
      ),
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 220,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: '目标',
      width: 190,
      render: (_, event) => {
        const label = event.target_label || event.target_id || '—'
        const suffix = event.target_label && event.target_id ? ' · ' + event.target_id : ''
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{label}{suffix}</Typography.Text>
            {event.target_type && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{event.target_type}</Typography.Text>}
          </Space>
        )
      },
    },
    {
      title: '结果',
      dataIndex: 'result',
      width: 100,
      render: (value: AuditEvent['result']) => (
        <Tag color={value === 'success' ? 'green' : 'red'}>{value === 'success' ? '成功' : '失败'}</Tag>
      ),
    },
    {
      title: '来源',
      width: 220,
      render: (_, event) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{event.ip_address || '—'}</Typography.Text>
          {event.request_id && (
            <Typography.Text type="secondary" ellipsis={{ tooltip: event.request_id }} style={{ maxWidth: 200, fontSize: 12 }}>
              {event.request_id}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '详情',
      render: (_, event) => (
        <Typography.Text
          type="secondary"
          ellipsis={{ tooltip: metadataText(event.metadata) }}
          style={{ maxWidth: 360 }}
        >
          {metadataText(event.metadata)}
        </Typography.Text>
      ),
    },
  ]

  return (
    <Modal
      title="审计日志"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1450}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap>
          <Select
            allowClear
            showSearch
            placeholder="操作"
            style={{ width: 260 }}
            value={action}
            onChange={(value) => setAction(value)}
            options={ACTION_OPTIONS.map((value) => ({ value, label: value }))}
          />
          <Select
            allowClear
            placeholder="结果"
            style={{ width: 140 }}
            value={result}
            onChange={(value?: 'success' | 'failure') => setResult(value)}
            options={[
              { value: 'success', label: '成功' },
              { value: 'failure', label: '失败' },
            ]}
          />
          <Input
            allowClear
            placeholder="操作者用户名"
            style={{ width: 220 }}
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            onPressEnter={() => void load(true)}
          />
          <Button type="primary" onClick={() => void load(true)}>应用</Button>
          <Button onClick={() => {
            const cleared: Filters = { action: undefined, result: undefined, actor: '' }
            setAction(undefined)
            setResult(undefined)
            setActor('')
            void load(true, cleared)
          }}>
            清除
          </Button>
        </Space>

        <Table<AuditEvent>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={events}
          columns={columns}
          pagination={false}
          scroll={{ x: 1300 }}
          locale={{ emptyText: '未找到审计事件' }}
        />

        {hasMore && (
          <div style={{ textAlign: 'center' }}>
            <Button loading={loading} onClick={() => void load(false)}>加载更早记录</Button>
          </div>
        )}
      </Space>
    </Modal>
  )
}
