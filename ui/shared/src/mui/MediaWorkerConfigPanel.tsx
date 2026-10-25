import { useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
import { xDriveCoreDependencyErrorMessage } from '../core-dependency-error'
import type {
  XDriveMediaWorkerConfig,
  XDriveMediaWorkerUpdate,
  XDriveMediaWorkerApplyResult,
  XDriveMediaWorkerRevisionPage,
  XDriveMediaWorkerRollbackInput,
} from '../service-dependencies'

export type XDriveMediaWorkerPort = {
  loadMediaWorkerConfig?: () => Promise<XDriveMediaWorkerConfig>
  saveMediaWorkerConfig?: (input: XDriveMediaWorkerUpdate) => Promise<XDriveMediaWorkerConfig>
  applyMediaWorker?: (input: { revision: number }) => Promise<XDriveMediaWorkerApplyResult>
  loadMediaWorkerRevisions?: () => Promise<XDriveMediaWorkerRevisionPage>
  rollbackMediaWorker?: (input: XDriveMediaWorkerRollbackInput) => Promise<XDriveMediaWorkerConfig>
}

function validMediaMemory(value: string): number | null {
  const raw = value.trim()
  if (!/^\d+$/.test(raw)) return null
  const result = Number(raw)
  return Number.isSafeInteger(result) && result >= 256 && result <= 4096 && result % 128 === 0
    ? result : null
}

function validMediaCPU(value: string): number | null {
  const raw = value.trim()
  if (!/^\d+$/.test(raw)) return null
  const result = Number(raw)
  return Number.isSafeInteger(result) && result >= 250 && result <= 4000 && result % 250 === 0
    ? result : null
}

function validMediaPIDs(value: string): number | null {
  const raw = value.trim()
  if (!/^\d+$/.test(raw)) return null
  const result = Number(raw)
  return Number.isSafeInteger(result) && result >= 64 && result <= 1024 && result % 32 === 0
    ? result : null
}

const states: Record<XDriveMediaWorkerConfig['apply_state'], string> = {
  unmanaged: '尚未由管理员配置', pending: '等待宿主机实际生效',
  unavailable: 'Host Manager 不可用', failed: '宿主机执行失败或运行状态丢失',
  applied: '已验证实际生效',
}

export function XDriveMediaWorkerConfigPanel({
  source, refreshID, section = 'config', onDirtyChange, onBusyChange,
}: {
  source: XDriveMediaWorkerPort
  refreshID: number
  section?: 'config' | 'history' | 'verify' | 'all'
  onDirtyChange?: (dirty: boolean) => void
  onBusyChange?: (busy: boolean) => void
}) {
  const epochRef = useRef(0)
  const configSourceRef = useRef(source)
  const [configState, setConfig] = useState<XDriveMediaWorkerConfig | null>(null)
  const [configOwner, setConfigOwner] = useState<XDriveMediaWorkerPort | null>(null)
  // Fence at render time: never paint another Server/Owner's old admin config.
  const config = configOwner === source ? configState : null
  const [history, setHistory] = useState<XDriveMediaWorkerRevisionPage['items']>([])
  const [draftEnabled, setDraftEnabled] = useState(false)
  const [draftMemory, setDraftMemory] = useState('768')
  const [draftCPU, setDraftCPU] = useState('750')
  const [draftPIDs, setDraftPIDs] = useState('128')
  const [rollbackTarget, setRollbackTarget] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmApply, setConfirmApply] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [historyError, setHistoryError] = useState('')

  useEffect(() => {
    let active = true
    const epoch = ++epochRef.current
    const sourceChanged = configSourceRef.current !== source
    configSourceRef.current = source
    // Read-only refresh never blanks or unmounts the last accepted editor.
    // A changed Server/Owner source still resets all old scoped state.
    if (sourceChanged) {
      setConfigOwner(null)
      setConfig(null)
      setDraftEnabled(false)
      setDraftMemory('768')
      setDraftCPU('750')
      setDraftPIDs('128')
      setHistory([])
    }
    setRollbackTarget('')
    setBusy(false)
    setLoading(true)
    setConfirmSave(false)
    setConfirmApply(false)
    setConfirmRollback(false)
    setError('')
    setNotice('')
    setHistoryError('')
    if (source.loadMediaWorkerConfig) {
      void source.loadMediaWorkerConfig().then((next) => {
        if (!active || epoch !== epochRef.current) return
        setConfigOwner(source)
        setConfig(next)
        setDraftEnabled(next.desired_enabled)
        setDraftMemory(String(next.desired_memory_mib ?? 768))
        setDraftCPU(String(next.desired_cpu_milli ?? 750))
        setDraftPIDs(String(next.desired_pids_limit ?? 128))
      }).catch(() => {
        if (active && epoch === epochRef.current) setError('无法读取 Media Worker 配置；请检查 Server/Agent 版本。')
      }).finally(() => {
        if (active && epoch === epochRef.current) setLoading(false)
      })
    } else {
      setLoading(false)
    }
    if ((section === 'history' || section === 'all') && source.loadMediaWorkerRevisions) {
      void source.loadMediaWorkerRevisions().then((page) => {
        if (active && epoch === epochRef.current) setHistory(page.items)
      }).catch(() => {
        if (active && epoch === epochRef.current) setHistoryError('Media Worker 历史配置暂时不可读取。')
      })
    }
    return () => { active = false; ++epochRef.current }
  }, [source, refreshID, section])

  const reload = async () => {
    if (!source.loadMediaWorkerConfig || busy || dirty) return
    const epoch = ++epochRef.current
    setLoading(true)
    setError('')
    try {
      const next = await source.loadMediaWorkerConfig()
      if (epoch !== epochRef.current) return
      setConfigOwner(source)
      setConfig(next)
      setDraftEnabled(next.desired_enabled)
      setDraftMemory(String(next.desired_memory_mib ?? 768))
      setDraftCPU(String(next.desired_cpu_milli ?? 750))
      setDraftPIDs(String(next.desired_pids_limit ?? 128))
      if ((section === 'history' || section === 'all') && source.loadMediaWorkerRevisions) {
        const result = await source.loadMediaWorkerRevisions().catch(() => null)
        if (result && epoch === epochRef.current) {
          setHistory(result.items)
          setHistoryError('')
        }
      }
    } catch (err) {
      if (epoch === epochRef.current) setError(xDriveCoreDependencyErrorMessage(err, 'media-worker', 'refresh'))
    } finally {
      if (epoch === epochRef.current) setLoading(false)
    }
  }

  const save = async () => {
    if (!config || !source.saveMediaWorkerConfig || busy) return
    // Local validation never reaches the Server; do not describe invalid
    // input as a potentially committed write when sanitizing transport errors.
    const memory = validMediaMemory(draftMemory)
    if (memory === null) {
      setError('Worker 内存限额必须为 256–4096 MiB，且是 128 MiB 的整数倍。')
      setConfirmSave(false)
      return
    }
    const cpu = validMediaCPU(draftCPU)
    if (cpu === null) {
      setError('Worker CPU 限额必须为 250–4000 mCPU，且是 250 mCPU 的整数倍。')
      setConfirmSave(false)
      return
    }
    const pids = validMediaPIDs(draftPIDs)
    if (pids === null) {
      setError('Worker PID 上限必须为 64–1024，且为 32 的整数倍。')
      setConfirmSave(false)
      return
    }
    const epoch = ++epochRef.current
    setBusy(true)
    setConfirmSave(false)
    setError('')
    setNotice('')
    try {
      const next = await source.saveMediaWorkerConfig({
        revision: config.revision, enabled: draftEnabled,
        memory_mib: memory, cpu_milli: cpu, pids_limit: pids,
      })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraftEnabled(next.desired_enabled)
      setDraftMemory(String(next.desired_memory_mib ?? 768))
      setDraftCPU(String(next.desired_cpu_milli ?? 750))
      setDraftPIDs(String(next.desired_pids_limit ?? 128))
      setNotice('期望配置已保存并审计；尚未作用于容器。请单独点击“提交宿主机应用”。')
      if (source.loadMediaWorkerRevisions) {
        const page = await source.loadMediaWorkerRevisions().catch(() => null)
        if (page && epoch === epochRef.current) setHistory(page.items)
      }
    } catch (err) {
      if (epoch === epochRef.current) setError(xDriveCoreDependencyErrorMessage(err, 'media-worker', 'save'))
    } finally {
      if (epoch === epochRef.current) setBusy(false)
    }
  }

  const apply = async () => {
    if (!config || !source.applyMediaWorker || busy || dirty) return
    const epoch = ++epochRef.current
    setBusy(true)
    setConfirmApply(false)
    setError('')
    setNotice('')
    try {
      const queued = await source.applyMediaWorker({ revision: config.revision })
      if (epoch !== epochRef.current) return
      setNotice('宿主机请求已排队（修订 #' + queued.revision + '）。请点击“验证实际生效”确认容器和 FFmpeg 探针结果。')
      const next = await source.loadMediaWorkerConfig?.().catch(() => null)
      if (next && epoch === epochRef.current) setConfig(next)
    } catch (err) {
      if (epoch === epochRef.current) setError(xDriveCoreDependencyErrorMessage(err, 'media-worker', 'apply'))
    } finally {
      if (epoch === epochRef.current) setBusy(false)
    }
  }

  const rollback = async () => {
    if (!config || !source.rollbackMediaWorker || busy || !rollbackTarget || dirty) return
    const targetRevision = Number(rollbackTarget)
    if (!Number.isSafeInteger(targetRevision) || targetRevision < 0 ||
        targetRevision >= config.revision || !history.some((item) => item.revision === targetRevision)) return
    const epoch = ++epochRef.current
    setBusy(true)
    setConfirmRollback(false)
    setError('')
    setNotice('')
    try {
      const next = await source.rollbackMediaWorker({
        revision: config.revision, target_revision: targetRevision,
      })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraftEnabled(next.desired_enabled)
      setDraftMemory(String(next.desired_memory_mib ?? 768))
      setDraftCPU(String(next.desired_cpu_milli ?? 750))
      setDraftPIDs(String(next.desired_pids_limit ?? 128))
      setRollbackTarget('')
      setNotice('已新建历史回滚修订并完成审计；仍需单独提交宿主机应用，未立即停止或启动服务。')
      if (source.loadMediaWorkerRevisions) {
        const page = await source.loadMediaWorkerRevisions().catch(() => null)
        if (page && epoch === epochRef.current) setHistory(page.items)
      }
    } catch (err) {
      if (epoch === epochRef.current) setError(xDriveCoreDependencyErrorMessage(err, 'media-worker', 'rollback'))
    } finally {
      if (epoch === epochRef.current) setBusy(false)
    }
  }

  const dirty = Boolean(config && (
    draftEnabled !== config.desired_enabled ||
    draftMemory !== String(config.desired_memory_mib ?? 768) ||
    draftCPU !== String(config.desired_cpu_milli ?? 750) ||
    draftPIDs !== String(config.desired_pids_limit ?? 128)
  ))
  const operationActive = config?.host.state === 'queued' || config?.host.state === 'running'
  const canApply = !!config && config.revision > 0 && config.apply_supported &&
    typeof config.desired_memory_mib === 'number' && typeof config.desired_cpu_milli === 'number' &&
    typeof config.desired_pids_limit === 'number' &&
    config.apply_state !== 'applied' && !operationActive && !dirty
  const canEdit = !!config?.editable && typeof config?.desired_memory_mib === 'number' &&
    typeof config?.desired_cpu_milli === 'number' && typeof config?.desired_pids_limit === 'number' &&
    !busy && !operationActive
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [onDirtyChange, dirty])
  useEffect(() => {
    onBusyChange?.(loading || busy || confirmSave || confirmApply || confirmRollback)
  }, [onBusyChange, loading, busy, confirmSave, confirmApply, confirmRollback])
  useEffect(() => () => { onBusyChange?.(false) }, [onBusyChange])

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}
      data-xdrive-admin-media-worker-control>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>
            {section === 'config' ? 'Media Worker · 期望配置与应用'
              : section === 'verify' ? 'Media Worker · 实际生效'
                : section === 'all' ? 'Media Worker · 配置、检测与历史' : 'Media Worker · 历史修订'}
          </Typography>
          {section === 'verify' && (
            <Button size="small" variant="outlined" disabled={busy || loading || !source.loadMediaWorkerConfig}
              onClick={() => { void reload() }}>验证实际生效</Button>
          )}
        </Stack>
        {(section === 'config' || section === 'all') && (
          <Typography variant="body2" color="text.secondary">
            仅控制独立 FFmpeg Media Worker，不影响数据库、文件存储及同步。
            保存期望配置后需明确执行宿主应用，实际生效要另行验证。
          </Typography>
        )}
        {config ? (
          <>
            {(section === 'config' || section === 'all') && (
              <Typography variant="caption" color="text.secondary">
                已保存修订 #{config.revision} · {config.source === 'saved' ? '管理员配置' : '默认未管理'}
                {' · '}{config.desired_enabled ? '期望启用' : '期望停用'}（尚需核对实际生效）
              </Typography>
            )}
            {(section === 'verify' || section === 'all') && (<>
            <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}
              id={section === 'all' ? 'dependency-media-worker-runtime-verify-header' : undefined}
              sx={{ scrollMarginTop: 72 }}>
              <Chip size="small" variant="outlined"
                color={config.apply_state === 'applied' ? 'success' :
                  config.apply_state === 'failed' || config.apply_state === 'unavailable' ? 'error' : 'default'}
                label={states[config.apply_state] ?? '未验证'} />
              <Typography variant="caption" color="text.secondary">
                期望修订 #{config.revision} · 宿主已应用修订 #{config.host.applied_revision}
                {' · '}{config.source === 'saved' ? '管理员持久化配置' : '默认未管理'}
              </Typography>
            </Stack>
            <Typography variant="body2">
              期望：{config.desired_enabled ? '启用' : '停用'}
              {' · '}宿主机：{config.host.supported ?
                (config.host.observed_enabled ? '检测到运行中' : '未检测到运行') : '控制器不在线'}
              {' · '}FFmpeg：{config.runtime_ready ? '探针通过' : '未验证就绪'}
              {' · '}内存：期望 {config.desired_memory_mib ?? '未知'} MiB
              {' · '}实际 {config.host.memory_verified ? config.host.observed_memory_mib + ' MiB（' + (config.host.observed_enabled ? 'Docker 实际限制已核验' : '停用后配置文件已核验') + '）' : '未核验'}
              {' · '}CPU：期望 {config.desired_cpu_milli ?? '未知'} mCPU
              {' · '}实际 {config.host.cpu_verified ? config.host.observed_cpu_milli + ' mCPU（' +
                (config.host.observed_enabled ? 'Docker 实际限制已核验' : '停用后配置文件已核验') + '）' : '未核验'}
              {' · '}PID：期望 {config.desired_pids_limit ?? '未知'}
              {' · '}实际 {config.host.pids_verified ? config.host.observed_pids_limit +
                (config.host.observed_enabled ? '（Docker 实际限制已核验）' : '（停用后配置文件已核验）') : '未核验'}
              {' · '}执行状态：{config.host.state}
            </Typography>
            </>)}
            {(section === 'config' || section === 'all') && (<Box
              id={section === 'all' ? 'dependency-media-worker-config-header' : undefined}
              sx={{ scrollMarginTop: 72 }}>
              {section === 'all' && <Typography variant="subtitle2">配置与修改</Typography>}
            <FormControlLabel
              control={<Switch checked={draftEnabled} disabled={!canEdit}
                onChange={(event) => setDraftEnabled(event.target.checked)} />}
              label={draftEnabled ? '期望启用媒体运行时' : '期望停止媒体运行时'} />
            <TextField fullWidth type="number" size="small" label="Media Worker 内存上限 (MiB)"
              value={draftMemory} onChange={(event) => setDraftMemory(event.target.value)}
              disabled={!canEdit} inputProps={{ min: 256, max: 4096, step: 128 }}
              error={validMediaMemory(draftMemory) === null}
              helperText="允许 256–4096 MiB，以 128 MiB 为步长。保存后不立即修改容器；仅独立 Worker 在受限应用时被重建。"
            />
            <TextField fullWidth type="number" size="small" label="Media Worker CPU 上限 (mCPU)"
              value={draftCPU} onChange={(event) => setDraftCPU(event.target.value)}
              disabled={!canEdit} inputProps={{ min: 250, max: 4000, step: 250 }}
              error={validMediaCPU(draftCPU) === null}
              helperText="允许 250–4000 mCPU，以 250 mCPU 为步长；1000 mCPU = 1 个 CPU。"
            />
            <TextField fullWidth type="number" size="small" label="Media Worker PID 上限"
              value={draftPIDs} onChange={(event) => setDraftPIDs(event.target.value)}
              disabled={!canEdit} inputProps={{ min: 64, max: 1024, step: 32 }}
              error={validMediaPIDs(draftPIDs) === null}
              helperText="允许 64–1024 个 PID，以 32 为步长。只影响独立 Media Worker 容器。"
            />
            <Button size="small" variant="outlined" disabled={!canEdit ||
              validMediaMemory(draftMemory) === null || validMediaCPU(draftCPU) === null ||
              validMediaPIDs(draftPIDs) === null ||
              (draftEnabled === config.desired_enabled &&
                validMediaMemory(draftMemory) === config.desired_memory_mib &&
                validMediaCPU(draftCPU) === config.desired_cpu_milli &&
                validMediaPIDs(draftPIDs) === config.desired_pids_limit) ||
              !source.saveMediaWorkerConfig} onClick={() => setConfirmSave(true)}>
              保存期望状态（不立即操作容器）
            </Button>
            <Button size="small" variant="contained" disabled={!canApply || busy || !source.applyMediaWorker}
              onClick={() => setConfirmApply(true)}>
              提交宿主机应用
            </Button>
            {!config.apply_supported && (
              <Typography variant="caption" color="warning.main">
                Host Manager 未提供在线 PID 策略控制或心跳已过期；需更新并启动受限 xdrive-server control 后才能应用。
              </Typography>
            )}
            {operationActive && (
              <Typography variant="caption" color="warning.main">受限操作已排队或正在执行，请勿重复提交。</Typography>
            )}
            <XDriveConfirmDialog open={confirmSave} loading={busy}
              title="保存 Media Worker 的期望启停状态"
              description="此操作只保存启停、内存、CPU 与 PID 限额的新修订并审计，不会直接改变容器；需要随后单独提交宿主机实际应用。"
              confirmLabel="保存期望配置" onCancel={() => setConfirmSave(false)}
              onConfirm={() => { void save() }} />
            <XDriveConfirmDialog open={confirmApply} loading={busy}
              title="确认宿主机实际启停 FFmpeg Worker"
              description={'仅控制 media-worker 容器，不接触数据库或核心文件服务。目标：' +
                (config.desired_enabled ? '开启' : '关闭') + '，内存限制 ' + config.desired_memory_mib +
                ' MiB，CPU 限制 ' + config.desired_cpu_milli +
                ' mCPU，PID 限制 ' + config.desired_pids_limit +
                '。启用时仅重建 media-worker，并实际核验容器内存/CPU/PID 限制和 FFmpeg 探针。'}
              confirmLabel="提交受限执行" onCancel={() => setConfirmApply(false)}
              onConfirm={() => { void apply() }} />
            </Box>)}
            {(section === 'history' || section === 'all') && source.loadMediaWorkerRevisions && source.rollbackMediaWorker && (
              <Box id={section === 'all' ? 'dependency-media-worker-history-header' : undefined}
                sx={{ scrollMarginTop: 72 }}>
                <Typography variant="subtitle2" fontWeight={700}>历史配置与安全回滚</Typography>
                <TextField select fullWidth size="small" label="选择历史修订" value={rollbackTarget}
                  sx={{ mt: 1 }} onChange={(event) => setRollbackTarget(event.target.value)}
                  disabled={!canEdit || dirty}
                  helperText="回滚产生新的审计修订；必须再次由 Host Manager 实际应用。">
                  <MenuItem value="">请选择较早修订</MenuItem>
                  {history.filter((item) => item.revision < config.revision).map((item) => (
                    <MenuItem key={item.revision} value={String(item.revision)}>
                      修订 #{item.revision} · {item.enabled ? '启用' : '停用'} · 内存 {item.memory_mib ?? 768} MiB · CPU {item.cpu_milli ?? 750} mCPU · PID {item.pids_limit ?? 128} · {item.origin}
                    </MenuItem>
                  ))}
                </TextField>
                <Button size="small" variant="outlined" sx={{ mt: 1 }} disabled={!canEdit || dirty || !rollbackTarget}
                  onClick={() => setConfirmRollback(true)}>保存历史回滚修订</Button>
                <XDriveConfirmDialog open={confirmRollback} loading={busy}
                  title="确认恢复 Media Worker 历史期望配置"
                  description="将新建审计修订，保留全部历史。回滚仅修改期望设置，需另行提交真实应用，不会自行重启核心服务。"
                  confirmLabel="确认回滚期望" onCancel={() => setConfirmRollback(false)}
                  onConfirm={() => { void rollback() }} />
                {historyError && <Typography variant="caption" color="warning.main">{historyError}</Typography>}
              </Box>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {loading ? '正在读取 Media Worker 状态…' : '此 Server/Agent 版本尚未支持实际启停控制；不会提供无效开关。'}
          </Typography>
        )}
        {configSourceRef.current === source && error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {configSourceRef.current === source && notice && <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert>}
      </Stack>
    </Paper>
  )
}
