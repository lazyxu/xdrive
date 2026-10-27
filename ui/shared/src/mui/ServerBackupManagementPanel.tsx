import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import type {
  XDriveServerBackupPage, XDriveServerBackupPort, XDriveServerBackupRequest,
  XDriveServerBackupSnapshot,
} from '../server-backup-admin'
import { XDriveActionButton } from './ActionButton'
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

export function XDriveServerBackupManagementPanel({
  port, onOpenStorage,
}: {
  port: XDriveServerBackupPort
  onOpenStorage?: () => void
}) {
  const [page, setPage] = useState<XDriveServerBackupPage | null>(null)
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
  const [confirmText, setConfirmText] = useState('')

  const reload = useCallback(async () => {
    const result = await port.read()
    setPage(result)
    setPolicyDraft(old => old?.revision === result.inventory.policy.revision ? old : {
      format: result.inventory.policy.schedule_format,
      days: String(result.inventory.policy.retention_days),
      revision: result.inventory.policy.revision,
    })
    setSnapshotID(current =>
      result.inventory.snapshots.some(snapshot => snapshot.id === current)
        ? current : result.inventory.snapshots[0]?.id || '')
    return result
  }, [port])

  useEffect(() => {
    let active = true
    setPage(null)
    setSnapshotID('')
    setPolicyDraft(null)
    setConfirmation(null)
    setError('')
    void port.read().then(result => {
      if (!active) return
      setPage(result)
      setSnapshotID(result.inventory.snapshots[0]?.id || '')
      setPolicyDraft({
        format: result.inventory.policy.schedule_format,
        days: String(result.inventory.policy.retention_days),
        revision: result.inventory.policy.revision,
      })
    }).catch(e => {
      if (active) setError(e instanceof Error ? e.message : '加载备份清单失败。')
    })
    const poll = window.setInterval(() => {
      if (!active) return
      void port.read().then(result => {
        if (!active) return
        setPage(result)
        setPolicyDraft(old => old?.revision === result.inventory.policy.revision ? old : {
          format: result.inventory.policy.schedule_format,
          days: String(result.inventory.policy.retention_days),
          revision: result.inventory.policy.revision,
        })
      }).catch(() => {
        if (active) setError('无法更新备份状态；操作结果仍以宿主机记录为准。')
      })
    }, 4500)
    return () => { active = false; window.clearInterval(poll) }
  }, [port])

  const busy = submitting || workStates.has(page?.operation.state || '')
  const supported = Boolean(page?.supported)
  const selected = page?.inventory.snapshots.find(item => item.id === snapshotID)
  const selectedComplete = selected?.state === 'complete'
  const selectedRestorable = selectedComplete && selected?.file_data_included !== false
  const keep = Number(keepLast)
  const keepValid = Number.isInteger(keep) && keep >= 1 && keep <= 1000
  const policyDays = Number(policyDraft?.days)
  const policyValid = Number.isInteger(policyDays) && policyDays >= 0 && policyDays <= 3650 &&
    !(policyDraft?.format === 'v1' && Boolean(page?.inventory.policy.repository))
  const disabled = !supported || busy

  const submit = async (request: XDriveServerBackupRequest) => {
    if (!supported || busy) return
    setSubmitting(true)
    setError('')
    try {
      const result = await port.submit(request)
      setNotice('已提交宿主机任务：' + (result.request_id || '等待处理'))
      await reload().catch(() => undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交备份操作失败。')
    } finally {
      setSubmitting(false)
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
          <TableContainer sx={{ maxHeight: 320 }}>
            <Table size="small" stickyHeader aria-label="服务器备份清单">
              <TableHead>
                <TableRow>
                  <TableCell>选择</TableCell><TableCell>快照</TableCell>
                  <TableCell>创建时间</TableCell><TableCell>格式</TableCell><TableCell>状态</TableCell>
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
                    <TableCell align="right">{displayBytes(item.bytes)}</TableCell>
                  </TableRow>
                ))}
                {!page?.inventory.snapshots.length ? (
                  <TableRow><TableCell colSpan={6}>尚无已发现的服务器快照。</TableCell></TableRow>
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
          </Stack>
        </Stack>
      </Paper>

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
            <XDriveActionButton intent="danger" disabled={disabled || !keepValid}
              onClick={() => ask({
                title: '确认清理旧代 v2 备份？',
                description: '将删除超过保留数量的旧快照和所有保留快照都不引用的备份 CAS。无法撤销；操作不会触及线上 CAS。',
                expected: 'PRUNE ' + keep,
                action: { action: 'prune', keep_last: keep, confirmation: 'PRUNE ' + keep },
              })}>手动清理旧代和孤儿 CAS</XDriveActionButton>
          </Stack>
          {page?.retention ? (
            <Alert severity="info">
              最近一次只读计划：保留 {page.retention.keep_snapshots?.length || 0} 代；
              可考虑删除 {page.retention.drop_candidates?.length || 0} 代；
              孤儿 CAS {page.retention.unreferenced_objects || 0} 项；
              潜在逻辑空间 {displayBytes(page.retention.potential_logical_bytes)}。
              此报告是历史预览，并非删除授权。
            </Alert>
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
