import type { ReactNode } from 'react'
import { Stack, TextField } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { synologyDsmAddressHelp } from '../external-sources'

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
