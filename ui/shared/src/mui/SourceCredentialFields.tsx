import type { ReactNode } from 'react'
import { Stack, TextField } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { synologyDsmAddressHelp } from '../external-sources'
import { XDriveSensitiveField } from './SensitiveField'

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
    <XDriveSensitiveField
      label={label} value={value} onChange={onChange}
      placeholder={placeholder} helperText={helperText} required={required}
      onFocus={onFocus} sx={sx} autoComplete="off"
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
  configured = false,
  revealedPassword = '',
  onRevealPassword,
  onHidePassword,
  passwordRevealLoading = false,
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
  configured?: boolean
  revealedPassword?: string
  onRevealPassword?: () => void
  onHidePassword?: () => void
  passwordRevealLoading?: boolean
  sx?: SxProps<Theme>
}) {
  const updating = mode === 'update'
  const retainedPlaceholder = updating ? '留空则保持当前配置不变' : undefined

  return (
    <Stack spacing={1.5} sx={sx}>
      <TextField
        fullWidth
        size="small"
        label="DSM 地址"
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
        label="DSM 用户名"
        placeholder={retainedPlaceholder}
        autoComplete="username"
        value={username}
        required={required}
        onChange={(event) => onUsernameChange(event.target.value)}
      />
      <XDriveSensitiveField label="DSM 密码"
        value={password} onChange={onPasswordChange}
        configured={configured} revealedValue={revealedPassword}
        onReveal={onRevealPassword} onHide={onHidePassword}
        revealLoading={passwordRevealLoading}
        required={required} autoComplete="new-password" />
    </Stack>
  )
}


export function XDriveSourceTargetField({
  value,
  managed = false,
  label = '目标目录',
  sx,
}: {
  value?: string
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
      helperText={managed
        ? '该目录由连接器按账号身份管理，普通设置保存不会修改目录。'
        : '当前同步目标目录为只读值；普通设置保存不会修改目录。'}
      slotProps={{ input: { readOnly: true } }}
      sx={sx}
    />
  )
}
