import { useEffect, useState, type ReactNode } from 'react'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha, type SxProps, type Theme } from '@mui/material/styles'

export type XDriveAuthFieldStatusTone = 'neutral' | 'good' | 'bad'

export function XDriveAuthFieldStatus({
  tone = 'neutral',
  loading = false,
  title,
  children,
}: {
  tone?: XDriveAuthFieldStatusTone
  loading?: boolean
  title?: string
  children: ReactNode
}) {
  return (
    <Stack
      component="span"
      direction="row"
      spacing={0.875}
      alignItems="center"
      title={title}
      sx={{ minWidth: 0 }}
    >
      {loading ? (
        <CircularProgress size={12} />
      ) : (
        <Box
          component="span"
          aria-hidden="true"
          sx={(theme) => {
            const color = tone === 'good'
              ? theme.palette.success.main
              : tone === 'bad'
                ? theme.palette.error.main
                : theme.palette.text.disabled
            return {
              width: 7,
              height: 7,
              flex: '0 0 auto',
              borderRadius: '50%',
              bgcolor: color,
              boxShadow: `0 0 0 3px ${alpha(color, 0.14)}`,
            }
          }}
        />
      )}
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Box>
    </Stack>
  )
}

export function XDriveAuthField({
  label,
  htmlFor,
  required = false,
  error = false,
  helper,
  helperAction,
  children,
  sx,
}: {
  label: ReactNode
  htmlFor?: string
  required?: boolean
  error?: boolean
  helper?: ReactNode
  helperAction?: ReactNode
  children: ReactNode
  sx?: SxProps<Theme>
}) {
  const hasMeta = helper !== undefined && helper !== null || Boolean(helperAction)

  return (
    <Box
      sx={[
        {
          display: 'grid',
          gap: 0.875,
          '& .MuiOutlinedInput-root': {
            minHeight: 44,
            borderRadius: 1.25,
            bgcolor: 'background.paper',
          },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'divider',
          },
          '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'text.disabled',
          },
          '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: 'primary.main',
          },
          '& .MuiOutlinedInput-root.Mui-focused': {
            boxShadow: (theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.16)}`,
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Typography
        component="label"
        htmlFor={htmlFor}
        color="text.secondary"
        sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}
      >
        {label}
        {required ? (
          <Box component="span" aria-hidden="true" sx={{ ml: 0.25, color: 'error.main' }}>
            *
          </Box>
        ) : null}
      </Typography>

      {children}

      {hasMeta ? (
        <Box
          sx={{
            minHeight: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
            '@media (max-width: 620px)': {
              alignItems: 'flex-start',
              flexDirection: 'column',
              gap: 0.25,
            },
          }}
        >
          <Box
            sx={{
              minWidth: 0,
              color: error ? 'error.main' : 'text.secondary',
              fontSize: 11.5,
              lineHeight: 1.45,
            }}
          >
            {helper}
          </Box>
          {helperAction ? (
            <Box
              sx={{
                flexShrink: 0,
                '& .MuiButton-root': {
                  minWidth: 0,
                  px: 0.5,
                  py: 0.25,
                  borderRadius: 0.875,
                  fontSize: 11.5,
                  textTransform: 'none',
                  whiteSpace: 'nowrap',
                },
              }}
            >
              {helperAction}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

export function XDriveAuthPasswordField({
  id,
  label = '密码',
  value,
  disabled = false,
  required = true,
  autoComplete = 'current-password',
  autoFocus = false,
  placeholder,
  error = false,
  helper,
  saved = false,
  savedLabel = '已保存',
  onClearSaved,
  clearSavedLabel = '清除已保存密码',
  clearSavedDisabled = false,
  minLength,
  onChange,
}: {
  id: string
  label?: ReactNode
  value: string
  disabled?: boolean
  required?: boolean
  autoComplete?: string
  autoFocus?: boolean
  placeholder?: string
  error?: boolean
  helper?: ReactNode
  saved?: boolean
  savedLabel?: string
  onClearSaved?: () => void
  clearSavedLabel?: string
  clearSavedDisabled?: boolean
  minLength?: number
  onChange: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!value) setVisible(false)
  }, [value])

  return (
    <XDriveAuthField
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      helper={helper}
      helperAction={onClearSaved ? (
        <Button
          type="button"
          size="small"
          variant="text"
          disabled={clearSavedDisabled}
          onClick={onClearSaved}
        >
          {clearSavedLabel}
        </Button>
      ) : undefined}
    >
      <TextField
        id={id}
        fullWidth
        size="small"
        type={visible ? 'text' : 'password'}
        value={value}
        disabled={disabled}
        error={error}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{
          htmlInput: minLength ? { minLength } : undefined,
          input: {
            endAdornment: value ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  aria-label={visible ? '隐藏密码' : '显示密码'}
                  edge="end"
                  sx={{ '@media (max-width:899.95px) and (pointer: coarse)': { minWidth: 44, minHeight: 44 } }}
                  onClick={() => setVisible((current) => !current)}
                >
                  {visible
                    ? <VisibilityOffRoundedIcon fontSize="small" />
                    : <VisibilityRoundedIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ) : saved ? (
              <InputAdornment position="end">
                <Chip
                  size="small"
                  label={savedLabel}
                  sx={{
                    height: 22,
                    borderRadius: 0.875,
                    bgcolor: 'action.hover',
                    color: 'text.secondary',
                    fontSize: 11,
                  }}
                />
              </InputAdornment>
            ) : undefined,
          },
        }}
      />
    </XDriveAuthField>
  )
}

export function XDriveAuthSubmitRow({
  hint,
  fullWidth = false,
  children,
}: {
  hint?: ReactNode
  fullWidth?: boolean
  children: ReactNode
}) {
  return (
    <Stack
      direction={fullWidth ? 'column' : { xs: 'column-reverse', sm: 'row' }}
      spacing={fullWidth ? 0 : 1.75}
      alignItems={fullWidth ? 'stretch' : { xs: 'stretch', sm: 'center' }}
      justifyContent="space-between"
      sx={{ pt: 0.25 }}
    >
      {hint ? (
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ fontSize: 11.5, textAlign: { xs: 'center', sm: 'left' } }}
        >
          {hint}
        </Typography>
      ) : null}
      <Box
        sx={{
          width: fullWidth ? '100%' : { xs: '100%', sm: 'auto' },
          ml: fullWidth ? 0 : { sm: 'auto' },
          '& > .MuiButton-root': {
            width: fullWidth ? '100%' : { xs: '100%', sm: 'auto' },
            minWidth: fullWidth ? 0 : 180,
            minHeight: 42,
            borderRadius: 1.25,
            '@media (max-width:899.95px) and (pointer: coarse)': { minHeight: 44 },
          },
        }}
      >
        {children}
      </Box>
    </Stack>
  )
}
