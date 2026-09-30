import type { ReactNode } from 'react'
import { MenuItem, TextField } from '@mui/material'

export type XDriveSourceRunMode = 'scan' | 'sync'
export type XDriveSourceStatus = 'active' | 'paused'

export function XDriveSourceNameField({
  value,
  onChange,
  label = '来源名称',
  error = false,
  helperText,
  autoFocus = false,
  required = false,
  maxLength = 128,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  error?: boolean
  helperText?: ReactNode
  autoFocus?: boolean
  required?: boolean
  maxLength?: number
}) {
  return (
    <TextField
      autoFocus={autoFocus}
      fullWidth
      size="small"
      label={label}
      value={value}
      error={error}
      helperText={helperText}
      required={required}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { maxLength } }}
    />
  )
}

export function XDriveSourceRunModeField({
  value,
  onChange,
  label = '运行模式',
  scanLabel = '仅扫描',
  syncLabel = '同步',
  syncFirst = false,
}: {
  value: XDriveSourceRunMode
  onChange: (value: XDriveSourceRunMode) => void
  label?: string
  scanLabel?: ReactNode
  syncLabel?: ReactNode
  syncFirst?: boolean
}) {
  const scan = <MenuItem key="scan" value="scan">{scanLabel}</MenuItem>
  const sync = <MenuItem key="sync" value="sync">{syncLabel}</MenuItem>

  return (
    <TextField
      select
      fullWidth
      size="small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as XDriveSourceRunMode)}
    >
      {syncFirst ? [sync, scan] : [scan, sync]}
    </TextField>
  )
}

export function XDriveSourceStatusField({
  value,
  onChange,
  label = '来源状态',
}: {
  value: XDriveSourceStatus
  onChange: (value: XDriveSourceStatus) => void
  label?: string
}) {
  return (
    <TextField
      select
      fullWidth
      size="small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as XDriveSourceStatus)}
    >
      <MenuItem value="active">启用</MenuItem>
      <MenuItem value="paused">暂停</MenuItem>
    </TextField>
  )
}
