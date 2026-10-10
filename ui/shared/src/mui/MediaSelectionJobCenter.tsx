import { useEffect, useRef, useState } from 'react'
import {
  Box, Button, CircularProgress, Divider, LinearProgress, Paper,
  Stack, Typography,
} from '@mui/material'
import type {
  MediaSelectionJob, MediaSelectionJobFailurePage,
} from '../models'
import { xDriveMediaGalleryErrorMessage } from './MediaGalleryUtils'

export interface XDriveMediaSelectionJobPort {
  list: () => Promise<MediaSelectionJob[]>
  cancel: (jobID: string) => Promise<unknown>
  retry: (jobID: string) => Promise<MediaSelectionJob>
  failures: (
    jobID: string, offset: number, limit: number,
  ) => Promise<MediaSelectionJobFailurePage>
}

const failurePageSize = 100

const jobStatusLabels: Record<MediaSelectionJob['status'], string> = {
  queued: '等待处理',
  running: '正在处理',
  cancel_requested: '正在取消',
  completed: '已完成',
  partial: '部分成功',
  cancelled: '已取消',
}

type MediaJobCenterScope = {
  port: XDriveMediaSelectionJobPort
  inFlight: boolean
  listGeneration: number
}

type MediaJobCenterState = {
  owner: MediaJobCenterScope
  jobs: MediaSelectionJob[]
  loading: boolean
  error: string
  busyID: string
  failureJobID: string
  failurePage: MediaSelectionJobFailurePage | null
  failureOffset: number
}

function emptyMediaJobCenterState(owner: MediaJobCenterScope): MediaJobCenterState {
  return {
    owner, jobs: [], loading: true, error: '', busyID: '',
    failureJobID: '', failurePage: null, failureOffset: 0,
  }
}

export function XDriveMediaSelectionJobCenter({
  port,
}: {
  port: XDriveMediaSelectionJobPort
}) {
  // A task read, failure page and mutation belong to exactly one authenticated
  // transport scope. Re-selecting an earlier transport creates a fresh owner.
  const scopeRef = useRef<MediaJobCenterScope>({
    port, inFlight: false, listGeneration: 0,
  })
  if (scopeRef.current.port !== port) {
    scopeRef.current = { port, inFlight: false, listGeneration: 0 }
  }
  const scope = scopeRef.current
  const [stored, setStored] = useState<MediaJobCenterState>(
    () => emptyMediaJobCenterState(scope),
  )
  // Do not render previous-account task names, errors or failures even for one
  // frame while the new transport performs its initial asynchronous read.
  const visible = stored.owner === scope
    ? stored : emptyMediaJobCenterState(scope)
  const {
    jobs, loading, error, busyID, failureJobID, failurePage, failureOffset,
  } = visible

  const update = (patch: Partial<Omit<MediaJobCenterState, 'owner'>>) => {
    if (scopeRef.current !== scope) return
    setStored((current) => {
      if (scopeRef.current !== scope) return current
      return {
        ...(current.owner === scope
          ? current : emptyMediaJobCenterState(scope)),
        ...patch,
      }
    })
  }

  useEffect(() => {
    let alive = true
    let fetching = false
    const refresh = () => {
      if (fetching || scopeRef.current !== scope || scope.inFlight) return
      fetching = true
      const request = ++scope.listGeneration
      void port.list().then((list) => {
        if (!alive || scopeRef.current !== scope || scope.inFlight ||
          request !== scope.listGeneration) return
        update({ jobs: list, error: '' })
      }).catch((reason) => {
        if (alive && scopeRef.current === scope && !scope.inFlight &&
          request === scope.listGeneration) {
          update({ error: xDriveMediaGalleryErrorMessage(reason) })
        }
      }).finally(() => {
        fetching = false
        if (alive && scopeRef.current === scope) update({ loading: false })
      })
    }
    refresh()
    // This panel mounts only in Task Center; Gallery first paint has no
    // task-list query and no 100k MediaItem materialization.
    const timer = setInterval(refresh, 2500)
    return () => { alive = false; clearInterval(timer) }
  }, [port])

  const claim = (jobID: string) => {
    if (scopeRef.current !== scope || scope.inFlight) return false
    // Claim synchronously before React publishes Busy. This also invalidates
    // any older polling snapshot started before the mutation was accepted.
    scope.inFlight = true
    scope.listGeneration += 1
    update({ busyID: jobID, error: '' })
    return true
  }

  const release = () => {
    scope.inFlight = false
    update({ busyID: '' })
  }

  const act = async (jobID: string, action: 'cancel' | 'retry') => {
    if (!claim(jobID)) return
    try {
      if (action === 'cancel') await port.cancel(jobID)
      else await port.retry(jobID)
      if (scopeRef.current !== scope) return
      const list = await port.list()
      if (scopeRef.current !== scope) return
      update({
        jobs: list, error: '',
        failurePage: null, failureJobID: '', failureOffset: 0,
      })
    } catch (reason) {
      if (scopeRef.current === scope) {
        update({ error: xDriveMediaGalleryErrorMessage(reason) })
      }
    } finally {
      release()
    }
  }

  const showFailures = async (jobID: string, offset: number) => {
    if (!claim(jobID)) return
    try {
      const result = await port.failures(jobID, offset, failurePageSize)
      if (scopeRef.current !== scope) return
      update({
        failureJobID: jobID, failurePage: result, failureOffset: offset,
      })
    } catch (reason) {
      if (scopeRef.current === scope) {
        update({ error: xDriveMediaGalleryErrorMessage(reason) })
      }
    } finally {
      release()
    }
  }

  return (
    <Box data-xdrive-media-selection-job-center>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
          媒体批量任务
        </Typography>
        {loading ? <CircularProgress size={18} /> : null}
      </Stack>
      {error ? (
        <Typography role="alert" variant="body2" color="error"
          sx={{ mb: 1, overflowWrap: 'anywhere' }}>{error}</Typography>
      ) : null}
      {!loading && jobs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          暂无媒体批量任务
        </Typography>
      ) : (
        <Stack spacing={1}>
          {jobs.map((job) => {
            const fraction = job.total_items > 0
              ? Math.min(100, Math.max(0, job.processed_items / job.total_items * 100))
              : 0
            return (
              <Paper key={job.id} variant="outlined" data-xdrive-media-job={job.id}
                sx={{ p: 1.5, borderRadius: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center"
                  useFlexGap flexWrap="wrap">
                  <Typography variant="body2" fontWeight={700} sx={{ flex: 1, minWidth: 120 }}>
                    {job.favorite ? '批量收藏' : '批量取消收藏'}
                  </Typography>
                  <Typography variant="body2" role="status">
                    {jobStatusLabels[job.status]}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  已处理 {job.processed_items.toLocaleString('zh-CN')} /
                  {job.total_items.toLocaleString('zh-CN')} 项 ·
                  成功 {job.succeeded_items.toLocaleString('zh-CN')} ·
                  失败 {job.failed_items.toLocaleString('zh-CN')} ·
                  取消 {job.cancelled_items.toLocaleString('zh-CN')}
                </Typography>
                <LinearProgress variant="determinate" value={fraction} sx={{ mt: 1, mb: 0.5 }} />
                <Typography variant="caption" color="text.secondary">
                  任务 ID：{job.id}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}
                  useFlexGap flexWrap="wrap">
                  {['queued', 'running'].includes(job.status) ? (
                    <Button size="small" color="error" disabled={Boolean(busyID)}
                      onClick={() => { void act(job.id, 'cancel') }}>取消任务</Button>
                  ) : null}
                  {['partial', 'cancelled'].includes(job.status) ? (
                    <Button size="small" disabled={Boolean(busyID)}
                      onClick={() => { void act(job.id, 'retry') }}>重试未成功项</Button>
                  ) : null}
                  {job.failed_items > 0 ? (
                    <Button size="small" disabled={Boolean(busyID)}
                      onClick={() => { void showFailures(job.id, 0) }}>查看失败详情</Button>
                  ) : null}
                </Stack>
                {failureJobID === job.id && failurePage ? (
                  <Box data-xdrive-media-job-failures={job.id} sx={{ mt: 1 }}>
                    <Divider sx={{ mb: 1 }} />
                    <Typography variant="body2" fontWeight={600}>
                      失败 {failurePage.total.toLocaleString('zh-CN')} 项
                    </Typography>
                    {failurePage.items.map((failure) => (
                      <Typography key={failure.node_id} variant="caption"
                        sx={{ display: 'block', my: 0.5, overflowWrap: 'anywhere' }}>
                        文件 #{failure.node_id} · 版本 {failure.revision} · {failure.failure_code}
                      </Typography>
                    ))}
                    <Stack direction="row" justifyContent="space-between">
                      <Button size="small" disabled={Boolean(busyID) || failureOffset === 0}
                        onClick={() => { void showFailures(job.id, Math.max(0, failureOffset-failurePageSize)) }}>
                        上一页失败项
                      </Button>
                      <Button size="small" disabled={Boolean(busyID) || !failurePage.has_more}
                        onClick={() => { void showFailures(job.id, failureOffset+failurePageSize) }}>
                        下一页失败项
                      </Button>
                    </Stack>
                  </Box>
                ) : null}
              </Paper>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}
