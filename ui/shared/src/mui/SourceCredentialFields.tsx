import { useEffect } from 'react'
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

export function XDriveStoredCredentialField({
  label,
  configured,
  revealedValue = '',
  loading = false,
  expiresInSeconds = 30,
  updatedAtLabel,
  configuredDescription = '凭据已加密保存；点击“显示”后仅在当前界面内存中临时展示。',
  onReveal,
  onHide,
  sx,
}: {
  label: ReactNode
  configured: boolean
  revealedValue?: string
  loading?: boolean
  expiresInSeconds?: number
  updatedAtLabel?: string
  configuredDescription?: string
  onReveal: () => void
  onHide: () => void
  sx?: SxProps<Theme>
}) {
  useEffect(() => {
    if (!revealedValue) return
    const timeout = globalThis.setTimeout(onHide, Math.max(1, expiresInSeconds) * 1000)
    return () => globalThis.clearTimeout(timeout)
  }, [expiresInSeconds, onHide, revealedValue])

  const helper = configured
    ? revealedValue
      ? `已临时显示，将在 ${Math.max(1, expiresInSeconds)} 秒后自动隐藏。`
      : configuredDescription
    : '尚未配置凭据。'
  const helperText = updatedAtLabel ? `${helper} 最后更新：${updatedAtLabel}` : helper

  return (
    <TextField
      fullWidth
      size="small"
      label={label}
      value={configured ? (revealedValue || externalSourceSavedCredentialMask) : '未配置'}
      helperText={helperText}
      autoComplete="off"
      slotProps={{
        input: {
          readOnly: true,
          endAdornment: configured ? (
            <InputAdornment position="end">
              <Button
                type="button"
                size="small"
                disabled={loading}
                onClick={revealedValue ? onHide : onReveal}
              >
                {loading ? '读取中…' : revealedValue ? '隐藏' : '显示'}
              </Button>
            </InputAdornment>
          ) : undefined,
        },
      }}
      sx={sx}
    />
  )
}
