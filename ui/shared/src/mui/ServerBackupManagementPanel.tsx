import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress,
  MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import type {
  XDriveServerBackupPage, XDriveServerBackupPort, XDriveServerBackupRequest,
  XDriveServerBackupSnapshot, XDriveServerBackupHistoryEntry,
} from '../server-backup-admin'
import { latestServerBackupVerification, serverBackupReceiptDurationSeconds,
  serverBackupReceiptExplanation, summarizeServerBackupIntegrity } from '../server-backup-integrity'
import { canPruneServerBackup, type XDriveServerBackupPrunePreview } from '../server-backup-prune-preview'
import { backupRetentionCapacity } from '../server-backup-capacity'
import { XDriveActionButton } from './ActionButton'
import { XDriveBackupVerificationReceipt } from './BackupVerificationReceipt'
import { XDriveBackupRecoveryEvidencePanel } from './BackupRecoveryEvidencePanel'
import { XDriveSectionHeader } from './SectionHeader'

type Confirmation = {
  title: string
  description: string
  expected: string
  action: XDriveServerBackupRequest
}

const workStates = new Set(['running', 'queued'])

function displayBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return String(value) + ' B'
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))
  return (value / 1024 ** unit).toFixed(1) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]
}

function snapshotStatus(item: XDriveServerBackupSnapshot): string {
  if (item.state === 'complete' && !item.file_data_included) return '仅数据库'
  if (item.state === 'complete') return '可校验'
  if (item.state === 'inconsistent') return '源数据不一致'
  return '不完整'
}


function historicalVerification(history: XDriveServerBackupPage['history'], snapshotID: string) {
  const latest = latestServerBackupVerification(history, snapshotID)
  if (!latest) return '未校验'
  return (latest.state === 'success' ? '通过' : '失败') + ' · ' + (latest.mode || 'fast') +
    ' · ' + (latest.finished_at ? new Date(latest.finished_at).toLocaleString() : '—') + '（历史）'
}

export function XDriveServerBackupManagementPanel({
  port, onOpenStorage,
}: {
  port: XDriveServerBackupPort
  onOpenStorage?: () => void
}) {
  // A late response from a previous Host/Owner must not repopulate this page.
  const [loaded, setLoaded] = useState<{ port: XDriveServerBackupPort; page: XDriveServerBackupPage } | null>(null)
  const page = loaded?.port === port ? loaded.page : null
  const sessionGeneration = useRef(0)
  const latestRead = useRef(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [snapshotID, setSnapshotID] = useState('')
  const [createFormat, setCreateFormat] = useState<'v1' | 'v2'>('v2')
  const [verifyMode, setVerifyMode] = useState<'fast' | 'deep'>('fast')
  const [keepLast, setKeepLast] = useState('7')
  const [policyDraft, setPolicyDraft] = useState<{
    format: 'v1' | 'v2'; days: string; revision: string
  } | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [historyDetail, setHistoryDetail] = useState<XDriveServerBackupHistoryEntry | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [prunePreview, setPrunePreview] = useState<XDriveServerBackupPrunePreview | null>(null)
  const [selectedPreviewRequestID, setSelectedPreviewRequestID] = useState('')

  const reload = useCallback(async () => {
    const generation = sessionGeneration.current
    const read = ++latestRead.current
    try {
      const result = await port.read()
      // Both Host identity and request ordering matter: polls can overlap.
      if (generation !== sessionGeneration.current || read !== latestRead.current) return
      setLoaded({ port, page: result })
      setError('')
      setPolicyDraft(old => old?.revision === result.inventory.policy.revision ? old : {
        format: result.inventory.policy.schedule_format,
        days: String(result.inventory.policy.retention_days),
        revision: result.inventory.policy.revision,
      })
      setSnapshotID(current =>
        result.inventory.snapshots.some(snapshot => snapshot.id === current)
          ? current : result.inventory.snapshots[0]?.id || '')
    } catch (e) {
      if (generation === sessionGeneration.current && read === latestRead.current) {
        setError(e instanceof Error ? e.message : '无法更新备份状态；以宿主机记录为准。')
      }
    }
  }, [port])

  useEffect(() => {
    sessionGeneration.current++
    latestRead.current = 0
    setLoaded(null)
    setSnapshotID('')
    setPolicyDraft(null)
    setConfirmation(null)
    setHistoryDetail(null)
    setPrunePreview(null)
    setSelectedPreviewRequestID('')
    setNotice('')
    setSubmitting(false)
    setError('')
    void reload()
    const poll = window.setInterval(() => { void reload() }, 4500)
    return () => {
      sessionGeneration.current++
      latestRead.current++
      window.clearInterval(poll)
    }
  }, [reload])

  const busy = submitting || workStates.has(page?.operation.state || '')
  const supported = Boolean(page?.supported)
  const selected = page?.inventory.snapshots.find(item => item.id === snapshotID)
  const integrity = page ? summarizeServerBackupIntegrity(page) : null
  const selectedComplete = selected?.state === 'complete'
  const selectedRestorable = selectedComplete && selected?.file_data_included !== false
  const keep = Number(keepLast)
  const keepValid = Number.isInteger(keep) && keep >= 1 && keep <= 1000
  const canPrune = canPruneServerBackup(page, keep, verifyMode, prunePreview)
  const capacity = page?.retention ? backupRetentionCapacity(page.retention) : null
  const selectedPreview = page?.selected_preview
  // The preview is informational only. It is never permission to delete a
  // snapshot; the Host must independently audit CAS under an exclusive lock.
  const selectedPreviewReady = Boolean(selectedPreview && selectedPreviewRequestID &&
    selectedPreview.request_id === selectedPreviewRequestID &&
    selectedPreview.snapshot_id === snapshotID && selectedPreview.mode === verifyMode &&
    page?.operation.action === 'preview_delete' &&
    page?.operation.request_id === selectedPreviewRequestID &&
    page?.operation.state === 'success' &&
    selectedPreview.report.mode === 'read_only' &&
    selectedPreview.report.delete_enabled === false &&
    selectedPreview.report.surviving_snapshots >= 1)
  const policyDays = Number(policyDraft?.days)
  const policyValid = Number.isInteger(policyDays) && policyDays >= 0 && policyDays <= 3650 &&
    !(policyDraft?.format === 'v1' && Boolean(page?.inventory.policy.repository))
  const disabled = !supported || busy

  const submit = async (request: XDriveServerBackupRequest) => {
    if (!supported || busy) return
    const generation = sessionGeneration.current
    setSubmitting(true)
    setError('')
    // Only an actual, successful preview from this UI session can enable prune.
    setPrunePreview(null)
    setSelectedPreviewRequestID('')
    try {
      const result = await port.submit(request)
      if (generation !== sessionGeneration.current) return
      if (request.action === 'plan' && result.request_id) {
        setPrunePreview({ requestID: result.request_id, keepLast: request.keep_last, mode: request.mode })
      }
      if (request.action === 'preview_delete' && result.request_id) {
        setSelectedPreviewRequestID(result.request_id)
      }
      setNotice('已提交宿主机任务：' + (result.request_id || '等待处理'))
      await reload()
    } catch (e) {
      if (generation === sessionGeneration.current) {
        setError(e instanceof Error ? e.message : '提交备份操作失败。')
      }
    } finally {
      if (generation === sessionGeneration.current) setSubmitting(false)
    }
  }

  const ask = (next: Confirmation) => {
    if (disabled) return
    setConfirmText('')
    setConfirmation(next)
  }

  const confirm = () => {
    if (!confirmation || confirmText !== confirmation.expected || disabled) return
    const next = confirmation.action
    setConfirmation(null)
    setConfirmText('')
    void submit(next)
  }

  return (
    <Stack spacing={2} data-xdrive-admin-backup-management>
      <XDriveSectionHeader
        level="h3" title="服务器备份与恢复"
        subtitle="仅管理员管理服务器备份；本机设备 Push 备份在独立应用中管理。备份实际执行由宿主机控制进程完成。"
        actions={
          <XDriveActionButton disabled={submitting} onClick={() => {
            setError('')
            void reload().catch(e => setError(e instanceof Error ? e.message : '刷新失败。'))
          }}>刷新备份状态</XDriveActionButton>
        }
      />
      {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
      {!page ? <Alert severity="info">正在读取宿主机备份状态…</Alert> : null}
      {page && !page.supported
        ? <Alert severity="warning">备份控制不可用：{page.message || '请检查宿主机控制进程和部署版本。'}。不会执行任何删除或恢复。</Alert>
        : null}
      {notice ? <Alert severity="info" onClose={() => setNotice('')}>{notice}</Alert> : null}
      {page ? (
        <Alert severity={page.operation.state === 'failed' ? 'error' :
          busy ? 'info' : page.operation.state === 'success' ? 'success' : 'info'}>
          宿主机任务：{page.operation.state} · {page.operation.action || '空闲'}
          {page.operation.snapshot_id ? ' · ' + page.operation.snapshot_id : ''}
          {page.operation.message ? ' · ' + page.operation.message : ''}
          {page.operation.request_id ? ' · ' + page.operation.request_id : ''}
        </Alert>
      ) : null}


      {page?.operation.state === 'running' ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }} data-xdrive-admin-backup-progress>
          <Stack spacing={1}>
            <Typography variant="subtitle2">
              当前阶段：{page.operation.stage || '宿主机执行中'}
            </Typography>
            {Number(page.operation.bytes_total || 0) > 0 ? (
              <LinearProgress variant="determinate" value={Math.max(0, Math.min(100,
                100 * Number(page.operation.bytes_done || 0) / Number(page.operation.bytes_total)))} />
            ) : <LinearProgress />}
            <Typography variant="caption" color="text.secondary">
              {Number(page.operation.bytes_total || 0) > 0
                ? '当前阶段已处理 ' + displayBytes(page.operation.bytes_done || 0) +
                  ' / ' + displayBytes(page.operation.bytes_total || 0)
                : Number(page.operation.bytes_done || 0) > 0
                  ? '当前阶段已处理 ' + displayBytes(page.operation.bytes_done || 0) + '（总量未知）'
                  : '当前阶段尚无可靠的字节总量，不显示估算百分比。'}
            </Typography>
          </Stack>
        </Paper>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" fontWeight={600}>创建备份</Typography>
          <Typography variant="body2" color="text.secondary">
            v1 为传统完整 tar；v2 为 CAS + Manifest 增量。均会在备份一致性窗口暂停服务，完成后自动恢复。
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <TextField select size="small" label="备份格式" value={createFormat}
              disabled={disabled} sx={{ minWidth: 160 }}
              onChange={e => setCreateFormat(e.target.value as 'v1' | 'v2')}>
              <MenuItem value="v2">v2 · CAS 增量</MenuItem>
              <MenuItem value="v1">v1 · 完整快照</MenuItem>
            </TextField>
            <XDriveActionButton intent="primary" disabled={disabled}
              onClick={() => ask({
                title: '确认创建服务器备份',
                description: '备份将短暂暂停服务并占用磁盘空间。请先检查存储容量。',
                expected: 'CREATE',
                action: { action: 'create', format: createFormat },
              })}>立即创建备份</XDriveActionButton>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" fontWeight={600}>备份清单与验证</Typography>
          {integrity ? (
            <Alert severity={integrity.needsAttention ? 'warning' : 'info'}
              data-xdrive-admin-backup-integrity-summary>
              <Stack spacing={1}>
                <Typography variant="body2">
                  已发现 {integrity.snapshots} 代备份：结构完整的文件与数据库恢复候选
                  {integrity.fullCandidates} 代；仅数据库 {integrity.databaseOnly} 代；
                  不完整 {integrity.incomplete} 代；源数据不一致 {integrity.inconsistent} 代。
                </Typography>
                <Typography variant="body2">
                  在最近最多 30 条宿主机操作记录中，各快照的最新校验结果：
                  历史通过 {integrity.historicalPassed} 代，历史失败
                  {integrity.historicalFailed} 代，未见近期校验记录
                  {integrity.withoutRecentReceipt} 代。
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  结构完整和历史校验通过均不代表当前数据仍完好；恢复前必须重新校验，
                  真正的数据库与文件恢复能力仍需独立演练。验证失败的快照不应作为可靠恢复点。
                </Typography>
                <Box>
                  <XDriveActionButton disabled={disabled || !integrity.newestFullID}
                    onClick={() => {
                      if (integrity.newestFullID) void submit({
                        action: 'verify', snapshot_id: integrity.newestFullID, mode: 'fast',
                      })
                    }}>
                    校验最新完整备份（fast）
                  </XDriveActionButton>
                </Box>
              </Stack>
            </Alert>
          ) : null}
          <TableContainer sx={{ maxHeight: 320 }}>
            <Table size="small" stickyHeader aria-label="服务器备份清单">
              <TableHead>
                <TableRow>
                  <TableCell>选择</TableCell><TableCell>快照</TableCell>
                  <TableCell>创建时间</TableCell><TableCell>格式</TableCell><TableCell>状态</TableCell>
                   <TableCell>最近验证（历史）</TableCell>
                  <TableCell align="right">本代占用</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(page?.inventory.snapshots || []).map(item => (
                  <TableRow key={item.id} selected={snapshotID === item.id}
                    hover onClick={() => setSnapshotID(item.id)} sx={{ cursor: 'pointer' }}>
                    <TableCell>
                      <input type="radio" name="admin-backup-selected" checked={snapshotID === item.id}
                        onChange={() => setSnapshotID(item.id)}
                        aria-label={'选择备份 ' + item.name} />
                    </TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.name}</TableCell>
                    <TableCell>{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</TableCell>
                    <TableCell>{item.format}</TableCell>
                    <TableCell>{snapshotStatus(item)}</TableCell>
                     <TableCell>{historicalVerification(page?.history, item.id)}</TableCell>
                    <TableCell align="right">{displayBytes(item.bytes)}</TableCell>
                  </TableRow>
                ))}
                {!page?.inventory.snapshots.length ? (
                  <TableRow><TableCell colSpan={7}>尚无已发现的服务器快照。</TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary">
            最多显示最新 100 个已发现快照；v2 本代大小不包括共享 CAS 对象。选择不完整或仅含数据库的快照不会允许完整恢复。
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <TextField select size="small" label="校验级别" value={verifyMode}
              disabled={disabled} sx={{ minWidth: 140 }}
              onChange={e => setVerifyMode(e.target.value as 'fast' | 'deep')}>
              <MenuItem value="fast">fast · 基础校验</MenuItem>
              <MenuItem value="deep">deep · 完整 CAS</MenuItem>
            </TextField>
            <XDriveActionButton disabled={disabled || !selected}
              onClick={() => { if (selected) void submit({
                action: 'verify', snapshot_id: selected.id, mode: verifyMode,
              }) }}>验证所选备份</XDriveActionButton>
            <XDriveActionButton disabled={disabled}
              onClick={() => ask({
                title: '确认批量验证全部服务器备份？',
                description: '宿主机扫描所有已配置的本地 v1/v2 仓库，不受清单最多显示 100 代的限制。最多 1000 代，超限或不安全的快照条目会明确失败。逐代执行真实 SHA-256 校验；deep 还会逐仓库检查孤儿 CAS。可能产生大量磁盘读取，但不会修改生产数据，也不是实际恢复演练。浏览器关闭不会取消宿主机任务。',
                expected: 'VERIFY ALL',
                action: { action: 'verify_all', mode: verifyMode },
              })}>批量验证全部本地备份</XDriveActionButton>
            <XDriveActionButton disabled={disabled || !selectedRestorable || selected?.format !== 'v2'}
              onClick={() => { if (selected) ask({
                title: '确认执行离线隔离恢复演练？',
                description: '使用宿主机受控的离线 Docker RAM 沙箱，最多 1024 MiB 还原文件和 PostgreSQL；不会替换线上文件、数据库或停止服务。任务最长可能运行数十分钟，当前不支持界面取消。演练结果不等于生产环境恢复验收。',
                expected: 'DRILL ' + selected.id,
                action: { action: 'drill', snapshot_id: selected.id, confirmation: 'DRILL ' + selected.id },
              }) }}>隔离演练所选 v2 备份</XDriveActionButton>
            <XDriveActionButton intent="warning" disabled={disabled || !selectedRestorable}
              onClick={() => { if (selected) ask({
                title: '确认恢复此备份？',
                description: '将首先创建恢复前安全备份，随后停止服务并替换数据库与文件数据。当前线上更改会被覆盖，且会断开当前登录。',
                expected: 'RESTORE ' + selected.id,
                action: { action: 'restore', snapshot_id: selected.id, confirmation: 'RESTORE ' + selected.id },
              }) }}>恢复所选备份</XDriveActionButton>
            <XDriveActionButton intent="danger" disabled={disabled || !selectedComplete || selected?.format !== 'v1'}
              onClick={() => { if (selected) ask({
                title: '确认删除旧版 v1 快照？',
                description: '操作会删除所选传统备份。最后一个有效恢复点不会被删除。v2 不能单独删除文件，必须使用引用感知清理。',
                expected: 'DELETE ' + selected.id,
                action: { action: 'delete', snapshot_id: selected.id, confirmation: 'DELETE ' + selected.id },
              }) }}>删除 v1 快照</XDriveActionButton>
            <XDriveActionButton disabled={disabled || !selectedComplete || selected?.format !== 'v2'}
              onClick={() => { if (selected) void submit({
                action: 'preview_delete', snapshot_id: selected.id, mode: verifyMode,
              }) }}>预览所选 v2 删除影响（只读）</XDriveActionButton>
          </Stack>
          {selectedPreviewReady && selectedPreview ? (
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}
              data-xdrive-admin-selected-v2-preview>
              <Stack spacing={1}>
                <Typography variant="subtitle2">所选 v2 代的删除影响（只读）</Typography>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {selectedPreview.snapshot_id} · {selectedPreview.mode} 校验；
                  删除该代后仍保留 {selectedPreview.report.surviving_snapshots} 代。
                </Typography>
                <Typography variant="body2">
                  本代私有元数据 {displayBytes(selectedPreview.report.selected_snapshot_bytes)}；
                  独有 CAS {selectedPreview.report.exclusive_cas_objects} 个（
                  {displayBytes(selectedPreview.report.exclusive_cas_bytes)}）；
                  共享 CAS {selectedPreview.report.shared_cas_objects} 个（受其他代保护）；
                  现有孤儿 CAS {selectedPreview.report.unreferenced_objects} 个。
                </Typography>
                <Typography variant="body2">
                  预计可清理逻辑总量：{displayBytes(selectedPreview.report.potential_logical_bytes)}。
                  不是实际释放的磁盘空间，且不包含硬链接、稀疏分配等影响。
                </Typography>
                <Alert severity="info">
                  此报告不授予删除权限，尚未开放“单独删除 v2”操作。
                  未来实际删除必须在宿主机独占锁下重新完成所有快照和 CAS 完整性审计。
                </Alert>
              </Stack>
            </Paper>
          ) : null}
        </Stack>
      </Paper>

      {page?.bulk_verification ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}
          data-xdrive-admin-backup-bulk-verification>
          <Stack spacing={1}>
            <Typography variant="subtitle1" fontWeight={600}>最近一次批量备份校验（历史）</Typography>
            <Alert severity={page.bulk_verification.state === 'success' ? 'info' : 'warning'}>
              {page.bulk_verification.state === 'success' ? '该次批量校验已完成' : '该次批量校验未全部通过'}；
              模式 {page.bulk_verification.mode}；发现 {page.bulk_verification.total_snapshots} 代，
              已核验 {page.bulk_verification.checked_snapshots} 代，
              通过 {page.bulk_verification.passed_snapshots} 代，
              失败 {page.bulk_verification.failed_snapshots} 代，
              未核验 {page.bulk_verification.unverified_snapshots} 代。
              {page.bulk_verification.mode === 'deep' ? (
                <> 额外完整仓库审计 {page.bulk_verification.deep_repositories_checked} 个，
                失败 {page.bulk_verification.deep_repositories_failed} 个。</>
              ) : null}
            </Alert>
            <Typography variant="caption" color="text.secondary">
              完成时间：{page.bulk_verification.finished_at ?
                new Date(page.bulk_verification.finished_at).toLocaleString() : '未知'}；
              请求号：{page.bulk_verification.request_id}。
              这是历史只读校验，不代表快照此刻仍完整，也不等于 PostgreSQL 与文件恢复演练通过。
              当前后台任务进度请以上方宿主机状态为准。
            </Typography>
            {page.bulk_verification.failure_category ? (
              <Typography color="error" variant="body2">
                批量扫描失败分类：{page.bulk_verification.failure_category}
              </Typography>
            ) : null}
            {page.bulk_verification.failure_sample.map(item => (
              <Typography variant="body2" key={item.snapshot_id} sx={{ overflowWrap: 'anywhere' }}>
                {item.snapshot_id} · {item.category}
              </Typography>
            ))}
            {page.bulk_verification.failure_sample_truncated ? (
              <Typography variant="caption" color="text.secondary">
                仅显示前 20 个失败快照；统计数仍包含全部失败项。
              </Typography>
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      {page?.supported
        ? <XDriveBackupRecoveryEvidencePanel page={page} snapshotID={snapshotID} />
        : null}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" fontWeight={600}>保留计划与 v2 引用感知清理</Typography>
          <Typography variant="body2" color="text.secondary">
            先预览再删除。deep 会重新校验完整仓库 CAS；真正清理必须再次独占锁校验。
            自动 v2 GC 始终关闭，且至少保留一个已提交的 v2 恢复点。
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <TextField size="small" type="number" label="保留最近 N 代 v2"
              value={keepLast} disabled={disabled} sx={{ width: 155 }}
              inputProps={{ min: 1, max: 1000, step: 1 }}
              onChange={e => setKeepLast(e.target.value)} />
            <XDriveActionButton disabled={disabled || !keepValid}
              onClick={() => { void submit({ action: 'plan', keep_last: keep, mode: verifyMode }) }}>
              预览保留计划
            </XDriveActionButton>
            <XDriveActionButton intent="danger" disabled={disabled || !canPrune}
              onClick={() => ask({
                title: '确认清理旧代 v2 备份？',
                description: '将删除超过保留数量的旧快照和所有保留快照都不引用的备份 CAS。无法撤销；操作不会触及线上 CAS。',
                expected: 'PRUNE ' + keep,
                action: { action: 'prune', keep_last: keep, confirmation: 'PRUNE ' + keep },
              })}>手动清理旧代和孤儿 CAS</XDriveActionButton>
          </Stack>
          <Typography variant="caption" color="text.secondary" data-xdrive-admin-backup-prune-preview-guard>
            {canPrune
              ? '当前会话已完成匹配保留数量与校验级别的只读预览；清理时宿主机会再次独占锁验证。'
              : '执行清理前，必须对当前保留数量与校验级别完成一次成功的只读预览；修改参数或切换宿主机后需重新预览。'}
          </Typography>
          {page?.retention && capacity ? (
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}
              data-xdrive-admin-backup-capacity-breakdown>
              <Stack spacing={1}>
                <Typography variant="subtitle2">上一次只读保留计划 · 容量拆分</Typography>
                <Typography variant="body2">
                  当前计划保留 {page.retention.keep_snapshots?.length || 0} 代，
                  待清理候选 {page.retention.drop_candidates?.length || 0} 代；
                  已发现提交快照 {capacity.committedSnapshots ?? '未知'} 代。
                  CAS 检查方式：
                  {capacity.integrityMode === 'deep' ? 'deep（已对仓库 CAS 进行哈希）'
                    : capacity.integrityMode === 'fast' ? 'fast（CAS 仅检查存在和大小）'
                      : '未知'}。
                </Typography>
                <Table size="small" aria-label="v2 备份清理逻辑空间分项">
                  <TableBody>
                    <TableRow>
                      <TableCell>候选代快照文件（数据库、Manifest 等）</TableCell>
                      <TableCell align="right">{displayBytes(capacity.snapshotBytes ?? NaN)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>仅被候选代引用的 CAS（{capacity.exclusiveObjects ?? '未知'} 个）</TableCell>
                      <TableCell align="right">{displayBytes(capacity.exclusiveCASBytes ?? NaN)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>全部已提交代均未引用的孤儿 CAS（{capacity.unreferencedObjects ?? '未知'} 个）</TableCell>
                      <TableCell align="right">{displayBytes(capacity.unreferencedCASBytes ?? NaN)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>潜在可清理逻辑字节合计</TableCell>
                      <TableCell align="right">{displayBytes(capacity.potentialLogicalBytes ?? NaN)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <Typography variant="body2">
                  受保护快照仍引用的 CAS：{capacity.retainedObjects ?? '未知'} 个。
                  {page.retention.hashed_objects > 0
                    ? ' 本次报告中实际执行完整 SHA-256 的仓库对象 ' +
                      page.retention.hashed_objects + ' 个，哈希读取 ' +
                      displayBytes(page.retention.hashed_bytes) + '。'
                    : ' 报告未提供已哈希对象数量；fast 不代表 CAS 内容全哈希。'}
                </Typography>
                {capacity.totalsConsistent === false ? (
                  <Alert severity="warning" data-xdrive-admin-backup-capacity-mismatch>
                    宿主机容量分项与合计不一致；不要将此报告用作清理空间预测。
                  </Alert>
                ) : null}
                {!capacity.componentsComplete ? (
                  <Typography variant="caption" color="text.secondary">
                    当前宿主机未提供全部可靠的容量分项；未提供的数值显示为“—”，不推断为零。
                  </Typography>
                ) : null}
                <Typography variant="caption" color="text.secondary">
                  上述为历史逻辑字节估计，不是实际可释放磁盘空间，不包括文件系统块分配、硬链接、
                  稀疏文件等差异。此计划不授予删除权限，实际 Prune 会独占锁重新验证所有保留引用。
                </Typography>
              </Stack>
            </Paper>
          ) : null}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" fontWeight={600}>定时备份策略</Typography>
          <Typography variant="body2" color="text.secondary">
            格式仅控制现有定时备份采用 v1 或 v2；保留天数只对 v1 生效。
            改成 v2 不会开启自动删除，备份目录也不会被移动。
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <TextField select size="small" label="定时备份格式"
              value={policyDraft?.format || 'v1'} sx={{ minWidth: 170 }}
              disabled={disabled || !policyDraft}
              onChange={e => setPolicyDraft(old => old && ({ ...old, format: e.target.value as 'v1' | 'v2' }))}>
              <MenuItem value="v1">v1 · 完整备份</MenuItem>
              <MenuItem value="v2">v2 · 增量备份</MenuItem>
            </TextField>
            <TextField size="small" label="v1 保留天数" type="number"
              value={policyDraft?.days || ''} sx={{ width: 145 }}
              inputProps={{ min: 0, max: 3650 }}
              disabled={disabled || !policyDraft}
              onChange={e => setPolicyDraft(old => old && ({ ...old, days: e.target.value }))} />
            <XDriveActionButton disabled={disabled || !policyDraft || !policyValid}
              onClick={() => {
                if (!policyDraft) return
                ask({
                  title: '确认修改定时备份策略？',
                  description: '只修改备份格式与 v1 保留天数。新策略在后续定时执行时生效，不会立刻创建或删除 v2 快照。',
                  expected: 'POLICY',
                  action: {
                    action: 'policy', format: policyDraft.format,
                    retention_days: policyDays, revision: policyDraft.revision,
                  },
                })
              }}>保存策略</XDriveActionButton>
          </Stack>
          {page?.inventory.policy.repository ? (
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              当前自定义 v2 仓库：{page.inventory.policy.repository}。修改或清空此宿主机路径需要本地管理员配置。
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }} data-xdrive-admin-backup-history>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" fontWeight={600}>宿主机备份操作与校验历史</Typography>
          <Typography variant="body2" color="text.secondary">
            最多保留 30 条真实执行结果。历史验证通过不代表当前仍完整；每次恢复前都重新校验。
          </Typography>
          <TableContainer sx={{ maxHeight: 320 }}>
            <Table size="small" stickyHeader aria-label="服务器备份操作历史">
              <TableHead>
                <TableRow>
                  <TableCell>完成时间</TableCell><TableCell>动作</TableCell><TableCell>快照</TableCell>
                  <TableCell>结果</TableCell><TableCell>模式</TableCell><TableCell>耗时</TableCell><TableCell>请求号</TableCell><TableCell>详情</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(page?.history || []).map(item => (
                  <TableRow key={item.request_id}>
                    <TableCell>{item.finished_at ? new Date(item.finished_at).toLocaleString() : '—'}</TableCell>
                    <TableCell>{item.action}</TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.snapshot_id || '—'}</TableCell>
                    <TableCell>{item.state === 'success' ? '成功' : '失败'}{item.error_code ? ' · ' + item.error_code : ''}</TableCell>
                    <TableCell>{item.mode || '—'}</TableCell>
                    <TableCell>{serverBackupReceiptDurationSeconds(item) === null ? '—' :
                      serverBackupReceiptDurationSeconds(item) + ' 秒'}</TableCell>
                    <TableCell>{item.request_id || '—'}</TableCell>
                    <TableCell>
                      <Button size="small" onClick={() => setHistoryDetail(item)}
                        aria-label={'查看备份操作详情 ' + item.request_id}>详情</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!page?.history?.length ? <TableRow><TableCell colSpan={8}>暂无历史操作记录。</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      </Paper>
      <Dialog open={Boolean(historyDetail)} onClose={() => setHistoryDetail(null)}
        fullWidth maxWidth="sm" aria-label="宿主机备份执行诊断详情"
        data-xdrive-admin-backup-history-detail>
        <DialogTitle>宿主机备份执行记录（历史）</DialogTitle>
        <DialogContent>
          {historyDetail ? (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <Typography variant="body2">动作：{historyDetail.action} ·
                {historyDetail.state === 'success' ? '已完成' : '失败'}</Typography>
              <Typography variant="body2">快照：{historyDetail.snapshot_id || '—'}</Typography>
              <Typography variant="body2">校验模式：{historyDetail.mode || '不适用'}</Typography>
              <Typography variant="body2">开始：{historyDetail.started_at || '—'}</Typography>
              <Typography variant="body2">结束：{historyDetail.finished_at || '—'}</Typography>
              <Typography variant="body2">
                执行耗时：{serverBackupReceiptDurationSeconds(historyDetail) === null
                  ? '未知'
                  : serverBackupReceiptDurationSeconds(historyDetail) + ' 秒'}
              </Typography>
              <Typography variant="body2">
                失败代码：{historyDetail.error_code || '无'}
              </Typography>
              <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                请求编号：{historyDetail.request_id || '—'}
              </Typography>
              <Alert severity={historyDetail.state === 'failed' ? 'warning' : 'info'}>
                {serverBackupReceiptExplanation(historyDetail)}
              </Alert>
              <XDriveBackupVerificationReceipt entry={historyDetail} />
              {historyDetail.action === 'drill' ? (
                <Alert severity={historyDetail.state === 'success' && historyDetail.drill?.state === 'success' &&
                  historyDetail.drill.files_restored && historyDetail.drill.postgresql_restored ? 'success' : 'warning'}
                  data-xdrive-admin-backup-drill-receipt>
                  {historyDetail.state === 'success' && historyDetail.drill?.state === 'success' &&
                    historyDetail.drill.files_restored && historyDetail.drill.postgresql_restored
                    ? '本机离线 RAM 沙箱文件与 PostgreSQL 恢复演练成功（历史）。'
                    : '隔离演练失败或缺少可验证的两阶段恢复凭据。'}
                  {' '}生产环境恢复验收：未执行（跳过）。资源上限：1024 MiB；
                  {historyDetail.drill?.failure_category
                    ? '失败分类：' + historyDetail.drill.failure_category : '不提供原始宿主机路径或日志。'}
                </Alert>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                对于没有新版宿主机验证报告的历史记录，仍然不推断对象数量或校验字节。
                详细错误日志仅可由宿主机管理员本地查看。
              </Typography>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions><Button onClick={() => setHistoryDetail(null)}>关闭</Button></DialogActions>
      </Dialog>
      <Box>
        <Typography variant="body2" color="text.secondary">
          在线存储 CAS 的完整性校验与修复是另一项维护任务，不代表备份仓库可恢复。
        </Typography>
        {onOpenStorage ? <Button size="small" onClick={onOpenStorage}>打开全局存储校验与修复</Button> : null}
      </Box>

      <Dialog open={Boolean(confirmation)} onClose={() => { if (!submitting) setConfirmation(null) }}
        fullWidth maxWidth="sm" aria-label="备份操作二次确认">
        <DialogTitle>{confirmation?.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">{confirmation?.description}</Alert>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              请完整输入：<strong>{confirmation?.expected}</strong>
            </Typography>
            <TextField value={confirmText} onChange={e => setConfirmText(e.target.value)}
              label="确认口令" autoComplete="off" inputProps={{ maxLength: 120 }}
              disabled={submitting} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmation(null)} disabled={submitting}>取消</Button>
          <Button color="error" variant="contained" disabled={!confirmation || disabled ||
            confirmText !== confirmation.expected} onClick={confirm}>确认执行</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
