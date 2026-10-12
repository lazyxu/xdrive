import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import type { XDriveLocalBackupEvidencePreflight } from '../device-backups'
import { formatBytes } from '../format'

export interface XDriveLocalBackupEvidencePreflightActions {
  load(sourceID: number, afterEvidenceID: number, requestID: string): Promise<XDriveLocalBackupEvidencePreflight>
  cancel(requestID: string): Promise<void>
}

function validPage(value: XDriveLocalBackupEvidencePreflight, sourceID: number, afterID: number): boolean {
  const counts = [
    value.checked, value.locally_hashed_files, value.locally_hashed_bytes,
    value.metadata_matched_files, value.physical_observed_files,
    value.physical_observed_bytes, value.physical_unobserved_files,
    value.physical_batch_requests,
  ]
  return value.source_id === sourceID &&
    Number.isSafeInteger(value.revision) && value.revision > 0 &&
    counts.every((count) => Number.isSafeInteger(count) && count >= 0) &&
    value.checked <= 64 && value.locally_hashed_files === value.checked &&
    value.metadata_matched_files === value.checked &&
    value.physical_observed_files <= 16 &&
    value.physical_observed_files <= value.checked &&
    value.physical_observed_files <= 4 * value.physical_batch_requests &&
    value.physical_unobserved_files === value.checked - value.physical_observed_files &&
    value.physical_batch_requests <= 4 &&
    value.physical_observed_bytes <= 256 * 1024 * 1024 &&
    value.physical_observed_bytes <= value.locally_hashed_bytes &&
    (value.physical_observed_files === 0) === (value.physical_batch_requests === 0) &&
    (value.checked === 0 || value.server_consistent === true) &&
    value.content_verified === false && value.commit_supported === false &&
    value.authoritative === false && value.missing_inference_safe === false &&
    typeof value.has_more === 'boolean' &&
    Number.isSafeInteger(value.next_after_id) && value.next_after_id >= 0 &&
    (value.checked === 0 || value.next_after_id > afterID) &&
    (!value.has_more || value.checked > 0)
}

// Owner Desktop ONLY. Page results are point-in-time, redacted observations.
// Even matching revisions do NOT establish a single atomic cloud snapshot,
// a complete backup or permission to modify SourceItem/CAS.
export function XDriveDeviceBackupLocalEvidencePreflightDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupEvidencePreflightActions
  onClose(): void
}) {
  const [afterID, setAfterID] = useState(0)
  const [pageNo, setPageNo] = useState(1)
  const [retry, setRetry] = useState(0)
  const [pageResult, setPageResult] = useState<{
    cursor: number
    value: XDriveLocalBackupEvidencePreflight
  } | null>(null)
  const [observedPages, setObservedPages] = useState<Record<number, XDriveLocalBackupEvidencePreflight>>({})
  const [loading, setLoading] = useState(true)
  const [failedAfterID, setFailedAfterID] = useState<number | null>(null)
  const [revisionChanged, setRevisionChanged] = useState(false)
  const sessionRevision = useRef<number | null>(null)

  // Replacing the authenticated Agent/server actions resets the session.
  useEffect(() => {
    sessionRevision.current = null
    setObservedPages({})
    setRevisionChanged(false)
    setAfterID(0)
    setPageNo(1)
    setRetry(0)
    setPageResult(null)
  }, [sourceID, actions])

  useEffect(() => {
    let active = true
    const requestID = crypto.randomUUID()
    setPageResult(null)
    setFailedAfterID(null)
    setLoading(true)
    void actions.load(sourceID, afterID, requestID).then((value) => {
      if (!active) return
      if (!validPage(value, sourceID, afterID)) throw new Error('无效的本机预检统计')
      if (sessionRevision.current !== null && sessionRevision.current !== value.revision) {
        setRevisionChanged(true)
        throw new Error('Source revision changed during pagination')
      }
      if (sessionRevision.current === null) sessionRevision.current = value.revision
      // A successful retry REPLACES the current page; never double count it.
      setObservedPages((previous) => ({ ...previous, [afterID]: value }))
      setPageResult({ cursor: afterID, value })
      setLoading(false)
    }).catch(() => {
      if (active) {
        // Raw paths, filenames, digest values and CAS keys never reach UI.
        setFailedAfterID(afterID)
        setLoading(false)
      }
    })
    return () => {
      active = false
      void actions.cancel(requestID).catch(() => {})
    }
  }, [sourceID, actions, afterID, retry])

  // The old page must never render with the new page number/cursor, even
  // for the render immediately BEFORE the next effect has started.
  const result = pageResult && pageResult.cursor === afterID ? pageResult.value : null
  const totals = useMemo(() => Object.values(observedPages).reduce((total, page) => ({
    pages: total.pages + 1,
    checked: total.checked + page.checked,
    localBytes: total.localBytes + page.locally_hashed_bytes,
    sampled: total.sampled + page.physical_observed_files,
    sampledBytes: total.sampledBytes + page.physical_observed_bytes,
    unsampled: total.unsampled + page.physical_unobserved_files,
  }), { pages: 0, checked: 0, localBytes: 0, sampled: 0, sampledBytes: 0, unsampled: 0 }), [observedPages])
  const totalSafe = [
    totals.pages, totals.checked, totals.localBytes,
    totals.sampled, totals.sampledBytes, totals.unsampled,
  ].every(Number.isSafeInteger)

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
              {totalSafe ? (
                <Typography variant="body2" color="text.secondary">
                  本次手动查看累计：{totals.pages} 页 · {totals.checked.toLocaleString('zh-CN')} 条候选，
                  本机读取 {formatBytes(totals.localBytes)}，
                  物理抽样 {totals.sampled.toLocaleString('zh-CN')} 条 / {formatBytes(totals.sampledBytes)}，
                  未抽样 {totals.unsampled.toLocaleString('zh-CN')} 条。
                </Typography>
              ) : <Alert severity="warning">累计计数超出安全范围，本次统计不可使用。</Alert>}
              <Alert severity="warning">
                按页累计只是不同时间点的只读检查记录，并非原子快照或全量 100k 验证，
                不代表完整备份、持久内容证明、上传就绪授权或 Mirror 删除依据。
                SourceItem/别名写入、实际 Push 与自动调度仍未启用。
              </Alert>
            </Stack>
          ) : null}
          {revisionChanged ? (
            <Alert severity="warning">
              Source 修订已在逐页预检过程中变化，不能拼接本次统计。请关闭后重新开始预检。
            </Alert>
          ) : failedAfterID === afterID ? (
            <Alert severity="warning">无法完成本页只读预检。请确认本机授权、两代清单及云端状态，或稍后重试。</Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!loading && !revisionChanged ? <Button onClick={() => setRetry((n) => n + 1)}>重新核验本页</Button> : null}
        {result?.has_more && !loading && !revisionChanged && totalSafe ? (
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
