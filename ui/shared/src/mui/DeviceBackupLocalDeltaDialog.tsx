import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import type { XDriveLocalBackupDelta } from '../device-backups'

export interface XDriveLocalBackupDeltaActions {
  compare(sourceID: number, requestID: string): Promise<XDriveLocalBackupDelta>
  cancel(requestID: string): Promise<void>
}

// Own-Desktop-only local journal comparison. No candidate rows or path/Root
// identities reach the renderer; cancellation propagates into Go Context.
export function XDriveDeviceBackupLocalDeltaDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupDeltaActions
  onClose(): void
}) {
  const [summary, setSummary] = useState<XDriveLocalBackupDelta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    const requestID = crypto.randomUUID()
    setSummary(null)
    setError('')
    setLoading(true)
    void actions.compare(sourceID, requestID).then((result) => {
      if (!active) return
      const counts = [result.previous_items, result.current_items, result.added,
        result.changed, result.metadata_stable, result.absent_candidates]
      if (result.source_id !== sourceID || !Number.isSafeInteger(result.revision) ||
        result.revision <= 0 || result.complete !== true ||
        result.authoritative !== false || result.missing_inference_safe !== false ||
        !counts.every((value) => Number.isSafeInteger(value) && value >= 0) ||
        result.current_items !== result.added + result.changed + result.metadata_stable ||
        result.previous_items !== result.absent_candidates + result.changed + result.metadata_stable) {
        throw new Error('本机差异结果不完整或 Source 身份不匹配')
      }
      setSummary(result)
      setLoading(false)
    }).catch((failure) => {
      if (active) {
        setError('两代清单比较失败：' + (failure instanceof Error ? failure.message : String(failure)))
        setLoading(false)
      }
    })
    return () => {
      active = false
      void actions.cancel(requestID).catch(() => {})
    }
  }, [sourceID, actions, retry])

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>本机同步文件夹 · 两代清单差异</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            仅读取此电脑已保存的两代完整扫描清单并比较文件元数据。
            请先使用“保存本机扫描清单”至少两次。不重新扫描、不上传、不修改云端。
          </Alert>
          {loading ? <Typography variant="body2">正在验证两代清单并统计差异，关闭可取消…</Typography> : null}
          {summary ? (
            <Stack spacing={0.75}>
              <Typography variant="body2">两代清单验证完成 · Source 版本 {summary.revision}</Typography>
              <Typography variant="body2">前一代 {summary.previous_items.toLocaleString('zh-CN')} 项 · 当前代 {summary.current_items.toLocaleString('zh-CN')} 项</Typography>
              <Typography variant="body2">新增候选：{summary.added.toLocaleString('zh-CN')} 项</Typography>
              <Typography variant="body2">元数据变化候选：{summary.changed.toLocaleString('zh-CN')} 项</Typography>
              <Typography variant="body2">元数据未变化：{summary.metadata_stable.toLocaleString('zh-CN')} 项</Typography>
              <Typography variant="body2">当前清单未出现的候选：{summary.absent_candidates.toLocaleString('zh-CN')} 项</Typography>
              <Alert severity="warning">
                这些数字仅为本机咨询性差异，不证明内容字节一致、文件已上传、重命名成立或云端需要删除。
                即使备份策略为 Mirror，也绝不会因本页结果触发删除。
              </Alert>
            </Stack>
          ) : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!loading && error ? <Button onClick={() => setRetry((n) => n + 1)}>重试</Button> : null}
        <Button onClick={onClose}>{loading ? '取消比较' : '关闭'}</Button>
      </DialogActions>
    </Dialog>
  )
}
