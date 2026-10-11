import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { formatBytes } from '../format'
import type { XDriveLocalBackupPreview } from '../device-backups'

export interface XDriveLocalBackupPreviewActions {
  preview(sourceID: number, requestID: string): Promise<XDriveLocalBackupPreview>
  cancel(requestID: string): Promise<void>
}

// Own-Desktop-only read-only metadata scan. No SourceRun or cloud mutation.
// Close, account/server transition and dialog unmount abort the Agent HTTP
// request so Go's scanner stops through its request context.
export function XDriveDeviceBackupLocalPreviewDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupPreviewActions
  onClose(): void
}) {
  const [preview, setPreview] = useState<XDriveLocalBackupPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    const requestID = crypto.randomUUID()
    setPreview(null)
    setError('')
    setLoading(true)
    void actions.preview(sourceID, requestID).then((result) => {
      if (!active) return
      if (result.source_id !== sourceID || !Number.isSafeInteger(result.revision) ||
        result.revision <= 0 || !result.complete || result.missing_inference_safe !== false ||
        ![result.scanned_files, result.scanned_directories, result.scanned_bytes,
          result.ignored_items, result.ignored_bytes, result.skipped_unsafe_items]
          .every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error('本机扫描结果不完整或 Source 身份不匹配')
      }
      setPreview(result)
      setLoading(false)
    }).catch((failure) => {
      if (active) {
        setError('本机预览失败：' + (failure instanceof Error ? failure.message : String(failure)))
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
      <DialogTitle>本机同步文件夹 · 扫描预览</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            仅扫描此电脑已授权文件夹的元数据，不上传、不创建同步任务、不写清单、
            不修改或删除云端文件。关闭后将取消正在进行的扫描。
          </Alert>
          {loading ? <Typography variant="body2">正在预览本机文件，关闭可取消扫描…</Typography> : null}
          {preview ? (
            <Stack spacing={0.75}>
              <Typography variant="body2">文件：{preview.scanned_files.toLocaleString('zh-CN')} 项</Typography>
              <Typography variant="body2">目录：{preview.scanned_directories.toLocaleString('zh-CN')} 项</Typography>
              <Typography variant="body2">文件大小合计：{formatBytes(preview.scanned_bytes)}</Typography>
              <Typography variant="body2">忽略规则命中：{preview.ignored_items.toLocaleString('zh-CN')} 项 · {formatBytes(preview.ignored_bytes)}</Typography>
              <Typography variant="body2">跳过的链接或特殊文件：{preview.skipped_unsafe_items.toLocaleString('zh-CN')} 项</Typography>
              <Typography variant="caption" color="text.secondary">
                完整扫描成功，Source 版本 {preview.revision}。这不是云端缺失判断或已备份证明。
              </Typography>
            </Stack>
          ) : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!loading ? <Button onClick={() => setRetry((n) => n + 1)}>重新预览</Button> : null}
        <Button onClick={onClose}>{loading ? '取消扫描' : '关闭'}</Button>
      </DialogActions>
    </Dialog>
  )
}
