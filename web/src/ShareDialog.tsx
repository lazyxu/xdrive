import { useCallback, useEffect, useState } from 'react'
import { CopyOutlined, DeleteOutlined, LinkOutlined, LockOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, InputNumber, Modal, Space, Table, Tag, Typography, message } from 'antd'
import type { XDriveApi } from './api'
import type { FileShare, Node } from '../../ui/shared/src'

type ShareFormValues = {
  expiresAt?: string
  password?: string
  maxDownloads?: number
}

function defaultExpiryInput() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function statusTag(status: FileShare['status']) {
  switch (status) {
    case 'active': return <Tag color="green">Active</Tag>
    case 'expired': return <Tag>Expired</Tag>
    case 'exhausted': return <Tag color="orange">Limit reached</Tag>
    case 'revoked': return <Tag color="red">Revoked</Tag>
  }
}

export default function ShareDialog({
  api,
  node,
  onClose,
  onError,
}: {
  api: XDriveApi
  node: Node | null
  onClose: () => void
  onError: (error: unknown) => void
}) {
  const [form] = Form.useForm<ShareFormValues>()
  const [shares, setShares] = useState<FileShare[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createdLink, setCreatedLink] = useState('')

  const load = useCallback(async () => {
    if (!node) return
    setLoading(true)
    try {
      setShares(await api.shares(node.id))
    } catch (err) {
      onError(err)
    } finally {
      setLoading(false)
    }
  }, [api, node, onError])

  useEffect(() => {
    if (!node) return
    setCreatedLink('')
    form.resetFields()
    form.setFieldsValue({
      expiresAt: defaultExpiryInput(),
      password: '',
      maxDownloads: 0,
    })
  }, [form, node?.id])

  useEffect(() => {
    if (!node) return
    void load()
  }, [load, node])

  const create = async (values: ShareFormValues) => {
    if (!node) return
    let expiresAt: string | undefined
    if (values.expiresAt) {
      const parsed = new Date(values.expiresAt)
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        message.error('Expiration must be in the future')
        return
      }
      expiresAt = parsed.toISOString()
    }

    setCreating(true)
    try {
      const created = await api.createShare(node.id, {
        expires_at: expiresAt,
        password: values.password || '',
        max_downloads: values.maxDownloads || 0,
      })
      setCreatedLink(`${window.location.origin}/#/s/${created.token}`)
      message.success('Share link created')
      await load()
    } catch (err) {
      onError(err)
    } finally {
      setCreating(false)
    }
  }

  const copyCreatedLink = async () => {
    if (!createdLink) return
    try {
      await navigator.clipboard.writeText(createdLink)
      message.success('Share link copied')
    } catch {
      message.error('Could not copy automatically. Copy the link manually.')
    }
  }

  return (
    <Modal
      title={node ? `Share — ${node.name}` : 'Share'}
      open={!!node}
      onCancel={onClose}
      footer={null}
      width={940}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        message="Share tokens are shown only once"
        description="xDrive stores only a one-way token hash. Copy a newly created link now; existing links can be revoked but cannot be revealed again."
        style={{ marginBottom: 18 }}
      />

      {createdLink && (
        <Space.Compact style={{ width: '100%', marginBottom: 18 }}>
          <Input value={createdLink} readOnly prefix={<LinkOutlined />} />
          <Button icon={<CopyOutlined />} onClick={() => void copyCreatedLink()}>Copy</Button>
        </Space.Compact>
      )}

      <Typography.Title level={5}>Create a download link</Typography.Title>
      <Form form={form} layout="vertical" onFinish={create}>
        <Space align="start" wrap>
          <Form.Item name="expiresAt" label="Expires">
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="maxDownloads" label="Maximum downloads" extra="0 means unlimited">
            <InputNumber min={0} precision={0} style={{ width: 180 }} />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password (optional)"
            rules={[{
              validator: async (_, value?: string) => {
                if (!value || value.length >= 8) return
                throw new Error('Use at least 8 characters')
              },
            }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
          </Form.Item>
        </Space>
        <Button type="primary" htmlType="submit" loading={creating} icon={<LinkOutlined />}>
          Create share link
        </Button>
      </Form>

      <Typography.Title level={5} style={{ marginTop: 24 }}>Existing shares</Typography.Title>
      <Table<FileShare>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={shares}
        pagination={false}
        locale={{ emptyText: 'No share links for this file' }}
        columns={[
          {
            title: 'Created',
            dataIndex: 'created_at',
            width: 190,
            render: (value: string) => new Date(value).toLocaleString(),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 130,
            render: (value: FileShare['status']) => statusTag(value),
          },
          {
            title: 'Protection',
            dataIndex: 'has_password',
            width: 120,
            render: (value: boolean) => value ? 'Password' : 'Link only',
          },
          {
            title: 'Expires',
            dataIndex: 'expires_at',
            width: 190,
            render: (value?: string) => value ? new Date(value).toLocaleString() : 'Never',
          },
          {
            title: 'Downloads',
            width: 140,
            render: (_, share) => share.max_downloads > 0
              ? `${share.download_count} / ${share.max_downloads}`
              : `${share.download_count} / unlimited`,
          },
          {
            title: '',
            width: 100,
            align: 'right',
            render: (_, share) => (
              <Button
                danger
                type="text"
                icon={<DeleteOutlined />}
                disabled={share.status === 'revoked'}
                onClick={async () => {
                  try {
                    await api.revokeShare(share.id)
                    message.success('Share revoked')
                    await load()
                  } catch (err) {
                    onError(err)
                  }
                }}
              >
                Revoke
              </Button>
            ),
          },
        ]}
      />
    </Modal>
  )
}
