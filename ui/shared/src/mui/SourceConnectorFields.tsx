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
  helperText,
  sx,
}: {
  value: SynologyPhotoSpace[]
  onChange: (value: SynologyPhotoSpace[]) => void
  error?: boolean
  helperText?: ReactNode
  sx?: SxProps<Theme>
}) {
  const id = useId()
  const labelId = `${id}-label`

  return (
    <FormControl fullWidth size="small" error={error} sx={sx}>
      <InputLabel id={labelId}>同步空间</InputLabel>
      <Select<SynologyPhotoSpace[]>
        labelId={labelId}
        multiple
        value={value}
        input={<OutlinedInput label="同步空间" />}
        renderValue={(selected) => selected.map(photoSpaceLabel).join('、')}
        onChange={(event: SelectChangeEvent<SynologyPhotoSpace[]>) => {
          const raw = typeof event.target.value === 'string'
            ? event.target.value.split(',')
            : event.target.value
          const spaces = raw.filter(
            (space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared',
          )
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
  helperText,
  rows,
  minRows = 3,
  monospace = false,
  sx,
}: {
  value: string[]
  onChange: (value: string[]) => void
  error?: boolean
  helperText?: ReactNode
  rows?: number
  minRows?: number
  monospace?: boolean
  sx?: SxProps<Theme>
}) {
  return (
    <TextField
      fullWidth
      multiline
      size="small"
      rows={rows}
      minRows={rows === undefined ? minRows : undefined}
      label="File Station 根目录"
      placeholder={'/documents\n/video/projects'}
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
