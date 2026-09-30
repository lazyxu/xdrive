import { TextField } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

export function XDriveSourceIgnoreRulesField({
  value,
  onChange,
  rows = 5,
  placeholder = '每行一条 gitignore 风格规则',
  monospace = false,
  sx,
}: {
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  monospace?: boolean
  sx?: SxProps<Theme>
}) {
  return (
    <TextField
      fullWidth
      multiline
      size="small"
      rows={rows}
      label="忽略规则"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { spellCheck: false } }}
      sx={[
        monospace ? { '& textarea': { fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace' } } : {},
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  )
}
