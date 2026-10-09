import { useEffect, useMemo, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import {
  Box, Button, Dialog, DialogActions, DialogTitle, IconButton,
  Stack, TextField, Typography, useMediaQuery,
} from '@mui/material'
import type { MediaItem } from '../models'
import { useXDriveMobilePanelViewport } from './useMobilePanelViewport'

const reviewPageSize = 100

// This is an explicit, bounded selection review. A query-wide snapshot is a
// separate Server contract: never imply that unloaded query matches are selected.
export function XDriveMediaGallerySelectionReviewDialog({
  open,
  items,
  busy = false,
  onRemove,
  onClear,
  onClose,
}: {
  open: boolean
  items: readonly MediaItem[]
  busy?: boolean
  onRemove: (nodeID: number) => void
  onClear: () => void
  onClose: () => void
}) {
  const compact = useMediaQuery('(max-width:899.95px)')
  const viewport = useXDriveMobilePanelViewport(compact && open)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setPage(0)
    }
  }, [open])

  const matching = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return items
    return items.filter((item) => item.node.name.toLocaleLowerCase('zh-CN').includes(normalized))
  }, [items, query])
  const lastPage = Math.max(0, Math.ceil(matching.length / reviewPageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  const visible = matching.slice(currentPage * reviewPageSize, (currentPage + 1) * reviewPageSize)

  return (
    <Dialog
      open={open}
      fullScreen={compact}
      fullWidth
      maxWidth="sm"
      onClose={busy ? undefined : onClose}
      aria-label="查看已选项"
      data-xdrive-gallery-selection-review
      slotProps={{ paper: { sx: compact ? {
        position: 'fixed',
        top: viewport ? viewport.top + 'px' : 0,
        left: 0,
        m: 0,
        width: '100%',
        height: viewport ? viewport.height + 'px' : '100dvh',
        maxHeight: viewport ? viewport.height + 'px' : '100dvh',
        display: 'flex',
        flexDirection: 'column',
      } : { maxHeight: 'min(760px, 86dvh)' } } }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{
        px: 2, minHeight: 52, borderBottom: 1, borderColor: 'divider', flexShrink: 0,
      }}>
        <DialogTitle sx={{ flex: 1, p: 0, fontSize: '1rem' }}>
          已选择 {items.length.toLocaleString('zh-CN')} 项
        </DialogTitle>
        <IconButton aria-label="关闭已选项" disabled={busy} onClick={onClose}
          sx={compact ? { width: 44, height: 44 } : undefined}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Box sx={{ px: 2, py: 1.5, flexShrink: 0 }}>
        <TextField
          fullWidth
          size="small"
          label="搜索已选文件"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }}
          inputProps={{ 'aria-label': '搜索已选文件' }}
        />
        <Typography role="status" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          已选列表匹配 {matching.length.toLocaleString('zh-CN')} 项 · 每页最多显示 {reviewPageSize} 项
        </Typography>
      </Box>
      <Box data-xdrive-gallery-selected-items-scroll sx={{
        flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
        px: 1.5, pb: 1,
      }}>
        {visible.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {items.length === 0 ? '当前没有已选项' : '没有匹配的已选文件'}
          </Typography>
        ) : visible.map((item) => (
          <Stack
            key={item.node.id}
            direction="row"
            alignItems="center"
            spacing={1}
            data-xdrive-gallery-selected-item={item.node.id}
            sx={{ px: 0.75, py: 0.75, minHeight: 48, borderBottom: 1, borderColor: 'divider' }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {item.node.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                文件 #{item.node.id} · {item.metadata.media_kind === 'video' ? '视频' : '照片'}
              </Typography>
            </Box>
            <Button size="small" variant="text" disabled={busy}
              aria-label={`从已选项移除 ${item.node.name}`}
              sx={compact ? { minHeight: 44 } : undefined}
              onClick={() => onRemove(item.node.id)}>
              移除
            </Button>
          </Stack>
        ))}
      </Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{
        p: 1.5, borderTop: 1, borderColor: 'divider', flexShrink: 0,
      }}>
        <Button size="small" variant="outlined" disabled={currentPage === 0}
          onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</Button>
        <Typography role="status" variant="caption" sx={{ flex: 1, textAlign: 'center' }}>
          {currentPage + 1} / {lastPage + 1}
        </Typography>
        <Button size="small" variant="outlined" disabled={currentPage >= lastPage}
          onClick={() => setPage((value) => Math.min(lastPage, value + 1))}>下一页</Button>
      </Stack>
      <DialogActions sx={{
        flexShrink: 0, px: 1.5,
        pb: compact ? 'max(8px, env(safe-area-inset-bottom, 0px))' : 1.5,
      }}>
        <Button color="error" disabled={busy || items.length === 0} onClick={onClear}>清空选择</Button>
        <Button variant="contained" disabled={busy} onClick={onClose}>返回图库</Button>
      </DialogActions>
    </Dialog>
  )
}
