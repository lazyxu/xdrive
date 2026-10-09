import { useEffect, useRef, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import {
  Box, Button, CircularProgress, Dialog, DialogActions, IconButton, Stack,
  TextField, Typography, useMediaQuery,
} from '@mui/material'
import type {
  MediaSelectionSnapshot, MediaSelectionSnapshotItem, MediaSelectionSnapshotPage,
  MediaSelectionJob, MediaSelectionJobFailurePage,
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
  submitFavorite?: (
    token: string, version: number, favorite: boolean,
  ) => Promise<MediaSelectionJob>
  getJob?: (jobID: string) => Promise<MediaSelectionJob>
  cancelJob?: (jobID: string) => Promise<void>
  retryJob?: (jobID: string) => Promise<MediaSelectionJob>
  failures?: (
    jobID: string, offset: number, limit: number,
  ) => Promise<MediaSelectionJobFailurePage>
}

/**
 * Query selections are owner-scoped and short-lived. Only explicit favorite
 * operations may consume a snapshot into a durable server job; never pass
 * the token to existing MediaItem[] mutation handlers.
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
  const [confirmFavorite, setConfirmFavorite] = useState<boolean | null>(null)
  const [job, setJob] = useState<MediaSelectionJob | null>(null)
  const [jobFailures, setJobFailures] = useState<MediaSelectionJobFailurePage | null>(null)
  const [jobFailureOffset, setJobFailureOffset] = useState(0)

  const generation = useRef(0)
  const tokenRef = useRef('')
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // A durable job keeps running when the UI closes or its token expires.
  // Poll only the single active job; never poll or hydrate 100k items.
  useEffect(() => {
    if (!job || !actionsRef.current.getJob ||
      ['completed', 'partial', 'cancelled'].includes(job.status)) return
    let alive = true
    const id = job.id
    const refresh = () => {
      void actionsRef.current.getJob?.(id).then((latest) => {
        if (alive) setJob((current) => current?.id === id ? latest : current)
      }).catch((reason) => {
        if (alive) setError(xDriveMediaGalleryErrorMessage(reason))
      })
    }
    const timer = setInterval(refresh, 1700)
    return () => { alive = false; clearInterval(timer) }
  }, [job?.id, job?.status])

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
    setConfirmFavorite(null)
    setJob(null)
    setJobFailures(null)
    setJobFailureOffset(0)
    setOpen(false)
    setError('')
    if (token) void actionsRef.current.release(token).catch(() => undefined)
  }

  const submitFavorite = async (favorite: boolean) => {
    if (!actions.submitFavorite || !actions.getJob || busy || !snapshot ||
      snapshot.selected <= 0 || job) return
    const request = ++generation.current
    setBusy(true)
    setError('')
    try {
      // User confirmed the exact snapshot version and count in a separate dialog.
      const queued = await actions.submitFavorite(snapshot.token, snapshot.version, favorite)
      if (request !== generation.current) return
      tokenRef.current = '' // server consumed it after durable commit
      setJob(queued)
      setSnapshot(null)
      setPage(null)
      setExcludedItems([])
      setConfirmFavorite(null)
    } catch (reason) {
      if (request === generation.current) setError(xDriveMediaGalleryErrorMessage(reason))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const cancelJob = async () => {
    if (!job || busy || !actions.cancelJob ||
      !['queued', 'running'].includes(job.status)) return
    setBusy(true)
    setError('')
    try {
      await actions.cancelJob(job.id)
      setJob((current) => current?.id === job.id
        ? { ...current, status: 'cancel_requested' } : current)
    } catch (reason) {
      setError(xDriveMediaGalleryErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const retryJob = async () => {
    if (!job || busy || !actions.retryJob ||
      !['partial', 'cancelled'].includes(job.status)) return
    setBusy(true)
    setError('')
    try {
      const resumed = await actions.retryJob(job.id)
      setJob(resumed)
      setJobFailures(null)
      setJobFailureOffset(0)
    } catch (reason) {
      setError(xDriveMediaGalleryErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const loadJobFailures = async (nextOffset: number) => {
    if (!job || busy || !actions.failures) return
    setBusy(true)
    setError('')
    try {
      const result = await actions.failures(job.id, nextOffset, pageSize)
      setJobFailures(result)
      setJobFailureOffset(nextOffset)
    } catch (reason) {
      setError(xDriveMediaGalleryErrorMessage(reason))
    } finally {
      setBusy(false)
    }
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
      setJob(null)
      setJobFailures(null)
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
    if (busy || !snapshot || job) return
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
    if (busy || !snapshot || job) return
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
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {job
              ? '已创建持久化收藏任务。关闭面板不取消任务，可在媒体任务记录查看结果。'
              : '选择会在 15 分钟后过期；仅包含已识别媒体，操作前会重新核对权限与文件版本。'}
          </Typography>
          {!job && actions.submitFavorite && actions.getJob && snapshot && snapshot.selected > 0 ? (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} useFlexGap flexWrap="wrap">
              <Button size="small" variant="contained" disabled={busy}
                data-xdrive-gallery-submit-favorite
                onClick={() => setConfirmFavorite(true)}>批量收藏已选</Button>
              <Button size="small" variant="outlined" disabled={busy}
                data-xdrive-gallery-submit-unfavorite
                onClick={() => setConfirmFavorite(false)}>批量取消收藏</Button>
            </Stack>
          ) : null}
          {job ? (
            <Stack spacing={0.5} data-xdrive-gallery-durable-job sx={{ mt: 1 }}>
              <Typography variant="body2" role="status">
                {job.favorite ? '批量收藏' : '批量取消收藏'} ·
                {job.status === 'queued' ? '等待处理' :
                  job.status === 'running' ? '正在处理' :
                  job.status === 'cancel_requested' ? '正在取消' :
                  job.status === 'completed' ? '已完成' :
                  job.status === 'partial' ? '部分成功' : '已取消'}
              </Typography>
              <Typography variant="caption">
                已处理 {job.processed_items.toLocaleString('zh-CN')} /
                {job.total_items.toLocaleString('zh-CN')} · 成功
                {job.succeeded_items.toLocaleString('zh-CN')} · 失败
                {job.failed_items.toLocaleString('zh-CN')} · 取消
                {job.cancelled_items.toLocaleString('zh-CN')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                任务 ID：{job.id}
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {['queued', 'running'].includes(job.status) && actions.cancelJob ? (
                  <Button size="small" color="error" disabled={busy}
                    onClick={() => { void cancelJob() }}>取消任务</Button>
                ) : null}
                {['partial', 'cancelled'].includes(job.status) && actions.retryJob ? (
                  <Button size="small" disabled={busy}
                    onClick={() => { void retryJob() }}>重试未成功项</Button>
                ) : null}
                {job.failed_items > 0 && actions.failures ? (
                  <Button size="small" disabled={busy}
                    onClick={() => { void loadJobFailures(0) }}>查看失败详情</Button>
                ) : null}
              </Stack>
            </Stack>
          ) : null}
          {error ? <Typography color="error" role="alert">{error}</Typography> : null}
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
          px: 1.5, py: 0.5 }}>
          {jobFailures ? (
            <Box data-xdrive-gallery-job-failures sx={{ py: 1 }}>
              <Typography variant="subtitle2">
                失败详情：{jobFailures.total.toLocaleString('zh-CN')} 项
              </Typography>
              {jobFailures.items.map((item) => (
                <Typography key={item.node_id} variant="body2" sx={{ py: 0.5 }}>
                  文件 #{item.node_id} · 版本 {item.revision} · {item.failure_code}
                </Typography>
              ))}
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                <Button disabled={busy || jobFailureOffset === 0}
                  onClick={() => { void loadJobFailures(Math.max(0, jobFailureOffset-pageSize)) }}>
                  上一页失败项
                </Button>
                <Button disabled={busy || !jobFailures.has_more}
                  onClick={() => { void loadJobFailures(jobFailureOffset+pageSize) }}>
                  下一页失败项
                </Button>
              </Stack>
            </Box>
          ) : null}
          {!job && page?.items.map((item) => (
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
          {!job && excludedItems.length > 0 ? (
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
        {!job ? <Stack direction="row" alignItems="center" spacing={1}
          sx={{ borderTop: 1, borderColor: 'divider', px: 1.5, py: 1 }}>
          <Button size="small" disabled={busy || offset === 0}
            onClick={() => { void readPage(Math.max(0, offset - pageSize)) }}>上一页</Button>
          <Typography variant="caption" role="status" sx={{ flex: 1, textAlign: 'center' }}>
            {snapshot ? (Math.floor(offset / pageSize) + 1) + ' / ' +
              Math.max(1, Math.ceil(snapshot.selected / pageSize)) : '—'}
          </Typography>
          <Button size="small" disabled={busy || !page?.has_more}
            onClick={() => { void readPage(offset + pageSize) }}>下一页</Button>
        </Stack> : null}
        <DialogActions sx={{ pb: compact
          ? 'max(8px, env(safe-area-inset-bottom, 0px))' : 1.5 }}>
          {!job ? <Button variant="outlined" disabled={busy} onClick={() => { void readPage(offset) }}>刷新本页</Button> : null}
          <Button variant="contained" disabled={busy} onClick={close}>完成审核</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmFavorite !== null} maxWidth="xs" fullWidth
        onClose={busy ? undefined : () => setConfirmFavorite(null)}
        aria-label="确认媒体批量收藏任务">
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700}>确认提交批量任务？</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            将对 {snapshot?.selected.toLocaleString('zh-CN') ?? 0} 个已选媒体
            {confirmFavorite ? '设置收藏' : '取消收藏'}。
            提交后在服务端持久化执行，逐项检查权限及文件版本。
            已变更的文件会记录为失败，不会跳过检查强制修改。
          </Typography>
        </Box>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirmFavorite(null)}>返回审核</Button>
          <Button variant="contained" disabled={busy || !snapshot || snapshot.selected === 0}
            data-xdrive-gallery-confirm-durable-favorite
            onClick={() => {
              if (confirmFavorite !== null) void submitFavorite(confirmFavorite)
            }}>
            {busy ? '提交中…' : '确认提交'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
