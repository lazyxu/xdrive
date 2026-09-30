import type { ReactNode } from 'react'
import { Button, InputAdornment, Stack, TextField } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { externalSourceSavedCredentialMask, synologyDsmAddressHelp } from '../external-sources'

export function XDriveSourceCookieField({
  value,
  onChange,
  placeholder,
  helperText,
  required = false,
  onFocus,
  label = '一刻相册 Cookie',
  sx,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  helperText?: ReactNode
  required?: boolean
  onFocus?: () => void
  label?: ReactNode
  sx?: SxProps<Theme>
}) {
  return (
    <TextField
      fullWidth
      size="small"
      type="password"
      label={label}
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      helperText={helperText}
      required={required}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      sx={sx}
    />
  )
}

export function XDriveSynologyDsmCredentialFields({
  baseURL,
  username,
  password,
  onBaseURLChange,
  onUsernameChange,
  onPasswordChange,
  mode = 'create',
  required = false,
  sx,
}: {
  baseURL: string
  username: string
  password: string
  onBaseURLChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  mode?: 'create' | 'update'
  required?: boolean
  sx?: SxProps<Theme>
}) {
  const updating = mode === 'update'
  const retainedPlaceholder = updating ? '留空则保持当前配置不变' : undefined

  return (
    <Stack spacing={1.5} sx={sx}>
      <TextField
        fullWidth
        size="small"
        label={updating ? '更新 DSM 地址' : 'DSM 地址'}
        placeholder={updating ? retainedPlaceholder : 'https://nas.example.com:5001'}
        helperText={synologyDsmAddressHelp}
        autoComplete="off"
        value={baseURL}
        required={required}
        onChange={(event) => onBaseURLChange(event.target.value)}
      />
      <TextField
        fullWidth
        size="small"
        label={updating ? '更新 DSM 用户名' : 'DSM 用户名'}
        placeholder={retainedPlaceholder}
        autoComplete="username"
        value={username}
        required={required}
        onChange={(event) => onUsernameChange(event.target.value)}
      />
      <TextField
        fullWidth
        size="small"
        type="password"
        label={updating ? '更新 DSM 密码' : 'DSM 密码'}
        placeholder={retainedPlaceholder}
        autoComplete="new-password"
        value={password}
        required={required}
        onChange={(event) => onPasswordChange(event.target.value)}
      />
    </Stack>
  )
}

export function XDriveSourceTargetField({
  value,
  managed = false,
  label = '目标目录',
  sx,
}: {
  value: string
  managed?: boolean
  label?: ReactNode
  sx?: SxProps<Theme>
}) {
  return (
    <TextField
      fullWidth
      size="small"
      label={label}
      value={value || '未配置'}
      helperText={managed ? '固定目录由服务器根据已绑定账号管理，不可在此修改。' : '同步目标目录为只读信息。'}
      slotProps={{ input: { readOnly: true } }}
      sx={sx}
    />
  )
}

export function XDriveSourceCredentialRevealField({
  label,
  configured,
  revealedValue,
  updatedAtLabel,
  loading = false,
  onReveal,
  onHide,
  sx,
}: {
  label: ReactNode
  configured: boolean
  revealedValue?: string
  updatedAtLabel?: string
  loading?: boolean
  onReveal: () => void
  onHide: () => void
  sx?: SxProps<Theme>
}) {
  const revealed = Boolean(revealedValue)
  const helper = configured
    ? `${updatedAtLabel ? `已保存 · ${updatedAtLabel} · ` : '已保存 · '}默认遮罩；显示后会在 30 秒内自动隐藏。`
    : '当前未配置凭据。'

  return (
    <TextField
      fullWidth
      size="small"
      label={label}
      value={revealed ? revealedValue : configured ? externalSourceSavedCredentialMask : ''}
      placeholder={configured ? externalSourceSavedCredentialMask : '未配置'}
      helperText={helper}
      autoComplete="off"
      slotProps={{
        input: {
          readOnly: true,
          endAdornment: configured ? (
            <InputAdornment position="end">
              <Button
                size="small"
                disabled={loading}
                onClick={revealed ? onHide : onReveal}
              >
                {loading ? '正在读取…' : revealed ? '隐藏' : '显示'}
              </Button>
            </InputAdornment>
          ) : undefined,
        },
      }}
      sx={sx}
    />
  )
}

