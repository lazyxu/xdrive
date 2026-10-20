import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { formatBytes } from '../format'
import type { XDriveLocalBackupFirstFile } from '../device-backups'

export interface XDriveLocalBackupFirstFileActions {
  run(sourceID: number): Promise<XDriveLocalBackupFirstFile>
}

// Only the credential-verified owning Desktop receives this action.
// No Web, foreign Desktop, SourceManager or generic trigger fallback.
export function XDriveDeviceBackupLocalFirstFileDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupFirstFileActions
  onClose(): void
}) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<XDriveLocalBackupFirstFile | null>(null)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const start = async () => {
    if (running || result) return
    setRunning(true)
    setError('')
    try {
      const next = await actions.run(sourceID)
      if (!mounted.current) return
      if (next.source_id !== sourceID ||
        !Number.isSafeInteger(next.revision) || next.revision <= 0 ||
        next.observed_files !== 1 ||
        !Number.isSafeInteger(next.observed_bytes) || next.observed_bytes < 0 ||
        next.observed_bytes > 64 * 1024 * 1024 ||
        next.physical_observed !== true ||
        next.backup_complete !== false || next.retirement_safe !== false) {
        throw new Error('first-file observation is incomplete')
      }
      setResult(next)
    } catch {
      if (mounted.current) {
        setError('首文件上传未得到完整确认。操作可能已提交云端；请保留本机原文件及操作状态，不要重复上传或清除私有凭据。')
      }
    } finally {
      if (mounted.current) setRunning(false)
    }
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={running ? undefined : onClose}>
      <DialogTitle>本机设备备份 · 开始真实首文件上传</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">
            此操作会真实写入一个文件到当前云端目录，并可能永久占用该来源的首次操作。
            仅从本机已验证的扫描清单选取首层普通文件（最大 64 MiB），只允许 Backup，不执行删除。
            当前尚不支持第二个文件、自动重试或完整备份；不确定结果请勿重复提交。
          </Alert>
          <Typography variant="body2">
            请先执行“保存本机扫描清单（不上传）”。Agent 会自行验证本机授权 Root、忽略规则、当前文件身份和内容，不接受网页传来的路径或哈希。
          </Typography>
          {running ? <Typography variant="body2" role="status">正在真实上传并核验 SQL、CAS 和本机原文件；请勿关闭应用…</Typography> : null}
          {result ? (
            <Alert severity="success">
              已观察到一个文件写入云端及原文件核验，大小 {formatBytes(result.observed_bytes)}。
              这不代表整个备份任务完成，暂时无法在此来源继续上传第二个文件。
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" disabled={running || Boolean(result)} onClick={() => void start()}>
          {running ? '上传进行中' : result ? '首文件已验证' : '确认并上传首文件'}
        </Button>
        <Button disabled={running} onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
