import { useId } from 'react'
import type { ReactNode } from 'react'
import {
  Checkbox,
  FormControl,
  FormHelperText,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  TextField,
} from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { SxProps, Theme } from '@mui/material/styles'
import type { SynologyPhotoSpace } from '../external-sources'
import {
  normalizeSynologyPhotoSpaces,
  synologyPhotoSpaceOptions,
} from '../external-sources'

function photoSpaceLabel(value: SynologyPhotoSpace) {
  return synologyPhotoSpaceOptions.find((option) => option.value === value)?.label ?? value
}

export function XDriveSynologyPhotoSpacesField({
  value,
  onChange,
  error = false,
  helperText = '至少选择一个照片空间',
  label = '同步空间',
  sx,
}: {
  value: SynologyPhotoSpace[]
  onChange: (value: SynologyPhotoSpace[]) => void
  error?: boolean
  helperText?: ReactNode
  label?: ReactNode
  sx?: SxProps<Theme>
}) {
  const id = useId()
  const labelId = `${id}-label`

  return (
    <FormControl fullWidth size="small" error={error} sx={sx}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select<SynologyPhotoSpace[]>
        labelId={labelId}
        multiple
        value={value}
        input={<OutlinedInput label={label} />}
        renderValue={(selected) => selected.map(photoSpaceLabel).join('、')}
        onChange={(event: SelectChangeEvent<SynologyPhotoSpace[]>) => {
          const raw = event.target.value
          const spaces = (typeof raw === 'string' ? raw.split(',') : raw)
            .filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
          onChange(normalizeSynologyPhotoSpaces(spaces))
        }}
      >
        {synologyPhotoSpaceOptions.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            <Checkbox checked={value.includes(option.value)} />
            <ListItemText primary={option.label} />
          </MenuItem>
        ))}
      </Select>
      {helperText ? <FormHelperText>{helperText}</FormHelperText> : null}
    </FormControl>
  )
}

export function XDriveSynologyFileRootsField({
  value,
  onChange,
  error = false,
  helperText = '每行一个 DSM 绝对目录',
  label = 'File Station 根目录',
  placeholder = '/documents\n/video/projects',
  minRows = 3,
  monospace = false,
  sx,
}: {
  value: string[]
  onChange: (value: string[]) => void
  error?: boolean
  helperText?: ReactNode
  label?: ReactNode
  placeholder?: string
  minRows?: number
  monospace?: boolean
  sx?: SxProps<Theme>
}) {
  return (
    <TextField
      fullWidth
      multiline
      minRows={minRows}
      size="small"
      label={label}
      placeholder={placeholder}
      value={value.join('\n')}
      error={error}
      helperText={helperText}
      onChange={(event) => onChange(event.target.value.split(/\r?\n/))}
      slotProps={{ htmlInput: { spellCheck: false } }}
      sx={[
        monospace ? { '& textarea': { fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace' } } : {},
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  )
}
