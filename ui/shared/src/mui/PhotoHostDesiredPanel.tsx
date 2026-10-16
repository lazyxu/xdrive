import { useEffect, useRef, useState } from 'react'
import { Box, Button, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveConfirmDialog } from './ConfirmDialog'
import type {
  XDrivePhotoHostConfig,
  XDrivePhotoHostPreflight,
  XDrivePhotoHostApplyInput,
  XDrivePhotoHostApplyResult,
  XDrivePhotoHostUpdate,
  XDrivePhotoHostRevisionPage,
  XDrivePhotoHostRollbackInput,
} from '../service-dependencies'

// This is one shared deployment host, NOT four independent model switches
// and NOT the separately versioned automatic-task admission policy.
export type XDrivePhotoHostPort = {
  loadPhotoHostConfig?: () => Promise<XDrivePhotoHostConfig>
  loadPhotoHostPreflight?: () => Promise<XDrivePhotoHostPreflight>
  applyPhotoHost?: (input: XDrivePhotoHostApplyInput) => Promise<XDrivePhotoHostApplyResult>
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
  const [preflight, setPreflight] = useState<XDrivePhotoHostPreflight | null>(null)
  const [preflightBusy, setPreflightBusy] = useState(false)
  const [preflightError, setPreflightError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [rollbackTarget, setRollbackTarget] = useState('')
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmApply, setConfirmApply] = useState(false)
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
    setPreflight(null)
    setPreflightBusy(false)
    setPreflightError('')
    setError('')
    setNotice('')
    setHistoryError('')
    setRollbackTarget('')
    setConfirmSave(false)
    setConfirmApply(false)
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

  const verifyLocalReadiness = async () => {
    if (section !== 'verify' || !source.loadPhotoHostPreflight || loading || preflightBusy) return
    const epoch = epochRef.current
    setPreflightBusy(true)
    setPreflight(null)
    setPreflightError('')
    try {
      const next = await source.loadPhotoHostPreflight()
      if (epoch === epochRef.current) setPreflight(next)
    } catch {
      if (epoch === epochRef.current) {
        setPreflightError('宿主启用预检不可用；旧版 Server/Agent 不支持，或只读检查失败。')
      }
    } finally {
      if (epoch === epochRef.current) setPreflightBusy(false)
    }
  }

  const reload = async () => {
    if (!source.loadPhotoHostConfig || busy || dirty) return
    const epoch = ++epochRef.current
    setLoading(true)
    setPreflightBusy(false)
    setPreflight(null)
    setPreflightError('')
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
      setPreflight(null)
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

  const applyHost = async () => {
    if (!config || !source.applyPhotoHost || !config.apply_supported ||
        !config.desired_enabled || config.revision <= 0 || busy || dirty) return
    const epoch = ++epochRef.current
    setBusy(true)
    setError('')
    setNotice('')
    setPreflight(null)
    try {
      const queued = await source.applyPhotoHost({ revision: config.revision })
      if (epoch !== epochRef.current) return
      setNotice('固定宿主启用请求已完成管理员审计并进入队列（修订 #' +
        queued.revision + '）。提交不等于宿主或模型生效，请重新读取状态核验。')
      const latest = await source.loadPhotoHostConfig?.().catch(() => null)
      if (latest && epoch === epochRef.current) {
        setConfig(latest)
        setDraftEnabled(latest.desired_enabled)
      }
    } catch {
      if (epoch === epochRef.current) {
        setError('安全启用未确认入队；可能存在修订冲突、执行中请求或宿主异常，请重新读取状态，勿重复盲目提交。')
      }
    } finally {
      if (epoch === epochRef.current) {
        setBusy(false)
        setConfirmApply(false)
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
      setPreflight(null)
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
          保存配置只记录期望；仅允许经管理员审计的固定宿主安全启用请求，绝不自动启用或重建正在运行的容器。
          停用、重启和跨实例分析任务排空尚不支持。「全局分析策略」的任务准入开关与宿主启用互不等价。
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
              未经审计请求令牌匹配的宿主状态不可当作已应用；即使宿主回执匹配，也不代表独立的模型 Info 检测通过。
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              生效结论：{config.apply_state === 'unmanaged' ? '没有已保存的期望修订'
                : config.apply_state === 'queued' ? '启用请求已登记，等待宿主回执（未生效）'
                  : config.apply_state === 'host-verified' ? '宿主请求令牌与运行状态已核验；具体模型尚未验证'
                    : config.apply_state === 'failed' ? '受限宿主启用失败；需重新核查状态'
                      : '已保存期望仍待安全启用（未生效）'}
            </Typography>
            <Typography variant="caption" color="text.secondary">{config.requirement}</Typography>
            {section === 'verify' && (
              <Stack spacing={1} data-xdrive-photo-host-preflight>
                <Typography variant="subtitle2">宿主与模型执行检测（只读）</Typography>
                <Typography variant="caption" color="text.secondary">
                  手动检查固定宿主前置条件；只有已保存的启用修订取得可信宿主回执时，才对四类模型执行独立 Info 探针。
                  不授权启停；可信 ACK 后可执行固定语义、YuNet/SFace、视觉／OCR 及 Creative 抠图模型烟测，均只使用内部固定合成输入；不代表真实图库或其他 Server 实例生效。
                </Typography>
                <Box>
                  <Button size="small" variant="outlined" onClick={() => { void verifyLocalReadiness() }}
                    disabled={!source.loadPhotoHostPreflight || preflightBusy || loading}>
                    {preflightBusy ? '正在检测…' : '检测宿主与模型（只读）'}
                  </Button>
                </Box>
                {preflightError && <XDriveStatusAlert tone="warning">{preflightError}</XDriveStatusAlert>}
                {preflight && (
                  <Stack spacing={0.5}>
                    <Typography variant="body2" fontWeight={600}>
                      本地预检：{preflight.local_checks_complete ? '可读取部分前置条件' : '条件尚不完整'}
                      {' · '}修订 #{preflight.desired_revision}
                      {' · '}受限启用请求：{preflight.apply_supported ? '可申请' : '暂不可提交'}（不代表已生效）
                    </Typography>
                    {preflight.checks.map((check) => (
                      <Typography key={check.id} variant="body2" color="text.secondary">
                        {check.state === 'pass' ? '✓' : check.state === 'missing' ? '缺少' : check.state === 'blocked' ? '阻止' : '未知'}
                        {' · '}{check.detail}
                      </Typography>
                    ))}
                    <Box component="section" aria-label="四类模型实时 Info" data-xdrive-photo-host-model-info>
                      <Typography variant="body2"
                        color={preflight.durable_work_blocker_state === 'blocked' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-durable-work-blocker-state>
                        跨实例任务排空阻止信号：{preflight.durable_work_blocker_state === 'blocked'
                          ? '数据库发现仍在运行的照片分析／人物聚类任务或已排队／运行的照片创作任务；禁止停用。'
                          : '尚未证明可以停用：未发现记录、检测不可用或旧版 Server/Agent 均不能证明其他 Server 和未持久化任务已经排空。'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.runtime_work_blocker_state === 'blocked' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-runtime-work-blocker-state>
                        多 Server 运行任务阻止信号：{preflight.runtime_work_blocker_state === 'blocked'
                          ? '发现尚未过期的照片后台任务运行／排队／取消中状态；禁止停用共享宿主。'
                          : '尚无跨实例排空证明：未找到运行记录、上报过期、检测失败或旧版 Server/Agent 均不能证明实例齐备及禁止新任务入队。'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.replica_membership_blocker_state === 'blocked' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-replica-membership-blocker-state>
                        Server 成员心跳阻止信号：{preflight.replica_membership_blocker_state === 'blocked'
                          ? '近期登记过的 Server 实例心跳已过期；实例可能失联或正常下线，禁止认定已安全排空。'
                          : '成员覆盖尚未核验：即使已有心跳全部新鲜，也不能证明没有遗漏实例、未来任务已冻结或可以停用。'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.private_ingress_auth_blocker_state === 'blocked' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-private-ingress-auth-blocker-state>
                        模型私有入口认证阻止信号：{preflight.private_ingress_auth_blocker_state === 'blocked'
                          ? '本机 Server 未配置模型 Bearer，或模型侧 Info 明确报告未启用；当前不具备安全停用条件。'
                          : '认证覆盖仍未核验：旧版实例、其它私有调用方及跨实例任务准入尚无充分证据；Bearer 已配置也不意味着可安全停用。'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.private_ingress_policy_observation === 'inconsistent' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-private-policy-observation>
                        模型私有入口策略（仅当前进程）：{preflight.private_ingress_policy_observation === 'strict-local'
                          ? '四类模型 Info 自报 require-bearer-v1 且与已审计宿主启用请求一致；仅证明本进程策略自报，不代表请求级准入生效或安全停用。'
                          : preflight.private_ingress_policy_observation === 'legacy-local'
                            ? '四类模型 Info 自报 legacy；仍使用既有私有入口访问方式，不代表已启用动态推理许可。'
                            : preflight.private_ingress_policy_observation === 'inconsistent'
                              ? '四类模型自报的认证策略不一致，或严格模式未启用 Bearer；不能认定策略实际生效。'
                              : '未核验：旧版模型／Server、宿主请求回执不匹配、Info 不完整或检测失败均不能确认运行策略。'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.trust_material_observation === 'blocked' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-trust-material-observation>
                        运维公钥材料（仅当前 Server）：{preflight.trust_material_observation === 'root-pin-match-local'
                          ? '本机只读公钥文件的完整 SHA-256 与单独配置的操作员公钥指纹均匹配；仅为静态材料核验，尚未证明信任根来源、真实模型授权或全集群安全停用。'
                          : preflight.trust_material_observation === 'material-only'
                            ? '部署提供的只读公钥文件与固定 SHA-256 一致；仅证明本机材料完整，未证明实际 Server 成员、签名准入或可安全停用。'
                            : preflight.trust_material_observation === 'blocked'
                              ? '运维文件、文件固定值或操作员公钥指纹缺失/不匹配，或材料格式/权限异常；此材料不可用于安全迁移。'
                              : '未配置或旧版 Server/Agent 尚未支持检测；不代表已完成部署信任身份核验。'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        运维侧可单独固定 XD_PHOTO_TRUST_OPERATOR_KEY_SHA256；网页不能修改此身份材料，检测通过也不会自动启用模型准入或停用控制。
                      </Typography>
                      <Typography variant="body2" color="text.secondary" data-xdrive-photo-model-request-ack-verified>
                        四类模型确认原始启用请求：{preflight.model_request_ack_verified
                          ? '同一已审计请求的 ID／修订号已由当前模型进程全部确认（仅请求回执，非任务生效）'
                          : '未核验或回执不一致；不能认为四类模型已确认原始启用请求'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.semantic_text_task_state === 'verified' ? 'success.main'
                          : preflight.semantic_text_task_state === 'failed' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-semantic-text-task-state>
                        固定文本语义推理：{preflight.semantic_text_task_state === 'verified'
                          ? '真实推理及向量结构通过（仅固定文本，不代表照片、人脸、OCR 或创作任务成功）'
                          : preflight.semantic_text_task_state === 'failed'
                            ? '推理或向量验证失败，不能报告成功'
                            : preflight.semantic_text_task_state === 'throttled'
                              ? '检测频率受限或正在执行；本次未验证'
                              : '未运行、宿主回执不足或旧版 Server/Agent 不支持'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.semantic_image_task_state === 'verified' ? 'success.main'
                          : preflight.semantic_image_task_state === 'failed' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-semantic-image-task-state>
                        合成图片语义推理：{preflight.semantic_image_task_state === 'verified'
                          ? '真实图片编码器与向量通过（仅模型内合成图，不代表图库照片、人脸、OCR 或创作任务成功）'
                          : preflight.semantic_image_task_state === 'failed'
                            ? '合成图片推理或向量验证失败，不报告生效'
                            : preflight.semantic_image_task_state === 'throttled'
                              ? '检测频率受限或正在执行；未验证'
                              : '未运行、回执不足或旧版 Server/Agent/模型不支持'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.face_detector_task_state === 'verified' ? 'success.main'
                          : preflight.face_detector_task_state === 'failed' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-face-detector-task-state>
                        合成图片人脸检测器：{preflight.face_detector_task_state === 'verified'
                          ? '真实 YuNet 已执行且返回合法结果（可能检测到 0 人脸；不代表识别准确、SFace 或真实图库成功）'
                          : preflight.face_detector_task_state === 'failed'
                            ? '检测器或返回结果验证失败；不能报告生效'
                            : preflight.face_detector_task_state === 'throttled'
                              ? '限流或已有检测运行；本次未验证'
                              : '未运行、宿主 ACK 不完整或旧版 Server/Agent/模型不支持'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.sface_task_state === 'verified' ? 'success.main'
                          : preflight.sface_task_state === 'failed' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-sface-task-state>
                        SFace 固定合成向量：{preflight.sface_task_state === 'verified'
                          ? '已执行真实 SFace，128 维归一化特征有效（非人物样本，不代表真实人脸或身份识别正确）'
                          : preflight.sface_task_state === 'failed'
                            ? 'SFace 执行或特征校验失败；YuNet 结果仍独立有效'
                            : preflight.sface_task_state === 'throttled'
                              ? '检测频率受限或已有检测运行中；本次未验证'
                              : '未运行、可信宿主条件不足或旧版模型／Server／Agent 不支持'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.creative_cutout_task_state === 'verified' ? 'success.main'
                          : preflight.creative_cutout_task_state === 'failed' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-creative-cutout-task-state>
                        创作模型固定抠图：{preflight.creative_cutout_task_state === 'verified'
                          ? '真实 EfficientSAM 已执行固定合成图抠图并校验 PNG（不代表真实照片抠图质量、擦除、影片或拼图任务成功）'
                          : preflight.creative_cutout_task_state === 'failed'
                            ? '固定模型抠图或输出校验失败；不能报告创作生效'
                            : preflight.creative_cutout_task_state === 'throttled'
                              ? '检测冷却中或其他检测正在运行；本次未验证'
                              : '未运行、可信宿主条件不足或旧版模型／Server／Agent 不支持'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.smart_model_task_state === 'verified' ? 'success.main'
                          : preflight.smart_model_task_state === 'failed' ? 'error.main' : 'text.secondary'}
                        data-xdrive-photo-smart-model-task-state>
                        视觉分类／OCR 三模型执行：{preflight.smart_model_task_state === 'verified'
                          ? 'MobileNet、PP-OCR 检测与 CRNN 均完成固定合成输入推理（不代表文字识别正确率或真实图库任务成功）'
                          : preflight.smart_model_task_state === 'failed'
                            ? '模型推理或执行证据验证失败，不能报告生效'
                            : preflight.smart_model_task_state === 'throttled'
                              ? '检测频率受限或已有检测执行中；本次未验证'
                              : '未执行、宿主 ACK 不完整或旧版 Server/Agent/模型不支持'}
                      </Typography>
                      <Typography variant="body2"
                        color={preflight.smart_ocr_fixture_state === 'verified' ? 'success.main'
                          : preflight.smart_ocr_fixture_state === 'mismatch' ? 'warning.main' : 'text.secondary'}
                        data-xdrive-photo-smart-ocr-fixture-state>
                        CRNN 固定字符识别：{preflight.smart_ocr_fixture_state === 'verified'
                          ? '已精确匹配模型内部固定字形（仅该样本，不代表真实图库 OCR 准确率）'
                          : preflight.smart_ocr_fixture_state === 'mismatch'
                            ? '真实推理执行成功，但固定字符不匹配；不能判定 OCR 识别正确'
                            : preflight.smart_ocr_fixture_state === 'throttled'
                              ? '检测频率受限或其他检测正在执行；本次未验证'
                              : '未验证、可信宿主前置条件不足或旧版模型／Server／Agent 不支持'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" data-xdrive-photo-request-generation-correlated>
                        已审计启用请求与当前模型代际：{preflight.request_generation_correlated
                          ? '宿主启用回执时的模型代际仍一致（仅本宿主的时点交叉核验）'
                          : '未核验、版本过旧或运行进程已变化；不能判定同次启用仍有效'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" data-xdrive-photo-socket-owner-proof>
                        固定容器监听 Socket 归属：{preflight.socket_owner_verified
                          ? 'Docker 主进程持有固定监听 Socket（宿主内核只读证据；仅本实例）'
                          : '未核验或不一致（旧版/无权限宿主也可能不支持）；不代表生效'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" data-xdrive-photo-docker-healthcheck-correspondence>
                        固定容器 Docker 健康检查摘要：{preflight.docker_healthcheck_matched
                          ? '与四类 Info 进程代际一致（只读交叉核验）'
                          : '未核验或不一致；仍不可认定模型部署已生效'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" data-xdrive-photo-model-instance-coherent>
                        四类 Info 进程代际一致性：{preflight.model_instance_coherent
                          ? '同一模型进程（仅自报，尚未与可信宿主绑定）'
                          : '未核验或不一致（旧版模型也可能不支持）'}
                      </Typography>
                      <Typography variant="subtitle2" sx={{ mt: 1 }}>
                        四类模型 Info 实际就绪（仅当前 Server）
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {preflight.host_revision_verified
                          ? '宿主请求令牌及修订号已核验；下列 Info 是独立证据，尚非同源部署证明或成功的图片分析任务。'
                          : '宿主目标修订尚未取得可信回执；本次没有运行模型 Info，也不会显示绿色生效。'}
                      </Typography>
                      {preflight.model_info_checks ? preflight.model_info_checks.map((probe) => (
                        <Typography key={probe.id} variant="body2" color={probe.state === 'ready' ? 'success.main'
                          : probe.state === 'failed' ? 'error.main' : 'text.secondary'}>
                          {probe.id === 'photo-face' ? '人脸／人物' : probe.id === 'photo-smart' ? '视觉／OCR'
                            : probe.id === 'photo-semantic' ? '语义搜索' : '照片创作'}
                          {' · '}{probe.state === 'ready' ? 'Info 检测通过'
                            : probe.state === 'failed' ? 'Info 检测失败'
                              : probe.state === 'unconfigured' ? '未配置' : '未核验'}
                          {' · '}{probe.detail}
                        </Typography>
                      )) : <Typography variant="caption" color="text.secondary">
                        当前 Server/Agent 尚未报告独立模型 Info 检测能力。
                      </Typography>}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      预检时间：{preflight.checked_at}（临时结果；需手动重查）
                    </Typography>
                  </Stack>
                )}
              </Stack>
            )}
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
                <Box>
                  <Button variant="outlined" size="small"
                    disabled={dirty || !config.apply_supported || !config.desired_enabled ||
                      config.revision <= 0 || busy || !source.applyPhotoHost}
                    onClick={() => setConfirmApply(true)}>
                    安全启用共享宿主（仅启用）
                  </Button>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  仅经后台审计与全局互斥后提交固定 photo-face 启用请求；不会停止当前分析任务。
                  不支持从此页面停用、重启或操作其他容器。实际回执与模型健康必须再次核验。
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
        <XDriveConfirmDialog open={confirmApply} loading={busy}
          title="经审计安全启用照片智能分析共享宿主？"
          description="仅对保存的正向启用修订提交一次固定容器请求。服务端必须完成管理员审计、跨实例互斥和可信宿主检查；不会停止或重建已经运行的模型。提交不是生效证明，停用和重启仍不可用。"
          confirmLabel="确认安全启用请求" onCancel={() => setConfirmApply(false)}
          onConfirm={() => { void applyHost() }} />
        <XDriveConfirmDialog open={confirmRollback} loading={busy}
          title="创建共享宿主的新回滚修订？"
          description="历史回滚只创建新的期望状态，不会向 Host Manager 下发宿主机操作。"
          confirmLabel="仅回滚期望状态" onCancel={() => setConfirmRollback(false)}
          onConfirm={() => { void rollback() }} />
      </Stack>
    </Paper>
  )
}
