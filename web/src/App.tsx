import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AuditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  LogoutOutlined,
  ReloadOutlined,
  RestOutlined,
  ShareAltOutlined,
  UploadOutlined,
  UserOutlined,
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
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd'
import type { UploadProps } from 'antd'
import { ApiError, AuthResult, AuthSession, FileVersion, MeResult, Node, QuotaUsage, XDriveApi, sessionFromAuth } from './api'
import { formatSize } from '../../ui/shared/src'
import AdminUsersPanel from './AdminUsers'
import AdminAuditPanel from './AdminAudit'
import PublicShareView from './PublicShare'
import ShareDialog from './ShareDialog'

const { Header, Content } = Layout
const ACCESS_KEY = 'xdrive.access_token'
const REFRESH_KEY = 'xdrive.refresh_token'
const EXPIRES_KEY = 'xdrive.access_expires_at'
const LEGACY_TOKEN_KEY = 'xdrive.token'
const USER_KEY = 'xdrive.username'

type Crumb = { id: number; name: string }

function initialSession(): AuthSession {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY) ?? ''
  return {
    accessToken: localStorage.getItem(ACCESS_KEY) ?? legacy,
    refreshToken: localStorage.getItem(REFRESH_KEY) ?? '',
    accessExpiresAt: Number(localStorage.getItem(EXPIRES_KEY) ?? '0') || 0,
  }
}

function App() {
  const [session, setSession] = useState<AuthSession>(initialSession)
  const [username, setUsername] = useState(() => localStorage.getItem(USER_KEY) ?? '')

  const publicShareToken = useMemo(() => {
    const match = window.location.hash.match(/^#\/s\/([^/]+)\/?$/)
    if (!match) return ''
    try {
      return decodeURIComponent(match[1])
    } catch {
      return ''
    }
  }, [])

  const persistSession = useCallback((next: AuthSession) => {
    localStorage.setItem(ACCESS_KEY, next.accessToken)
    localStorage.setItem(LEGACY_TOKEN_KEY, next.accessToken)
    localStorage.setItem(REFRESH_KEY, next.refreshToken)
    localStorage.setItem(EXPIRES_KEY, String(next.accessExpiresAt))
    setSession(next)
  }, [])

  const clearSession = useCallback(() => {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(EXPIRES_KEY)
    localStorage.removeItem(USER_KEY)
    setSession({ accessToken: '', refreshToken: '', accessExpiresAt: 0 })
    setUsername('')
  }, [])

  const api = useMemo(
    () => new XDriveApi(session, persistSession),
    [session.accessToken, session.refreshToken, session.accessExpiresAt, persistSession],
  )

  const signOut = () => {
    void api.logout().finally(clearSession)
  }

  if (publicShareToken) {
    return <PublicShareView token={publicShareToken} />
  }

  if (!session.accessToken) {
    return <AuthView api={api} onAuthenticated={(result) => {
      persistSession(sessionFromAuth(result))
      localStorage.setItem(USER_KEY, result.username)
      setUsername(result.username)
    }} />
  }

  return <FileManager api={api} username={username} onAuthExpired={clearSession} onLogout={signOut} />
}

function AuthView({ api, onAuthenticated }: { api: XDriveApi; onAuthenticated: (result: AuthResult) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true)
    setError('')
    try {
      onAuthenticated(await api.login(values.username, values.password))
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
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy} block>Sign in</Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, textAlign: 'center' }}>
          Accounts are created by your xDrive administrator.
        </Typography.Paragraph>
      </Card>
    </div>
  )
}

function FileManager({ api, username, onAuthExpired, onLogout }: { api: XDriveApi; username: string; onAuthExpired: () => void; onLogout: () => void }) {
  const [modal, modalContext] = Modal.useModal()
  const [profile, setProfile] = useState<MeResult | null>(null)
  const [quota, setQuota] = useState<QuotaUsage | null>(null)
  const [items, setItems] = useState<Node[]>([])
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [renameNode, setRenameNode] = useState<Node | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashItems, setTrashItems] = useState<Node[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [historyNode, setHistoryNode] = useState<Node | null>(null)
  const [shareNode, setShareNode] = useState<Node | null>(null)
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [folderForm] = Form.useForm<{ name: string }>()
  const [renameForm] = Form.useForm<{ name: string }>()
  const [passwordForm] = Form.useForm<{ current: string; next: string; confirm: string }>()

  const current = crumbs.at(-1)

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.message.includes('account_disabled')) {
        message.error('Session is no longer valid. Sign in again.')
        onAuthExpired()
        return
      }
      if (err.message.includes('password_change_required')) {
        setProfile((currentProfile) => currentProfile ? { ...currentProfile, must_change_password: true } : currentProfile)
        message.warning('Change your password before using files.')
        return
      }
      if (err.status === 507 && err.message.includes('quota_exceeded')) {
        message.error('Storage quota exceeded. Permanently delete recycle-bin items or ask an administrator to increase the quota.')
        return
      }
    }
    message.error(err instanceof Error ? err.message : 'Request failed')
  }, [onAuthExpired])

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

  const refreshQuota = async () => {
    try {
      setQuota(await api.quota())
    } catch (err) {
      handleError(err)
    }
  }

  const loadInitial = async () => {
    setLoading(true)
    try {
      const me = await api.me()
      setProfile(me)
      if (me.must_change_password) return
      setQuota(await api.quota())
      const root = await api.root()
      const list = await api.list(root.id)
      setCrumbs([{ id: root.id, name: 'My files' }])
      setItems(list)
    } catch (err) {
      handleError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!active) return
      await loadInitial()
    })()
    return () => { active = false }
    // api changes when auth tokens rotate; reload identity and data then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  if (profile?.must_change_password) {
    return (
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
          <Card className="auth-card" title="Change your temporary password">
            <Alert
              type="warning"
              showIcon
              message="Your administrator requires a password change before file access is enabled."
              style={{ marginBottom: 18 }}
            />
            <Form
              form={passwordForm}
              layout="vertical"
              onFinish={async (values) => {
                if (values.next !== values.confirm) {
                  message.error('New passwords do not match')
                  return
                }
                try {
                  await api.changePassword(values.current, values.next)
                  passwordForm.resetFields()
                  message.success('Password changed')
                  setProfile({ ...profile, must_change_password: false })
                } catch (err) {
                  handleError(err)
                }
              }}
            >
              <Form.Item name="current" label="Current password" rules={[{ required: true }]}>
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Form.Item name="next" label="New password" rules={[{ required: true }, { min: 8 }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item name="confirm" label="Confirm new password" rules={[{ required: true }, { min: 8 }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit">Change password</Button>
            </Form>
          </Card>
        </Content>
      </Layout>
    )
  }

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
        await refreshQuota()
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
      await api.rename(renameNode.id, renameNode.revision, name)
      setRenameNode(null)
      renameForm.resetFields()
      await loadDirectory(current.id)
    } catch (err) { handleError(err) }
  }

  const remove = (node: Node) => {
    modal.confirm({
      title: `Move ${node.name} to the recycle bin?`,
      content: node.type === 'dir'
        ? 'The directory and everything inside it will disappear from synced folders, but can be restored later.'
        : 'The file will disappear from synced folders, but can be restored later.',
      okText: 'Move to recycle bin',
      okButtonProps: { danger: true },
      async onOk() {
        try {
          await api.remove(node.id, node.revision)
          message.success('Moved to recycle bin')
          if (current) await loadDirectory(current.id)
          await refreshQuota()
        } catch (err) { handleError(err) }
      },
    })
  }

  const loadTrash = async () => {
    setTrashLoading(true)
    try {
      setTrashItems(await api.trash())
    } catch (err) {
      handleError(err)
    } finally {
      setTrashLoading(false)
    }
  }

  const openTrash = () => {
    setTrashOpen(true)
    void loadTrash()
  }

  const openHistory = async (node: Node) => {
    setHistoryNode(node)
    setVersionsLoading(true)
    try {
      setVersions(await api.versions(node.id))
    } catch (err) {
      handleError(err)
      setVersions([])
    } finally {
      setVersionsLoading(false)
    }
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
            {profile?.role === 'admin' && (
              <>
                <Button type="text" icon={<UserOutlined />} onClick={() => setAdminOpen(true)} className="logout-button">
                  Users
                </Button>
                <Button type="text" icon={<AuditOutlined />} onClick={() => setAuditOpen(true)} className="logout-button">
                  Audit
                </Button>
              </>
            )}
            {quota && (
              <Tooltip title={`Current files ${formatSize(quota.logical_file_bytes)} · Recycle bin ${formatSize(quota.trash_bytes)} · History ${formatSize(quota.history_bytes)}`}>
                <Typography.Text className="username">
                  Storage {formatSize(quota.physical_used_bytes)} / {quota.quota_bytes === 0 ? 'Unlimited' : formatSize(quota.quota_bytes)}
                </Typography.Text>
              </Tooltip>
            )}
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
                <Button icon={<RestOutlined />} onClick={openTrash}>Recycle bin</Button>
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
                  title: '', key: 'actions', width: 190, align: 'right',
                  render: (_, node) => (
                    <Space size="small">
                      {node.type === 'file' && <Button type="text" aria-label={`Download ${node.name}`} icon={<DownloadOutlined />} onClick={() => api.download(node).catch(handleError)} />}
                      {node.type === 'file' && <Button type="text" aria-label={`Share ${node.name}`} icon={<ShareAltOutlined />} onClick={() => setShareNode(node)} />}
                      {node.type === 'file' && <Button type="text" aria-label={`History ${node.name}`} icon={<HistoryOutlined />} onClick={() => void openHistory(node)} />}
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

        <Modal
          title="Recycle bin"
          open={trashOpen}
          onCancel={() => setTrashOpen(false)}
          footer={null}
          width={900}
        >
          <Table<Node>
            rowKey="id"
            loading={trashLoading}
            dataSource={trashItems}
            pagination={false}
            locale={{ emptyText: 'Recycle bin is empty' }}
            columns={[
              {
                title: 'Name',
                dataIndex: 'name',
                render: (_, node) => (
                  <Space>
                    {node.type === 'dir' ? <FolderOpenOutlined /> : <FileOutlined />}
                    <span>{node.name}</span>
                  </Space>
                ),
              },
              {
                title: 'Deleted',
                dataIndex: 'deleted_at',
                width: 190,
                render: (value?: string) => value ? new Date(value).toLocaleString() : '—',
              },
              {
                title: 'Actions',
                width: 220,
                render: (_, node) => (
                  <Space>
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          await api.restoreTrash(node.id, node.revision)
                          message.success('Restored')
                          await loadTrash()
                          if (current) await loadDirectory(current.id)
                          await refreshQuota()
                        } catch (err) { handleError(err) }
                      }}
                    >
                      Restore
                    </Button>
                    <Button
                      danger
                      size="small"
                      onClick={() => modal.confirm({
                        title: `Permanently delete ${node.name}?`,
                        content: 'The item, current content and all stored file versions will be permanently removed.',
                        okText: 'Delete permanently',
                        okButtonProps: { danger: true },
                        async onOk() {
                          try {
                            await api.permanentlyDeleteTrash(node.id, node.revision)
                            message.success('Permanently deleted')
                            await loadTrash()
                            await refreshQuota()
                          } catch (err) { handleError(err) }
                        },
                      })}
                    >
                      Delete permanently
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </Modal>

        <Modal
          title={historyNode ? `Version history — ${historyNode.name}` : 'Version history'}
          open={!!historyNode}
          onCancel={() => { setHistoryNode(null); setVersions([]) }}
          footer={null}
          width={760}
        >
          <Table<FileVersion>
            rowKey="id"
            loading={versionsLoading}
            dataSource={versions}
            pagination={false}
            locale={{ emptyText: 'No previous versions yet' }}
            columns={[
              { title: 'Revision', dataIndex: 'revision', width: 110, render: (value: number) => `r${value}` },
              { title: 'Size', dataIndex: 'size', width: 120, render: (value: number) => formatSize(value) },
              { title: 'Saved', dataIndex: 'created_at', width: 190, render: (value: string) => new Date(value).toLocaleString() },
              {
                title: 'Actions',
                render: (_, version) => historyNode && (
                  <Space>
                    <Button size="small" onClick={() => api.downloadVersion(historyNode, version).catch(handleError)}>
                      Download
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => modal.confirm({
                        title: `Restore revision ${version.revision}?`,
                        content: 'The current content will first be preserved as another historical version.',
                        okText: 'Restore version',
                        async onOk() {
                          try {
                            const restored = await api.restoreVersion(historyNode.id, historyNode.revision, version.id)
                            message.success('Version restored')
                            setHistoryNode(restored)
                            setVersions(await api.versions(restored.id))
                            if (current) await loadDirectory(current.id)
                            await refreshQuota()
                          } catch (err) { handleError(err) }
                        },
                      })}
                    >
                      Restore
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </Modal>

        <ShareDialog
          api={api}
          node={shareNode}
          onClose={() => setShareNode(null)}
          onError={handleError}
        />

        {profile?.role === 'admin' && (
          <>
            <AdminUsersPanel
              api={api}
              open={adminOpen}
              currentUserID={profile.id}
              onClose={() => setAdminOpen(false)}
              onChanged={() => { void refreshQuota() }}
            />
            <AdminAuditPanel
              api={api}
              open={auditOpen}
              onClose={() => setAuditOpen(false)}
            />
          </>
        )}
      </Layout>
    </>
  )
}

export default App
