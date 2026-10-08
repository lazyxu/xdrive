import type { ReactNode } from 'react'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import { InputAdornment, Stack, TextField, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveActionButton } from './ActionButton'
import type { XDriveActionIntent } from './ActionButton'

export type XDriveShareExpiryMode = 'datetime' | 'days'

export function XDriveCreatedShareLink({
  value,
  onCopy,
  onShare,
  copyLabel = '复制',
  shareLabel = '系统分享',
  copyIntent = 'secondary',
  sx,
}: {
  value: string
  onCopy: () => void
  onShare?: () => void
  copyLabel?: ReactNode
  shareLabel?: ReactNode
  copyIntent?: XDriveActionIntent
  sx?: SxProps<Theme>
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      alignItems={{ xs: 'stretch', sm: 'center' }}
      sx={sx}
    >
      <TextField
        fullWidth
        size="small"
        value={value}
        aria-label="新创建的分享链接"
        slotProps={{
          input: {
            readOnly: true,
            startAdornment: (
              <InputAdornment position="start">
                <LinkRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />
      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
        <XDriveActionButton
          intent={copyIntent}
          startIcon={<ContentCopyRoundedIcon />}
          onClick={onCopy}
        >
          {copyLabel}
        </XDriveActionButton>
        {onShare ? (
          <XDriveActionButton
            startIcon={<ShareRoundedIcon />}
            onClick={onShare}
          >
            {shareLabel}
          </XDriveActionButton>
        ) : null}
      </Stack>
    </Stack>
  )
}

export function XDriveShareCreateFields({
  expiryMode,
  expiryValue,
  onExpiryChange,
  expiryError,
  expiryHelperText,
  maxDownloadsValue,
  onMaxDownloadsChange,
  maxDownloadsHelperText = '0 表示不限',
  password,
  onPasswordChange,
  passwordError,
  passwordHelperText,
  passwordPlaceholder,
  sx,
}: {
  expiryMode: XDriveShareExpiryMode
  expiryValue: string
  onExpiryChange: (value: string) => void
  expiryError?: boolean
  expiryHelperText?: ReactNode
  maxDownloadsValue: string | number
  onMaxDownloadsChange: (value: string) => void
  maxDownloadsHelperText?: ReactNode
  password: string
  onPasswordChange: (value: string) => void
  passwordError?: boolean
  passwordHelperText?: ReactNode
  passwordPlaceholder?: string
  sx?: SxProps<Theme>
}) {
  const daysMode = expiryMode === 'days'

  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      alignItems={{ xs: 'stretch', md: 'flex-start' }}
      sx={sx}
    >
      <TextField
        size="small"
        type={daysMode ? 'number' : 'datetime-local'}
        label={daysMode ? '有效期' : '过期时间'}
        value={expiryValue}
        error={expiryError}
        helperText={expiryHelperText}
        onChange={(event) => onExpiryChange(event.target.value)}
        slotProps={daysMode
          ? {
              htmlInput: { min: 0, max: 3650, step: 1 },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Typography variant="caption" color="text.secondary">天</Typography>
                  </InputAdornment>
                ),
              },
            }
          : { inputLabel: { shrink: true } }}
        sx={{ minWidth: { md: 200 } }}
      />
      <TextField
        size="small"
        type="number"
        label="最大下载次数"
        value={maxDownloadsValue}
        helperText={maxDownloadsHelperText}
        onChange={(event) => onMaxDownloadsChange(event.target.value)}
        slotProps={{ htmlInput: { min: 0, step: 1 } }}
        sx={{ minWidth: { md: 180 } }}
      />
      <TextField
        size="small"
        type="password"
        label="密码（可选）"
        value={password}
        error={passwordError}
        helperText={passwordHelperText}
        placeholder={passwordPlaceholder}
        autoComplete="new-password"
        onChange={(event) => onPasswordChange(event.target.value)}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <LockRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        sx={{ minWidth: { md: 220 } }}
      />
    </Stack>
  )
}
