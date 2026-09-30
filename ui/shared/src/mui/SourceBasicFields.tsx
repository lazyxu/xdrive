import type { ReactNode } from 'react'
import { ListItemText, MenuItem, TextField } from '@mui/material'
import type {
  ExternalSourceCreatePreset,
  ExternalSourceRunMode,
  ExternalSourceStatus,
} from '../external-sources'
import {
  externalSourceCreateOption,
  externalSourceCreateOptions,
} from '../external-sources'
import { XDriveSourceKindIcon } from './SourceKindIcon'

export function XDriveSourcePresetField({
  value,
  onChange,
  label = '来源类型',
}: {
  value: ExternalSourceCreatePreset
  onChange: (value: ExternalSourceCreatePreset) => void
  label?: ReactNode
}) {
  const selected = externalSourceCreateOption(value)

  return (
    <TextField
      select
      fullWidth
      size="small"
      label={label}
      value={value}
      helperText={selected.description}
      onChange={(event) => onChange(event.target.value as ExternalSourceCreatePreset)}
      sx={{ minWidth: 0 }}
    >
      {externalSourceCreateOptions.map((option) => (
        <MenuItem key={option.value} value={option.value} sx={{ gap: 1 }}>
          <XDriveSourceKindIcon kind={option.kind} size="small" title={option.label} />
          <ListItemText primary={option.label} />
        </MenuItem>
      ))}
    </TextField>
  )
}

export function XDriveSourceNameField({
  value,
  onChange,
  label = '来源名称',
  error = false,
  helperText,
  autoFocus = false,
  required = false,
  maxLength,
}: {
  value: string
  onChange: (value: string) => void
  label?: ReactNode
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
      slotProps={maxLength === undefined ? undefined : { htmlInput: { maxLength } }}
      sx={{ minWidth: 0 }}
    />
  )
}

export function XDriveSourceRunModeField({
  value,
  onChange,
  label = '运行模式',
  scanLabel = '仅扫描',
}: {
  value: ExternalSourceRunMode
  onChange: (value: ExternalSourceRunMode) => void
  label?: ReactNode
  scanLabel?: ReactNode
}) {
  return (
    <TextField
      select
      fullWidth
      size="small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as ExternalSourceRunMode)}
      sx={{ minWidth: 0 }}
    >
      <MenuItem value="scan">{scanLabel}</MenuItem>
      <MenuItem value="sync">同步</MenuItem>
    </TextField>
  )
}

export function XDriveSourceStatusField({
  value,
  onChange,
  label = '状态',
}: {
  value: ExternalSourceStatus
  onChange: (value: ExternalSourceStatus) => void
  label?: ReactNode
}) {
  return (
    <TextField
      select
      fullWidth
      size="small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as ExternalSourceStatus)}
      sx={{ minWidth: 0 }}
    >
      <MenuItem value="active">启用</MenuItem>
      <MenuItem value="paused">暂停</MenuItem>
    </TextField>
  )
}
