import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { XDriveApi } from './api'
import type { AdminUser } from '../../ui/shared/src'
import { formatBinarySize as formatBytes } from '../../ui/shared/src'

type CreateForm = {
  username: string
  password: string
  role: 'user' | 'admin'
  must_change_password: boolean
  quota_gib: number
}

type QuotaForm = {
  quota_gib: number
}

type ResetForm = {
  password: string
  must_change_password: boolean
}

const GIB = 1024 ** 3

function quotaToGiB(bytes: number) {
  return bytes === 0 ? 0 : Number((bytes / GIB).toFixed(3))
}

function gibToBytes(gib: number) {
  return Math.round(Math.max(0, gib || 0) * GIB)
}

export default function AdminUsersPanel({
  api,
  open,
  currentUserID,
  onClose,
  onChanged,
}: {
  api: XDriveApi
  open: boolean
  currentUserID: number
  onClose: () => void
  onChanged: () => void
}) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [quotaUser, setQuotaUser] = useState<AdminUser | null>(null)
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [createForm] = Form.useForm<CreateForm>()
  const [quotaForm] = Form.useForm<QuotaForm>()
  const [resetForm] = Form.useForm<ResetForm>()

  const load = async () => {
    setLoading(true)
    try {
      setUsers(await api.adminUsers())
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
    // api is stable for one authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const updateUser = async (user: AdminUser, input: { role?: 'user' | 'admin'; disabled?: boolean; quota_bytes?: number }) => {
    try {
      await api.adminUpdateUser(user.id, input)
      await load()
      onChanged()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新用户失败')
    }
  }

  const columns: ColumnsType<AdminUser> = [
    {
      title: '用户',
      dataIndex: 'username',
      render: (_, user) => (
        <Space>
          <Typography.Text strong={user.id === currentUserID}>{user.username}</Typography.Text>
          {user.id === currentUserID && <Tag color="blue">当前用户</Tag>}
        </Space>
      ),
    },
    {
      title: '角色',
      width: 140,
      render: (_, user) => (
        <Select
          size="small"
          value={user.role}
          disabled={user.id === currentUserID}
          style={{ width: 110 }}
          options={[
            { value: 'user', label: '普通用户' },
            { value: 'admin', label: '管理员' },
          ]}
          onChange={(role: 'user' | 'admin') => void updateUser(user, { role })}
        />
      ),
    },
    {
      title: '启用',
      width: 100,
      render: (_, user) => (
        <Switch
          checked={!user.disabled}
          disabled={user.id === currentUserID}
          onChange={(enabled) => void updateUser(user, { disabled: !enabled })}
        />
      ),
    },
    {
      title: '密码',
      width: 150,
      render: (_, user) => user.must_change_password
        ? <Tag color="orange">需要修改</Tag>
        : <Tag color="green">已设置</Tag>,
    },
    {
      title: '存储',
      width: 270,
      render: (_, user) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>
            {formatBytes(user.physical_used_bytes)} / {user.quota_bytes === 0 ? '不限' : formatBytes(user.quota_bytes)}
            {user.over_quota && <Tag color="red" style={{ marginLeft: 8 }}>已超配额</Tag>}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            文件 {formatBytes(user.logical_file_bytes)} · 回收站 {formatBytes(user.trash_bytes)} · 历史版本 {formatBytes(user.history_bytes)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '上次登录',
      width: 190,
      render: (_, user) => user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '从未',
    },
    {
      title: '操作',
      width: 300,
      render: (_, user) => (
        <Space size="small" wrap>
          <Button size="small" onClick={() => {
            setQuotaUser(user)
            quotaForm.setFieldsValue({ quota_gib: quotaToGiB(user.quota_bytes) })
          }}>
            设置配额
          </Button>
          <Button size="small" onClick={() => {
            setResetUser(user)
            resetForm.setFieldsValue({ password: '', must_change_password: true })
          }}>
            重置密码
          </Button>
          <Popconfirm
            title="撤销全部会话？"
            description="该用户现有的 access token 和 refresh token 将立即失效。"
            onConfirm={async () => {
              try {
                await api.adminRevokeSessions(user.id)
                message.success('会话已撤销')
              } catch (err) {
                message.error(err instanceof Error ? err.message : '撤销会话失败')
              }
            }}
          >
            <Button size="small">撤销会话</Button>
          </Popconfirm>
          {user.id !== currentUserID && (
            <Popconfirm
              title={'永久删除 ' + user.username + '？'}
              description="该用户账户、元数据和已存储文件都将被永久删除。"
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                try {
                  await api.adminDeleteUser(user.id)
                  message.success('用户已删除')
                  await load()
                } catch (err) {
                  message.error(err instanceof Error ? err.message : '删除用户失败')
                }
              }}
            >
              <Button danger size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <>
      <Modal
        title="用户管理"
        open={open}
        onCancel={onClose}
        footer={null}
        width={1280}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Button type="primary" onClick={() => {
              createForm.setFieldsValue({
                username: '',
                password: '',
                role: 'user',
                must_change_password: true,
                quota_gib: 0,
              })
              setCreateOpen(true)
            }}>
              创建用户
            </Button>
          </div>
          <Table<AdminUser>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={users}
            columns={columns}
            pagination={false}
            scroll={{ x: 900 }}
          />
        </Space>
      </Modal>

      <Modal
        title="创建用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ role: 'user', must_change_password: true, quota_gib: 0 }}
          onFinish={async (values) => {
            try {
              const { quota_gib, ...account } = values
              await api.adminCreateUser({ ...account, quota_bytes: gibToBytes(quota_gib) })
              message.success('用户已创建')
              setCreateOpen(false)
              createForm.resetFields()
              await load()
            } catch (err) {
              message.error(err instanceof Error ? err.message : '创建用户失败')
            }
          }}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true }, { min: 3, max: 64 }]}>
            <Input autoFocus autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="临时密码" rules={[{ required: true }, { min: 8 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '管理员' }]} />
          </Form.Item>
          <Form.Item
            name="quota_gib"
            label="存储配额"
            extra="0 表示不限。当前文件、回收站内容和历史版本都会计入配额。"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} precision={3} step={1} addonAfter="GiB" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="must_change_password" valuePropName="checked">
            <Switch /> <span style={{ marginLeft: 8 }}>首次登录时要求修改密码</span>
          </Form.Item>
          <Button type="primary" htmlType="submit">创建</Button>
        </Form>
      </Modal>

      <Modal
        title={quotaUser ? '存储配额 — ' + quotaUser.username : '存储配额'}
        open={!!quotaUser}
        onCancel={() => setQuotaUser(null)}
        footer={null}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          0 GiB 表示不限。将配额降低到当前用量以下不会删除数据；在用量降到配额以下之前，新增占用空间的上传和覆盖写入会被阻止。
        </Typography.Paragraph>
        <Form
          form={quotaForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!quotaUser) return
            try {
              await api.adminUpdateUser(quotaUser.id, { quota_bytes: gibToBytes(values.quota_gib) })
              message.success('存储配额已更新')
              setQuotaUser(null)
              await load()
              onChanged()
            } catch (err) {
              message.error(err instanceof Error ? err.message : '更新存储配额失败')
            }
          }}
        >
          <Form.Item name="quota_gib" label="配额" rules={[{ required: true }]}>
            <InputNumber autoFocus min={0} precision={3} step={1} addonAfter="GiB" style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit">保存配额</Button>
        </Form>
      </Modal>

      <Modal
        title={resetUser ? '重置密码 — ' + resetUser.username : '重置密码'}
        open={!!resetUser}
        onCancel={() => setResetUser(null)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={resetForm}
          layout="vertical"
          initialValues={{ must_change_password: true }}
          onFinish={async (values) => {
            if (!resetUser) return
            try {
              await api.adminResetPassword(resetUser.id, values.password, values.must_change_password)
              message.success('密码已重置，现有会话已撤销')
              setResetUser(null)
              resetForm.resetFields()
              await load()
            } catch (err) {
              message.error(err instanceof Error ? err.message : '重置密码失败')
            }
          }}
        >
          <Form.Item name="password" label="新临时密码" rules={[{ required: true }, { min: 8 }]}>
            <Input.Password autoFocus autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="must_change_password" valuePropName="checked">
            <Switch /> <span style={{ marginLeft: 8 }}>下次登录时要求修改密码</span>
          </Form.Item>
          <Button type="primary" htmlType="submit">重置密码</Button>
        </Form>
      </Modal>
    </>
  )
}
