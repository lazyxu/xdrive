import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { formatBytes } from '../format'
import type { XDriveLocalBackupCommonBatch } from '../device-backups'

export interface XDriveLocalBackupCommonBatchActions {
  run(sourceID: number): Promise<XDriveLocalBackupCommonBatch>
  inspect(sourceID: number): Promise<XDriveLocalBackupCommonBatch>
}

function safeBatchStatus(value: XDriveLocalBackupCommonBatch, sourceID: number): boolean {
  if (!value || value.source_id !== sourceID || value.backup_complete !== false ||
    value.retirement_safe !== false || value.current_cas_verified !== false ||
    !['running', 'partial', 'uncertain'].includes(value.state) ||
    value.running !== (value.state === 'running')) return false
  if (value.state !== 'running' &&
    (!Number.isSafeInteger(value.revision) || value.revision <= 0)) return false
  return [
    value.inspected_files, value.confirmed_files, value.skipped_files,
    value.unsupported_files, value.uncertain_files, value.confirmed_bytes,
  ].every((count) => Number.isSafeInteger(count) && count >= 0) &&
    value.confirmed_files + value.skipped_files <= value.inspected_files
}

// Only owning Desktop passes this adapter. Closing is an observer detach,
// NOT a claim that the Agent/Server stopped an in-flight CAS/SQL operation.
export function XDriveDeviceBackupLocalCommonBatchDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupCommonBatchActions
  onClose(): void
}) {
  const epoch = useRef(0)
  const inspectGeneration = useRef(0)
  const [pending, setPending] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [status, setStatus] = useState<XDriveLocalBackupCommonBatch | null>(null)
  const [message, setMessage] = useState('')
  const [hasAttempted, setHasAttempted] = useState(false)

  const refresh = useCallback(async () => {
    const ticket = epoch.current
    const generation = ++inspectGeneration.current
    setInspecting(true)
    try {
      const next = await actions.inspect(sourceID)
      if (epoch.current !== ticket || inspectGeneration.current !== generation) return
      if (!safeBatchStatus(next, sourceID)) throw new Error('untrusted backup status')
      setStatus(next)
      if (!next.running) setHasAttempted(false)
      setMessage('')
    } catch {
      if (epoch.current !== ticket || inspectGeneration.current !== generation) return
      // An Agent restart can lose an in-memory summary. This is not proof
      // that any earlier original SQL Operation is safe to release/retry.
      setMessage('本机运行状态暂不可查询。历史操作仍由 Agent 私有任务记录及 Server 原始 SQL 回执核对。')
      setStatus(null)
    } finally {
      if (epoch.current === ticket && inspectGeneration.current === generation) setInspecting(false)
    }
  }, [actions, sourceID])

  useEffect(() => {
    epoch.current += 1
    inspectGeneration.current += 1
    setStatus(null)
    setHasAttempted(false)
    setMessage('')
    void refresh()
    return () => { epoch.current += 1; inspectGeneration.current += 1 }
  }, [refresh])

  // Start returns HTTP 202 while the owning Agent continues independently.
  // Poll only while running; closing the dialog merely detaches this observer.
  useEffect(() => {
    if (!status?.running) return
    const timer = window.setInterval(() => { void refresh() }, 2000)
    return () => window.clearInterval(timer)
  }, [status?.running, refresh])

  const start = async () => {
    if (pending || inspecting || hasAttempted || status?.running) return
    const ticket = epoch.current
    setPending(true)
    setHasAttempted(true)
    setMessage('')
    try {
      const next = await actions.run(sourceID)
      if (epoch.current !== ticket) return
      if (!safeBatchStatus(next, sourceID)) {
        throw new Error('invalid owning Agent start receipt')
      }
      setStatus(next)
      if (next.state === 'uncertain') {
        setMessage('原始任务状态仍不确定；仅允许 Agent 使用同一持久 Operation 重新核对，不得盲目创建新任务。')
      }
    } catch {
      if (epoch.current !== ticket) return
      setStatus(null)
      setMessage('本轮备份未得到完整确认；云端可能已经提交部分文件。不要删除原文件或重复分配新操作 ID，请先查询原任务状态。')
    } finally {
      if (epoch.current === ticket) setPending(false)
    }
  }

  const blocked = status?.running

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>本机文件夹备份 · 手动增量</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">
            此操作会真实写入云端。当前版本处理已授权 Root 中通过安全验证的普通文件（含嵌套目录），
            单文件受 Server 上传额度约束。尚未验证整轮备份完成；仅 Backup，不删除本地或云端内容，
            不会标记整轮备份完成。已使用旧版首文件 Stage 的来源必须先完成单独迁移。
          </Alert>
          <Typography variant="body2">
            Agent 先完成本机差异扫描，再逐文件读取私有持久任务、核对原始 SQL 回执，
            只上传新增或修改的文件。关闭此窗口不会取消 Agent 已开始的上传。
          </Typography>
          {pending || status?.running ? (
            <Typography role="status" variant="body2">
              Agent 正在扫描、上传和核对结果；请使用下方只读查询查看状态。
            </Typography>
          ) : null}
          {status?.state === 'partial' && !pending ? (
            <Alert severity="info">
              本轮已核实 {status.confirmed_files} 个写入文件（{formatBytes(status.confirmed_bytes)}），
              跳过 {status.skipped_files} 个未变化文件。
              {status.unsupported_files > 0 ? `另有 ${status.unsupported_files} 个暂未支持的文件未上传。` : ''}
              这不是完整备份成功回执。
            </Alert>
          ) : null}
          {status?.state === 'uncertain' || (status?.uncertain_files ?? 0) > 0 ? (
            <Alert severity="error">存在结果不确定的文件。可让本机 Agent 核对并恢复原始 Operation，但禁止盲目新建任务或清除历史。</Alert>
          ) : null}
          {message ? <Alert severity="warning">{message}</Alert> : null}
          <Button size="small" variant="outlined" disabled={inspecting}
            onClick={() => void refresh()}>
            {inspecting ? '查询中' : '刷新本机任务状态（只读）'}
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained"
          disabled={pending || inspecting || hasAttempted || Boolean(blocked)}
          onClick={() => void start()}>
          {pending ? '正在启动' : hasAttempted ? '本次已提交' : status?.state === 'uncertain' || (status?.uncertain_files ?? 0) > 0 ? '核对并恢复原始任务' : '立即扫描并增量备份'}
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
