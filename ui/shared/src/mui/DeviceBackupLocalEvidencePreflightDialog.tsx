import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import type { XDriveLocalBackupEvidencePreflight } from '../device-backups'
import { formatBytes } from '../format'

export interface XDriveLocalBackupEvidencePreflightActions {
  load(sourceID: number, afterEvidenceID: number, requestID: string): Promise<XDriveLocalBackupEvidencePreflight>
  cancel(requestID: string): Promise<void>
}

// Owner Desktop ONLY. The Agent itself resolves the exact device/Root,
// locally sealed inventory, SHA256, Source identity and current physical CAS.
// This dialog sees aggregate counters and a pagination cursor, nothing else.
export function XDriveDeviceBackupLocalEvidencePreflightDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupEvidencePreflightActions
  onClose(): void
}) {
  const [afterID, setAfterID] = useState(0)
  const [pageNo, setPageNo] = useState(1)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<XDriveLocalBackupEvidencePreflight | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    const requestID = crypto.randomUUID()
    setResult(null)
    setFailed(false)
    setLoading(true)
    void actions.load(sourceID, afterID, requestID).then((value) => {
      if (!active) return
      const counts = [
        value.checked, value.locally_hashed_files, value.locally_hashed_bytes,
        value.metadata_matched_files, value.physical_observed_files,
        value.physical_observed_bytes, value.physical_unobserved_files,
        value.physical_batch_requests,
      ]
      if (value.source_id !== sourceID ||
        !Number.isSafeInteger(value.revision) || value.revision <= 0 ||
        !counts.every((count) => Number.isSafeInteger(count) && count >= 0) ||
        value.checked > 64 || value.locally_hashed_files !== value.checked ||
        value.metadata_matched_files !== value.checked ||
        value.physical_observed_files > 16 ||
        value.physical_observed_files > value.checked ||
        value.physical_unobserved_files !== value.checked - value.physical_observed_files ||
        value.physical_batch_requests > 4 || value.physical_observed_bytes > 256 * 1024 * 1024 ||
        (value.physical_observed_files === 0) !== (value.physical_batch_requests === 0) ||
        (value.checked > 0 && !value.server_consistent) ||
        value.content_verified !== false || value.commit_supported !== false ||
        value.authoritative !== false || value.missing_inference_safe !== false ||
        typeof value.has_more !== 'boolean' ||
        !Number.isSafeInteger(value.next_after_id) || value.next_after_id < 0 ||
        (value.has_more && value.next_after_id <= afterID)) {
        throw new Error('无效的本机预检统计')
      }
      setResult(value)
      setLoading(false)
    }).catch(() => {
      if (active) {
        // Never reveal raw native paths, hashed filenames, remote HTTP
        // responses, token errors or physical CAS storage keys in the UI.
        setFailed(true)
        setLoading(false)
      }
    })
    return () => {
      active = false
      void actions.cancel(requestID).catch(() => {})
    }
  }, [sourceID, actions, afterID, retry])

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>本机设备备份 · 内容一致性预检（只读）</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            仅在本机 Agent 中核验已有的两代清单和云端文件内容。单页最多 64 条候选，
            最多抽样 16 个对象 / 256 MiB。没有被物理抽样的文件不代表已验证或需要删除。
          </Alert>
          {loading ? <Typography variant="body2">正在核验第 {pageNo} 页，读取大文件可能较慢；关闭即取消本次请求…</Typography> : null}
          {result ? (
            <Stack spacing={1}>
              <Typography variant="body2">第 {pageNo} 页 · Source 修订 {result.revision}</Typography>
              <Typography variant="body2">身份与元数据核对：{result.metadata_matched_files.toLocaleString('zh-CN')} / {result.checked.toLocaleString('zh-CN')} 条</Typography>
              <Typography variant="body2">本机原文件 SHA256 读取：{result.locally_hashed_files.toLocaleString('zh-CN')} 条 · {formatBytes(result.locally_hashed_bytes)}</Typography>
              <Typography variant="body2">本页物理 CAS 抽样：{result.physical_observed_files.toLocaleString('zh-CN')} 条 · {formatBytes(result.physical_observed_bytes)}</Typography>
              <Typography variant="body2">尚未物理抽样：{result.physical_unobserved_files.toLocaleString('zh-CN')} 条 · 共 {result.physical_batch_requests} 次核验请求</Typography>
              <Typography variant="body2">后续候选页：{result.has_more ? '还有（可手动查看下一页）' : '本次候选清单已到末尾'}</Typography>
              <Alert severity="warning">
                本检查是当前时刻的抽样结果，不是完整备份、持久内容证明、上传就绪授权或
                Mirror 删除依据。SourceItem/别名写入、实际 Push 与自动调度仍未启用。
              </Alert>
            </Stack>
          ) : null}
          {failed ? <Alert severity="warning">无法完成本页只读预检。请确认本机授权、两代清单及云端状态，或稍后重试。</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!loading ? <Button onClick={() => setRetry((n) => n + 1)}>重新核验本页</Button> : null}
        {result?.has_more && !loading ? (
          <Button variant="outlined" onClick={() => {
            setAfterID(result.next_after_id)
            setPageNo((n) => n + 1)
          }}>核验下一页</Button>
        ) : null}
        <Button onClick={onClose}>{loading ? '取消本次预检' : '关闭'}</Button>
      </DialogActions>
    </Dialog>
  )
}
