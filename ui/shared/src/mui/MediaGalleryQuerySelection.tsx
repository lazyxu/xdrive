import { useEffect, useRef, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import {
  Box, Button, CircularProgress, Dialog, DialogActions, IconButton, Stack,
  TextField, Typography, useMediaQuery,
} from '@mui/material'
import type {
  MediaSelectionSnapshot, MediaSelectionSnapshotItem, MediaSelectionSnapshotPage,
} from '../models'
import { xDriveMediaGalleryErrorMessage } from './MediaGalleryUtils'
import { useXDriveMobilePanelViewport } from './useMobilePanelViewport'

const pageSize = 100

export interface XDriveMediaGalleryQuerySelectionActions {
  create: (day?: string) => Promise<MediaSelectionSnapshot>
  page: (token: string, offset: number, limit: number) => Promise<MediaSelectionSnapshotPage>
  exclude: (
    token: string, nodeID: number, excluded: boolean, version: number,
  ) => Promise<MediaSelectionSnapshot>
  release: (token: string) => Promise<void>
}

/**
 * Query selections are owner-scoped, short-lived and read-only. Do not pass
 * their token to existing MediaItem[] batch actions: Phase 3 needs a durable
 * Task Center operation with fresh ACL/revision checks first.
 *
 * Parent keys this component by the active server collection scope, so a
 * changed filter, folder, account or sorting dimension releases its token.
 */
export function XDriveMediaGalleryQuerySelection({
  actions, timeZone, sortBy, disabled = false, onActivated,
}: {
  actions: XDriveMediaGalleryQuerySelectionActions
  timeZone: string
  sortBy: 'captured' | 'added'
  disabled?: boolean
  onActivated?: () => void
}) {
  const compact = useMediaQuery('(max-width:899.95px)')
  const [open, setOpen] = useState(false)
  const viewport = useXDriveMobilePanelViewport(compact && open)
  const [day, setDay] = useState('')
  const [snapshot, setSnapshot] = useState<MediaSelectionSnapshot | null>(null)
  const [page, setPage] = useState<MediaSelectionSnapshotPage | null>(null)
  const [offset, setOffset] = useState(0)
  const [excludedItems, setExcludedItems] = useState<MediaSelectionSnapshotItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const tokenRef = useRef('')
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => () => {
    generation.current += 1
    const token = tokenRef.current
    tokenRef.current = ''
    if (token) void actionsRef.current.release(token).catch(() => undefined)
  }, [])

  const close = () => {
    if (busy) return
    generation.current += 1
    const token = tokenRef.current
    tokenRef.current = ''
    setSnapshot(null)
    setPage(null)
    setOffset(0)
    setExcludedItems([])
    setOpen(false)
    setError('')
    if (token) void actionsRef.current.release(token).catch(() => undefined)
  }

  const create = async (selectedDay: string) => {
    if (busy || disabled || tokenRef.current) return
    const request = ++generation.current
    setBusy(true)
    setError('')
    try {
      const created = await actions.create(selectedDay || undefined)
      if (request !== generation.current) {
        void actionsRef.current.release(created.token).catch(() => undefined)
        return
      }
      tokenRef.current = created.token
      setSnapshot(created)
      setPage(null)
      setOffset(0)
      setExcludedItems([])
      setOpen(true)
      onActivated?.()
      const first = await actions.page(created.token, 0, pageSize)
      if (request !== generation.current) return
      setPage(first)
      setSnapshot((current) => current?.token === created.token
        ? { ...current, ...first } : current)
    } catch (reason) {
      if (request === generation.current) setError(xDriveMediaGalleryErrorMessage(reason))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const readPage = async (nextOffset: number) => {
    if (busy || !snapshot) return
    const request = ++generation.current
    setBusy(true)
    setError('')
    try {
      const result = await actions.page(snapshot.token, nextOffset, pageSize)
      if (request !== generation.current) return
      setPage(result)
      setSnapshot((current) => current?.token === result.token
        ? { ...current, ...result } : current)
      setOffset(nextOffset)
    } catch (reason) {
      if (request === generation.current) setError(xDriveMediaGalleryErrorMessage(reason))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const changeExclusion = async (item: MediaSelectionSnapshotItem, excluded: boolean) => {
    if (busy || !snapshot) return
    const request = ++generation.current
    setBusy(true)
    setError('')
    try {
      const updated = await actions.exclude(
        snapshot.token, item.node_id, excluded, snapshot.version,
      )
      if (request !== generation.current) return
      // A page contains only selected rows, so preserve the excluded names
      // locally to expose a bounded 'restore' action without a 100k scan.
      setExcludedItems((current) => excluded
        ? [...current.filter((candidate) => candidate.node_id !== item.node_id), item]
        : current.filter((candidate) => candidate.node_id !== item.node_id))
      const nextOffset = Math.min(
        offset, Math.max(0, Math.ceil(updated.selected / pageSize) - 1) * pageSize,
      )
      setSnapshot((current) => current?.token === updated.token
        ? { ...current, ...updated } : current)
      const fresh = await actions.page(updated.token, nextOffset, pageSize)
      if (request !== generation.current) return
      setPage(fresh)
      setOffset(nextOffset)
      setSnapshot((current) => current?.token === fresh.token
        ? { ...current, ...fresh } : current)
    } catch (reason) {
      if (request === generation.current) setError(xDriveMediaGalleryErrorMessage(reason))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap"
        useFlexGap data-xdrive-gallery-query-selection>
        <Button size="small" variant="outlined"
          disabled={disabled || busy || Boolean(snapshot)}
          data-xdrive-gallery-select-query
          onClick={() => { void create('') }}>
          全选当前查询结果
        </Button>
        <TextField size="small" type="date" label="选择日期"
          value={day} onChange={(event) => setDay(event.target.value)}
          disabled={disabled || busy || Boolean(snapshot)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 168 }} data-xdrive-gallery-selection-day />
        <Button size="small" variant="outlined"
          disabled={disabled || busy || Boolean(snapshot) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(day)}
          data-xdrive-gallery-select-day
          onClick={() => { void create(day) }}>
          选择该日全部
        </Button>
        {busy && !open ? <CircularProgress size={18} /> : null}
        {error && !open ? (
          <Typography role="alert" variant="caption" color="error">{error}</Typography>
        ) : null}
      </Stack>

      <Dialog open={open} fullWidth maxWidth="sm" fullScreen={compact}
        onClose={busy ? undefined : close}
        aria-label="查询选择审核" data-xdrive-gallery-query-selection-review
        slotProps={{ paper: { sx: compact && viewport ? {
          position: 'fixed', top: viewport.top + 'px', left: 0, m: 0,
          width: '100%', height: viewport.height + 'px',
          maxHeight: viewport.height + 'px', display: 'flex',
          flexDirection: 'column',
        } : { maxHeight: 'min(780px, 90dvh)' } } }}>
        <Stack direction="row" alignItems="center" spacing={1}
          sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
            查询选择审核
          </Typography>
          <IconButton aria-label="关闭查询选择" disabled={busy} onClick={close}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="body2" role="status">
            {snapshot ? '当前选中 ' + snapshot.selected.toLocaleString('zh-CN') +
              ' / ' + snapshot.total.toLocaleString('zh-CN') + ' 项 · 已排除 ' +
              snapshot.excluded.toLocaleString('zh-CN') + ' 项' : '尚未创建查询选择'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {(snapshot?.day ? '日期 ' + snapshot.day + ' · ' : '全部查询结果 · ') +
              (sortBy === 'captured' ? '拍摄日期' : '加入日期') + ' · ' + timeZone}
          </Typography>
          <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
            临时选择有效期 15 分钟，且仅包含已识别媒体。当前支持核对和排除；
            尚不支持从查询选择直接删除、下载或修改文件。
          </Typography>
          {error ? <Typography color="error" role="alert">{error}</Typography> : null}
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
          px: 1.5, py: 0.5 }}>
          {page?.items.map((item) => (
            <Stack key={item.node_id} direction="row" spacing={1}
              alignItems="center" data-xdrive-gallery-snapshot-row={item.node_id}
              sx={{ minHeight: 48, borderBottom: 1, borderColor: 'divider', py: 0.5 }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {item.name || ('文件 #' + item.node_id)}
                </Typography>
                {item.stale ? (
                  <Typography variant="caption" color="warning.main">已变更，批量操作前须重新验证</Typography>
                ) : null}
              </Box>
              <Button disabled={busy} size="small"
                aria-label={'排除 ' + (item.name || item.node_id)}
                onClick={() => { void changeExclusion(item, true) }}>排除</Button>
            </Stack>
          ))}
          {page && page.items.length === 0 ? (
            <Typography variant="body2" sx={{ p: 2 }} color="text.secondary">此页没有已选媒体</Typography>
          ) : null}
          {excludedItems.length > 0 ? (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">本次审核中排除的项目</Typography>
              {excludedItems.map((item) => (
                <Stack key={item.node_id} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                    {item.name || ('文件 #' + item.node_id)}
                  </Typography>
                  <Button disabled={busy} size="small" onClick={() => {
                    void changeExclusion(item, false)
                  }}>恢复选择</Button>
                </Stack>
              ))}
            </Box>
          ) : null}
        </Box>
        <Stack direction="row" alignItems="center" spacing={1}
          sx={{ borderTop: 1, borderColor: 'divider', px: 1.5, py: 1 }}>
          <Button size="small" disabled={busy || offset === 0}
            onClick={() => { void readPage(Math.max(0, offset - pageSize)) }}>上一页</Button>
          <Typography variant="caption" role="status" sx={{ flex: 1, textAlign: 'center' }}>
            {snapshot ? (Math.floor(offset / pageSize) + 1) + ' / ' +
              Math.max(1, Math.ceil(snapshot.selected / pageSize)) : '—'}
          </Typography>
          <Button size="small" disabled={busy || !page?.has_more}
            onClick={() => { void readPage(offset + pageSize) }}>下一页</Button>
        </Stack>
        <DialogActions sx={{ pb: compact
          ? 'max(8px, env(safe-area-inset-bottom, 0px))' : 1.5 }}>
          <Button variant="outlined" disabled={busy} onClick={() => { void readPage(offset) }}>刷新本页</Button>
          <Button variant="contained" disabled={busy} onClick={close}>完成审核</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
