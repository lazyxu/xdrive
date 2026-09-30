import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { xDriveAppearanceOptions, type XDriveAppearance } from '../preferences'

export function XDriveAppearanceField({
  value,
  onChange,
  disabled = false,
  label = '外观',
  sx,
}: {
  value: XDriveAppearance
  onChange: (value: XDriveAppearance) => void
  disabled?: boolean
  label?: string
  sx?: SxProps<Theme>
}) {
  return (
    <FormControl disabled={disabled} sx={sx}>
      <FormLabel>{label}</FormLabel>
      <RadioGroup
        row
        value={value}
        onChange={(event) => onChange(event.target.value as XDriveAppearance)}
      >
        {xDriveAppearanceOptions.map((option) => (
          <FormControlLabel
            key={option.value}
            value={option.value}
            control={<Radio size="small" />}
            label={option.label}
          />
        ))}
      </RadioGroup>
    </FormControl>
  )
}
