import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { XDriveApi } from './api'
import { XDriveStatusBadge } from '@xdrive/ui/mui'
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

type AdminConfirmAction = {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  successMessage: string
  errorTitle: string
  errorFallback: string
  run: () => Promise<void>
}

type AdminActionError = {
  title: string
  message: string
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
  const [confirmAction, setConfirmAction] = useState<AdminConfirmAction | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [actionError, setActionError] = useState<AdminActionError | null>(null)
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

  const showActionError = (title: string, err: unknown, fallback: string) => {
    setActionError({
      title,
      message: err instanceof Error && err.message.trim() ? err.message : fallback,
    })
  }

  const updateUser = async (
    user: AdminUser,
    input: { role?: 'user' | 'admin'; disabled?: boolean; quota_bytes?: number },
    successMessage = '用户已更新',
  ) => {
    try {
      await api.adminUpdateUser(user.id, input)
      message.success(successMessage)
      await load()
      onChanged()
    } catch (err) {
      showActionError('更新用户失败', err, '更新用户失败，请稍后重试。')
    }
  }

  const executeConfirmAction = async () => {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmLoading(true)
    try {
      await action.run()
      message.success(action.successMessage)
      setConfirmAction(null)
    } catch (err) {
      setConfirmAction(null)
      showActionError(action.errorTitle, err, action.errorFallback)
    } finally {
      setConfirmLoading(false)
    }
  }

  const columns: ColumnsType<AdminUser> = [
    {
      title: '用户',
      dataIndex: 'username',
      render: (_, user) => (
        <Space>
          <Typography.Text strong={user.id === currentUserID}>{user.username}</Typography.Text>
          {user.id === currentUserID && <XDriveStatusBadge tone="neutral" label="当前用户" />}
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
          onChange={(role: 'user' | 'admin') => {
            if (role === user.role) return
            setConfirmAction({
              title: `变更 ${user.username} 的角色？`,
              description: role === 'admin'
                ? '该用户将获得管理员权限，包括用户管理、全局存储查看和管理操作。'
                : '该用户将失去管理员权限，但其文件和账户数据不会被删除。',
              confirmLabel: '确认变更',
              danger: role !== 'admin',
              successMessage: '用户角色已更新',
              errorTitle: '变更用户角色失败',
              errorFallback: '无法变更用户角色，请稍后重试。',
              run: async () => {
                await api.adminUpdateUser(user.id, { role })
                await load()
                onChanged()
              },
            })
          }}
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
          onChange={(enabled) => {
            if (enabled) {
              void updateUser(user, { disabled: false }, '用户已启用')
              return
            }
            setConfirmAction({
              title: `停用 ${user.username}？`,
              description: '停用后该用户将无法继续登录或使用现有会话，数据不会被删除。',
              confirmLabel: '停用用户',
              danger: true,
              successMessage: '用户已停用',
              errorTitle: '停用用户失败',
              errorFallback: '无法停用该用户，请稍后重试。',
              run: async () => {
                await api.adminUpdateUser(user.id, { disabled: true })
                await load()
                onChanged()
              },
            })
          }}
        />
      ),
    },
    {
      title: '密码',
      width: 150,
      render: (_, user) => user.must_change_password
        ? <XDriveStatusBadge tone="warning" label="需要修改" />
        : <XDriveStatusBadge tone="good" label="已设置" />,
    },
    {
      title: '存储',
      width: 340,
      render: (_, user) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>
            {formatBytes(user.physical_used_bytes)} / {user.quota_bytes === 0 ? '不限' : formatBytes(user.quota_bytes)}
            {user.over_quota && <span style={{ marginLeft: 8 }}><XDriveStatusBadge tone="bad" label="已超配额" /></span>}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            可用 {formatBytes(user.available_bytes)}
            {user.quota_bytes === 0 ? '（服务器磁盘）' : ''}
            {user.reserved_bytes > 0 ? ` · 上传预占 ${formatBytes(user.reserved_bytes)}` : ''}
            {' · '}文件 {formatBytes(user.logical_file_bytes)} · 回收站 {formatBytes(user.trash_bytes)} · 历史版本 {formatBytes(user.history_bytes)}
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
          <Button
            size="small"
            onClick={() => setConfirmAction({
              title: `撤销 ${user.username} 的全部会话？`,
              description: '该用户现有的 access token 和 refresh token 将立即失效，需要重新登录。',
              confirmLabel: '撤销全部会话',
              successMessage: '会话已撤销',
              errorTitle: '撤销会话失败',
              errorFallback: '无法撤销该用户的现有会话，请稍后重试。',
              run: async () => {
                await api.adminRevokeSessions(user.id)
              },
            })}
          >
            撤销会话
          </Button>
          {user.id !== currentUserID && (
            <Button
              danger
              size="small"
              onClick={() => setConfirmAction({
                title: `永久删除 ${user.username}？`,
                description: '该用户账户、元数据、当前文件、回收站内容和历史版本都将永久删除。此操作不可恢复。',
                confirmLabel: '永久删除用户',
                danger: true,
                successMessage: '用户已删除',
                errorTitle: '删除用户失败',
                errorFallback: '无法永久删除该用户，请稍后重试。',
                run: async () => {
                  await api.adminDeleteUser(user.id)
                  await load()
                  onChanged()
                },
              })}
            >
              删除
            </Button>
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
              showActionError('创建用户失败', err, '无法创建用户，请检查输入后重试。')
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
              showActionError('更新存储配额失败', err, '无法更新存储配额，请稍后重试。')
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
              showActionError('重置密码失败', err, '无法重置该用户密码，请稍后重试。')
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

      <Modal
        title={confirmAction?.title ?? '确认操作'}
        open={!!confirmAction}
        onCancel={() => !confirmLoading && setConfirmAction(null)}
        closable={!confirmLoading}
        maskClosable={!confirmLoading}
        footer={[
          <Button key="cancel" disabled={confirmLoading} onClick={() => setConfirmAction(null)}>取消</Button>,
          <Button
            key="confirm"
            type="primary"
            danger={confirmAction?.danger}
            loading={confirmLoading}
            onClick={() => void executeConfirmAction()}
          >
            {confirmAction?.confirmLabel ?? '确认'}
          </Button>,
        ]}
      >
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          {confirmAction?.description}
        </Typography.Paragraph>
      </Modal>

      <Modal
        title={actionError?.title ?? '操作失败'}
        open={!!actionError}
        onCancel={() => setActionError(null)}
        footer={<Button type="primary" onClick={() => setActionError(null)}>知道了</Button>}
      >
        <Typography.Text type="danger">{actionError?.message}</Typography.Text>
      </Modal>
    </>
  )
}
