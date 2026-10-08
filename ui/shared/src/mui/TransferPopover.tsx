import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded'
import { Badge, Box, Button, Popover, Stack, Typography } from '@mui/material'
import {
  formatBytesPerSecond,
  xDriveTransferActive,
  xDriveTransferIsNetwork,
  xDriveTransferSpeedSummary,
  type XDriveTransferTask,
} from '..'
import { XDriveActionButton } from './ActionButton'
import { XDriveTransferCenter } from './TransferCenter'

export type XDriveTransferPopoverClearHistory = {
  disabled?: boolean
  loading?: boolean
  onClear: () => void
}

export function XDriveTransferPopover({
  transfers,
  disabled = false,
  retryingID = '',
  retryDisabled = false,
  onRetry,
  clearHistory,
  downloadSpeedCaption,
}: {
  transfers: XDriveTransferTask[]
  disabled?: boolean
  retryingID?: string
  retryDisabled?: boolean
  onRetry?: (id: string) => void
  clearHistory?: XDriveTransferPopoverClearHistory
  downloadSpeedCaption?: ReactNode
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const networkTransfers = useMemo(
    () => transfers.filter(xDriveTransferIsNetwork),
    [transfers],
  )
  const hasActiveTransfer = networkTransfers.some(xDriveTransferActive)

  useEffect(() => {
    setClock(Date.now())
    if (!hasActiveTransfer) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasActiveTransfer, networkTransfers])

  useEffect(() => {
    if (disabled) setAnchorEl(null)
  }, [disabled])

  const speed = useMemo(
    () => xDriveTransferSpeedSummary(networkTransfers, clock),
    [clock, networkTransfers],
  )
  const uploadLabel = formatBytesPerSecond(speed.uploadBytesPerSecond)
  const downloadLabel = formatBytesPerSecond(speed.downloadBytesPerSecond)

  return (
    <>
      <Button
        color="inherit"
        size="small"
        disabled={disabled}
        aria-label={`传输：上传 ${uploadLabel}，下载 ${downloadLabel}`}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        startIcon={(
          <Badge color="primary" badgeContent={speed.activeTotal} invisible={speed.activeTotal === 0} max={99}>
            <SwapVertRoundedIcon fontSize="small" />
          </Badge>
        )}
        sx={{
          minWidth: 0,
          height: 40,
          px: 1,
          borderRadius: 1.5,
          textTransform: 'none',
          color: 'text.secondary',
          '& .MuiButton-startIcon': { mr: 0.75 },
        }}
      >
        <Stack spacing={0} alignItems="flex-start" sx={{ lineHeight: 1 }}>
          <Typography variant="caption" component="span" sx={{ lineHeight: 1.25, whiteSpace: 'nowrap' }}>
            ↑ {uploadLabel}
          </Typography>
          <Typography variant="caption" component="span" sx={{ lineHeight: 1.25, whiteSpace: 'nowrap' }}>
            ↓ {downloadLabel}
          </Typography>
        </Stack>
      </Button>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: {
          width: 'min(560px, calc(100vw - 16px))',
          maxHeight: 'min(720px, calc(100dvh - 64px))',
          mt: 0.5,
          overflow: 'hidden',
        } } }}
      >
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>传输</Typography>
              <Typography variant="caption" color="text.secondary">
                上传 {uploadLabel} · 下载 {downloadLabel}
              </Typography>
            </Box>
            {clearHistory ? (
              <XDriveActionButton
                compact
                disabled={clearHistory.disabled || clearHistory.loading}
                loading={clearHistory.loading}
                loadingLabel="正在清空…"
                onClick={clearHistory.onClear}
              >
                清空历史
              </XDriveActionButton>
            ) : (
              <Typography variant="caption" color="text.secondary">
                {speed.activeTotal > 0 ? `${speed.activeTotal} 个进行中` : '当前无传输'}
              </Typography>
            )}
          </Stack>
          {downloadSpeedCaption ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {downloadSpeedCaption}
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ p: 1.5, overflowY: 'auto', maxHeight: 'calc(min(720px, calc(100dvh - 64px)) - 86px)' }}>
          <XDriveTransferCenter
            transfers={networkTransfers}
            compact
            retryingID={retryingID}
            retryDisabled={retryDisabled}
            onRetry={onRetry}
          />
        </Box>
      </Popover>
    </>
  )
}
