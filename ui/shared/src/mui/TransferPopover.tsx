import { useEffect, useId, useMemo, useRef, useState } from 'react'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded'
import {
  Badge,
  Box,
  ButtonBase,
  IconButton,
  Popover,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  formatBytes,
  xDriveNetworkTransferSummary,
  xDriveNetworkTransferTasks,
  xDriveTransferRootID,
  xDriveTransferTerminal,
  xDriveTransferTree,
  xDriveTransferTreeActive,
  type XDriveTransferDirectionSummary,
  type XDriveTransferTask,
} from '..'
import { XDriveActionButton } from './ActionButton'
import { XDriveStatePanel } from './StatePanel'
import { XDriveTransferTreeItem } from './TransferCenter'

export type XDriveTransferPopoverProps = {
  transfers: readonly XDriveTransferTask[]
  compactTrigger?: boolean
  loading?: boolean
  disabled?: boolean
  sessionKey?: string
  clearHistoryLoading?: boolean
  clearHistoryDisabled?: boolean
  onClearHistory?: () => void
  retryingID?: string
  retryDisabled?: boolean
  onRetry?: (id: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function DirectionMetric({
  direction,
  summary,
}: {
  direction: 'upload' | 'download'
  summary: XDriveTransferDirectionSummary
}) {
  const label = direction === 'upload' ? '上传' : '下载'
  return (
    <Box sx={{ minWidth: 0, flex: 1, bgcolor: 'action.hover', borderRadius: 1.5, px: 1.25, py: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {label} · {summary.activeCount} 项进行中
      </Typography>
      <Typography variant="subtitle1" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatBytes(summary.bytesPerSecond)}/s
      </Typography>
      {summary.serverReported ? (
        <Typography variant="caption" color="text.secondary" component="div">
          服务端发送 {formatBytes(summary.serverBytesPerSecond)}/s
          {summary.clientBytesPerSecond > 0 ? ` · 客户端 ${formatBytes(summary.clientBytesPerSecond)}/s` : ''}
        </Typography>
      ) : null}
    </Box>
  )
}

function TransferPopoverSession({
  transfers,
  compactTrigger = false,
  loading = false,
  disabled = false,
  clearHistoryLoading = false,
  clearHistoryDisabled = false,
  onClearHistory,
  retryingID = '',
  retryDisabled = false,
  onRetry,
  open,
  onOpenChange,
}: XDriveTransferPopoverProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const [internalOpen, setInternalOpen] = useState(false)
  const [section, setSection] = useState<'active' | 'history'>('active')
  const [clock, setClock] = useState(Date.now)
  const network = useMemo(() => xDriveNetworkTransferTasks(transfers), [transfers])
  const roots = useMemo(() => xDriveTransferTree(network), [network])
  const hasActive = roots.some(xDriveTransferTreeActive)
  const now = Math.max(clock, Date.now())
  const summary = xDriveNetworkTransferSummary(network, now)
  const activeRootIDs = new Set(roots.filter(xDriveTransferTreeActive).map(({ task }) => xDriveTransferRootID(task)))
  const active = roots.filter(({ task }) => activeRootIDs.has(xDriveTransferRootID(task)))
  const history = roots.filter(({ task }) => !activeRootIDs.has(xDriveTransferRootID(task)) && xDriveTransferTerminal(task))
  const items = section === 'active' ? active : history
  const isOpen = Boolean(anchorEl) && !disabled && (open ?? internalOpen)
  const serverReported = summary.upload.serverReported || summary.download.serverReported

  useEffect(() => {
    if (!disabled || (!internalOpen && !open)) return
    setInternalOpen(false)
    onOpenChange?.(false)
  }, [disabled, internalOpen, onOpenChange, open])

  // Keep stale-rate expiry running when the popup is closed and no new transfer
  // events arrive. A retained average is never a current network sample.
  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasActive])

  const setOpen = (value: boolean) => {
    setInternalOpen(value)
    onOpenChange?.(value)
  }
  const rateLabel = (value: XDriveTransferDirectionSummary) => (
    `${formatBytes(value.bytesPerSecond)}/s${value.serverReported ? '（含服务端发送速度）' : ''}`
  )
  const triggerLabel = `上传与下载，上传 ${rateLabel(summary.upload)}，下载 ${rateLabel(summary.download)}，${summary.activeCount} 项进行中`

  return (
    <>
      <Tooltip title="上传与下载">
        <Badge
          badgeContent={summary.activeCount}
          max={99}
          color="primary"
          sx={{ flexShrink: 0, WebkitAppRegion: 'no-drag', '& .MuiBadge-badge': { right: 3, top: 8, pointerEvents: 'none' } }}
        >
          <ButtonBase
            ref={setAnchorEl}
            type="button"
            disabled={disabled}
            aria-label={triggerLabel}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-controls={isOpen ? `${id}-dialog` : undefined}
            onClick={() => {
              if (!isOpen) setSection(summary.activeCount > 0 ? 'active' : 'history')
              setOpen(!isOpen)
            }}
            sx={{
              minWidth: compactTrigger ? 44 : 100,
              maxWidth: compactTrigger ? 44 : 164,
              minHeight: 36,
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              color: 'text.primary',
              WebkitAppRegion: 'no-drag',
              '&:hover': { bgcolor: 'action.hover' },
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
              '@media (pointer: coarse)': { minHeight: 44 },
            }}
          >
            {compactTrigger ? <SyncAltRoundedIcon aria-hidden="true" fontSize="small" /> : <Stack spacing={0} aria-hidden="true" sx={{ minWidth: 0, width: '100%' }}>
              {(['upload', 'download'] as const).map((direction) => (
                <Stack key={direction} direction="row" spacing={0.5} alignItems="center">
                  {direction === 'upload'
                    ? <ArrowUpwardRoundedIcon sx={{ fontSize: 13, color: 'primary.main', flexShrink: 0 }} />
                    : <ArrowDownwardRoundedIcon sx={{ fontSize: 13, color: 'success.main', flexShrink: 0 }} />}
                  <Typography variant="caption" noWrap sx={{ fontSize: 11, lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' }}>
                    {formatBytes(summary[direction].bytesPerSecond)}/s
                  </Typography>
                  {summary[direction].serverReported ? (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, flexShrink: 0 }}>服务端</Typography>
                  ) : null}
                </Stack>
              ))}
            </Stack>}
          </ButtonBase>
        </Badge>
      </Tooltip>

      <Popover
        open={isOpen}
        anchorEl={anchorEl ?? undefined}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        marginThreshold={8}
        transitionDuration={120}
        slotProps={{
          paper: {
            id: `${id}-dialog`,
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': `${id}-title`,
            sx: {
              width: { xs: 'calc(100vw - 16px)', sm: 480 },
              maxWidth: 480,
              maxHeight: 'min(640px, calc(100dvh - 72px))',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRadius: 2,
              WebkitAppRegion: 'no-drag',
              '& button': { minHeight: 36 },
              '@media (pointer: coarse)': {
                '& button': { minHeight: 44 },
                '& .MuiIconButton-root': { minWidth: 44 },
              },
            },
          },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, pt: 1, pb: 0.5, flexShrink: 0 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography id={`${id}-title`} component="h2" variant="subtitle1" fontWeight={700}>上传与下载</Typography>
            <Typography variant="caption" color="text.secondary">本客户端的传输与历史记录</Typography>
          </Box>
          {onClearHistory ? (
            <XDriveActionButton
              compact
              disabled={clearHistoryDisabled || disabled || summary.historyCount === 0}
              loading={clearHistoryLoading}
              loadingLabel="正在清除…"
              onClick={() => {
                closeButtonRef.current?.focus()
                onClearHistory()
              }}
            >
              清除历史
            </XDriveActionButton>
          ) : null}
          <IconButton ref={closeButtonRef} autoFocus aria-label="关闭上传与下载" onClick={() => setOpen(false)} sx={{ width: 36, height: 36, flexShrink: 0 }}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ px: 1.5, py: 1, flexShrink: 0 }}>
          <DirectionMetric direction="upload" summary={summary.upload} />
          <DirectionMetric direction="download" summary={summary.download} />
        </Stack>
        {serverReported ? (
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pb: 0.5 }}>
            服务端进度表示已向浏览器发送的数据。
          </Typography>
        ) : null}

        <Tabs value={section} onChange={(_event, value: 'active' | 'history') => setSection(value)} variant="fullWidth" aria-label="传输记录" sx={{ flexShrink: 0, minHeight: 40, borderBottom: 1, borderColor: 'divider' }}>
          <Tab id={`${id}-active-tab`} aria-controls={`${id}-active-panel`} value="active" label={`进行中 (${summary.activeCount})`} sx={{ minHeight: 40 }} />
          <Tab id={`${id}-history-tab`} aria-controls={`${id}-history-panel`} value="history" label={`历史记录 (${summary.historyCount})`} sx={{ minHeight: 40 }} />
        </Tabs>
        <Box
          key={section}
          id={`${id}-${section}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${section}-tab`}
          sx={{ minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', p: 1.5 }}
        >
          {loading && roots.length === 0 ? (
            <XDriveStatePanel loading compact variant="plain" message="正在加载传输记录…" />
          ) : items.length === 0 ? (
            <XDriveStatePanel compact variant="plain" message={section === 'active' ? '暂无进行中的上传或下载。' : '暂无上传或下载历史。'} />
          ) : (
            <Stack spacing={1}>
              {items.map((node) => (
                <XDriveTransferTreeItem
                  key={node.task.id}
                  node={node}
                  compact
                  now={now}
                  retryDisabled={retryDisabled || disabled}
                  retryingID={retryingID}
                  onRetry={onRetry ? (id) => {
                    closeButtonRef.current?.focus()
                    onRetry(id)
                  } : undefined}
                />
              ))}
            </Stack>
          )}
        </Box>
      </Popover>
    </>
  )
}

export function XDriveTransferPopover(props: XDriveTransferPopoverProps) {
  const previousSession = useRef(props.sessionKey)
  const sessionChanged = previousSession.current !== props.sessionKey
  useEffect(() => {
    if (previousSession.current === props.sessionKey) return
    previousSession.current = props.sessionKey
    props.onOpenChange?.(false)
  }, [props.onOpenChange, props.sessionKey])
  return (
    <TransferPopoverSession
      key={props.sessionKey}
      {...props}
      open={sessionChanged && props.open !== undefined ? false : props.open}
    />
  )
}
