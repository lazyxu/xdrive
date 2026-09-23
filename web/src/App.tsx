import { useEffect, useMemo, useState } from 'react'
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Form,
  Input,
  Layout,
  Modal,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd'
import type { UploadProps } from 'antd'
import { ApiError, Node, XDriveApi } from './api'

const { Header, Content } = Layout
const TOKEN_KEY = 'xdrive.token'
const USER_KEY = 'xdrive.username'

type Crumb = { id: number; name: string }

function formatSize(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [username, setUsername] = useState(() => localStorage.getItem(USER_KEY) ?? '')
  const api = useMemo(() => new XDriveApi(token), [token])

  const signOut = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken('')
    setUsername('')
  }

  if (!token) {
    return <AuthView api={api} onAuthenticated={(result) => {
      localStorage.setItem(TOKEN_KEY, result.token)
      localStorage.setItem(USER_KEY, result.username)
      setToken(result.token)
      setUsername(result.username)
    }} />
  }

  return <FileManager api={api} username={username} onAuthExpired={signOut} onLogout={signOut} />
}

function AuthView({ api, onAuthenticated }: { api: XDriveApi; onAuthenticated: (result: { token: string; username: string }) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true)
    setError('')
    try {
      const result = mode === 'login' ? await api.login(values.username, values.password) : await api.register(values.username, values.password)
      onAuthenticated(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <Card className="auth-card">
        <div className="brand-lockup">
          <div className="brand-mark">x</div>
          <div>
            <Typography.Title level={2} style={{ margin: 0 }}>xDrive</Typography.Title>
            <Typography.Text type="secondary">Mount your cloud as a local drive.</Typography.Text>
          </div>
        </div>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 18 }} />}
        <Form layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item label="Username" name="username" rules={[{ required: true }, { min: 3, max: 64 }]}>
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }, { min: 8, max: 128 }]}>
            <Input.Password autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy} block>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </Form>
        <Button type="link" block onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
          {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
        </Button>
      </Card>
    </div>
  )
}

function FileManager({ api, username, onAuthExpired, onLogout }: { api: XDriveApi; username: string; onAuthExpired: () => void; onLogout: () => void }) {
  const [modal, modalContext] = Modal.useModal()
  const [items, setItems] = useState<Node[]>([])
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [renameNode, setRenameNode] = useState<Node | null>(null)
  const [folderForm] = Form.useForm<{ name: string }>()
  const [renameForm] = Form.useForm<{ name: string }>()

  const current = crumbs.at(-1)

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      message.error('Session expired. Sign in again.')
      onAuthExpired()
      return
    }
    message.error(err instanceof Error ? err.message : 'Request failed')
  }

  const loadDirectory = async (id: number, nextCrumbs?: Crumb[]) => {
    setLoading(true)
    try {
      const list = await api.list(id)
      setItems(list)
      if (nextCrumbs) setCrumbs(nextCrumbs)
    } catch (err) {
      handleError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        await api.me()
        const root = await api.root()
        const list = await api.list(root.id)
        if (!active) return
        setCrumbs([{ id: root.id, name: 'My files' }])
        setItems(list)
      } catch (err) {
        if (active) handleError(err)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
    // api changes only when the auth token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const enterDirectory = (node: Node) => loadDirectory(node.id, [...crumbs, { id: node.id, name: node.name }])

  const uploadProps: UploadProps = {
    showUploadList: false,
    multiple: true,
    beforeUpload: async (file) => {
      if (!current) return Upload.LIST_IGNORE
      try {
        setUploadProgress(0)
        await api.upload(current.id, file as File, setUploadProgress)
        message.success(`${file.name} uploaded`)
        await loadDirectory(current.id)
      } catch (err) {
        handleError(err)
      } finally {
        setUploadProgress(null)
      }
      return Upload.LIST_IGNORE
    },
  }

  const createFolder = async ({ name }: { name: string }) => {
    if (!current) return
    try {
      await api.createDirectory(current.id, name)
      setFolderOpen(false)
      folderForm.resetFields()
      await loadDirectory(current.id)
    } catch (err) { handleError(err) }
  }

  const rename = async ({ name }: { name: string }) => {
    if (!renameNode || !current) return
    try {
      await api.rename(renameNode.id, name)
      setRenameNode(null)
      renameForm.resetFields()
      await loadDirectory(current.id)
    } catch (err) { handleError(err) }
  }

  const remove = (node: Node) => {
    modal.confirm({
      title: `Delete ${node.name}?`,
      content: node.type === 'dir' ? 'The directory and everything inside it will be deleted.' : 'This file will be deleted permanently.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      async onOk() {
        try {
          await api.remove(node.id)
          if (current) await loadDirectory(current.id)
        } catch (err) { handleError(err) }
      },
    })
  }

  return (
    <>
      {modalContext}
      <Layout className="app-shell">
      <Header className="topbar">
        <div className="brand-lockup compact">
          <div className="brand-mark small">x</div>
          <Typography.Title level={4} style={{ color: 'white', margin: 0 }}>xDrive</Typography.Title>
        </div>
        <Space>
          <Typography.Text className="username">{username}</Typography.Text>
          <Button type="text" icon={<LogoutOutlined />} onClick={onLogout} className="logout-button">Sign out</Button>
        </Space>
      </Header>
      <Content className="content-wrap">
        <Card className="file-card">
          <div className="file-toolbar">
            <Breadcrumb items={crumbs.map((crumb, index) => ({
              title: index === crumbs.length - 1 ? crumb.name : <a onClick={() => loadDirectory(crumb.id, crumbs.slice(0, index + 1))}>{crumb.name}</a>,
            }))} />
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={() => current && loadDirectory(current.id)}>Refresh</Button>
              <Button icon={<FolderAddOutlined />} onClick={() => setFolderOpen(true)}>New folder</Button>
              <Upload {...uploadProps}><Button type="primary" icon={<UploadOutlined />}>Upload</Button></Upload>
            </Space>
          </div>
          {uploadProgress !== null && <div className="upload-progress"><Progress percent={uploadProgress} size="small" /></div>}
          <Table<Node>
            rowKey="id"
            loading={loading}
            dataSource={items}
            pagination={false}
            locale={{ emptyText: 'This folder is empty' }}
            columns={[
              {
                title: 'Name', dataIndex: 'name', key: 'name',
                render: (_, node) => (
                  <Space>
                    {node.type === 'dir' ? <FolderOpenOutlined className="folder-icon" /> : <FileOutlined />}
                    {node.type === 'dir' ? <a onDoubleClick={() => enterDirectory(node)} onClick={() => enterDirectory(node)}>{node.name}</a> : <span>{node.name}</span>}
                    {node.type === 'dir' && <Tag>Folder</Tag>}
                  </Space>
                ),
              },
              { title: 'Size', dataIndex: 'size', width: 120, render: (value: number, node: Node) => node.type === 'dir' ? '—' : formatSize(value) },
              { title: 'Modified', dataIndex: 'updated_at', width: 190, render: (value: string) => new Date(value).toLocaleString() },
              {
                title: '', key: 'actions', width: 150, align: 'right',
                render: (_, node) => (
                  <Space size="small">
                    {node.type === 'file' && <Button type="text" aria-label={`Download ${node.name}`} icon={<DownloadOutlined />} onClick={() => api.download(node).catch(handleError)} />}
                    <Button type="text" aria-label={`Rename ${node.name}`} icon={<EditOutlined />} onClick={() => { setRenameNode(node); renameForm.setFieldsValue({ name: node.name }) }} />
                    <Button danger type="text" aria-label={`Delete ${node.name}`} icon={<DeleteOutlined />} onClick={() => remove(node)} />
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      </Content>

      <Modal title="New folder" open={folderOpen} onCancel={() => setFolderOpen(false)} footer={null} destroyOnClose>
        <Form form={folderForm} layout="vertical" onFinish={createFolder}>
          <Form.Item name="name" label="Folder name" rules={[{ required: true, whitespace: true, max: 255 }]}>
            <Input autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit">Create</Button>
        </Form>
      </Modal>

      <Modal title="Rename" open={!!renameNode} onCancel={() => setRenameNode(null)} footer={null} destroyOnClose>
        <Form form={renameForm} layout="vertical" onFinish={rename}>
          <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, max: 255 }]}>
            <Input autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit">Save</Button>
        </Form>
      </Modal>
      </Layout>
    </>
  )
}

export default App
