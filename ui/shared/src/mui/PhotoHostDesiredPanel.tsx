import { useEffect, useRef, useState } from 'react'
import { Box, Button, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveConfirmDialog } from './ConfirmDialog'
import type {
  XDrivePhotoHostConfig,
  XDrivePhotoHostUpdate,
  XDrivePhotoHostRevisionPage,
  XDrivePhotoHostRollbackInput,
} from '../service-dependencies'

// This is one shared deployment host, NOT four independent model switches
// and NOT the separately versioned automatic-task admission policy.
export type XDrivePhotoHostPort = {
  loadPhotoHostConfig?: () => Promise<XDrivePhotoHostConfig>
  savePhotoHostConfig?: (input: XDrivePhotoHostUpdate) => Promise<XDrivePhotoHostConfig>
  loadPhotoHostRevisions?: () => Promise<XDrivePhotoHostRevisionPage>
  rollbackPhotoHost?: (input: XDrivePhotoHostRollbackInput) => Promise<XDrivePhotoHostConfig>
}

const hostLabels: Record<XDrivePhotoHostConfig['host_runtime_state'], string> = {
  healthy: 'Docker 固定容器健康检查通过',
  unhealthy: 'Docker 固定容器健康检查失败',
  starting: '固定容器启动中',
  'running-unverified': '固定容器已运行，健康尚未确认',
  stopped: '固定容器已停止',
  unknown: '宿主实际运行状态未知',
}

export function XDrivePhotoHostDesiredPanel({
  source, section = 'config', onDirtyChange,
}: {
  source: XDrivePhotoHostPort
  section?: 'config' | 'verify' | 'history'
  onDirtyChange?: (dirty: boolean) => void
}) {
  const epochRef = useRef(0)
  const [config, setConfig] = useState<XDrivePhotoHostConfig | null>(null)
  const [draftEnabled, setDraftEnabled] = useState(false)
  const [history, setHistory] = useState<XDrivePhotoHostRevisionPage['items']>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [rollbackTarget, setRollbackTarget] = useState('')
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const dirty = section === 'config' && !!config && draftEnabled !== config.desired_enabled

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    const epoch = ++epochRef.current
    let active = true
    setLoading(true)
    setConfig(null)
    setHistory([])
    setError('')
    setNotice('')
    setHistoryError('')
    setRollbackTarget('')
    setConfirmSave(false)
    setConfirmRollback(false)
    if (!source.loadPhotoHostConfig) {
      setLoading(false)
      return () => { active = false; ++epochRef.current }
    }
    void source.loadPhotoHostConfig().then((next) => {
      if (!active || epoch !== epochRef.current) return
      setConfig(next)
      setDraftEnabled(next.desired_enabled)
    }).catch(() => {
      if (active && epoch === epochRef.current) setError('当前 Server/Agent 尚未支持智能分析宿主期望配置，或读取失败。')
    }).finally(() => {
      if (active && epoch === epochRef.current) setLoading(false)
    })
    if (section === 'history' && source.loadPhotoHostRevisions) {
      void source.loadPhotoHostRevisions().then((page) => {
        if (active && epoch === epochRef.current) setHistory(page.items)
      }).catch(() => {
        if (active && epoch === epochRef.current) setHistoryError('宿主配置历史读取失败。')
      })
    }
    return () => { active = false; ++epochRef.current }
  }, [source, section])

  const reload = async () => {
    if (!source.loadPhotoHostConfig || busy || dirty) return
    const epoch = ++epochRef.current
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const next = await source.loadPhotoHostConfig()
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraftEnabled(next.desired_enabled)
      if (section === 'history' && source.loadPhotoHostRevisions) {
        const revisions = await source.loadPhotoHostRevisions().catch(() => null)
        if (revisions && epoch === epochRef.current) setHistory(revisions.items)
      }
    } catch {
      if (epoch === epochRef.current) setError('重新读取智能分析宿主状态失败，保留上次已取得的结果。')
    } finally {
      if (epoch === epochRef.current) setLoading(false)
    }
  }

  const save = async () => {
    if (!config || !source.savePhotoHostConfig || busy || !dirty) return
    const epoch = ++epochRef.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await source.savePhotoHostConfig({
        revision: config.revision, enabled: draftEnabled,
      })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraftEnabled(next.desired_enabled)
      setNotice('期望启停修订已保存并审计；没有操作任何宿主容器，实际启停仍需后续安全应用功能。')
    } catch {
      if (epoch === epochRef.current) setError('保存失败或修订已冲突；当前草稿未作为宿主已生效状态。请重新核对版本。')
    } finally {
      if (epoch === epochRef.current) {
        setBusy(false)
        setConfirmSave(false)
      }
    }
  }

  const rollback = async () => {
    if (!config || !source.rollbackPhotoHost || !rollbackTarget || busy) return
    const targetRevision = Number(rollbackTarget)
    if (!Number.isSafeInteger(targetRevision) || targetRevision < 0 ||
        targetRevision >= config.revision ||
        !history.some((entry) => entry.revision === targetRevision)) return
    const epoch = ++epochRef.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await source.rollbackPhotoHost({
        revision: config.revision, target_revision: targetRevision,
      })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraftEnabled(next.desired_enabled)
      setRollbackTarget('')
      setNotice('已创建并审计新的期望回滚修订；宿主机配置未发生任何变化。')
      if (source.loadPhotoHostRevisions) {
        const revisions = await source.loadPhotoHostRevisions().catch(() => null)
        if (revisions && epoch === epochRef.current) setHistory(revisions.items)
      }
    } catch {
      if (epoch === epochRef.current) setError('宿主配置回滚失败或目标修订已过期，已保存配置未变。')
    } finally {
      if (epoch === epochRef.current) {
        setBusy(false)
        setConfirmRollback(false)
      }
    }
  }

  return (
    <Paper variant="outlined" data-xdrive-photo-host-desired sx={{ mt: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Typography variant="subtitle2" fontWeight={700}>照片智能分析 · 共享宿主容器</Typography>
          <Button size="small" variant="outlined" onClick={() => { void reload() }}
            disabled={busy || loading || dirty || !source.loadPhotoHostConfig}>重新读取实际状态</Button>
        </Stack>
        <XDriveStatusAlert tone="warning">
          这一设置只记录部署期望，尚不具备宿主机应用能力。
          它与「全局分析策略」的自动任务开关完全独立；没有启停容器按钮，也不影响已运行的分析和同步任务。
        </XDriveStatusAlert>
        {loading && <Typography variant="body2" color="text.secondary">正在读取宿主配置…</Typography>}
        {config && (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              配置来源：{config.source === 'saved' ? '管理员已保存期望' : '尚无管理员期望修订（沿用部署配置）'}
              {' · '}期望修订：#{config.revision}
              {' · '}期望状态：{config.source === 'saved'
                ? config.desired_enabled ? '准备启用' : '准备停用'
                : '未管理'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              实际宿主观测：{config.host_observed
                ? hostLabels[config.host_runtime_state] ?? hostLabels.unknown
                : '没有可信 Host Manager 新鲜观测'}
              {' · '}部署 Profile：{!config.host_observed || typeof config.host_profile_configured !== 'boolean'
                ? '未知'
                : config.host_profile_configured ? '宿主已配置启用意图' : '宿主未配置启用意图'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              受限宿主控制器：{config.host_control_supported
                ? '已取得新鲜只读控制证据' : '未安装、版本过旧或无法验证'}
              {' · '}执行状态：{config.host_control_supported
                ? ({ idle: '空闲', queued: '排队', running: '执行中', success: '宿主已确认执行', failed: '宿主执行失败',
                  unavailable: '不可用' }[config.host_control_state ?? 'unavailable'] ?? '未知')
                : '未知'}
              {' · '}宿主侧记录修订：{config.host_applied_revision ?? '未知'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              宿主控制证据尚未与管理员审计授权令牌绑定；即使显示宿主侧成功也不代表此期望修订已由 xDrive 管理界面应用。
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              生效结论：{config.apply_state === 'unmanaged' ? '没有已保存的期望修订'
                : '待宿主安全应用及按修订号验证（不是已生效）'}
            </Typography>
            <Typography variant="caption" color="text.secondary">{config.requirement}</Typography>
            {section === 'config' && (
              <Stack spacing={1}>
                <FormControlLabel control={<Switch checked={draftEnabled}
                  onChange={(_event, checked) => setDraftEnabled(checked)}
                  disabled={!config.editable || busy || !source.savePhotoHostConfig} />}
                  label="期望启用共享 Photo Intelligence 容器（仅保存，不立即启停）" />
                <Box>
                  <Button variant="contained" size="small"
                    disabled={!dirty || !config.editable || busy || !source.savePhotoHostConfig}
                    onClick={() => setConfirmSave(true)}>保存期望配置（不应用）</Button>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  当前尚无安全的应用入口；保存后即使观测到容器健康或部署意图相同，也不能宣称当前修订已生效。
                </Typography>
              </Stack>
            )}
            {section === 'history' && (
              <Stack spacing={1}>
                <Typography variant="subtitle2">审计历史与期望回滚</Typography>
                {historyError && <XDriveStatusAlert tone="warning">{historyError}</XDriveStatusAlert>}
                <TextField select label="选择较早的期望修订" size="small"
                  value={rollbackTarget} onChange={(event) => setRollbackTarget(event.target.value)}
                  disabled={!source.rollbackPhotoHost || busy || !config.editable}>
                  <MenuItem value="">请选择历史修订</MenuItem>
                  {history.filter((item) => item.revision < config.revision).map((item) => (
                    <MenuItem key={item.revision} value={String(item.revision)}>
                      #{item.revision} · {item.enabled ? '期望启用' : '期望停用'}
                      {' · '}{item.origin === 'rollback' ? '历史回滚' : item.origin === 'default' ? '原始默认' : '管理员配置'}
                    </MenuItem>
                  ))}
                </TextField>
                <Box>
                  <Button size="small" variant="outlined" disabled={!rollbackTarget || busy || !source.rollbackPhotoHost}
                    onClick={() => setConfirmRollback(true)}>创建回滚修订（不应用宿主）</Button>
                </Box>
              </Stack>
            )}
          </Stack>
        )}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {notice && <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert>}
        <XDriveConfirmDialog open={confirmSave} loading={busy}
          title="保存照片智能分析宿主期望状态？"
          description={'仅写入审计后的管理员目标修订，不启动、不停止容器，也不会改变正在进行的任务。目标：' +
            (draftEnabled ? '期望启用' : '期望停用')}
          confirmLabel="只保存期望配置" onCancel={() => setConfirmSave(false)}
          onConfirm={() => { void save() }} />
        <XDriveConfirmDialog open={confirmRollback} loading={busy}
          title="创建共享宿主的新回滚修订？"
          description="历史回滚只创建新的期望状态，不会向 Host Manager 下发宿主机操作。"
          confirmLabel="仅回滚期望状态" onCancel={() => setConfirmRollback(false)}
          onConfirm={() => { void rollback() }} />
      </Stack>
    </Paper>
  )
}
