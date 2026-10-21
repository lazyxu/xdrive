import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { formatBytes } from '../format'
import type { XDriveLocalBackupFirstFile, XDriveLocalBackupFirstFileJobStatus } from '../device-backups'

export interface XDriveLocalBackupFirstFileActions {
  run(sourceID: number): Promise<XDriveLocalBackupFirstFile>
  inspect?(sourceID: number): Promise<XDriveLocalBackupFirstFileJobStatus>
}

type ScopeKey = { sourceID: number; actions: XDriveLocalBackupFirstFileActions }
type Scoped<T> = ScopeKey & { value: T }

function trustworthyStatus(next: XDriveLocalBackupFirstFileJobStatus, sourceID: number): boolean {
  if (!next || next.source_id !== sourceID ||
    next.backup_complete !== false || next.retirement_safe !== false ||
    !['not-recorded', 'running', 'observed', 'uncertain'].includes(next.phase)) return false
  if (next.phase === 'observed') {
    return next.physical_observed === true &&
      Number.isSafeInteger(next.revision) && (next.revision ?? 0) > 0 &&
      Number.isSafeInteger(next.observed_bytes) && (next.observed_bytes ?? -1) >= 0 &&
      (next.observed_bytes ?? -1) <= 64 * 1024 * 1024
  }
  return next.physical_observed === false &&
    (next.revision ?? 0) === 0 && (next.observed_bytes ?? 0) === 0
}

// The status GET never uploads. This dialog intentionally lets the owning
// Desktop close while the already-started Agent process job continues.
export function XDriveDeviceBackupLocalFirstFileDialog({ sourceID, actions, onClose }: {
  sourceID: number
  actions: XDriveLocalBackupFirstFileActions
  onClose(): void
}) {
  const mounted = useRef(false)
  const activeScope = useRef<ScopeKey>({ sourceID, actions })
  const scopeEpoch = useRef(0)
  const statusTicket = useRef(0)
  if (activeScope.current.sourceID !== sourceID || activeScope.current.actions !== actions) {
    activeScope.current = { sourceID, actions }
    scopeEpoch.current += 1
    statusTicket.current += 1
  }

  const [runningFor, setRunningFor] = useState<ScopeKey | null>(null)
  const [attemptedFor, setAttemptedFor] = useState<ScopeKey | null>(null)
  const [resultFor, setResultFor] = useState<Scoped<XDriveLocalBackupFirstFile> | null>(null)
  const [errorFor, setErrorFor] = useState<Scoped<string> | null>(null)
  const [statusFor, setStatusFor] = useState<Scoped<XDriveLocalBackupFirstFileJobStatus> | null>(null)
  const [statusErrorFor, setStatusErrorFor] = useState<Scoped<string> | null>(null)
  const [inspectingFor, setInspectingFor] = useState<ScopeKey | null>(null)

  const mine = (candidate: ScopeKey | null) =>
    candidate !== null && candidate.sourceID === sourceID && candidate.actions === actions
  const running = mine(runningFor)
  const attempted = mine(attemptedFor)
  const result = mine(resultFor) ? resultFor?.value ?? null : null
  const error = mine(errorFor) ? errorFor?.value ?? '' : ''
  const status = mine(statusFor) ? statusFor?.value ?? null : null
  const statusError = mine(statusErrorFor) ? statusErrorFor?.value ?? '' : ''
  const inspecting = mine(inspectingFor)

  const readStatus = useCallback(async () => {
    if (!actions.inspect) return
    const request = ++statusTicket.current
    const epoch = scopeEpoch.current
    setInspectingFor({ sourceID, actions })
    setStatusErrorFor(null)
    try {
      const next = await actions.inspect(sourceID)
      if (!mounted.current || scopeEpoch.current !== epoch || statusTicket.current !== request) return
      if (!trustworthyStatus(next, sourceID)) throw new Error('untrusted first-file job status')
      setStatusFor({ sourceID, actions, value: next })
    } catch {
      if (mounted.current && scopeEpoch.current === epoch && statusTicket.current === request) {
        setStatusErrorFor({ sourceID, actions, value: '无法核实本机任务状态。请勿将无法查询误认为原上传已取消。' })
        setStatusFor(null)
      }
    } finally {
      if (mounted.current && scopeEpoch.current === epoch && statusTicket.current === request) {
        setInspectingFor(null)
      }
    }
  }, [sourceID, actions])

  useEffect(() => {
    mounted.current = true
    if (actions.inspect) void readStatus()
    return () => {
      mounted.current = false
      scopeEpoch.current += 1
      statusTicket.current += 1
    }
  }, [actions, readStatus])

  const blockedByStatus = status?.phase === 'running' ||
    status?.phase === 'observed' || status?.phase === 'uncertain' || Boolean(statusError)
  const start = async () => {
    if (running || attempted || result || inspecting || blockedByStatus ||
      (actions.inspect && !status && !statusError)) return
    const epoch = scopeEpoch.current
    statusTicket.current += 1
    setAttemptedFor({ sourceID, actions })
    setRunningFor({ sourceID, actions })
    setStatusFor(null)
    setErrorFor(null)
    try {
      const next = await actions.run(sourceID)
      if (!mounted.current || scopeEpoch.current !== epoch) return
      if (next.source_id !== sourceID ||
        !Number.isSafeInteger(next.revision) || next.revision <= 0 ||
        next.observed_files !== 1 ||
        !Number.isSafeInteger(next.observed_bytes) || next.observed_bytes < 0 ||
        next.observed_bytes > 64 * 1024 * 1024 ||
        next.physical_observed !== true ||
        next.backup_complete !== false || next.retirement_safe !== false) {
        throw new Error('first-file observation is incomplete')
      }
      setResultFor({ sourceID, actions, value: next })
      setStatusFor({ sourceID, actions, value: {
        source_id: sourceID, phase: 'observed', revision: next.revision,
        observed_bytes: next.observed_bytes, physical_observed: true,
        backup_complete: false, retirement_safe: false,
      } })
    } catch {
      if (mounted.current && scopeEpoch.current === epoch) {
        setErrorFor({ sourceID, actions,
          value: '首文件上传未得到完整确认。操作可能已提交云端；请保留本机原文件及操作状态，不要重复上传或清除私有凭据。' })
        setStatusFor({ sourceID, actions, value: {
          source_id: sourceID, phase: 'uncertain', physical_observed: false,
          backup_complete: false, retirement_safe: false,
        } })
      }
    } finally {
      if (mounted.current && scopeEpoch.current === epoch) setRunningFor(null)
    }
  }

  let phaseLabel = '当前 Agent 未提供任务状态查询；原写入保护仍由 Agent/Server 执行。'
  if (inspecting) phaseLabel = '正在读取当前本机 Agent 的任务状态'
  else if (status?.phase === 'not-recorded') {
    phaseLabel = '此 Agent 进程没有任务记录；Agent 重启后仍可能有历史上传，不能据此判定可以重试。'
  } else if (status?.phase === 'running') {
    phaseLabel = '原上传仍由本机 Agent 处理；关闭此窗口不会主动取消原任务。'
  } else if (status?.phase === 'observed') {
    phaseLabel = '本机 Agent 已核验原首文件的物理写入；尚不是完整设备备份。'
  } else if (status?.phase === 'uncertain') {
    phaseLabel = '原任务结果不确定，仍处于隔离状态；不得重新上传或退休 Stage/密钥。'
  } else if (statusError) phaseLabel = statusError

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>本机设备备份 · 真实首文件上传</DialogTitle>
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
          <Stack spacing={1} sx={{ minHeight: 76 }}>
            <Typography variant="body2" role="status">{phaseLabel}</Typography>
            {actions.inspect ? (
              <Button size="small" disabled={inspecting} onClick={() => void readStatus()}>
                刷新本机任务状态（只读）
              </Button>
            ) : null}
          </Stack>
          {running ? (
            <Typography variant="body2" role="status">
              本机 Agent 正在上传并核验 SQL、CAS 和原文件；窗口断开不会主动取消此操作
            </Typography>
          ) : null}
          {result || status?.phase === 'observed' ? (
            <Alert severity="success">
              已观察到一个文件写入云端及原文件核验，
              大小 {formatBytes(result?.observed_bytes ?? status?.observed_bytes ?? 0)}。
              这不代表整个备份任务完成，暂时无法在此来源继续上传第二个文件。
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained"
          disabled={running || attempted || Boolean(result) || inspecting || blockedByStatus ||
            Boolean(actions.inspect && !status && !statusError)}
          onClick={() => void start()}>
          {running ? '上传进行中' : result || status?.phase === 'observed' ? '首文件已验证' : '确认并上传首文件'}
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
