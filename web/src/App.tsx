import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded'
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import UploadRoundedIcon from '@mui/icons-material/UploadRounded'
import {
  AppBar,
  Avatar as MuiAvatar,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Chip,
  Dialog,
  IconButton,
  LinearProgress,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveDialogActions,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDriveMediaGalleryPage,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStatusBadge,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import type { MediaGalleryDataSource } from '@xdrive/ui/mui'
import { ApiError, XDriveApi, sessionFromAuth } from './api'
import type { AuthResult, AuthSession, BuildInfo } from './api'
import type { FileVersion, MeResult, Node, QuotaUsage } from '../../ui/shared/src'
import { formatSize } from '../../ui/shared/src'
import AdminUsersPanel from './AdminUsers'
import AdminAuditPanel from './AdminAudit'
import PublicShareView from './PublicShare'
import ShareDialog from './ShareDialog'
import StorageStatsModal from './StorageStatsModal'
import ExternalSourcesPanel from './ExternalSources'
import xDriveBrandIcon from '../../assets/icon/master/xdrive-icon-master.svg'

const ACCESS_KEY = 'xdrive.access_token'
const REFRESH_KEY = 'xdrive.refresh_token'
const EXPIRES_KEY = 'xdrive.access_expires_at'
const LEGACY_TOKEN_KEY = 'xdrive.token'
const USER_KEY = 'xdrive.username'

type Crumb = { id: number; name: string }

type Feedback = {
  tone: 'good' | 'bad' | 'warning' | 'neutral'
  message: string
}

type ConfirmAction = {
  title: string
  description: string
  confirmLabel: string
  intent?: 'primary' | 'danger' | 'warning'
  run: () => Promise<void>
}

function initialSession(): AuthSession {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY) ?? ''
  return {
    accessToken: localStorage.getItem(ACCESS_KEY) ?? legacy,
    refreshToken: localStorage.getItem(REFRESH_KEY) ?? '',
    accessExpiresAt: Number(localStorage.getItem(EXPIRES_KEY) ?? '0') || 0,
  }
}

function WebAccountMenu({
  username,
  serverBuild,
  onLogout,
}: {
  username: string
  serverBuild: BuildInfo | null
  onLogout: () => void
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const accountInitial = username.trim().slice(0, 1).toUpperCase() || '?'

  return (
    <>
      <Tooltip title={username ? `${username} · 账户` : '账户'}>
        <IconButton
          aria-label="账户菜单"
          size="small"
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ ml: 0.5, p: 0.5 }}
        >
          <MuiAvatar sx={{ width: 28, height: 28, fontSize: 13, fontWeight: 700 }}>
            {accountInitial}
          </MuiAvatar>
        </IconButton>
      </Tooltip>
      <Menu
        id="web-account-menu"
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ minWidth: 240, maxWidth: 320, px: 2, py: 1.25 }}>
          <Typography variant="body2" fontWeight={700} noWrap>
            {username || '已登录用户'}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            Server {serverBuild?.version || '未知'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            已登录
          </Typography>
        </Box>
        <Box sx={{ borderTop: 1, borderColor: 'divider' }} />
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            setAnchorEl(null)
            onLogout()
          }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}>
            <LogoutRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>退出登录</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}

const webSidebarItemSx = {
  minHeight: 40,
  borderRadius: 1.25,
  px: 1.25,
  color: 'text.secondary',
  '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
  '&.Mui-selected': { bgcolor: 'action.selected', color: 'primary.main' },
  '&.Mui-selected:hover': { bgcolor: 'action.selected' },
}

const webSidebarIconSx = { minWidth: 32, color: 'inherit' }

const webSidebarTextSx = {
  '& .MuiListItemText-primary': { fontSize: 13, fontWeight: 600 },
  '& .MuiListItemText-secondary': { fontSize: 11, lineHeight: 1.25 },
}

function App() {
  const [session, setSession] = useState<AuthSession>(initialSession)
  const [username, setUsername] = useState(() => localStorage.getItem(USER_KEY) ?? '')
  const [serverBuild, setServerBuild] = useState<BuildInfo | null>(null)
  const [authNotice, setAuthNotice] = useState('')

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

  const clearSession = useCallback((notice = '') => {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(EXPIRES_KEY)
    localStorage.removeItem(USER_KEY)
    setSession({ accessToken: '', refreshToken: '', accessExpiresAt: 0 })
    setUsername('')
    setAuthNotice(notice)
  }, [])

  const api = useMemo(
    () => new XDriveApi(session, persistSession),
    [session.accessToken, session.refreshToken, session.accessExpiresAt, persistSession],
  )

  useEffect(() => {
    let active = true
    const refresh = () => {
      void api.serverVersion()
        .then((build) => { if (active) setServerBuild(build) })
        .catch(() => { if (active) setServerBuild(null) })
    }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [api])

  const signOut = () => {
    void api.logout().finally(() => clearSession())
  }

  if (publicShareToken) {
    return <PublicShareView token={publicShareToken} />
  }

  if (!session.accessToken) {
    return (
      <AuthView
        api={api}
        serverBuild={serverBuild}
        notice={authNotice}
        onAuthenticated={(result) => {
          setAuthNotice('')
          persistSession(sessionFromAuth(result))
          localStorage.setItem(USER_KEY, result.username)
          setUsername(result.username)
        }}
      />
    )
  }

  return (
    <FileManager
      api={api}
      username={username}
      serverBuild={serverBuild}
      onAuthExpired={(notice) => clearSession(notice)}
      onLogout={signOut}
    />
  )
}

function AuthView({
  api,
  serverBuild,
  notice,
  onAuthenticated,
}: {
  api: XDriveApi
  serverBuild: BuildInfo | null
  notice: string
  onAuthenticated: (result: AuthResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loginUsername, setLoginUsername] = useState('')
  const [password, setPassword] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const username = loginUsername.trim()
    const nextUsernameError = !username
      ? '请填写用户名'
      : username.length < 3 || username.length > 64
        ? '用户名长度需要 3–64 个字符'
        : ''
    const nextPasswordError = password.length < 8 || password.length > 128
      ? '密码长度需要 8–128 个字符'
      : ''
    setUsernameError(nextUsernameError)
    setPasswordError(nextPasswordError)
    if (nextUsernameError || nextPasswordError) return

    setBusy(true)
    setError('')
    try {
      onAuthenticated(await api.login(username, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <Card className="auth-card" sx={{ p: 3, borderRadius: 2 }}>
        <div className="brand-lockup">
          <img className="brand-mark" src={xDriveBrandIcon} alt="" aria-hidden="true" />
          <div>
            <Typography component="h1" variant="h5" fontWeight={700}>xDrive</Typography>
            <Typography variant="body2" color="text.secondary">将云端文件挂载为本地磁盘。</Typography>
            <Box sx={{ mt: 0.75 }}>
              <Chip size="small" label={`Server ${serverBuild?.version || '未知'}`} />
            </Box>
          </div>
        </div>

        {notice && <XDriveStatusAlert tone="warning" sx={{ mb: 2 }}>{notice}</XDriveStatusAlert>}
        {error && <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>{error}</XDriveStatusAlert>}

        <Stack component="form" spacing={2} onSubmit={(event) => void submit(event)}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="用户名"
            autoComplete="username"
            value={loginUsername}
            error={Boolean(usernameError)}
            helperText={usernameError || ' '}
            onChange={(event) => {
              setLoginUsername(event.target.value)
              if (usernameError) setUsernameError('')
            }}
          />
          <TextField
            fullWidth
            size="small"
            type="password"
            label="密码"
            autoComplete="current-password"
            value={password}
            error={Boolean(passwordError)}
            helperText={passwordError || ' '}
            onChange={(event) => {
              setPassword(event.target.value)
              if (passwordError) setPasswordError('')
            }}
          />
          <XDriveActionButton
            intent="primary"
            type="submit"
            fullWidth
            loading={busy}
            loadingLabel="正在登录…"
          >
            登录
          </XDriveActionButton>
        </Stack>

        <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 2 }}>
          账户由 xDrive 管理员创建。
        </Typography>
      </Card>
    </div>
  )
}

function FileManager({
  api,
  username,
  serverBuild,
  onAuthExpired,
  onLogout,
}: {
  api: XDriveApi
  username: string
  serverBuild: BuildInfo | null
  onAuthExpired: (notice?: string) => void
  onLogout: () => void
}) {
  const [profile, setProfile] = useState<MeResult | null>(null)
  const [quota, setQuota] = useState<QuotaUsage | null>(null)
  const [items, setItems] = useState<Node[]>([])
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderNameError, setFolderNameError] = useState('')
  const [renameNode, setRenameNode] = useState<Node | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameNameError, setRenameNameError] = useState('')
  const [adminOpen, setAdminOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [storageStatsScope, setStorageStatsScope] = useState<'self' | 'global' | null>(null)
  const [appView, setAppView] = useState<'files' | 'gallery' | 'sources' | 'storage'>('files')
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashItems, setTrashItems] = useState<Node[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [historyNode, setHistoryNode] = useState<Node | null>(null)
  const [shareNode, setShareNode] = useState<Node | null>(null)
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [passwordValues, setPasswordValues] = useState({ current: '', next: '', confirm: '' })
  const [passwordError, setPasswordError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const current = crumbs.at(-1)

  const gallerySource = useMemo<MediaGalleryDataSource>(() => ({
    listItems: (limit, offset) => api.mediaItems('', limit, offset),
    listAlbums: () => api.mediaAlbums(),
    listAlbumItems: (albumID, limit, offset) => api.mediaAlbumItems(albumID, limit, offset),
    loadThumbnail: async (nodeID) => URL.createObjectURL(await api.mediaThumbnail(nodeID)),
  }), [api])

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.message.includes('account_disabled')) {
        onAuthExpired('登录状态已失效，请重新登录。')
        return
      }
      if (err.message.includes('password_change_required')) {
        setProfile((currentProfile) => currentProfile ? { ...currentProfile, must_change_password: true } : currentProfile)
        setFeedback({ tone: 'warning', message: '请先修改密码，再使用文件功能。' })
        return
      }
      if (err.status === 507 && err.message.includes('quota_exceeded')) {
        setFeedback({ tone: 'bad', message: '剩余存储配额不足（包含进行中上传的预占空间）。请释放空间、等待/取消其他上传，或联系管理员提高配额。' })
        return
      }
      if (err.status === 507 && err.message.includes('storage_capacity_exceeded')) {
        setFeedback({ tone: 'bad', message: '服务器存储空间不足。请释放服务器磁盘空间后重试。' })
        return
      }
    }
    setFeedback({ tone: 'bad', message: err instanceof Error ? err.message : '请求失败' })
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
      setCrumbs([{ id: root.id, name: '我的文件' }])
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

  const executeConfirm = async () => {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmBusy(true)
    try {
      await action.run()
      setConfirmAction(null)
    } catch (err) {
      setConfirmAction(null)
      handleError(err)
    } finally {
      setConfirmBusy(false)
    }
  }

  if (profile?.must_change_password) {
    const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!passwordValues.current) {
        setPasswordError('请填写当前密码')
        return
      }
      if (passwordValues.next.length < 8) {
        setPasswordError('新密码至少需要 8 个字符')
        return
      }
      if (passwordValues.next !== passwordValues.confirm) {
        setPasswordError('两次输入的新密码不一致')
        return
      }
      try {
        await api.changePassword(passwordValues.current, passwordValues.next)
        setPasswordValues({ current: '', next: '', confirm: '' })
        setPasswordError('')
        setFeedback({ tone: 'good', message: '密码已修改' })
        setProfile({ ...profile, must_change_password: false })
      } catch (err) {
        handleError(err)
      }
    }

    return (
      <Box className="app-shell" sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppBar position="static" elevation={1}>
          <Toolbar className="topbar">
            <div className="brand-lockup compact">
              <img className="brand-mark small" src={xDriveBrandIcon} alt="" aria-hidden="true" />
              <Typography variant="h6" fontWeight={700}>xDrive</Typography>
            </div>
            <WebAccountMenu username={username} serverBuild={serverBuild} onLogout={onLogout} />
          </Toolbar>
        </AppBar>
        <Box component="main" className="content-wrap">
          <Card className="auth-card" sx={{ p: 3, mx: 'auto', borderRadius: 2 }}>
            <Typography component="h2" variant="h6" fontWeight={700} sx={{ mb: 2 }}>
              修改临时密码
            </Typography>
            <XDriveStatusAlert tone="warning" sx={{ mb: 2 }}>
              管理员要求先修改密码，之后才能访问文件。
            </XDriveStatusAlert>
            {passwordError && <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>{passwordError}</XDriveStatusAlert>}
            <Stack component="form" spacing={2} onSubmit={(event) => void submitPassword(event)}>
              <TextField
                fullWidth
                size="small"
                type="password"
                label="当前密码"
                autoComplete="current-password"
                value={passwordValues.current}
                onChange={(event) => {
                  setPasswordValues((currentValues) => ({ ...currentValues, current: event.target.value }))
                  if (passwordError) setPasswordError('')
                }}
              />
              <TextField
                fullWidth
                size="small"
                type="password"
                label="新密码"
                autoComplete="new-password"
                value={passwordValues.next}
                onChange={(event) => {
                  setPasswordValues((currentValues) => ({ ...currentValues, next: event.target.value }))
                  if (passwordError) setPasswordError('')
                }}
              />
              <TextField
                fullWidth
                size="small"
                type="password"
                label="确认新密码"
                autoComplete="new-password"
                value={passwordValues.confirm}
                onChange={(event) => {
                  setPasswordValues((currentValues) => ({ ...currentValues, confirm: event.target.value }))
                  if (passwordError) setPasswordError('')
                }}
              />
              <XDriveActionButton intent="primary" type="submit">修改密码</XDriveActionButton>
            </Stack>
          </Card>
        </Box>
        <Snackbar
          open={Boolean(feedback)}
          autoHideDuration={3500}
          onClose={(_event, reason) => { if (reason !== 'clickaway') setFeedback(null) }}
        >
          <div>{feedback ? <XDriveStatusAlert tone={feedback.tone}>{feedback.message}</XDriveStatusAlert> : null}</div>
        </Snackbar>
      </Box>
    )
  }

  const enterDirectory = (node: Node) => void loadDirectory(node.id, [...crumbs, { id: node.id, name: node.name }])

  const uploadFiles = async (files: FileList | null) => {
    if (!current || !files?.length) return
    for (const file of Array.from(files)) {
      try {
        setUploadProgress(0)
        await api.upload(current.id, file, setUploadProgress)
        setFeedback({ tone: 'good', message: `${file.name} 已上传` })
      } catch (err) {
        handleError(err)
        break
      } finally {
        setUploadProgress(null)
      }
    }
    await loadDirectory(current.id)
    await refreshQuota()
  }

  const createFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!current) return
    const name = folderName.trim()
    const error = !name ? '请填写文件夹名称' : name.length > 255 ? '文件夹名称不能超过 255 个字符' : ''
    setFolderNameError(error)
    if (error) return
    try {
      await api.createDirectory(current.id, name)
      setFolderOpen(false)
      setFolderName('')
      setFolderNameError('')
      await loadDirectory(current.id)
    } catch (err) {
      handleError(err)
    }
  }

  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!renameNode || !current) return
    const name = renameName.trim()
    const error = !name ? '请填写名称' : name.length > 255 ? '名称不能超过 255 个字符' : ''
    setRenameNameError(error)
    if (error) return
    try {
      await api.rename(renameNode.id, renameNode.revision, name)
      setRenameNode(null)
      setRenameName('')
      setRenameNameError('')
      await loadDirectory(current.id)
    } catch (err) {
      handleError(err)
    }
  }

  const remove = (node: Node) => {
    setConfirmAction({
      title: `将 ${node.name} 移到回收站？`,
      description: node.type === 'dir'
        ? '该文件夹及其中的全部内容会从同步文件夹中移除，但之后仍可恢复。'
        : '该文件会从同步文件夹中移除，但之后仍可恢复。',
      confirmLabel: '移到回收站',
      intent: 'danger',
      run: async () => {
        await api.remove(node.id, node.revision)
        setFeedback({ tone: 'good', message: '已移到回收站' })
        if (current) await loadDirectory(current.id)
        await refreshQuota()
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
    <Box className="app-shell" sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={1}>
        <Toolbar className="topbar">
          <div className="brand-lockup compact">
            <img className="brand-mark small" src={xDriveBrandIcon} alt="" aria-hidden="true" />
            <Typography variant="h6" fontWeight={700}>xDrive</Typography>
          </div>
          <Stack direction="row" spacing={0.5} alignItems="center" useFlexGap flexWrap="wrap" justifyContent="flex-end">
            {profile?.role === 'admin' && (
              <>
                <Button color="inherit" size="small" startIcon={<ManageAccountsRoundedIcon />} onClick={() => setAdminOpen(true)}>
                  用户管理
                </Button>
                <Button color="inherit" size="small" startIcon={<AssessmentRoundedIcon />} onClick={() => setAuditOpen(true)}>
                  审计日志
                </Button>
                <Button color="inherit" size="small" startIcon={<StorageRoundedIcon />} onClick={() => setStorageStatsScope('global')}>
                  全局存储
                </Button>
              </>
            )}
            <WebAccountMenu username={username} serverBuild={serverBuild} onLogout={onLogout} />
          </Stack>
        </Toolbar>
      </AppBar>

      <Box
        className="web-workspace-shell"
        sx={{
          display: { xs: 'block', md: 'grid' },
          gridTemplateColumns: { md: '184px minmax(0, 1fr)' },
          minHeight: { md: 'calc(100vh - 64px)' },
        }}
      >
        <Box
          component="aside"
          aria-label="网页端功能区"
          sx={{
            minWidth: 0,
            bgcolor: 'background.paper',
            borderRight: { xs: 0, md: 1 },
            borderBottom: { xs: 1, md: 0 },
            borderColor: 'divider',
            p: { xs: 1, md: 1.5 },
            overflowX: { xs: 'auto', md: 'visible' },
          }}
        >
          <List
            component="nav"
            disablePadding
            sx={{
              display: { xs: 'flex', md: 'grid' },
              gap: 0.5,
              minWidth: { xs: 'max-content', md: 0 },
            }}
          >
            <ListItemButton
              selected={appView === 'files'}
              onClick={() => setAppView('files')}
              sx={webSidebarItemSx}
            >
              <ListItemIcon sx={webSidebarIconSx}><FolderRoundedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="文件" sx={webSidebarTextSx} />
            </ListItemButton>
            <ListItemButton
              selected={appView === 'gallery'}
              onClick={() => setAppView('gallery')}
              sx={webSidebarItemSx}
            >
              <ListItemIcon sx={webSidebarIconSx}><PhotoLibraryRoundedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="图库" sx={webSidebarTextSx} />
            </ListItemButton>
            <ListItemButton
              selected={appView === 'sources'}
              onClick={() => setAppView('sources')}
              sx={webSidebarItemSx}
            >
              <ListItemIcon sx={webSidebarIconSx}><CloudSyncRoundedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="外部来源" sx={webSidebarTextSx} />
            </ListItemButton>
            <ListItemButton
              selected={appView === 'storage'}
              onClick={() => setAppView('storage')}
              sx={webSidebarItemSx}
            >
              <ListItemIcon sx={webSidebarIconSx}><StorageRoundedIcon fontSize="small" /></ListItemIcon>
              <ListItemText
                primary="存储"
                secondary={quota ? `${formatSize(quota.physical_used_bytes)} / ${quota.quota_bytes === 0 ? '不限' : formatSize(quota.quota_bytes)}` : undefined}
                sx={webSidebarTextSx}
              />
            </ListItemButton>
          </List>
        </Box>

        <Box component="main" className="content-wrap" sx={{ minWidth: 0, width: '100%' }}>
        {appView === 'files' ? (
          <Paper className="file-card" variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, borderRadius: 2 }}>
            <div className="file-toolbar">
              <Breadcrumbs aria-label="文件路径">
                {crumbs.map((crumb, index) => (
                  index === crumbs.length - 1 ? (
                    <Typography key={crumb.id} variant="body2" color="text.primary">{crumb.name}</Typography>
                  ) : (
                    <Link
                      key={crumb.id}
                      component="button"
                      type="button"
                      underline="hover"
                      variant="body2"
                      onClick={() => void loadDirectory(crumb.id, crumbs.slice(0, index + 1))}
                    >
                      {crumb.name}
                    </Link>
                  )
                ))}
              </Breadcrumbs>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <XDriveActionButton compact startIcon={<RefreshRoundedIcon />} onClick={() => current && void loadDirectory(current.id)}>
                  刷新
                </XDriveActionButton>
                <XDriveActionButton compact startIcon={<RestoreFromTrashRoundedIcon />} onClick={openTrash}>
                  回收站
                </XDriveActionButton>
                <XDriveActionButton
                  compact
                  startIcon={<CreateNewFolderRoundedIcon />}
                  onClick={() => {
                    setFolderName('')
                    setFolderNameError('')
                    setFolderOpen(true)
                  }}
                >
                  新建文件夹
                </XDriveActionButton>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<UploadRoundedIcon />}
                  component="label"
                >
                  上传
                  <input
                    hidden
                    type="file"
                    multiple
                    onChange={(event) => {
                      void uploadFiles(event.target.files)
                      event.target.value = ''
                    }}
                  />
                </Button>
              </Stack>
            </div>

            {uploadProgress !== null && (
              <Box className="upload-progress">
                <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, uploadProgress))} />
              </Box>
            )}
            {loading && items.length > 0 ? <LinearProgress sx={{ mb: 1 }} /> : null}

            {loading && items.length === 0 ? (
              <XDriveStatePanel variant="plain" loading message="正在加载文件…" />
            ) : items.length === 0 ? (
              <XDriveStatePanel variant="plain" message="此文件夹为空" />
            ) : (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="文件列表">
                  <TableHead>
                    <TableRow>
                      <TableCell>名称</TableCell>
                      <TableCell sx={{ width: 120, display: { xs: 'none', md: 'table-cell' } }}>大小</TableCell>
                      <TableCell sx={{ width: 190, display: { xs: 'none', md: 'table-cell' } }}>修改时间</TableCell>
                      <TableCell align="right" sx={{ width: 220 }}>操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((node) => (
                      <TableRow key={node.id} hover>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {node.type === 'dir'
                              ? <FolderOpenRoundedIcon className="folder-icon" fontSize="small" />
                              : <InsertDriveFileRoundedIcon fontSize="small" />}
                            {node.type === 'dir' ? (
                              <Link
                                component="button"
                                type="button"
                                underline="hover"
                                onClick={() => enterDirectory(node)}
                              >
                                {node.name}
                              </Link>
                            ) : (
                              <Typography variant="body2">{node.name}</Typography>
                            )}
                            {node.type === 'dir' && <XDriveStatusBadge tone="neutral" label="文件夹" />}
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                          {node.type === 'dir' ? '—' : formatSize(node.size)}
                        </TableCell>
                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                          {new Date(node.updated_at).toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                            {node.type === 'file' && (
                              <Tooltip title="下载">
                                <IconButton size="small" aria-label={`下载 ${node.name}`} onClick={() => void api.download(node).catch(handleError)}>
                                  <DownloadRoundedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            {node.type === 'file' && (
                              <Tooltip title="分享">
                                <IconButton size="small" aria-label={`分享 ${node.name}`} onClick={() => setShareNode(node)}>
                                  <ShareRoundedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            {node.type === 'file' && (
                              <Tooltip title="历史版本">
                                <IconButton size="small" aria-label={`历史版本 ${node.name}`} onClick={() => void openHistory(node)}>
                                  <HistoryRoundedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            <Tooltip title="重命名">
                              <IconButton
                                size="small"
                                aria-label={`重命名 ${node.name}`}
                                onClick={() => {
                                  setRenameNode(node)
                                  setRenameName(node.name)
                                  setRenameNameError('')
                                }}
                              >
                                <EditRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="删除">
                              <IconButton color="error" size="small" aria-label={`删除 ${node.name}`} onClick={() => remove(node)}>
                                <DeleteOutlineRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        ) : appView === 'gallery' ? (
          <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, minHeight: 320, borderRadius: 2 }}>
            <XDriveMediaGalleryPage source={gallerySource} onError={handleError} />
          </Paper>
        ) : appView === 'sources' ? (
          <ExternalSourcesPanel
            open
            presentation="page"
            api={api}
            defaultTargetNodeID={current?.id}
            defaultTargetLabel={current?.name ?? '我的文件'}
            defaultTargetPath={crumbs.slice(1).map((crumb) => crumb.name).join('/')}
            onClose={() => setAppView('files')}
            onError={handleError}
          />
        ) : (
          <StorageStatsModal
            api={api}
            scope="self"
            open
            presentation="page"
            onClose={() => setAppView('files')}
          />
        )}
        </Box>
      </Box>

      <Dialog open={folderOpen} onClose={() => setFolderOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title="新建文件夹" onClose={() => setFolderOpen(false)} />
        <XDriveDialogContent>
          <Stack component="form" spacing={2} onSubmit={(event) => void createFolder(event)}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="文件夹名称"
              value={folderName}
              error={Boolean(folderNameError)}
              helperText={folderNameError || ' '}
              onChange={(event) => {
                setFolderName(event.target.value)
                if (folderNameError) setFolderNameError('')
              }}
            />
            <XDriveActionButton intent="primary" type="submit">创建</XDriveActionButton>
          </Stack>
        </XDriveDialogContent>
      </Dialog>

      <Dialog open={!!renameNode} onClose={() => setRenameNode(null)} maxWidth="sm" fullWidth slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title="重命名" onClose={() => setRenameNode(null)} />
        <XDriveDialogContent>
          <Stack component="form" spacing={2} onSubmit={(event) => void rename(event)}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="名称"
              value={renameName}
              error={Boolean(renameNameError)}
              helperText={renameNameError || ' '}
              onChange={(event) => {
                setRenameName(event.target.value)
                if (renameNameError) setRenameNameError('')
              }}
            />
            <XDriveActionButton intent="primary" type="submit">保存</XDriveActionButton>
          </Stack>
        </XDriveDialogContent>
      </Dialog>

      <Dialog open={trashOpen} onClose={() => setTrashOpen(false)} maxWidth="md" fullWidth scroll="paper" slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title="回收站" onClose={() => setTrashOpen(false)} />
        <XDriveDialogContent dividers>
          {trashLoading && trashItems.length === 0 ? (
            <XDriveStatePanel variant="plain" loading message="正在加载回收站…" />
          ) : trashItems.length === 0 ? (
            <XDriveStatePanel variant="plain" message="回收站为空" />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="回收站">
                <TableHead>
                  <TableRow>
                    <TableCell>名称</TableCell>
                    <TableCell sx={{ width: 190 }}>删除时间</TableCell>
                    <TableCell align="right" sx={{ width: 230 }}>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {trashItems.map((node) => (
                    <TableRow key={node.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {node.type === 'dir' ? <FolderOpenRoundedIcon fontSize="small" /> : <InsertDriveFileRoundedIcon fontSize="small" />}
                          <Typography variant="body2">{node.name}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>{node.deleted_at ? new Date(node.deleted_at).toLocaleString() : '—'}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <XDriveActionButton
                            compact
                            onClick={() => void (async () => {
                              try {
                                await api.restoreTrash(node.id, node.revision)
                                setFeedback({ tone: 'good', message: '已恢复' })
                                await loadTrash()
                                if (current) await loadDirectory(current.id)
                                await refreshQuota()
                              } catch (err) {
                                handleError(err)
                              }
                            })()}
                          >
                            恢复
                          </XDriveActionButton>
                          <XDriveActionButton
                            compact
                            intent="danger"
                            onClick={() => setConfirmAction({
                              title: `永久删除 ${node.name}？`,
                              description: '该项目、当前内容以及所有已保存的历史版本都将被永久删除。',
                              confirmLabel: '永久删除',
                              intent: 'danger',
                              run: async () => {
                                await api.permanentlyDeleteTrash(node.id, node.revision)
                                setFeedback({ tone: 'good', message: '已永久删除' })
                                await loadTrash()
                                await refreshQuota()
                              },
                            })}
                          >
                            永久删除
                          </XDriveActionButton>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </XDriveDialogContent>
      </Dialog>

      <Dialog
        open={!!historyNode}
        onClose={() => {
          setHistoryNode(null)
          setVersions([])
        }}
        maxWidth="md"
        fullWidth
        scroll="paper"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={historyNode ? `版本历史 — ${historyNode.name}` : '版本历史'}
          onClose={() => {
            setHistoryNode(null)
            setVersions([])
          }}
        />
        <XDriveDialogContent dividers>
          {versionsLoading && versions.length === 0 ? (
            <XDriveStatePanel variant="plain" loading message="正在加载历史版本…" />
          ) : versions.length === 0 ? (
            <XDriveStatePanel variant="plain" message="暂无历史版本" />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="版本历史">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 110 }}>版本</TableCell>
                    <TableCell sx={{ width: 120 }}>大小</TableCell>
                    <TableCell sx={{ width: 190 }}>保存时间</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {versions.map((version) => (
                    <TableRow key={version.id} hover>
                      <TableCell>{`r${version.revision}`}</TableCell>
                      <TableCell>{formatSize(version.size)}</TableCell>
                      <TableCell>{new Date(version.created_at).toLocaleString()}</TableCell>
                      <TableCell align="right">
                        {historyNode && (
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <XDriveActionButton compact onClick={() => void api.downloadVersion(historyNode, version).catch(handleError)}>
                              下载
                            </XDriveActionButton>
                            <XDriveActionButton
                              compact
                              intent="primary"
                              onClick={() => setConfirmAction({
                                title: `恢复到版本 ${version.revision}？`,
                                description: '当前内容会先保留为一个新的历史版本。',
                                confirmLabel: '恢复版本',
                                intent: 'primary',
                                run: async () => {
                                  const restored = await api.restoreVersion(historyNode.id, historyNode.revision, version.id)
                                  setFeedback({ tone: 'good', message: '版本已恢复' })
                                  setHistoryNode(restored)
                                  setVersions(await api.versions(restored.id))
                                  if (current) await loadDirectory(current.id)
                                  await refreshQuota()
                                },
                              })}
                            >
                              恢复
                            </XDriveActionButton>
                          </Stack>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </XDriveDialogContent>
      </Dialog>

      <Dialog
        open={!!confirmAction}
        onClose={() => {
          if (!confirmBusy) setConfirmAction(null)
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={confirmAction?.title ?? '确认操作'}
          onClose={() => setConfirmAction(null)}
          closeDisabled={confirmBusy}
        />
        <XDriveDialogContent>
          <Typography variant="body2">{confirmAction?.description}</Typography>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton disabled={confirmBusy} onClick={() => setConfirmAction(null)}>取消</XDriveActionButton>
          <XDriveActionButton
            intent={confirmAction?.intent ?? 'primary'}
            loading={confirmBusy}
            loadingLabel="正在处理…"
            onClick={() => void executeConfirm()}
          >
            {confirmAction?.confirmLabel ?? '确认'}
          </XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <ShareDialog api={api} node={shareNode} onClose={() => setShareNode(null)} onError={handleError} />

      <StorageStatsModal
        api={api}
        scope={storageStatsScope ?? 'self'}
        open={storageStatsScope !== null}
        onClose={() => setStorageStatsScope(null)}
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
          <AdminAuditPanel api={api} open={auditOpen} onClose={() => setAuditOpen(false)} />
        </>
      )}

      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={3500}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setFeedback(null)
        }}
      >
        <div>{feedback ? <XDriveStatusAlert tone={feedback.tone}>{feedback.message}</XDriveStatusAlert> : null}</div>
      </Snackbar>
    </Box>
  )
}

export default App
