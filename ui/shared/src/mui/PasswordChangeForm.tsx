import type { FormEventHandler, ReactNode } from 'react'
import { Stack } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveActionButton } from './ActionButton'
import { XDriveAuthPasswordField } from './AuthForm'
import { XDriveStatusAlert } from './StatusAlert'

export interface XDrivePasswordChangeValues {
  current: string
  next: string
  confirm: string
}

export function xDrivePasswordChangeValidationError(values: XDrivePasswordChangeValues) {
  if (!values.current) return '请填写当前密码'
  if (values.next.length < 8) return '新密码至少需要 8 个字符'
  if (values.next !== values.confirm) return '两次输入的新密码不一致'
  return ''
}

export function XDrivePasswordChangeForm({
  values,
  error,
  loading = false,
  disabled = false,
  loadingLabel = '正在更新…',
  submitFullWidth = false,
  className,
  buttonClassName,
  sx,
  onChange,
  onSubmit,
}: {
  values: XDrivePasswordChangeValues
  error?: ReactNode
  loading?: boolean
  disabled?: boolean
  loadingLabel?: string
  submitFullWidth?: boolean
  className?: string
  buttonClassName?: string
  sx?: SxProps<Theme>
  onChange: (field: keyof XDrivePasswordChangeValues, value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
}) {
  return (
    <Stack component="form" className={className} spacing={2} sx={sx} onSubmit={onSubmit}>
      {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}
      <XDriveAuthPasswordField
        id="xdrive-current-password"
        label="当前密码"
        autoComplete="current-password"
        value={values.current}
        disabled={disabled || loading}
        onChange={(value) => onChange('current', value)}
      />
      <XDriveAuthPasswordField
        id="xdrive-new-password"
        label="新密码"
        autoComplete="new-password"
        value={values.next}
        disabled={disabled || loading}
        minLength={8}
        onChange={(value) => onChange('next', value)}
      />
      <XDriveAuthPasswordField
        id="xdrive-confirm-password"
        label="确认新密码"
        autoComplete="new-password"
        value={values.confirm}
        disabled={disabled || loading}
        minLength={8}
        onChange={(value) => onChange('confirm', value)}
      />
      <XDriveActionButton
        className={buttonClassName}
        fullWidth={submitFullWidth}
        intent="primary"
        type="submit"
        disabled={disabled}
        loading={loading}
        loadingLabel={loadingLabel}
      >
        修改密码
      </XDriveActionButton>
    </Stack>
  )
}
