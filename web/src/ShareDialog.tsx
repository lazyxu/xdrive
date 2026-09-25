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
    case 'active': return <Tag color="green">有效</Tag>
    case 'expired': return <Tag>已过期</Tag>
    case 'exhausted': return <Tag color="orange">已达上限</Tag>
    case 'revoked': return <Tag color="red">已撤销</Tag>
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
        message.error('过期时间必须晚于当前时间')
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
      message.success('分享链接已创建')
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
      message.success('分享链接已复制')
    } catch {
      message.error('无法自动复制，请手动复制链接。')
    }
  }

  return (
    <Modal
      title={node ? `分享 — ${node.name}` : '分享'}
      open={!!node}
      onCancel={onClose}
      footer={null}
      width={940}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        message="分享令牌只显示一次"
        description="xDrive 只保存单向令牌哈希。请立即复制新创建的链接；已有链接可以撤销，但无法再次显示。"
        style={{ marginBottom: 18 }}
      />

      {createdLink && (
        <Space.Compact style={{ width: '100%', marginBottom: 18 }}>
          <Input value={createdLink} readOnly prefix={<LinkOutlined />} />
          <Button icon={<CopyOutlined />} onClick={() => void copyCreatedLink()}>复制</Button>
        </Space.Compact>
      )}

      <Typography.Title level={5}>创建下载链接</Typography.Title>
      <Form form={form} layout="vertical" onFinish={create}>
        <Space align="start" wrap>
          <Form.Item name="expiresAt" label="过期时间">
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="maxDownloads" label="最大下载次数" extra="0 表示不限">
            <InputNumber min={0} precision={0} style={{ width: 180 }} />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码（可选）"
            rules={[{
              validator: async (_, value?: string) => {
                if (!value || value.length >= 8) return
                throw new Error('至少需要 8 个字符')
              },
            }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
          </Form.Item>
        </Space>
        <Button type="primary" htmlType="submit" loading={creating} icon={<LinkOutlined />}>
          创建分享链接
        </Button>
      </Form>

      <Typography.Title level={5} style={{ marginTop: 24 }}>已有分享</Typography.Title>
      <Table<FileShare>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={shares}
        pagination={false}
        locale={{ emptyText: '此文件暂无分享链接' }}
        columns={[
          {
            title: '创建时间',
            dataIndex: 'created_at',
            width: 190,
            render: (value: string) => new Date(value).toLocaleString(),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 130,
            render: (value: FileShare['status']) => statusTag(value),
          },
          {
            title: '保护方式',
            dataIndex: 'has_password',
            width: 120,
            render: (value: boolean) => value ? '密码' : '仅链接',
          },
          {
            title: '过期时间',
            dataIndex: 'expires_at',
            width: 190,
            render: (value?: string) => value ? new Date(value).toLocaleString() : '永不过期',
          },
          {
            title: '下载次数',
            width: 140,
            render: (_, share) => share.max_downloads > 0
              ? `${share.download_count} / ${share.max_downloads}`
              : `${share.download_count} / 不限`,
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
                    message.success('分享已撤销')
                    await load()
                  } catch (err) {
                    onError(err)
                  }
                }}
              >
                撤销
              </Button>
            ),
          },
        ]}
      />
    </Modal>
  )
}
