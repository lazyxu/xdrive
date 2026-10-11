import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import type { XDriveLocalBackupEvidenceSummary } from '../device-backups'

export interface XDriveLocalBackupEvidenceSummaryActions {
  load(sourceID: number, requestID: string): Promise<XDriveLocalBackupEvidenceSummary>
  cancel(requestID: string): Promise<void>
}

// Only the verified owning Desktop can open this observer. It displays an
// exact-generation Server COUNT; it is NOT a rename, upload or Mirror proof.
// The request never includes local file paths, device tokens or Root identity.
export function XDriveDeviceBackupLocalEvidenceSummaryDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupEvidenceSummaryActions
  onClose(): void
}) {
  const [summary, setSummary] = useState<XDriveLocalBackupEvidenceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    const requestID = crypto.randomUUID()
    setSummary(null)
    setError('')
    setLoading(true)
    void actions.load(sourceID, requestID).then((value) => {
      if (!active) return
      if (value.source_id !== sourceID ||
        !Number.isSafeInteger(value.revision) || value.revision <= 0 ||
        !Number.isSafeInteger(value.staged_records) || value.staged_records < 0 ||
        value.authoritative !== false || value.missing_inference_safe !== false) {
        throw new Error('暂存记录统计无效或 Source 身份不匹配')
      }
      setSummary(value)
      setLoading(false)
    }).catch(() => {
      if (active) {
        // Agent failures are not rendered as raw OS/HTTP errors. The Source
        // may be revoked, its Root replaced or its saved generation stale.
        setError('无法验证本机两代清单或读取当前暂存记录。请检查设备授权与清单状态。')
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
      <DialogTitle>本机同步文件夹 · 已暂存候选记录</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            仅核对本机已验证的两代完整扫描清单在服务器上对应的非权威候选记录数。
            此操作只读，不扫描新文件、不上传、不修改云端。
          </Alert>
          {loading ? <Typography variant="body2">正在验证本机清单并查询记录，关闭可取消…</Typography> : null}
          {summary ? (
            <Stack spacing={1}>
              <Typography variant="body2">当前 Source 版本：{summary.revision}</Typography>
              <Typography variant="body2">当前两代清单的已暂存候选：{summary.staged_records.toLocaleString('zh-CN')} 条</Typography>
              <Alert severity="warning">
                {summary.staged_records === 0
                  ? '当前清单版本没有对应的暂存证据。这不代表本机文件为空，也不代表任何云端文件需要删除。'
                  : '这些只是持久化的咨询性候选，不代表重命名成立、文件内容一致或备份成功。'}
                Mirror 删除、SourceItem 别名提交和实际上传均未启用。
              </Alert>
            </Stack>
          ) : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!loading ? <Button onClick={() => setRetry((n) => n + 1)}>重新验证</Button> : null}
        <Button onClick={onClose}>{loading ? '取消读取' : '关闭'}</Button>
      </DialogActions>
    </Dialog>
  )
}
