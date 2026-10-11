import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import type { XDriveLocalBackupEvidence } from '../device-backups'

export interface XDriveLocalBackupEvidenceActions {
  stage(sourceID: number, requestID: string): Promise<XDriveLocalBackupEvidence>
  cancel(requestID: string): Promise<void>
}

// A deliberate action on the owning Desktop. The Renderer never receives
// Root paths, native identity keys, tokens or SourceItem IDs. Evidence is
// advisory metadata only; a cancelled request may have inert partial rows.
export function XDriveDeviceBackupLocalEvidenceDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupEvidenceActions
  onClose(): void
}) {
  const [result, setResult] = useState<XDriveLocalBackupEvidence | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const currentRequest = useRef<string | null>(null)
  const disposed = useRef(false)

  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      if (currentRequest.current) void actions.cancel(currentRequest.current).catch(() => {})
    }
  }, [actions])

  const close = () => {
    if (currentRequest.current) void actions.cancel(currentRequest.current).catch(() => {})
    onClose()
  }

  const stage = async () => {
    if (loading || currentRequest.current) return
    const requestID = crypto.randomUUID()
    currentRequest.current = requestID
    setLoading(true)
    setResult(null)
    setError('')
    try {
      const value = await actions.stage(sourceID, requestID)
      if (disposed.current || currentRequest.current !== requestID) return
      const counts = [value.hints, value.matched, value.unmatched, value.stored, value.replayed]
      if (value.source_id !== sourceID || !Number.isSafeInteger(value.revision) ||
        value.revision <= 0 || value.complete !== true ||
        value.authoritative !== false || value.missing_inference_safe !== false ||
        !counts.every((n) => Number.isSafeInteger(n) && n >= 0) ||
        value.hints !== value.matched + value.unmatched ||
        value.matched !== value.stored + value.replayed) {
        throw new Error('候选暂存的汇总结果不完整或 Source 身份不匹配')
      }
      setResult(value)
    } catch (failure) {
      if (!disposed.current && currentRequest.current === requestID) {
        setError('暂存未完成：' + (failure instanceof Error ? failure.message : String(failure)))
      }
    } finally {
      if (currentRequest.current === requestID) currentRequest.current = null
      if (!disposed.current) setLoading(false)
    }
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={close}>
      <DialogTitle>本机同步文件夹 · 重命名候选暂存</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            先保存两代完整本机扫描清单，再手动暂存经过本机核验的重命名候选。
            只保存服务器上的非权威候选证据，不重新上传文件、不修改云端文件，也不启动备份。
          </Alert>
          <Alert severity="warning">
            暂存不证明重命名已成立、文件内容一致或云端文件应移动。
            关闭期间请求将取消；部分无执行权限的候选记录可能已安全暂存，重复操作可幂等复用。
            Mirror 删除、SourceItem 别名提交和真实上传均未启用。
          </Alert>
          {loading ? <Typography variant="body2">正在校验两代清单并暂存候选，关闭可取消…</Typography> : null}
          {result ? (
            <Stack spacing={0.75}>
              <Typography variant="body2">候选阶段完成 · Source 版本 {result.revision}</Typography>
              <Typography variant="body2">唯一原生身份候选：{result.hints.toLocaleString('zh-CN')}</Typography>
              <Typography variant="body2">关联已有 SourceItem：{result.matched.toLocaleString('zh-CN')}</Typography>
              <Typography variant="body2">未关联的候选（未写入）：{result.unmatched.toLocaleString('zh-CN')}</Typography>
              <Typography variant="body2">新暂存：{result.stored.toLocaleString('zh-CN')} · 幂等复用：{result.replayed.toLocaleString('zh-CN')}</Typography>
              <Alert severity="info">仅完成咨询性证据暂存，并不代表任何文件已成功备份。</Alert>
            </Stack>
          ) : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!result && !loading ? <Button onClick={() => { void stage() }} variant="contained">手动暂存候选</Button> : null}
        <Button onClick={close}>{loading ? '取消暂存' : '关闭'}</Button>
      </DialogActions>
    </Dialog>
  )
}
