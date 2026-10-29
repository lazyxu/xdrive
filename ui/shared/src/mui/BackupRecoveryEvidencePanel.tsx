import { Paper, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material'
import type { XDriveServerBackupPage } from '../server-backup-admin'
import { selectServerBackupRecoveryEvidence } from '../server-backup-recovery-evidence'
import { assessServerBackupRecoveryReadiness } from '../server-backup-recovery-readiness'

const snapshotStatus: Record<string, string> = {
  none: '未选择已发现的快照',
  complete_candidate: '文件与数据库结构完整：仅是恢复候选，不能代表当前可恢复',
  database_only: '仅包含数据库：不能执行完整文件与数据库恢复',
  incomplete: '不完整：不能作为完整恢复点',
  inconsistent: '源数据不一致：不能作为可靠恢复点',
}

function drillLabel(event: import('../server-backup-admin').XDriveServerBackupHistoryEntry | null): string {
  if (!event) return '跳过（未验收）— 当前宿主机没有独立、可信的演练成功凭据'
  const time = event.finished_at ? new Date(event.finished_at).toLocaleString() : '时间未知'
  const proof = event.drill
  if (event.state === 'success' && proof?.state === 'success' &&
      proof.files_restored && proof.postgresql_restored && !proof.production_verified) {
    return '本机隔离演练成功（历史） · 文件与 PostgreSQL 已在离线 RAM 沙箱实际恢复 · ' +
      time + ' · 不是生产破坏性恢复验收，不能证明此刻仍可恢复'
  }
  if (event.state === 'failed') {
    return '最近一次隔离演练失败 · ' + time + ' · ' +
      (proof?.failure_category || '缺少可验证的失败分类；请检查宿主机私有日志')
  }
  return '缺少可信的本机隔离演练凭据；不能标记成功'
}

function receiptLabel(event: {
  state: string
  finished_at?: string
  mode?: string
} | null, kind: 'verify' | 'restore'): string {
  if (!event) return '最近最多 30 条宿主机记录中无对应操作证据'
  const outcome = event.state === 'success' ? '宿主机记录成功' : '宿主机记录失败'
  const time = event.finished_at ? new Date(event.finished_at).toLocaleString() : '时间未知'
  if (kind === 'verify') {
    return outcome + ' · ' + (event.mode || '模式未知') + ' · ' + time +
      '（历史校验，不证明快照现在仍完整）'
  }
  return outcome + ' · ' + time +
    '（历史实际恢复操作，不是隔离演练，也不等于当前可恢复性验收）'
}

/** Same authorized Host-backed data for Web, Desktop and DSM shared UI. */
export function XDriveBackupRecoveryEvidencePanel({ page, snapshotID }: {
  page: XDriveServerBackupPage
  snapshotID: string
}) {
  const evidence = selectServerBackupRecoveryEvidence(page, snapshotID)
  const readiness = assessServerBackupRecoveryReadiness(page, evidence, snapshotID)
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}
      data-xdrive-admin-backup-recovery-evidence>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={600}>恢复能力与演练证据</Typography>
        <Typography variant="body2" color="text.secondary">
          以下结果只对应当前选中的快照。备份创建、完整性校验、实际恢复历史与独立隔离演练
          是不同证据，不能互相替代。
        </Typography>
        <Typography variant="subtitle2" data-xdrive-admin-backup-recovery-readiness>
          恢复前检查建议：{readiness.label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {readiness.action}
        </Typography>
        <Table size="small" aria-label="所选备份恢复证据分层">
          <TableBody>
            <TableRow>
              <TableCell sx={{ width: 156 }}>结构恢复候选</TableCell>
              <TableCell>{snapshotStatus[evidence.snapshotKind]}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>宿主机校验</TableCell>
              <TableCell>{receiptLabel(evidence.lastVerify, 'verify')}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>实际恢复记录</TableCell>
              <TableCell>{receiptLabel(evidence.lastRestore, 'restore')}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>本机隔离恢复演练</TableCell>
              <TableCell>{drillLabel(evidence.lastDrill)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>隔离 CI 恢复演练</TableCell>
              <TableCell>
                CI 产物独立于当前部署；本页面尚无匹配运行版本的可信绑定证据，
                因此不显示本机通过。请到对应提交的 GitHub Actions 核验演练 Artifact。
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary">
          “宿主机实际恢复成功”仅代表曾执行恢复并完成既有后置校验；
          绝不自动标记为独立恢复演练通过。隔离演练只验证所选快照的离线文件与数据库恢复，
          不证明线上生产恢复已经通过。历史记录最多 30 条，缺失不表示失败。
        </Typography>
      </Stack>
    </Paper>
  )
}
