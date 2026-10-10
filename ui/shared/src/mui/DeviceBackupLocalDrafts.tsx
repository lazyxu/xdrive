import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Stack, Typography,
} from '@mui/material'
import type { XDriveLocalSourceDraft, XDriveLocalSourceDraftPage } from '../device-backups'
import type { XDriveLocalBackupCreateActions } from './DeviceBackupLocalCreateDialog'

type DraftState = {
  reader?: (limit: number, afterID: number) => Promise<XDriveLocalSourceDraftPage>
  items: XDriveLocalSourceDraft[]
  loading: boolean
  hasMore: boolean
  nextAfterID: number
  error: string
}

const EMPTY: DraftState = {
  items: [], loading: false, hasMore: false, nextAfterID: 0, error: '',
}

export function XDriveDeviceBackupLocalDrafts({
  reader, actions, refreshID, onFinished,
}: {
  reader(limit: number, afterID: number): Promise<XDriveLocalSourceDraftPage>
  actions: Pick<XDriveLocalBackupCreateActions, 'authorize' | 'discard'>
  refreshID: number
  onFinished(message: string): void
}) {
  const [state, setState] = useState<DraftState>(EMPTY)
  const [workingID, setWorkingID] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<XDriveLocalSourceDraft | null>(null)
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  // Scope *actions* as well as list results. A native picker can finish
  // after the user switches account/server or leaves this page.
  const activeReaderRef = useRef<typeof reader | undefined>(reader)
  activeReaderRef.current = reader
  useEffect(() => {
    activeReaderRef.current = reader
    return () => { activeReaderRef.current = undefined }
  }, [reader])
  const current = state.reader === reader ? state : EMPTY

  const load = useCallback(async (afterID: number, append: boolean) => {
    const request = ++generation.current
    setState((prior) => ({
      reader,
      items: append && prior.reader === reader ? prior.items : [],
      loading: true,
      hasMore: append && prior.reader === reader ? prior.hasMore : false,
      nextAfterID: append && prior.reader === reader ? prior.nextAfterID : 0,
      error: '',
    }))
    try {
      const page = await reader(20, afterID)
      if (request !== generation.current) return
      setState((prior) => ({
        reader,
        items: append && prior.reader === reader
          ? [...prior.items, ...page.items.filter((item) => !prior.items.some((old) => old.source_id === item.source_id))]
          : page.items,
        loading: false,
        hasMore: page.has_more,
        nextAfterID: page.next_after_id,
        error: '',
      }))
    } catch (error) {
      if (request !== generation.current) return
      setState((prior) => ({
        ...prior, reader, loading: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [reader])

  useEffect(() => {
    setWorkingID(null)
    setConfirm(null)
    setNotice('')
    void load(0, false)
    return () => { ++generation.current }
  }, [load, refreshID])

  const authorize = async (draft: XDriveLocalSourceDraft) => {
    const actionReader = reader
    const stillCurrent = () => activeReaderRef.current === actionReader
    setWorkingID(draft.source_id)
    setNotice('')
    try {
      const result = await actions.authorize(draft.source_id)
      if (!stillCurrent()) return
      if (result.cancelled) {
        setNotice('已取消本机目录选择，草稿仍保持暂停，可以稍后重试。')
      } else {
        onFinished('本机 Root 已授权；真正上传和自动同步尚未启用')
      }
      await load(0, false)
    } catch (error) {
      if (!stillCurrent()) return
      setNotice('授权失败或结果尚未确认，草稿不会被自动删除：' +
        (error instanceof Error ? error.message : String(error)))
      await load(0, false)
    } finally {
      if (stillCurrent()) setWorkingID(null)
    }
  }

  const discard = async () => {
    const actionReader = reader
    const stillCurrent = () => activeReaderRef.current === actionReader
    const draft = confirm
    if (!draft || workingID !== null) return
    setConfirm(null)
    setWorkingID(draft.source_id)
    setNotice('')
    try {
      await actions.discard(draft.source_id, draft.revision)
      if (!stillCurrent()) return
      onFinished('本机未绑定的空草稿已安全清理，云端数据不会删除')
      await load(0, false)
    } catch (error) {
      if (!stillCurrent()) return
      setNotice('草稿未删除：' + (error instanceof Error ? error.message : String(error)) +
        '。如 Root 已绑定或版本变化，Server 会拒绝草稿清理。')
      await load(0, false)
    } finally {
      if (stillCurrent()) setWorkingID(null)
    }
  }

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={700}>本机待完成授权</Typography>
          <Button size="small" onClick={() => void load(0, false)} disabled={current.loading || workingID !== null}>
            刷新草稿
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          只列出这台设备创建、尚未首次绑定 Root 的暂停草稿。登录同一账号的其他设备无法恢复或清理。
        </Typography>
        {notice ? <Alert severity="info">{notice}</Alert> : null}
        {current.error ? <Alert severity="warning">读取本机草稿失败：{current.error}</Alert> : null}
        {!current.loading && current.items.length === 0 && !current.error ? (
          <Typography variant="body2" color="text.secondary">没有待完成的本机授权。</Typography>
        ) : null}
        {current.items.map((draft) => (
          <Box key={draft.source_id}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>{draft.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  #{draft.source_id} · 创建于 {new Date(draft.created_at).toLocaleString('zh-CN')} · 暂停
                </Typography>
              </Box>
              <Button size="small" variant="outlined"
                disabled={workingID !== null || current.loading}
                onClick={() => void authorize(draft)}>
                继续选择本机目录
              </Button>
              <Button size="small" color="warning"
                disabled={workingID !== null || current.loading}
                onClick={() => setConfirm(draft)}>
                清理草稿
              </Button>
            </Stack>
            <Divider sx={{ mt: 1.5 }} />
          </Box>
        ))}
        {current.loading ? <Typography variant="body2" color="text.secondary">正在读取草稿…</Typography> : null}
        {current.hasMore && !current.loading ? (
          <Button size="small" disabled={workingID !== null}
            onClick={() => void load(current.nextAfterID, true)}>加载更多草稿</Button>
        ) : null}
      </Stack>
      <Dialog open={Boolean(confirm)} onClose={() => { if (workingID === null) setConfirm(null) }}>
        <DialogTitle>清理未绑定的草稿？</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            仅删除这台设备创建且尚未授权 Root、没有运行历史的空 Source 草稿。
            如该 Source 已发生变化，Server 会拒绝删除，不会影响云端文件。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>取消</Button>
          <Button color="warning" disabled={workingID !== null} onClick={() => void discard()}>
            确认清理
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
