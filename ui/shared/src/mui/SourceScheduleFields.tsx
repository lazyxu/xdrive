import { Box, MenuItem, TextField } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ExternalSourceScheduleType } from '../external-sources'

type XDriveSourceScheduleWideAt = 'sm' | 'md'

export function XDriveSourceScheduleFields({
  scheduleType,
  expression,
  timezone,
  onScheduleTypeChange,
  onExpressionChange,
  onTimezoneChange,
  wideAt = 'sm',
  sx,
}: {
  scheduleType: ExternalSourceScheduleType
  expression: string
  timezone: string
  onScheduleTypeChange: (value: ExternalSourceScheduleType) => void
  onExpressionChange: (value: string) => void
  onTimezoneChange: (value: string) => void
  wideAt?: XDriveSourceScheduleWideAt
  sx?: SxProps<Theme>
}) {
  const timezoneSx: SxProps<Theme> = {
    gridColumn: {
      sm: wideAt === 'sm' ? '2 / 3' : null,
      md: wideAt === 'md' ? '2 / 3' : null,
    },
  }

  return (
    <Box
      sx={[
        {
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: wideAt === 'sm' ? '160px 1fr' : null,
            md: wideAt === 'md' ? '180px 1fr' : null,
          },
          gap: 1.5,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <TextField
        select
        size="small"
        label="调度方式"
        value={scheduleType}
        onChange={(event) => onScheduleTypeChange(event.target.value as ExternalSourceScheduleType)}
      >
        <MenuItem value="interval">固定间隔</MenuItem>
        <MenuItem value="cron">Cron</MenuItem>
        <MenuItem value="manual">仅手动</MenuItem>
      </TextField>
      {scheduleType !== 'manual' ? (
        <TextField
          size="small"
          label={scheduleType === 'cron' ? 'Cron 表达式' : '运行间隔'}
          value={expression}
          onChange={(event) => onExpressionChange(event.target.value)}
          helperText={scheduleType === 'cron' ? '标准 5 段，例如：0 3 * * *' : '例如：30m、6h、24h'}
        />
      ) : null}
      {scheduleType === 'cron' ? (
        <TextField
          size="small"
          label="时区"
          value={timezone}
          onChange={(event) => onTimezoneChange(event.target.value)}
          helperText="IANA 时区，例如 Asia/Shanghai"
          sx={timezoneSx}
        />
      ) : null}
    </Box>
  )
}
