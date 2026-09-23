import { useEffect, useState } from 'react'
import {
  Button,
  Form,
  Input,
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
import type { AdminUser, XDriveApi } from './api'

type CreateForm = {
  username: string
  password: string
  role: 'user' | 'admin'
  must_change_password: boolean
}

type ResetForm = {
  password: string
  must_change_password: boolean
}

export default function AdminUsersPanel({
  api,
  open,
  currentUserID,
  onClose,
}: {
  api: XDriveApi
  open: boolean
  currentUserID: number
  onClose: () => void
}) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [createForm] = Form.useForm<CreateForm>()
  const [resetForm] = Form.useForm<ResetForm>()

  const load = async () => {
    setLoading(true)
    try {
      setUsers(await api.adminUsers())
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
    // api is stable for one authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const updateUser = async (user: AdminUser, input: { role?: 'user' | 'admin'; disabled?: boolean }) => {
    try {
      await api.adminUpdateUser(user.id, input)
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update user')
    }
  }

  const columns: ColumnsType<AdminUser> = [
    {
      title: 'User',
      dataIndex: 'username',
      render: (_, user) => (
        <Space>
          <Typography.Text strong={user.id === currentUserID}>{user.username}</Typography.Text>
          {user.id === currentUserID && <Tag color="blue">You</Tag>}
        </Space>
      ),
    },
    {
      title: 'Role',
      width: 140,
      render: (_, user) => (
        <Select
          size="small"
          value={user.role}
          disabled={user.id === currentUserID}
          style={{ width: 110 }}
          options={[
            { value: 'user', label: 'User' },
            { value: 'admin', label: 'Admin' },
          ]}
          onChange={(role: 'user' | 'admin') => void updateUser(user, { role })}
        />
      ),
    },
    {
      title: 'Enabled',
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
      title: 'Password',
      width: 150,
      render: (_, user) => user.must_change_password
        ? <Tag color="orange">Change required</Tag>
        : <Tag color="green">Set</Tag>,
    },
    {
      title: 'Last login',
      width: 190,
      render: (_, user) => user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never',
    },
    {
      title: 'Actions',
      width: 300,
      render: (_, user) => (
        <Space size="small" wrap>
          <Button size="small" onClick={() => {
            setResetUser(user)
            resetForm.setFieldsValue({ password: '', must_change_password: true })
          }}>
            Reset password
          </Button>
          <Popconfirm
            title="Revoke all sessions?"
            description="All existing access and refresh tokens for this user will stop working immediately."
            onConfirm={async () => {
              try {
                await api.adminRevokeSessions(user.id)
                message.success('Sessions revoked')
              } catch (err) {
                message.error(err instanceof Error ? err.message : 'Failed to revoke sessions')
              }
            }}
          >
            <Button size="small">Revoke sessions</Button>
          </Popconfirm>
          {user.id !== currentUserID && (
            <Popconfirm
              title={'Permanently delete ' + user.username + '?'}
              description="The user account, metadata and stored files will be permanently deleted."
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                try {
                  await api.adminDeleteUser(user.id)
                  message.success('User deleted')
                  await load()
                } catch (err) {
                  message.error(err instanceof Error ? err.message : 'Failed to delete user')
                }
              }}
            >
              <Button danger size="small">Delete</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <>
      <Modal
        title="User management"
        open={open}
        onCancel={onClose}
        footer={null}
        width={1080}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Button type="primary" onClick={() => {
              createForm.setFieldsValue({
                username: '',
                password: '',
                role: 'user',
                must_change_password: true,
              })
              setCreateOpen(true)
            }}>
              Create user
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
        title="Create user"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ role: 'user', must_change_password: true }}
          onFinish={async (values) => {
            try {
              await api.adminCreateUser(values)
              message.success('User created')
              setCreateOpen(false)
              createForm.resetFields()
              await load()
            } catch (err) {
              message.error(err instanceof Error ? err.message : 'Failed to create user')
            }
          }}
        >
          <Form.Item name="username" label="Username" rules={[{ required: true }, { min: 3, max: 64 }]}>
            <Input autoFocus autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="Temporary password" rules={[{ required: true }, { min: 8 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={[{ value: 'user', label: 'User' }, { value: 'admin', label: 'Admin' }]} />
          </Form.Item>
          <Form.Item name="must_change_password" valuePropName="checked">
            <Switch /> <span style={{ marginLeft: 8 }}>Require password change at first login</span>
          </Form.Item>
          <Button type="primary" htmlType="submit">Create</Button>
        </Form>
      </Modal>

      <Modal
        title={resetUser ? 'Reset password — ' + resetUser.username : 'Reset password'}
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
              message.success('Password reset; existing sessions revoked')
              setResetUser(null)
              resetForm.resetFields()
              await load()
            } catch (err) {
              message.error(err instanceof Error ? err.message : 'Failed to reset password')
            }
          }}
        >
          <Form.Item name="password" label="New temporary password" rules={[{ required: true }, { min: 8 }]}>
            <Input.Password autoFocus autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="must_change_password" valuePropName="checked">
            <Switch /> <span style={{ marginLeft: 8 }}>Require password change at next login</span>
          </Form.Item>
          <Button type="primary" htmlType="submit">Reset password</Button>
        </Form>
      </Modal>
    </>
  )
}
