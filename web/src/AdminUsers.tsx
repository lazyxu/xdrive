import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Dialog,
  FormControlLabel,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveDialogActions,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStatusBadge,
  XDriveWorkspaceSurface,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
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

function initialCreateValues(): CreateForm {
  return {
    username: '',
    password: '',
    role: 'user',
    must_change_password: true,
    quota_gib: 0,
  }
}

function initialResetValues(): ResetForm {
  return {
    password: '',
    must_change_password: true,
  }
}

export default function AdminUsersPanel({
  api,
  currentUserID,
  onChanged,
}: {
  api: XDriveApi
  currentUserID: number
  onChanged: () => void
}) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createValues, setCreateValues] = useState<CreateForm>(initialCreateValues)
  const [createUsernameError, setCreateUsernameError] = useState('')
  const [createPasswordError, setCreatePasswordError] = useState('')
  const [quotaUser, setQuotaUser] = useState<AdminUser | null>(null)
  const [quotaGiB, setQuotaGiB] = useState(0)
  const [quotaError, setQuotaError] = useState('')
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [resetValues, setResetValues] = useState<ResetForm>(initialResetValues)
  const [resetPasswordError, setResetPasswordError] = useState('')
  const [confirmAction, setConfirmAction] = useState<AdminConfirmAction | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [actionError, setActionError] = useState<AdminActionError | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      setUsers(await api.adminUsers())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // api is stable for one authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

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
      setFeedback(successMessage)
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
      setFeedback(action.successMessage)
      setConfirmAction(null)
    } catch (err) {
      setConfirmAction(null)
      showActionError(action.errorTitle, err, action.errorFallback)
    } finally {
      setConfirmLoading(false)
    }
  }

  const openCreate = () => {
    setCreateValues(initialCreateValues())
    setCreateUsernameError('')
    setCreatePasswordError('')
    setCreateOpen(true)
  }

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const username = createValues.username.trim()
    const usernameError = !username
      ? '请填写用户名'
      : username.length < 3 || username.length > 64
        ? '用户名长度需要 3–64 个字符'
        : ''
    const passwordError = createValues.password.length < 8 ? '临时密码至少需要 8 个字符' : ''
    setCreateUsernameError(usernameError)
    setCreatePasswordError(passwordError)
    if (usernameError || passwordError) return

    try {
      await api.adminCreateUser({
        username,
        password: createValues.password,
        role: createValues.role,
        must_change_password: createValues.must_change_password,
        quota_bytes: gibToBytes(createValues.quota_gib),
      })
      setFeedback('用户已创建')
      setCreateOpen(false)
      setCreateValues(initialCreateValues())
      await load()
    } catch (err) {
      showActionError('创建用户失败', err, '无法创建用户，请检查输入后重试。')
    }
  }

  const saveQuota = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!quotaUser) return
    const nextError = Number.isFinite(quotaGiB) && quotaGiB >= 0 ? '' : '配额必须是大于等于 0 的数字'
    setQuotaError(nextError)
    if (nextError) return

    try {
      await api.adminUpdateUser(quotaUser.id, { quota_bytes: gibToBytes(quotaGiB) })
      setFeedback('存储配额已更新')
      setQuotaUser(null)
      await load()
      onChanged()
    } catch (err) {
      showActionError('更新存储配额失败', err, '无法更新存储配额，请稍后重试。')
    }
  }

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!resetUser) return
    const nextError = resetValues.password.length < 8 ? '新临时密码至少需要 8 个字符' : ''
    setResetPasswordError(nextError)
    if (nextError) return

    try {
      await api.adminResetPassword(resetUser.id, resetValues.password, resetValues.must_change_password)
      setFeedback('密码已重置，现有会话已撤销')
      setResetUser(null)
      setResetValues(initialResetValues())
      await load()
    } catch (err) {
      showActionError('重置密码失败', err, '无法重置该用户密码，请稍后重试。')
    }
  }

  return (
    <>
      <XDriveWorkspaceSurface presentation="page" title="用户管理">
        <Stack spacing={2}>
            <Stack direction="row" justifyContent="flex-end">
              <XDriveActionButton intent="primary" onClick={openCreate}>创建用户</XDriveActionButton>
            </Stack>

            {loadError && <XDriveStatusAlert tone="bad">{loadError}</XDriveStatusAlert>}
            {loading && users.length > 0 ? <LinearProgress /> : null}

            {loading && users.length === 0 ? (
              <XDriveStatePanel variant="plain" loading message="正在加载用户…" />
            ) : users.length === 0 ? (
              <XDriveStatePanel variant="plain" message="暂无用户" />
            ) : (
              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflowX: 'auto' }}>
                <Table size="small" aria-label="用户管理" sx={{ minWidth: 1180 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>用户</TableCell>
                      <TableCell sx={{ width: 140 }}>角色</TableCell>
                      <TableCell sx={{ width: 100 }}>启用</TableCell>
                      <TableCell sx={{ width: 150 }}>密码</TableCell>
                      <TableCell sx={{ width: 340 }}>存储</TableCell>
                      <TableCell sx={{ width: 190 }}>上次登录</TableCell>
                      <TableCell sx={{ width: 330 }}>操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id} hover>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="body2" fontWeight={user.id === currentUserID ? 700 : 400}>
                              {user.username}
                            </Typography>
                            {user.id === currentUserID && <XDriveStatusBadge tone="neutral" label="当前用户" />}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <TextField
                            select
                            size="small"
                            value={user.role}
                            disabled={user.id === currentUserID}
                            onChange={(event) => {
                              const role = event.target.value as 'user' | 'admin'
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
                            sx={{ minWidth: 110 }}
                          >
                            <MenuItem value="user">普通用户</MenuItem>
                            <MenuItem value="admin">管理员</MenuItem>
                          </TextField>
                        </TableCell>
                        <TableCell>
                          <Switch
                            size="small"
                            checked={!user.disabled}
                            disabled={user.id === currentUserID}
                            inputProps={{ 'aria-label': `${user.username} 启用状态` }}
                            onChange={(_event, enabled) => {
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
                        </TableCell>
                        <TableCell>
                          {user.must_change_password
                            ? <XDriveStatusBadge tone="warning" label="需要修改" />
                            : <XDriveStatusBadge tone="good" label="已设置" />}
                        </TableCell>
                        <TableCell>
                          <Stack spacing={0.25}>
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                              <Typography variant="body2">
                                {formatBytes(user.physical_used_bytes)} / {user.quota_bytes === 0 ? '不限' : formatBytes(user.quota_bytes)}
                              </Typography>
                              {user.over_quota && <XDriveStatusBadge tone="bad" label="已超配额" />}
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              可用 {formatBytes(user.available_bytes)}
                              {user.quota_bytes === 0 ? '（服务器磁盘）' : ''}
                              {user.reserved_bytes > 0 ? ` · 上传预占 ${formatBytes(user.reserved_bytes)}` : ''}
                              {' · '}文件 {formatBytes(user.logical_file_bytes)} · 回收站 {formatBytes(user.trash_bytes)} · 历史版本 {formatBytes(user.history_bytes)}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '从未'}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                            <XDriveActionButton
                              compact
                              onClick={() => {
                                setQuotaUser(user)
                                setQuotaGiB(quotaToGiB(user.quota_bytes))
                                setQuotaError('')
                              }}
                            >
                              设置配额
                            </XDriveActionButton>
                            <XDriveActionButton
                              compact
                              onClick={() => {
                                setResetUser(user)
                                setResetValues(initialResetValues())
                                setResetPasswordError('')
                              }}
                            >
                              重置密码
                            </XDriveActionButton>
                            <XDriveActionButton
                              compact
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
                            </XDriveActionButton>
                            {user.id !== currentUserID && (
                              <XDriveActionButton
                                compact
                                intent="danger"
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
                              </XDriveActionButton>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
        </Stack>
      </XDriveWorkspaceSurface>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle title="创建用户" onClose={() => setCreateOpen(false)} />
        <XDriveDialogContent>
          <Stack component="form" spacing={2} onSubmit={(event) => void createUser(event)}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="用户名"
              autoComplete="off"
              value={createValues.username}
              error={Boolean(createUsernameError)}
              helperText={createUsernameError || '3–64 个字符'}
              onChange={(event) => {
                setCreateValues((current) => ({ ...current, username: event.target.value }))
                if (createUsernameError) setCreateUsernameError('')
              }}
            />
            <TextField
              fullWidth
              size="small"
              type="password"
              label="临时密码"
              autoComplete="new-password"
              value={createValues.password}
              error={Boolean(createPasswordError)}
              helperText={createPasswordError || '至少 8 个字符'}
              onChange={(event) => {
                setCreateValues((current) => ({ ...current, password: event.target.value }))
                if (createPasswordError) setCreatePasswordError('')
              }}
            />
            <TextField
              select
              fullWidth
              size="small"
              label="角色"
              value={createValues.role}
              onChange={(event) => setCreateValues((current) => ({ ...current, role: event.target.value as 'user' | 'admin' }))}
            >
              <MenuItem value="user">普通用户</MenuItem>
              <MenuItem value="admin">管理员</MenuItem>
            </TextField>
            <TextField
              fullWidth
              size="small"
              type="number"
              label="存储配额"
              value={createValues.quota_gib}
              helperText="0 表示不限。当前文件、回收站内容和历史版本都会计入配额。"
              onChange={(event) => {
                const parsed = Number.parseFloat(event.target.value || '0')
                setCreateValues((current) => ({ ...current, quota_gib: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 }))
              }}
              slotProps={{
                htmlInput: { min: 0, step: 0.001 },
                input: { endAdornment: <InputAdornment position="end">GiB</InputAdornment> },
              }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={createValues.must_change_password}
                  onChange={(_event, checked) => setCreateValues((current) => ({ ...current, must_change_password: checked }))}
                />
              }
              label="首次登录时要求修改密码"
            />
            <XDriveActionButton intent="primary" type="submit">创建</XDriveActionButton>
          </Stack>
        </XDriveDialogContent>
      </Dialog>

      <Dialog
        open={!!quotaUser}
        onClose={() => setQuotaUser(null)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={quotaUser ? `存储配额 — ${quotaUser.username}` : '存储配额'}
          onClose={() => setQuotaUser(null)}
        />
        <XDriveDialogContent>
          <Stack component="form" spacing={2} onSubmit={(event) => void saveQuota(event)}>
            <Typography variant="body2" color="text.secondary">
              0 GiB 表示不限。将配额降低到当前用量以下不会删除数据；在用量降到配额以下之前，新增占用空间的上传和覆盖写入会被阻止。
            </Typography>
            <TextField
              autoFocus
              fullWidth
              size="small"
              type="number"
              label="配额"
              value={quotaGiB}
              error={Boolean(quotaError)}
              helperText={quotaError || ' '}
              onChange={(event) => {
                const parsed = Number.parseFloat(event.target.value)
                setQuotaGiB(Number.isFinite(parsed) ? parsed : 0)
                if (quotaError) setQuotaError('')
              }}
              slotProps={{
                htmlInput: { min: 0, step: 0.001 },
                input: { endAdornment: <InputAdornment position="end">GiB</InputAdornment> },
              }}
            />
            <XDriveActionButton intent="primary" type="submit">保存配额</XDriveActionButton>
          </Stack>
        </XDriveDialogContent>
      </Dialog>

      <Dialog
        open={!!resetUser}
        onClose={() => setResetUser(null)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={resetUser ? `重置密码 — ${resetUser.username}` : '重置密码'}
          onClose={() => setResetUser(null)}
        />
        <XDriveDialogContent>
          <Stack component="form" spacing={2} onSubmit={(event) => void resetPassword(event)}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              type="password"
              label="新临时密码"
              autoComplete="new-password"
              value={resetValues.password}
              error={Boolean(resetPasswordError)}
              helperText={resetPasswordError || '至少 8 个字符'}
              onChange={(event) => {
                setResetValues((current) => ({ ...current, password: event.target.value }))
                if (resetPasswordError) setResetPasswordError('')
              }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={resetValues.must_change_password}
                  onChange={(_event, checked) => setResetValues((current) => ({ ...current, must_change_password: checked }))}
                />
              }
              label="下次登录时要求修改密码"
            />
            <XDriveActionButton intent="primary" type="submit">重置密码</XDriveActionButton>
          </Stack>
        </XDriveDialogContent>
      </Dialog>

      <Dialog
        open={!!confirmAction}
        onClose={() => {
          if (!confirmLoading) setConfirmAction(null)
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={confirmAction?.title ?? '确认操作'}
          onClose={() => setConfirmAction(null)}
          closeDisabled={confirmLoading}
        />
        <XDriveDialogContent>
          <Typography variant="body2">{confirmAction?.description}</Typography>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton disabled={confirmLoading} onClick={() => setConfirmAction(null)}>取消</XDriveActionButton>
          <XDriveActionButton
            intent={confirmAction?.danger ? 'danger' : 'primary'}
            loading={confirmLoading}
            loadingLabel="正在处理…"
            onClick={() => void executeConfirmAction()}
          >
            {confirmAction?.confirmLabel ?? '确认'}
          </XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Dialog
        open={!!actionError}
        onClose={() => setActionError(null)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle title={actionError?.title ?? '操作失败'} onClose={() => setActionError(null)} />
        <XDriveDialogContent>
          {actionError && <XDriveStatusAlert tone="bad">{actionError.message}</XDriveStatusAlert>}
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton intent="primary" onClick={() => setActionError(null)}>知道了</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={3000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setFeedback('')
        }}
      >
        <div>{feedback ? <XDriveStatusAlert tone="good">{feedback}</XDriveStatusAlert> : null}</div>
      </Snackbar>
    </>
  )
}
