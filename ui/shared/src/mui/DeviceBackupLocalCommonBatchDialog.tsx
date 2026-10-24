import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { formatBytes } from '../format'
import type {
  XDriveLocalBackupCommonBatch, XDriveLocalBackupCommonBatchHistoryItem,
  XDriveLocalBackupCommonBatchHistoryPage, XDriveLocalBackupRecoveryReview,
} from '../device-backups'

export interface XDriveLocalBackupCommonBatchActions {
  run(sourceID: number): Promise<XDriveLocalBackupCommonBatch>
  inspect(sourceID: number): Promise<XDriveLocalBackupCommonBatch>
  history(sourceID: number): Promise<XDriveLocalBackupCommonBatchHistoryPage>
  // Optional owning-Agent-only, read-only historical SQL receipt review.
  review?(sourceID: number, afterFile: number, pageEpoch: string, requestID: string): Promise<XDriveLocalBackupRecoveryReview>
  cancelReview?(requestID: string): Promise<void>
  control(sourceID: number, action: 'pause' | 'cancel'): Promise<XDriveLocalBackupCommonBatch>
}

function safeBatchStatus(value: XDriveLocalBackupCommonBatch, sourceID: number): boolean {
  if (!value || value.source_id !== sourceID || value.backup_complete !== false ||
    value.retirement_safe !== false || value.current_cas_verified !== false ||
    !['running', 'partial', 'uncertain', 'paused', 'cancelled'].includes(value.state) ||
    value.running !== (value.state === 'running')) return false
  if (value.stop_requested !== undefined &&
    (value.state !== 'running' || !['pause', 'cancel'].includes(value.stop_requested))) return false
  if (value.state !== 'running' &&
    (!Number.isSafeInteger(value.revision) || value.revision <= 0)) return false
  return [
    value.inspected_files, value.confirmed_files, value.skipped_files,
    value.unsupported_files, value.uncertain_files, value.confirmed_bytes,
  ].every((count) => Number.isSafeInteger(count) && count >= 0) &&
    value.confirmed_files + value.skipped_files <= value.inspected_files
}

// Renderer defense in depth: a page is an unauthoritative historical
// observation, never a current CAS proof or permission to resume upload.
export function safeRecoveryReviewPage(
  value: XDriveLocalBackupRecoveryReview, sourceID: number,
  after: number, expectedEpoch: string,
): boolean {
  if (!value || value.source_id !== sourceID ||
    !Number.isSafeInteger(value.revision) || value.revision <= 0 ||
    !['partial', 'uncertain', 'paused', 'cancelled'].includes(value.run_state) ||
    value.authoritative !== false || typeof value.has_more !== 'boolean' ||
    typeof value.page_epoch !== 'string' || !/^[0-9a-f]{64}$/.test(value.page_epoch) ||
    (after > 0 && value.page_epoch !== expectedEpoch)) return false
  const counts = [value.reviewed_files, value.ignored_files, value.unsupported_files,
    value.unrecorded_files, value.historical_committed_files, value.pending_original_files,
    value.current_node_metadata_match_files, value.current_node_metadata_mismatch_files,
    value.next_after_file]
  if (!counts.every((n) => Number.isSafeInteger(n) && n >= 0) ||
    value.reviewed_files > 16 ||
    value.reviewed_files !== value.ignored_files + value.unsupported_files +
      value.unrecorded_files + value.historical_committed_files + value.pending_original_files ||
    value.historical_committed_files !== value.current_node_metadata_match_files +
      value.current_node_metadata_mismatch_files) return false
  return value.has_more
    ? value.reviewed_files === 16 && value.next_after_file === after + value.reviewed_files &&
        value.next_after_file <= 1_000_000
    : value.next_after_file === 0
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
  const historyGeneration = useRef(0)
  const reviewGeneration = useRef(0)
  const activeReviewID = useRef('')
  const [pending, setPending] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [controlPending, setControlPending] = useState(false)
  const [status, setStatus] = useState<XDriveLocalBackupCommonBatch | null>(null)
  const [message, setMessage] = useState('')
  const [hasAttempted, setHasAttempted] = useState(false)
  const [history, setHistory] = useState<XDriveLocalBackupCommonBatchHistoryItem[]>([])
  const [historyError, setHistoryError] = useState(false)
  const [reviewPage, setReviewPage] = useState<XDriveLocalBackupRecoveryReview | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState('')
  // Day-to-day backup should not expose a technical SQL receipt audit panel.
  // Preserve the read-only diagnostics, but require deliberate expansion.
  const [showRecoveryDetails, setShowRecoveryDetails] = useState(false)

  const refresh = useCallback(async () => {
    const ticket = epoch.current
    const generation = ++inspectGeneration.current
    setInspecting(true)
    try {
      const next = await actions.inspect(sourceID)
      if (epoch.current !== ticket || inspectGeneration.current !== generation) return
      if (!safeBatchStatus(next, sourceID)) throw new Error('untrusted backup status')
      setStatus(next)
      if (next.running) {
        setReviewPage(null)
        setReviewError('')
      }
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

  const refreshHistory = useCallback(async () => {
    const ticket = epoch.current
    const generation = ++historyGeneration.current
    try {
      const page = await actions.history(sourceID)
      if (epoch.current !== ticket || historyGeneration.current !== generation) return
      if (!page || page.source_id !== sourceID || !Array.isArray(page.items) ||
        page.items.length > 20 || page.items.some((item) =>
          item.source_id !== sourceID || !item.run_id ||
          !Number.isSafeInteger(item.revision) || item.revision <= 0 ||
          !['partial', 'uncertain', 'paused', 'cancelled'].includes(item.state) ||
          ![item.inspected_files, item.confirmed_files, item.skipped_files,
            item.unsupported_files, item.uncertain_files, item.confirmed_bytes].every(
              (n) => Number.isSafeInteger(n) && n >= 0,
            ) ||
          item.confirmed_files + item.skipped_files > item.inspected_files ||
          !Number.isFinite(Date.parse(item.finished_at)) ||
          (item.started_at && !Number.isFinite(Date.parse(item.started_at))))) {
        throw new Error('untrusted owning history')
      }
      setHistory(page.items)
      setHistoryError(false)
    } catch {
      if (epoch.current !== ticket || historyGeneration.current !== generation) return
      setHistoryError(true)
      setHistory([])
    }
  }, [actions, sourceID])

  useEffect(() => {
    epoch.current += 1
    inspectGeneration.current += 1
    historyGeneration.current += 1
    reviewGeneration.current += 1
    setReviewPage(null)
    setReviewError('')
    setShowRecoveryDetails(false)
    setReviewLoading(false)
    setStatus(null)
    setHistory([])
    setHistoryError(false)
    setHasAttempted(false)
    setMessage('')
    void refresh()
    void refreshHistory()
    return () => {
      epoch.current += 1
      inspectGeneration.current += 1
      historyGeneration.current += 1
      reviewGeneration.current += 1
      const id = activeReviewID.current
      activeReviewID.current = ''
      if (id) void actions.cancelReview?.(id).catch(() => {})
    }
  }, [refresh, refreshHistory, actions])

  // Start returns HTTP 202 while the owning Agent continues independently.
  // Poll only while running; closing the dialog merely detaches this observer.
  useEffect(() => {
    if (!status?.running) return
    const timer = window.setInterval(() => { void refresh() }, 2000)
    return () => window.clearInterval(timer)
  }, [status?.running, refresh])

  useEffect(() => {
    if (status && !status.running) void refreshHistory()
  }, [status?.running, status?.state, refreshHistory])

  const start = async () => {
    if (pending || inspecting || reviewLoading || hasAttempted || status?.running) return
    const ticket = epoch.current
    reviewGeneration.current += 1
    setReviewPage(null)
    setReviewError('')
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

  const requestStop = async (action: 'pause' | 'cancel') => {
    if (!status?.running || status.stop_requested || controlPending || pending) return
    const ticket = epoch.current
    setControlPending(true)
    try {
      const next = await actions.control(sourceID, action)
      if (epoch.current !== ticket) return
      if (!safeBatchStatus(next, sourceID) || !next.running ||
        !next.stop_requested) throw new Error('unconfirmed owning Agent stop request')
      setStatus(next)
      setMessage(action === 'pause'
        ? '暂停请求已接收：当前文件仍会完成上传和原始 SQL 回执核对，然后停止安排后续文件。'
        : '停止本轮请求已接收：当前文件仍会完成上传和原始 SQL 回执核对，不代表远端物理取消。')
    } catch {
      if (epoch.current === ticket) {
        setMessage('停止调度请求未得到确认。请刷新 Agent 状态；不能据此认定当前文件已取消。')
      }
    } finally {
      if (epoch.current === ticket) setControlPending(false)
    }
  }

  const loadReview = async (continuePage: boolean) => {
    if (!actions.review || !actions.cancelReview || reviewLoading || pending ||
      status?.running || (continuePage && !reviewPage?.has_more)) return
    const earlier = reviewPage
    const after = continuePage && earlier ? earlier.next_after_file : 0
    const pageEpoch = after > 0 && earlier ? earlier.page_epoch : ''
    const ticket = epoch.current
    const generation = ++reviewGeneration.current
    const requestID = crypto.randomUUID()
    activeReviewID.current = requestID
    setReviewLoading(true)
    setReviewError('')
    if (!continuePage) setReviewPage(null)
    try {
      const next = await actions.review(sourceID, after, pageEpoch, requestID)
      if (epoch.current !== ticket || reviewGeneration.current !== generation) return
      if (!safeRecoveryReviewPage(next, sourceID, after, pageEpoch) ||
        (continuePage && earlier &&
          (next.revision !== earlier.revision || next.run_state !== earlier.run_state))) {
        throw new Error('untrusted recovery page')
      }
      // Only one page is displayed: mixing historical SQL reads from
      // different moments cannot establish a complete SourceRun.
      setReviewPage(next)
    } catch {
      if (epoch.current !== ticket || reviewGeneration.current !== generation) return
      setReviewPage(null)
      setReviewError('原始回执只读核查失败或清单代际已变化。请重新从第一页核对，不要重试不确定的上传。')
    } finally {
      if (activeReviewID.current === requestID) activeReviewID.current = ''
      if (epoch.current === ticket && reviewGeneration.current === generation) setReviewLoading(false)
    }
  }

  const blocked = status?.running

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>本机文件夹备份 · 手动增量</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            本机增量备份只上传新增或修改的普通文件（含嵌套目录），不删除本地或云端文件。
            单文件受 Server 上传额度约束。旧版首文件 Stage 来源需要先单独迁移。
          </Alert>
          <Typography variant="body2">
            Agent 先完成本机差异扫描，再逐文件读取私有持久任务、核对原始 SQL 回执，
            只上传新增或修改的文件。关闭此窗口不会取消 Agent 已开始的上传。
          </Typography>
          {pending || status?.running ? (
            <Typography role="status" variant="body2">
              {status?.running
                ? `本轮进行中：已检查 ${status.inspected_files} 个文件，已上传 ${status.confirmed_files} 个，已跳过 ${status.skipped_files} 个未变化文件。`
                : '正在请求本机 Agent 启动增量备份…'}
            </Typography>
          ) : null}
          {status?.state === 'partial' && !pending ? (
            <Alert severity="info">
              {status.uncertain_files === 0 && status.unsupported_files === 0 &&
              status.confirmed_files + status.skipped_files === status.inspected_files
                ? '本轮扫描及已支持文件的处理已结束。'
                : '本轮扫描已结束，仍有未支持或未确认的文件。'}
              已上传 {status.confirmed_files} 个（{formatBytes(status.confirmed_bytes)}），
              跳过 {status.skipped_files} 个未变化文件。
              {status.unsupported_files > 0 ? `另有 ${status.unsupported_files} 个未支持的文件未上传。` : ''}
              这是文件级运行结果，不代表整库现时 CAS 完整性证明。
            </Alert>
          ) : null}
          {status?.state === 'paused' || status?.state === 'cancelled' ? (
            <Alert severity="info">
              {status.state === 'paused' ? '本轮已在文件边界暂停。' : '本轮已停止安排后续文件。'}
              已核实 {status.confirmed_files} 个上传文件，后续可再次扫描并沿用原始任务恢复。
              本状态不表示远端物理取消或完整备份成功。
            </Alert>
          ) : null}
          {status?.running && status.stop_requested ? (
            <Alert severity="info">
              已请求{status.stop_requested === 'pause' ? '暂停' : '停止调度'}。
              正在等待当前文件原始 SQL 回执核对，不会中途伪造取消。
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
          {actions.review && actions.cancelReview ? (
            <Stack spacing={0.75}>
              <Button size="small" variant="text" disabled={reviewLoading}
                onClick={() => setShowRecoveryDetails((value) => !value)}>
                {showRecoveryDetails ? '收起故障诊断' : '故障诊断（高级）'}
              </Button>
              {showRecoveryDetails ? (
                <Stack spacing={0.75}>
                  <Typography variant="subtitle2">原始任务恢复核查（只读）</Typography>
              <Typography variant="caption" color="text.secondary">
                仅核对当前 Owner 的持久原始 SQL 回执，每页最多 16 个文件。
                已提交仅代表历史回执，不证明当前云端文件或 CAS 数据仍然完整。
                本功能不会自动恢复、重传或删除任何文件。
              </Typography>
              <Button size="small" variant="outlined"
                disabled={reviewLoading || pending || Boolean(status?.running)}
                onClick={() => void loadReview(false)}>
                {reviewLoading ? '核查中…' : reviewPage ? '重新从第一页核查' : '开始只读恢复核查'}
              </Button>
              {reviewPage ? (
                <Stack spacing={0.5}>
                  <Typography variant="body2">
                    当前页 {reviewPage.reviewed_files} 个文件 · Source 版本 {reviewPage.revision}
                  </Typography>
                  <Typography variant="body2">
                    历史已提交 {reviewPage.historical_committed_files} ·
                    待确认 {reviewPage.pending_original_files} ·
                    未记录 {reviewPage.unrecorded_files}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    历史已提交文件的当前云端元数据一致 {reviewPage.current_node_metadata_match_files} ·
                    不一致 {reviewPage.current_node_metadata_mismatch_files}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    已忽略 {reviewPage.ignored_files} · 暂不支持 {reviewPage.unsupported_files}
                  </Typography>
                  <Alert severity="warning">
                    历史提交记录不能当作当前 CAS 物理完整性证明；跨页结果也不是同一时点的数据库快照。
                    待确认的 Operation 不允许自动重发。
                  </Alert>
                  {reviewPage.has_more ? (
                    <Button size="small" variant="text"
                      disabled={reviewLoading || Boolean(status?.running)}
                      onClick={() => void loadReview(true)}>
                      核查下一页（仅只读）
                    </Button>
                  ) : <Typography variant="caption" color="text.secondary">当前清单已无更多可核查文件</Typography>}
                </Stack>
              ) : null}
                  {reviewError ? <Alert severity="warning">{reviewError}</Alert> : null}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
          <Stack spacing={0.75}>
            <Typography variant="subtitle2">最近本机备份记录</Typography>
            <Typography variant="caption" color="text.secondary">
              仅保存本机 Agent 的历史运行结果，不是云端完整备份或物理 CAS 验证证明。
            </Typography>
            {history.map((item) => (
              <Stack key={item.run_id} spacing={0.25} sx={{ py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2">
                  {new Date(item.finished_at).toLocaleString('zh-CN')} ·
                  {item.state === 'partial' ? (item.unsupported_files > 0 ? '本轮已结束（有未支持文件）' : '本轮已结束') : item.state === 'uncertain' ? '结果待核对' :
                    item.state === 'paused' ? '已暂停' : '已结束本轮'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  已上传 {item.confirmed_files} · 已跳过 {item.skipped_files} ·
                  未支持 {item.unsupported_files} · 待核对 {item.uncertain_files} · {formatBytes(item.confirmed_bytes)}
                </Typography>
              </Stack>
            ))}
            {history.length === 0 && !historyError ? (
              <Typography variant="caption" color="text.secondary">暂无已记录的本机运行历史</Typography>
            ) : null}
            {historyError ? (
              <Alert severity="info">本机历史记录暂不可查询，不影响原始文件 Operation 的安全核对。</Alert>
            ) : null}
            <Button size="small" variant="text" onClick={() => void refreshHistory()}>刷新运行历史</Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        {status?.running && !status.stop_requested ? (
          <>
            <Button disabled={controlPending} onClick={() => void requestStop('pause')}>
              暂停后续文件
            </Button>
            <Button color="warning" disabled={controlPending} onClick={() => void requestStop('cancel')}>
              结束本轮
            </Button>
          </>
        ) : null}
        <Button variant="contained"
          disabled={pending || inspecting || reviewLoading || hasAttempted || Boolean(blocked)}
          onClick={() => void start()}>
          {pending ? '正在启动' : hasAttempted ? '本次已提交' : status?.state === 'uncertain' || (status?.uncertain_files ?? 0) > 0 ? '核对并恢复原始任务' : status?.state === 'paused' ? '继续增量备份'
            : status?.state === 'cancelled' ? '重新扫描并备份' : '立即扫描并增量备份'}
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
