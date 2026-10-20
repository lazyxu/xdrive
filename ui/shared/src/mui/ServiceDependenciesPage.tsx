import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import MovieRoundedIcon from '@mui/icons-material/MovieRounded'
import FaceRoundedIcon from '@mui/icons-material/FaceRounded'
import ImageSearchRoundedIcon from '@mui/icons-material/ImageSearchRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'
import { alpha } from '@mui/material/styles'
import { XDRIVE_SYSTEM_DEPENDENCY_IDS, xDriveNormalizeSystemDependenciesLocation, xDriveSystemDependenciesLocationKey, xDriveVisibleSystemDependencies, xDriveSystemDependencySelectionMissing, xDriveSystemDependenciesOverviewEntries } from '../system-dependencies-navigation'
import { xDriveSystemDependenciesOverviewCoverage, xDriveSystemDependencyOverviewSignals, xDriveDashboardAssessment, xDriveDashboardCounts, xDriveDashboardMatches } from '../system-dependencies-overview'
import type { XDriveDashboardFilter, XDriveDashboardState } from '../system-dependencies-overview'
import { XDRIVE_SYSTEM_DEPENDENCY_CAPABILITIES, xDriveSystemDependencyAvailableTargets } from '../system-dependencies-capabilities'
import type { XDriveSystemDependenciesLocation, XDriveSystemDependencyTab, XDriveSystemDependencyID } from '../system-dependencies-navigation'
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import type {
  XDriveBaiduMapAdminConfig,
  XDriveBaiduMapAdminUpdate,
  XDriveBaiduMapAKReveal,
  XDriveBaiduMapVerification,
  XDrivePhotoAutoConfig,
  XDrivePhotoAutoKinds,
  XDrivePhotoAutoUpdate,
  XDrivePhotoAutoRevision,
  XDrivePhotoAutoRevisionPage,
  XDrivePhotoAutoRollbackInput,
  XDriveGeoNamesConfig,
  XDriveGeoNamesReloadResult,
  XDriveGeoNamesUpdate,
  XDriveGeoNamesRevision,
  XDriveGeoNamesRevisionPage,
  XDriveGeoNamesRollbackInput,
  XDriveGeoNamesSnapshotInput,
  XDriveGeoNamesSnapshotResult,
  XDriveGeoNamesDatasetApplyInput,
  XDriveGeoNamesRestoreMissingInput,
  XDriveServiceDependenciesSnapshot,
  XDriveServiceDependency,
  XDriveServiceDependencyGroup,
  XDriveServiceDependencyState,
  XDriveServiceConfigMode,
  XDriveServiceApplyMode,
} from '../service-dependencies'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStoredCredentialField } from './SourceCredentialFields'
import { XDriveBaiduJSAPIDesiredPanel } from './BaiduJSAPIDesiredPanel'
import { XDriveSourceWorkerConfigPanel } from './SourceWorkerConfigPanel'
import { XDrivePostgresPoolConfigPanel, type XDrivePostgresPoolPort } from './PostgresPoolConfigPanel'
import { XDriveMediaWorkerConfigPanel, type XDriveMediaWorkerPort } from './MediaWorkerConfigPanel'
import { XDrivePhotoHostDesiredPanel, type XDrivePhotoHostPort } from './PhotoHostDesiredPanel'
import { XDriveCaddyHTTPSDesiredPanel, type XDriveCaddyHTTPSPort } from './CaddyHTTPSDesiredPanel'
import { XDriveCaddyAliDNSPanel, type XDriveCaddyAliDNSPort } from './CaddyAliDNSPanel'
import { XDriveCaddyPreflightPanel, type XDriveCaddyPreflightPort } from './CaddyPreflightPanel'
import { XDriveCaddyDetailV1 } from './CaddyDetailV1'

export type XDriveServiceDependenciesPort = XDrivePostgresPoolPort & XDriveMediaWorkerPort & XDrivePhotoHostPort & XDriveCaddyHTTPSPort & XDriveCaddyAliDNSPort & XDriveCaddyPreflightPort & {
  load: () => Promise<XDriveServiceDependenciesSnapshot>
  loadSourceWorkerConfig?: () => Promise<import('../service-dependencies').XDriveSourceWorkerConfig>
  saveSourceWorkerConfig?: (input: import('../service-dependencies').XDriveSourceWorkerUpdate) => Promise<import('../service-dependencies').XDriveSourceWorkerConfig>
  loadSourceWorkerRevisions?: () => Promise<import('../service-dependencies').XDriveSourceWorkerRevisionPage>
  rollbackSourceWorker?: (input: import('../service-dependencies').XDriveSourceWorkerRollbackInput) => Promise<import('../service-dependencies').XDriveSourceWorkerConfig>
  loadBaiduMapConfig?: () => Promise<XDriveBaiduMapAdminConfig>
  saveBaiduMapConfig?: (input: XDriveBaiduMapAdminUpdate) => Promise<XDriveBaiduMapAdminConfig>
  revealBaiduMapAK?: (revision: number) => Promise<XDriveBaiduMapAKReveal>
  verifyBaiduMap?: (revision: number) => Promise<XDriveBaiduMapVerification>
  loadBaiduJSAPIConfig?: () => Promise<import('../service-dependencies').XDriveBaiduJSAPIConfig>
  saveBaiduJSAPIConfig?: (input: import('../service-dependencies').XDriveBaiduJSAPIUpdate) => Promise<import('../service-dependencies').XDriveBaiduJSAPIConfig>
  verifyBaiduJSAPI4Loader?: (revision: number) => Promise<import('../service-dependencies').XDriveBaiduJSAPI4LoaderProbe>
  loadPhotoAutoConfig?: () => Promise<XDrivePhotoAutoConfig>
  savePhotoAutoConfig?: (input: XDrivePhotoAutoUpdate) => Promise<XDrivePhotoAutoConfig>
  loadPhotoAutoRevisions?: () => Promise<XDrivePhotoAutoRevisionPage>
  rollbackPhotoAuto?: (input: XDrivePhotoAutoRollbackInput) => Promise<XDrivePhotoAutoConfig>
  loadGeoNamesConfig?: () => Promise<XDriveGeoNamesConfig>
  saveGeoNamesConfig?: (input: XDriveGeoNamesUpdate) => Promise<XDriveGeoNamesConfig>
  reloadGeoNames?: (expectedVersion: string) => Promise<XDriveGeoNamesReloadResult>
  stageGeoNamesSnapshot?: (input: XDriveGeoNamesSnapshotInput) => Promise<XDriveGeoNamesSnapshotResult>
  applyGeoNamesDataset?: (input: XDriveGeoNamesDatasetApplyInput) => Promise<XDriveGeoNamesConfig>
  restoreMissingGeoNamesSnapshot?: (input: XDriveGeoNamesRestoreMissingInput) => Promise<XDriveGeoNamesConfig>
  loadGeoNamesRevisions?: () => Promise<XDriveGeoNamesRevisionPage>
  rollbackGeoNames?: (input: XDriveGeoNamesRollbackInput) => Promise<XDriveGeoNamesConfig>
}

const defaultPhotoAutoKinds: XDrivePhotoAutoKinds = {
  face: true, smart: true, semantic: true, person_cluster: true,
}

// These correspond to existing Server task groups. Visual/OCR is one shared
// scheduler kind and must not be represented as separately controllable jobs.
const photoAutoKindChoices = [
  { key: 'face', title: '人脸检测与特征', description: '仅限制后续自动人脸处理' },
  { key: 'smart', title: '视觉识别 / OCR', description: '动物、物体识别与 OCR 共用当前自动任务队列' },
  { key: 'semantic', title: '语义向量与搜索索引', description: '仅限制后续自动语义分析' },
  { key: 'person_cluster', title: '人物聚类', description: '仅限制后续自动人物整理' },
] as const

function photoAutoKindSummary(kinds: XDrivePhotoAutoKinds): string {
  return photoAutoKindChoices.map((kind) => `${kind.title}：${kinds[kind.key] ? '开启' : '暂停'}`).join('、')
}

const groups: Array<{ id: XDriveServiceDependencyGroup; label: string; description: string }> = [
  { id: 'core', label: '基础服务', description: '数据库、文件存储、后台 Worker 与 HTTPS 网关的就绪及运行证据。' },
  { id: 'media', label: '媒体处理', description: 'FFmpeg/FFprobe 运行时可独立探测；媒体作业协议仍未集成。' },
  { id: 'intelligence', label: '照片智能分析', description: '共享 Photo Intelligence 容器；分别探测已配置的分析能力。' },
  { id: 'location', label: '地理位置与地图', description: 'GeoNames 只提供可选地名标签；百度地图是唯一地图 Provider。' },
]

const dependencyTabLabels: Record<XDriveSystemDependencyTab, string> = {
  status: '当前状态', config: '配置与修改',
  verify: '检测与生效证据', history: '配置历史与回滚',
}

function dependencyTabsFor(service: string): XDriveSystemDependencyTab[] {
  switch (service) {
    case 'storage': return ['status', 'verify']
    case 'photo-face': return ['status', 'config', 'verify', 'history']
    case 'photo-smart':
    case 'photo-semantic':
    case 'photo-creative': return ['status', 'verify']
    case 'baidu-map': return ['status', 'config', 'verify']
    case 'photo-auto': return ['status', 'config', 'history']
    default: return ['status', 'config', 'verify', 'history']
  }
}

function expandDependencySection(
  previous: Record<string, boolean>, service: string, tab?: XDriveSystemDependencyTab,
): Record<string, boolean> {
  if (!tab) return previous
  return {
    ...previous,
    [`${service}:${tab === 'verify' ? 'status' : tab}`]: true,
    ...(tab === 'verify' ? { [`${service}:verify`]: true } : {}),
  }
}

const statusLabels: Record<XDriveServiceDependencyState, { label: string; color: 'success' | 'error' | 'warning' | 'default' }> = {
  ready: { label: '可用', color: 'success' },
  unavailable: { label: '不可用', color: 'error' },
  disabled: { label: '未启用', color: 'default' },
  unknown: { label: '无法检测', color: 'warning' },
  planned: { label: '尚未接入', color: 'default' },
}

const configurationStateLabels = {
  configured: '当前 Server 已配置',
  unconfigured: '当前 Server 未配置',
  unknown: '配置未知',
} as const
const installationStateLabels = {
  observed: '实际运行时已观测',
  external: '外部服务（不检查本机安装）',
  unknown: '安装/部署未确认',
} as const
const healthStateLabels = {
  ready: '独立健康检查通过',
  failed: '实际健康检查失败',
  'not-checked': '未进行健康检测',
  unknown: '健康无法确认',
} as const
const activationStateLabels = {
  verified: '当前实例目标修订已核验（不代表全集群）',
  'local-effective': '本机配置即时读取（远端另验）',
  pending: '目标待生效或待验证',
  'deployment-only': '仅受控部署管理',
  unknown: '无法确认目标修订生效',
} as const

// Automatic task admission is separate from analyzer container deployment,
// model health and actual successful processing.
const automaticPolicyLabels = {
  enabled: '当前实例已按目标修订允许自动任务',
  paused: '当前实例已按目标修订暂停自动任务',
  partial: '人脸检测与人物聚类的自动任务策略不同（详见下方分项开关）',
  pending: '目标修订尚未在当前实例确认生效',
  unmanaged: '使用默认策略，尚无管理员保存的修订',
  unknown: '无法验证任务策略（旧版服务或配置不可读取）',
  'not-applicable': '不适用：照片创作当前不受自动分析调度开关控制',
} as const

const photoHostStateLabels = {
  healthy: '固定容器 Docker 健康检查通过',
  unhealthy: '固定容器 Docker 健康检查失败',
  starting: '固定容器正在启动',
  'running-unverified': '固定容器在运行，但没有可信健康结果',
  stopped: '固定容器已停止',
  unknown: '容器状态不可确认',
} as const

const configModeLabels: Record<XDriveServiceConfigMode | 'unknown', string> = {
  'in-app': '应用内可配置（能否启停以详情页为准）',
  deployment: '模型／资源由受控部署管理（具体能力见详情）',
  planned: '暂未提供应用内配置',
  unknown: '配置能力未知（请核对 Server/Agent 版本）',
}

const applyModeLabels: Record<XDriveServiceApplyMode, string> = {
  immediate: '保存后立即生效',
  'task-boundary': '运行批次完成后安全生效',
  'manual-reload': '管理员校验后手动热加载',
  'controlled-restart': '需受控宿主处理（具体支持范围见详情）',
  'not-available': '尚无安全配置执行接口',
}

const caddyHostWitnessHints: Record<NonNullable<XDriveServiceDependency['caddy_host_witness_reason']>, string> = {
  'control-not-configured': '运行中 Server 没有配置可信 Host Control 目录；核对版本和只读挂载。',
  'heartbeat-missing': '宿主心跳在 Server 视角缺失；核对 Host Control 采样器和 /host-control 挂载。',
  'heartbeat-unreadable': 'Server 无法读取心跳元数据；核对运行用户、目录权限及 UID/GID/ACL。',
  'heartbeat-invalid': '心跳不是可信普通文件；不能据此推断容器或 TLS 状态。',
  'heartbeat-stale': '宿主心跳过期或时钟异常；检查 Host Control Runner 是否持续采样。',
  'snapshot-missing': 'Caddy 快照在 Server 视角缺失；检查只读观察器是否生成快照，再核对挂载与 UID/GID/ACL。',
  'snapshot-unreadable': 'Server 无法读取快照元数据；检查 /host-control 绑定挂载及权限。',
  'snapshot-invalid': 'Caddy 快照不是可信普通文件；不能采信运行状态。',
  'snapshot-stale': 'Caddy 快照过期或时钟异常；检查观察器采样周期和实际 Server 版本。',
  'snapshot-invalid-or-changing': '快照不符合可信格式，或采样期间发生变化；检查采样器与宿主/Server 版本。',
}

function ServiceRow({ service }: { service: XDriveServiceDependency }) {
  const [showLifecycleEvidence, setShowLifecycleEvidence] = useState(false)
  // Baidu's static-map health is manual/quota-consuming. An unrun probe is
  // NOT a broken detection capability, and saved credentials are not proof.
  const state = service.id === 'baidu-map' && service.status === 'unknown' &&
    service.health_state === 'not-checked'
    ? { label: '待人工在线验证', color: 'warning' as const }
    : statusLabels[service.status] ?? statusLabels.unknown
  const evidenceDetails = [
    service.id === 'caddy' && service.configuration_state === 'configured' && service.installation_state !== 'observed'
      ? 'Server 已声明 HTTPS 入口（宿主运行另验）'
      : configurationStateLabels[service.configuration_state ?? 'unknown'] ?? '配置未知',
    installationStateLabels[service.installation_state ?? 'unknown'] ?? '部署未确认',
    healthStateLabels[service.health_state ?? 'unknown'] ?? '健康无法确认',
    service.id === 'caddy' && service.activation_state === 'deployment-only'
      ? (service.installation_state === 'observed'
        ? '已观测到宿主网关；应用内目标修订仍须单独验证，不代表自动应用'
        : '当前缺少可信网关观测；不能因此判定原有 Caddy 未部署')
      : service.id === 'background-worker' && service.activation_state === 'verified'
        ? '已观测的在线 Pull Worker 均确认目标修订（不代表全部部署实例）'
        : activationStateLabels[service.activation_state ?? 'unknown'] ?? '生效未确认',
  ]
  return (
    <Box
      data-xdrive-service-id={service.id}
      sx={{ px: { xs: 1.5, sm: 2 }, py: 1.75, '& + &': { borderTop: 1, borderColor: 'divider' } }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" spacing={1}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {/* The selected service title belongs to the detail page header, never twice. */}
          {service.id !== 'baidu-map' && (
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {service.detail}
            </Typography>
          )}
          {service.id === 'caddy' && service.caddy_internal_http_state && (
            <Typography variant="caption" color="text.secondary" data-xdrive-caddy-internal-http-evidence
              sx={{ mt: 0.5, display: 'block', overflowWrap: 'anywhere' }}>
              {service.caddy_internal_http_state === 'reachable'
                ? '内部 HTTP 转发通路已响应；不代表 Docker、HTTPS/TLS、公网或期望修订已生效。'
                : '内部 HTTP 转发未得到可信成功响应；不代表原有 Caddy 已停止或未部署。'}
            </Typography>
          )}
          {service.id === 'caddy' && service.caddy_local_domain_https_state && (
            <Typography variant="caption" color="text.secondary" data-xdrive-caddy-domain-https-evidence
              sx={{ mt: 0.5, display: 'block', overflowWrap: 'anywhere' }}>
              {service.caddy_local_domain_https_state === 'verified'
                ? '独立 HTTPS 证据：Server 经固定内部 Caddy:443 通道，使用系统可信公有 CA 验证域名证书及 Ready 响应成功；仍需独立确认 Caddy 容器身份、私网 IP HTTPS、公网访问和配置修订是否生效。'
                : '独立域名 HTTPS 检查未取得可信结果；可能是网络、证书或旧部署配置差异，不代表原网关已停止。'}
            </Typography>
          )}
          {service.id === 'caddy' && service.installation_state !== 'observed' && (
            <Typography variant="caption" color="text.secondary" data-xdrive-caddy-host-witness-help
              sx={{ mt: 0.5, display: 'block', overflowWrap: 'anywhere' }}>
              {service.caddy_host_witness_reason ? (
                <span data-xdrive-caddy-host-witness-reason>
                  观测受阻（{service.caddy_host_witness_reason}）：{caddyHostWitnessHints[service.caddy_host_witness_reason]}
                </span>
              ) : '当前 Server/Agent 未返回细分观测原因；先核对实际运行版本。'}
              {' '}如果原 Caddy 已能正常访问，请在实际宿主机执行 xdrive-server doctor，
              核对运行中 Server 版本、/host-control 挂载、UID/GID 或 ACL 与采样文件；无需重装或重启 Caddy。
            </Typography>
          )}
          {showLifecycleEvidence && service.id === 'baidu-map' && service.health_state === 'not-checked' && (
            <Typography variant="caption" color="text.secondary"
              data-xdrive-baidu-static-unverified-hint
              sx={{ mt: 0.5, display: 'block', overflowWrap: 'anywhere' }}>
              静态地图在线检测尚未执行（需人工触发并消耗 API 配额），与 JSAPI 4.0 发布授权独立。
            </Typography>
          )}
          {showLifecycleEvidence && (service.version || service.model) && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', overflowWrap: 'anywhere' }}>
              {service.version ? '版本：' + service.version : ''}
              {service.version && service.model ? ' · ' : ''}
              {service.model ? '模型：' + service.model : ''}
            </Typography>
          )}
          {service.id === 'caddy' && typeof service.https_configured === 'boolean' && (
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Chip size="small" variant="outlined"
                label={service.https_configured ? 'HTTPS 已配置' : 'HTTP 模式'} />
              {service.https_configured && (
                <Chip size="small" variant="outlined"
                  color={service.local_tls_state === 'verified' ? 'success' :
                    service.local_tls_state === 'failed' || service.local_tls_state === 'invalid-config'
                      ? 'error' : 'warning'}
                  label={
                    service.local_tls_state === 'verified' ? '本机 TLS 证书已验证' :
                    service.local_tls_state === 'failed' ? '本机 TLS 验证失败' :
                    service.local_tls_state === 'invalid-config' ? 'HTTPS 配置不合法' :
                    '尚无可信 TLS 验证'
                  }
                />
              )}
              <Typography variant="caption" color="text.secondary">
                公网 HTTPS 可达性仍需独立验证
              </Typography>
            </Stack>
          )}
          <Box data-xdrive-service-lifecycle aria-label="配置、部署、健康、生效独立证据" sx={{
            mt: 1.25, display: 'grid', gap: 0.75,
            gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))',
              lg: 'repeat(4, minmax(0,1fr))' },
          }}>
            {xDriveSystemDependencyOverviewSignals(service).map((axis, index) => (
              <Box key={axis.label} sx={{ p: 1, minWidth: 0, border: 1,
                borderColor: 'divider', borderRadius: 1.5 }}>
                <Typography variant="caption" color="text.secondary">{axis.label}</Typography>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 0.25,
                  color: axis.tone === 'positive' ? 'success.main'
                    : axis.tone === 'negative' ? 'error.main'
                      : axis.tone === 'attention' ? 'warning.main' : 'text.primary' }}>
                  {axis.value}
                </Typography>
                {showLifecycleEvidence && (
                  <Typography variant="caption" color="text.secondary"
                    sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>
                    {evidenceDetails[index]}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
          <Button size="small" variant="text" color="inherit" sx={{ mt: 0.25, px: 0.5 }}
            data-xdrive-service-evidence-toggle aria-expanded={showLifecycleEvidence}
            onClick={() => setShowLifecycleEvidence((visible) => !visible)}>
            {showLifecycleEvidence ? '收起状态依据' : '查看状态依据'}
          </Button>
          {service.group === 'intelligence' && (
            <Stack spacing={0.25} sx={{ mt: 1 }} data-xdrive-photo-host-observation>
              <Typography variant="caption" color="text.secondary">
                宿主容器：{photoHostStateLabels[service.photo_host_runtime_state ?? 'unknown']}
                {' · '}部署 Profile：{typeof service.photo_host_profile_configured === 'boolean'
                  ? service.photo_host_profile_configured ? '已配置启用意图' : '未配置启用意图'
                  : '未取得可信配置观测'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                共享宿主仅支持审计后的安全启用，停用／重启尚未开放；此处宿主状态不代表各模型 Info 健康、自动任务准入或实际分析作业完成。
              </Typography>
            </Stack>
          )}
          {service.group === 'intelligence' && (
            <Stack spacing={0.25} sx={{ mt: 1 }} data-xdrive-photo-auto-policy>
              <Typography variant="caption" color="text.secondary">
                自动任务准入：{automaticPolicyLabels[service.automatic_policy_state ?? 'unknown'] ?? automaticPolicyLabels.unknown}
                {typeof service.automatic_policy_desired_revision === 'number' &&
                  ` · 目标修订 #${service.automatic_policy_desired_revision}`}
                {typeof service.automatic_policy_effective_revision === 'number' &&
                  ` · 当前实例修订 #${service.automatic_policy_effective_revision}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                只影响自动任务的准入策略，不代表模型安装、健康检查或作业执行成功；手动操作另行授权。
              </Typography>
            </Stack>
          )}
          {/* Default view: one status summary and four independent lifecycle facts.
              Configuration boilerplate is evidence, not a second primary status. */}
          {showLifecycleEvidence && (
            <Box data-xdrive-service-extra-evidence sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary"
                data-xdrive-service-config-mode
                sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                配置方式：{configModeLabels[service.config_mode ?? 'unknown'] ?? configModeLabels.unknown}
              </Typography>
              {service.config_mode !== 'in-app' && (
                <Typography variant="caption" color="text.secondary"
                  sx={{ mt: 0.5, display: 'block', overflowWrap: 'anywhere' }}>
                  {service.group === 'intelligence'
                    ? '此模型没有独立启停；可在共享宿主详情保存期望、按预检安全启用，尚不能停用或重启。'
                    : service.config_mode === 'deployment'
                      ? '此项需受控部署管理，本页不会提供尚未实现的在线操作。'
                      : '当前没有经过后端验证的应用内配置或启停能力，本页不会显示无效操作。'}
                </Typography>
              )}
              {service.config_hint && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', overflowWrap: 'anywhere' }}>
                  {service.config_hint}
                </Typography>
              )}
              {service.apply_mode && (
                <Chip size="small" variant="outlined" sx={{ mt: 1 }}
                  label={applyModeLabels[service.apply_mode] ?? '配置生效模式待确认'} />
              )}
            </Box>
          )}
        </Box>
        <Chip size="small" color={state.color} variant="outlined" label={state.label} />
      </Stack>
    </Box>
  )
}

const serviceOverviewIcons: Record<string, ReactNode> = {
  database: <StorageRoundedIcon fontSize="small" />,
  storage: <FolderRoundedIcon fontSize="small" />,
  'background-worker': <SyncRoundedIcon fontSize="small" />,
  caddy: <ShieldRoundedIcon fontSize="small" />,
  'media-worker': <MovieRoundedIcon fontSize="small" />,
  'photo-face': <FaceRoundedIcon fontSize="small" />,
  'photo-smart': <ImageSearchRoundedIcon fontSize="small" />,
  'photo-semantic': <SearchRoundedIcon fontSize="small" />,
  'photo-creative': <AutoFixHighRoundedIcon fontSize="small" />,
  'baidu-map': <MapRoundedIcon fontSize="small" />,
  geonames: <PlaceRoundedIcon fontSize="small" />,
}

// Missing entries never synthesize health or grant configuration actions.
function UnreportedServiceOverviewCard({ id, label, onOpen }: {
  id: string; label: string; onOpen: () => void
}) {
  return (
    <Button variant="outlined" color="inherit" onClick={onOpen}
      aria-label={'查看' + label + '未报告详情（只读）'}
      data-xdrive-system-dependency-unreported-card={id}
      data-xdrive-system-dependency-overview-state="unknown"
      sx={(theme) => ({
        display: 'flex', minWidth: 0, width: '100%', minHeight: 138,
        flexDirection: 'column', alignItems: 'stretch', textAlign: 'left',
        justifyContent: 'flex-start', textTransform: 'none', px: 1.75, py: 1.5,
        gap: 1, borderRadius: 2, borderStyle: 'dashed',
        borderColor: alpha(theme.palette.info.main, 0.48),
        bgcolor: alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.12 : 0.055),
        '&:hover': { bgcolor: alpha(theme.palette.info.main, 0.18), borderColor: 'info.main' },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      })}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, width: '100%' }}>
        <HelpOutlineRoundedIcon fontSize="small" color="info" />
        <Typography variant="subtitle2" color="text.primary" fontWeight={700}
          sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>{label}</Typography>
        <Chip size="small" color="info" variant="outlined" label="未报告"
          sx={{ height: 24, flexShrink: 0 }} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        未获取可信状态，配置与运行情况均未知。
      </Typography>
      <Stack direction="row" alignItems="center" justifyContent="space-between"
        sx={{ width: '100%', mt: 'auto' }}>
        <Typography variant="caption" color="text.secondary">只读说明</Typography>
        <Typography variant="caption" fontWeight={700}>查看详情 ›</Typography>
      </Stack>
    </Button>
  )
}

function pageLocalNavSx(selected: boolean) {
  return {
    justifyContent: 'flex-start',
    textAlign: 'left',
    color: selected ? 'text.primary' : 'text.secondary',
    bgcolor: selected ? 'action.selected' : 'transparent',
    borderLeft: '3px solid',
    borderColor: selected ? 'primary.main' : 'transparent',
    borderRadius: 1.5,
    minHeight: 36,
    px: 1.25,
    py: 0.75,
    fontWeight: selected ? 700 : 500,
    fontSize: '0.8125rem',
    lineHeight: 1.35,
    textTransform: 'none',
    whiteSpace: 'normal',
    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
  } as const
}

// One display state per card, never a claim that saved deployment was applied.
function ServiceOverviewCard({ service, onOpen }: {
  service: XDriveServiceDependency; onOpen: () => void
}) {
  const assessment = xDriveDashboardAssessment(service)
  const chipColors: Record<XDriveDashboardState, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
    healthy: 'success', failed: 'error', attention: 'warning',
    disabled: 'default', unknown: 'info',
  }
  return (
    <Button variant="outlined" color="inherit" onClick={onOpen}
      aria-label={'查看' + service.label + '详情，主状态：' + assessment.label + '；四维证据请查看详情'}
      data-xdrive-system-dependency-overview-card={service.id}
      data-xdrive-system-dependency-overview-state={assessment.state}
      title={configModeLabels[service.config_mode ?? 'unknown'] ?? configModeLabels.unknown}
      sx={(theme) => {
        const accent = assessment.state === 'healthy' ? theme.palette.success.main
          : assessment.state === 'failed' ? theme.palette.error.main
            : assessment.state === 'attention' ? theme.palette.warning.main
              : assessment.state === 'unknown' ? theme.palette.info.main
                : theme.palette.text.secondary
        return {
          display: 'flex', minWidth: 0, width: '100%', minHeight: 138,
          flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start',
          px: 1.75, py: 1.5, gap: 1, borderRadius: 2, textTransform: 'none',
          textAlign: 'left', border: '1px solid',
          borderColor: alpha(accent, theme.palette.mode === 'dark' ? 0.58 : 0.48),
          bgcolor: alpha(accent, theme.palette.mode === 'dark' ? 0.15 : 0.07),
          '&:hover': { borderColor: accent, bgcolor: alpha(accent, theme.palette.mode === 'dark' ? 0.22 : 0.12) },
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        }
      }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, width: '100%' }}>
        <Box sx={{ flexShrink: 0, display: 'grid', placeItems: 'center',
          color: assessment.state === 'healthy' ? 'success.main'
            : assessment.state === 'failed' ? 'error.main'
              : assessment.state === 'attention' ? 'warning.main'
                : assessment.state === 'unknown' ? 'info.main' : 'text.secondary' }}>
          {serviceOverviewIcons[service.id]}
        </Box>
        <Typography variant="subtitle2" color="text.primary" fontWeight={700}
          sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>{service.label}</Typography>
        <Chip size="small" variant="outlined" label={assessment.label}
          color={chipColors[assessment.state]} sx={{ height: 24, flexShrink: 0, fontWeight: 700 }} />
      </Stack>
      <Typography variant="body2" color="text.secondary" title={service.detail}
        sx={{ width: '100%', overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>
        {service.detail}
      </Typography>
      <Stack direction="row" alignItems="center" justifyContent="space-between"
        sx={{ width: '100%', mt: 'auto', pt: 0.5, gap: 1 }}>
        <Typography variant="caption" color="text.secondary" title={assessment.summary}
          sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {assessment.summary}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={0.25}
          sx={{ color: 'primary.main', flexShrink: 0 }}>
          <Typography variant="caption" fontWeight={700}>详情</Typography>
          <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />
        </Stack>
      </Stack>
    </Button>
  )
}

/** Administrator-only status and encrypted Baidu AK management. No Docker control socket. */
export function XDriveServiceDependenciesPage({
  source, location, onLocationChange, onUnsavedChange, navigationResetKey = 0,
}: {
  source: XDriveServiceDependenciesPort
  location?: XDriveSystemDependenciesLocation
  onLocationChange?: (next: XDriveSystemDependenciesLocation, options?: { replace?: boolean }) => void
  onUnsavedChange?: (hasUnsavedEdits: boolean) => void
  navigationResetKey?: number
}) {
  const [showCapabilityMatrix, setShowCapabilityMatrix] = useState(false)
  const [overviewFilter, setOverviewFilter] = useState<XDriveDashboardFilter>('all')
  // One shared detail page per service. Sections, not separate routes, own their expansion.
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [visibleLocation, setVisibleLocation] = useState<XDriveSystemDependenciesLocation>(
    () => xDriveNormalizeSystemDependenciesLocation(location),
  )
  const selectedPage = visibleLocation.policy === 'photo-auto' ? 'photo-auto' : visibleLocation.service ?? 'overview'
  const selectedTabs = dependencyTabsFor(selectedPage)
  const showVerify = selectedTabs.includes('verify') &&
    (expandedSections[`${selectedPage}:verify`] ?? (selectedPage === 'caddy' || visibleLocation.tab === 'verify'))
  const currentTab = selectedTabs.includes(visibleLocation.tab ?? 'status')
    ? visibleLocation.tab ?? 'status' : 'status'
  const historyKey = `${selectedPage}:history`
  const historyExpanded = selectedTabs.includes('history') && (expandedSections[historyKey] ?? (currentTab === 'history'))
  const [pendingNavigation, setPendingNavigation] = useState<{
    next: XDriveSystemDependenciesLocation
    external: boolean
  } | null>(null)
  const [childDirty, setChildDirty] = useState(false)
  const [caddyHTTPSDirty, setCaddyHTTPSDirty] = useState(false)
  const [caddyAliDirty, setCaddyAliDirty] = useState(false)
  const [baiduJSAPIDirty, setBaiduJSAPIDirty] = useState(false)
  const unsavedRef = useRef(false)
  const resetKeyRef = useRef(navigationResetKey)
  const externalLocationKey = xDriveSystemDependenciesLocationKey(location ?? {})
  const [snapshotState, setSnapshot] = useState<XDriveServiceDependenciesSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // Keep a successfully loaded inventory mounted during status-only refresh.
  // Only an actual server/account source change may discard the old snapshot.
  const snapshotSourceRef = useRef<XDriveServiceDependenciesPort | null>(null)
  const cachedSnapshotRef = useRef<XDriveServiceDependenciesSnapshot | null>(null)
  // Fence the read during render: a changed Server/Owner cannot paint a
  // previous account's saved health snapshot even before effects run.
  const snapshot = snapshotSourceRef.current === source ? snapshotState : null
  const [error, setError] = useState('')
  const visibleError = snapshotSourceRef.current === source ? error : ''
  const [refreshID, setRefreshID] = useState(0)
  // Local HTTPS/AliDNS edits invalidate sibling preflight and read-auth proof
  // without resetting the editing panel's saved acknowledgement or draft.
  const [caddyEvidenceRevision, setCaddyEvidenceRevision] = useState(0)
  const invalidateCaddyEvidence = useCallback(() => setCaddyEvidenceRevision((value) => value + 1), [])
  const [baiduConfig, setBaiduConfig] = useState<XDriveBaiduMapAdminConfig | null>(null)
  const [baiduEnabled, setBaiduEnabled] = useState(false)
  const [baiduAK, setBaiduAK] = useState('')
  const [baiduError, setBaiduError] = useState('')
  const [baiduNotice, setBaiduNotice] = useState('')
  const [baiduBusy, setBaiduBusy] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [baiduReveal, setBaiduReveal] = useState<XDriveBaiduMapAKReveal | null>(null)
  const [revealingAK, setRevealingAK] = useState(false)
  const revealEpochRef = useRef(0)
  const baiduVerifyEpochRef = useRef(0)
  const [baiduVerification, setBaiduVerification] = useState<XDriveBaiduMapVerification | null>(null)
  const [baiduVerifyBusy, setBaiduVerifyBusy] = useState(false)
  const [baiduVerifyError, setBaiduVerifyError] = useState('')
  const geoNamesEpochRef = useRef(0)
  const [geoNamesConfig, setGeoNamesConfig] = useState<XDriveGeoNamesConfig | null>(null)
  const [geoNamesDraftDistance, setGeoNamesDraftDistance] = useState('')
  const [geoNamesBusy, setGeoNamesBusy] = useState(false)
  const [geoNamesError, setGeoNamesError] = useState('')
  const [geoNamesNotice, setGeoNamesNotice] = useState('')
  const [geoNamesRevisions, setGeoNamesRevisions] = useState<XDriveGeoNamesRevision[]>([])
  const [geoNamesHistoryError, setGeoNamesHistoryError] = useState('')
  const [geoNamesRollbackTarget, setGeoNamesRollbackTarget] = useState('')
  const [geoNamesRollbackConfirmOpen, setGeoNamesRollbackConfirmOpen] = useState(false)
  const [geoNamesSnapshotConfirmOpen, setGeoNamesSnapshotConfirmOpen] = useState(false)
  const [geoNamesDatasetTarget, setGeoNamesDatasetTarget] = useState('')
  const [geoNamesDatasetConfirmOpen, setGeoNamesDatasetConfirmOpen] = useState(false)
  const [geoNamesRestoreConfirmOpen, setGeoNamesRestoreConfirmOpen] = useState(false)
  const photoPolicyEpochRef = useRef(0)
  const photoHistoryEpochRef = useRef(0)
  const [photoPolicy, setPhotoPolicy] = useState<XDrivePhotoAutoConfig | null>(null)
  const [photoAutoDraft, setPhotoAutoDraft] = useState(true)
  const [photoKindsDraft, setPhotoKindsDraft] = useState<XDrivePhotoAutoKinds>(defaultPhotoAutoKinds)
  const [photoPolicyBusy, setPhotoPolicyBusy] = useState(false)
  const [photoPolicyError, setPhotoPolicyError] = useState('')
  const [photoPolicyNotice, setPhotoPolicyNotice] = useState('')
  const [photoRevisions, setPhotoRevisions] = useState<XDrivePhotoAutoRevision[]>([])
  const [photoHistoryError, setPhotoHistoryError] = useState('')
  const [photoRollbackTarget, setPhotoRollbackTarget] = useState('')
  const [photoRollbackConfirmOpen, setPhotoRollbackConfirmOpen] = useState(false)

  const dirtyBaidu = selectedPage === 'baidu-map' && !!baiduConfig &&
    (baiduEnabled !== baiduConfig.enabled || baiduAK.length > 0)
  const dirtyGeoNames = selectedPage === 'geonames' && !!geoNamesConfig &&
    geoNamesDraftDistance !== String(geoNamesConfig.max_distance_km)
  const dirtyPhoto = selectedPage === 'photo-auto' && !!photoPolicy &&
    (photoPolicy.auto_enabled !== photoAutoDraft ||
      (photoPolicy.kinds != null && photoAutoKindChoices.some(
        (kind) => photoPolicy.kinds![kind.key] !== photoKindsDraft[kind.key],
      )))
  const hasUnsavedEdits = Boolean(
    childDirty || caddyHTTPSDirty || caddyAliDirty || baiduJSAPIDirty ||
    dirtyBaidu || dirtyGeoNames || dirtyPhoto,
  )
  unsavedRef.current = hasUnsavedEdits
  useEffect(() => {
    onUnsavedChange?.(hasUnsavedEdits)
    return () => { onUnsavedChange?.(false) }
  }, [onUnsavedChange, hasUnsavedEdits])

  // The same guard handles internal links, browser back/forward and the
  // Desktop global Sidebar reset. Never silently discard an unsaved draft.
  const navigateTo = (nextInput: XDriveSystemDependenciesLocation) => {
    const next = xDriveNormalizeSystemDependenciesLocation(nextInput)
    if (xDriveSystemDependenciesLocationKey(next) ===
        xDriveSystemDependenciesLocationKey(visibleLocation)) {
      if (next.tab) {
        setExpandedSections((prior) => expandDependencySection(prior, selectedPage, next.tab))
        document.getElementById(`dependency-${selectedPage}-${next.tab}-header`)?.scrollIntoView({ block: 'start' })
      }
      return
    }
    // Legacy ?tab= links now select an in-page section. No editor is unmounted,
    // so moving within the same dependency must not discard or warn about drafts.
    if ((next.service && next.service === visibleLocation.service) ||
        (next.policy && next.policy === visibleLocation.policy)) {
      if (next.tab) setExpandedSections((prior) => expandDependencySection(prior, selectedPage, next.tab))
      setVisibleLocation(next)
      onLocationChange?.(next)
      return
    }
    if (unsavedRef.current) {
      setPendingNavigation({ next, external: false })
      return
    }
    setChildDirty(false)
    setCaddyHTTPSDirty(false)
    setCaddyAliDirty(false)
    setVisibleLocation(next)
    onLocationChange?.(next)
  }
  useEffect(() => {
    if (!onLocationChange) return
    const incoming = xDriveNormalizeSystemDependenciesLocation(location)
    if (xDriveSystemDependenciesLocationKey(incoming) ===
        xDriveSystemDependenciesLocationKey(visibleLocation)) return
    if (((incoming.service && incoming.service === visibleLocation.service) ||
         (incoming.policy && incoming.policy === visibleLocation.policy))) {
      if (incoming.tab) setExpandedSections((prior) =>
        expandDependencySection(prior, selectedPage, incoming.tab))
      setVisibleLocation(incoming)
    } else if (unsavedRef.current) setPendingNavigation({ next: incoming, external: true })
    else {
      setChildDirty(false)
      setCaddyHTTPSDirty(false)
      setCaddyAliDirty(false)
      setVisibleLocation(incoming)
    }
  // External location is the trigger, not local form keystrokes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalLocationKey])
  useEffect(() => {
    if (resetKeyRef.current === navigationResetKey) return
    resetKeyRef.current = navigationResetKey
    if (xDriveSystemDependenciesLocationKey(visibleLocation) === 'overview') return
    if (unsavedRef.current) setPendingNavigation({ next: {}, external: false })
    else {
      setChildDirty(false)
      setCaddyHTTPSDirty(false)
      setCaddyAliDirty(false)
      setVisibleLocation({})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationResetKey])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!unsavedRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  useEffect(() => {
    // Existing deep links remain section anchors instead of navigation to
    // separate pages. Only navigation/loading changes scroll the viewport.
    if (loading || cachedSnapshotRef.current === null || selectedPage === 'overview' ||
        currentTab === 'status' || (currentTab === 'verify' && !showVerify)) return
    document.getElementById(`dependency-${selectedPage}-${currentTab}-header`)
      ?.scrollIntoView({ block: 'start' })
  }, [selectedPage, currentTab, loading, showVerify])

  const hideBaiduAK = useCallback(() => {
    ++revealEpochRef.current
    setBaiduReveal(null)
    setRevealingAK(false)
  }, [])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'visible') hideBaiduAK()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', hideBaiduAK)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', hideBaiduAK)
    }
  }, [hideBaiduAK])

  // The reveal TTL must be owned by the persistent page, not only the
  // credential child: collapsing a section unmounts that child's timer.
  useEffect(() => {
    if (!baiduReveal) return
    const seconds = Number.isFinite(baiduReveal.expires_in_seconds)
      ? Math.min(30, Math.max(1, baiduReveal.expires_in_seconds)) : 1
    const timer = window.setTimeout(hideBaiduAK, seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [baiduReveal, hideBaiduAK])

  useEffect(() => {
    let active = true
    ++revealEpochRef.current
    ++baiduVerifyEpochRef.current
    setBaiduVerification(null)
    setBaiduVerifyBusy(false)
    setBaiduVerifyError('')
    ++geoNamesEpochRef.current
    ++photoPolicyEpochRef.current
    ++photoHistoryEpochRef.current
    setPhotoPolicy(null)
    setPhotoAutoDraft(true)
    setPhotoKindsDraft(defaultPhotoAutoKinds)
    setPhotoPolicyBusy(false)
    setPhotoPolicyError('')
    setPhotoPolicyNotice('')
    setPhotoRevisions([])
    setPhotoHistoryError('')
    setPhotoRollbackTarget('')
    setPhotoRollbackConfirmOpen(false)
    setBaiduReveal(null)
    setRevealingAK(false)
    setGeoNamesBusy(false)
    setGeoNamesConfig(null)
    setGeoNamesDraftDistance('')
    setGeoNamesError('')
    setGeoNamesNotice('')
    setGeoNamesRevisions([])
    setGeoNamesHistoryError('')
    setGeoNamesRollbackTarget('')
    setGeoNamesRollbackConfirmOpen(false)
    setGeoNamesSnapshotConfirmOpen(false)
    setGeoNamesDatasetTarget('')
    setGeoNamesDatasetConfirmOpen(false)
    setGeoNamesRestoreConfirmOpen(false)
    // Editor data is scoped to the active service. Overview has no private config reads.
    setBaiduConfig(null)
    setBaiduEnabled(false)
    setBaiduAK('')
    setBaiduError('')
    setBaiduNotice('')
    if (selectedPage === 'photo-auto' && source.loadPhotoAutoConfig) {
      void source.loadPhotoAutoConfig().then((policy) => {
        if (!active) return
        setPhotoPolicy(policy)
        setPhotoAutoDraft(policy.auto_enabled)
        setPhotoKindsDraft(policy.kinds ?? defaultPhotoAutoKinds)
      }).catch(() => {
        if (active) setPhotoPolicyError('无法读取照片智能分析策略，请检查 Server 或更新客户端。')
      })
    }
    if (selectedPage === 'baidu-map' && source.loadBaiduMapConfig) {
      void source.loadBaiduMapConfig().then((config) => {
        if (!active) return
        setBaiduConfig(config)
        setBaiduEnabled(config.enabled)
      }).catch(() => {
        if (active) setBaiduError('无法读取百度地图管理配置，请检查 Server 或更新客户端。')
      })
    }
    if (selectedPage === 'geonames' && source.loadGeoNamesConfig) {
      const initialGeoNamesEpoch = geoNamesEpochRef.current
      void source.loadGeoNamesConfig().then((config) => {
        if (active && initialGeoNamesEpoch === geoNamesEpochRef.current) {
          setGeoNamesConfig(config)
          setGeoNamesDraftDistance(String(config.max_distance_km))
        }
      }).catch(() => {
        if (active && initialGeoNamesEpoch === geoNamesEpochRef.current) {
          setGeoNamesError('无法读取 GeoNames 管理配置，请检查 Server 或更新客户端。')
        }
      })
    }
    return () => {
      active = false
      ++revealEpochRef.current
      ++baiduVerifyEpochRef.current
      ++geoNamesEpochRef.current
      ++photoPolicyEpochRef.current
      ++photoHistoryEpochRef.current
    }
  }, [source, selectedPage])

  // Revision history is intentionally fetched only when its accordion opens.
  // This separate effect must never reset any already-edited configuration.
  useEffect(() => {
    if (!historyExpanded) return
    let active = true
    const historyEpoch = ++photoHistoryEpochRef.current
    if (selectedPage === 'photo-auto' && source.loadPhotoAutoRevisions) {
      void source.loadPhotoAutoRevisions().then((page) => {
        if (active && historyEpoch === photoHistoryEpochRef.current) {
          setPhotoRevisions(page.items)
          setPhotoHistoryError('')
        }
      }).catch(() => {
        if (active && historyEpoch === photoHistoryEpochRef.current)
          setPhotoHistoryError('无法读取照片智能分析配置历史，请检查 Server/Agent 版本。')
      })
    }
    if (selectedPage === 'geonames' && source.loadGeoNamesRevisions) {
      void source.loadGeoNamesRevisions().then((page) => {
        if (active) {
          setGeoNamesRevisions(page.items)
          setGeoNamesHistoryError('')
        }
      }).catch(() => {
        if (active) setGeoNamesHistoryError('当前服务尚无法读取 GeoNames 配置历史，请检查 Server/Agent 版本。')
      })
    }
    return () => { active = false; ++photoHistoryEpochRef.current }
  }, [source, selectedPage, historyExpanded])

  useEffect(() => {
    let active = true
    const sourceChanged = snapshotSourceRef.current !== source
    snapshotSourceRef.current = source
    if (sourceChanged) {
      // A different account/server must never see the previous inventory.
      cachedSnapshotRef.current = null
      setSnapshot(null)
    }
    if (cachedSnapshotRef.current === null) {
      setLoading(true)
    } else {
      // Never unmount an active editor or reset an unsaved draft just because
      // the administrator wants a new read-only health snapshot.
      setRefreshing(true)
    }
    setError('')
    void source.load().then((next) => {
      if (!active) return
      cachedSnapshotRef.current = next
      setSnapshot(next)
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : '读取依赖状态失败')
    }).finally(() => {
      if (!active) return
      setLoading(false)
      setRefreshing(false)
    })
    return () => { active = false }
  }, [source, refreshID])

  const revealBaiduAK = async () => {
    if (!baiduConfig?.configured || !source.revealBaiduMapAK || revealingAK || baiduBusy) return
    const epoch = ++revealEpochRef.current
    setBaiduReveal(null)
    setRevealingAK(true)
    setBaiduError('')
    try {
      const revealed = await source.revealBaiduMapAK(baiduConfig.revision)
      if (epoch !== revealEpochRef.current) return
      if (revealed.field !== 'ak' || !revealed.value) throw new Error('读取 AK 响应无效')
      setBaiduReveal(revealed)
    } catch (err) {
      if (epoch !== revealEpochRef.current) return
      setBaiduReveal(null)
      setBaiduError(err instanceof Error ? err.message : '显示 AK 失败，请重试。')
    } finally {
      if (epoch === revealEpochRef.current) setRevealingAK(false)
    }
  }

  const verifyBaiduMap = async () => {
    if (!baiduConfig || !baiduConfig.enabled || !baiduConfig.configured ||
        !source.verifyBaiduMap || baiduVerifyBusy || baiduBusy ||
        baiduEnabled !== baiduConfig.enabled || baiduAK.trim() !== '') return
    const epoch = ++baiduVerifyEpochRef.current
    setBaiduVerification(null)
    setBaiduVerifyError('')
    setBaiduVerifyBusy(true)
    try {
      const result = await source.verifyBaiduMap(baiduConfig.revision)
      if (epoch !== baiduVerifyEpochRef.current) return
      if (!['verified', 'denied', 'unavailable'].includes(result.state) ||
          result.revision !== baiduConfig.revision ||
          result.image_verified !== (result.state === 'verified') ||
          typeof result.checked_at !== 'string' || !Number.isFinite(Date.parse(result.checked_at)) ||
          typeof result.detail !== 'string' || !result.detail) {
        throw new Error('地图在线验证响应不符合修订或安全合同，请升级 Server/Agent。')
      }
      setBaiduVerification(result)
    } catch (err) {
      if (epoch === baiduVerifyEpochRef.current) {
        setBaiduVerifyError(err instanceof Error ? err.message : '百度地图在线检测失败，请稍后重试。')
      }
    } finally {
      if (epoch === baiduVerifyEpochRef.current) setBaiduVerifyBusy(false)
    }
  }

  const applyBaiduMap = async (clearAK = false) => {
    if (!baiduConfig || !source.saveBaiduMapConfig || baiduBusy) return
    hideBaiduAK()
    // A pending save, rotation or disable attempt invalidates all old proof.
    ++baiduVerifyEpochRef.current
    setBaiduVerification(null)
    setBaiduVerifyError('')
    setBaiduVerifyBusy(false)
    const ak = baiduAK.trim()
    if (!clearAK && baiduEnabled && !baiduConfig.configured && !ak) {
      setBaiduError('启用百度地图前，请先填写有效的 Server AK。')
      return
    }
    setBaiduBusy(true)
    setBaiduError('')
    setBaiduNotice('')
    try {
      const next = await source.saveBaiduMapConfig({
        enabled: clearAK ? false : baiduEnabled,
        revision: baiduConfig.revision,
        ...(clearAK ? { clear_ak: true } : ak ? { ak } : {}),
      })
      setBaiduConfig(next)
      setBaiduEnabled(next.enabled)
      setBaiduAK('')
      setBaiduNotice('配置已保存并热应用到新请求，无需重启 xDrive Server；百度上游是否接受当前 AK 仍需单独在线验证。')
      const status = await source.load()
      setSnapshot(status)
    } catch (err) {
      setBaiduError(err instanceof Error ? err.message : '保存百度地图配置失败；请刷新后重试。')
    } finally {
      setBaiduBusy(false)
      setClearConfirmOpen(false)
    }
  }

  // This administrator command validates the deployment-mounted dataset and
  // swaps the fully loaded resolver. It does not edit a user sync folder, choose
  // an arbitrary Server filesystem path, or claim online env-variable editing.
  const saveGeoNamesConfig = async () => {
    if (!geoNamesConfig?.editable || !source.saveGeoNamesConfig || geoNamesBusy) return
    const distance = Number(geoNamesDraftDistance)
    if (!geoNamesDraftDistance.trim() || !Number.isFinite(distance) || distance <= 0 || distance > 500) {
      setGeoNamesError('匹配距离必须大于 0 且不超过 500 km。')
      return
    }
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const updated = await source.saveGeoNamesConfig({
        revision: geoNamesConfig.revision,
        max_distance_km: distance,
      })
      if (epoch !== geoNamesEpochRef.current) return
      setGeoNamesConfig(updated)
      setGeoNamesDraftDistance(String(updated.max_distance_km))
      setGeoNamesNotice(updated.apply_state === 'applied'
        ? '已持久化配置并写入审计，当前 Server 新索引立即生效；其他实例每 30 秒尝试自动校验并应用，失败时仍显示待生效。'
        : '配置已保存，但当前 Server 尚未确认生效，请校验并热加载。')
      if (source.loadGeoNamesRevisions) {
        const history = await source.loadGeoNamesRevisions().catch(() => null)
        if (epoch === geoNamesEpochRef.current && history) {
          setGeoNamesRevisions(history.items)
          setGeoNamesRollbackTarget('')
          setGeoNamesHistoryError('')
        }
      }
      const next = await source.load()
      if (epoch === geoNamesEpochRef.current) setSnapshot(next)
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 配置未保存，原索引继续生效。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) setGeoNamesBusy(false)
    }
  }

  const applyGeoNamesDataset = async () => {
    if (!geoNamesConfig || geoNamesConfig.desired_dataset_fingerprint === undefined ||
        !geoNamesDatasetTarget || !source.applyGeoNamesDataset || geoNamesBusy ||
        (!geoNamesConfig.snapshot_apply_supported && geoNamesDatasetTarget !== 'deployment')) return
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const next = await source.applyGeoNamesDataset({
        revision: geoNamesConfig.revision,
        expected_version: geoNamesConfig.current_version,
        expected_fingerprint: geoNamesConfig.active_dataset_fingerprint ?? '',
        target: geoNamesDatasetTarget,
      })
      if (epoch !== geoNamesEpochRef.current) return
      const expected = geoNamesDatasetTarget === 'deployment' ? '' : geoNamesDatasetTarget
      if (next.active_dataset_fingerprint !== expected ||
          next.desired_dataset_fingerprint !== expected || next.active_dataset_persistent !== true ||
          next.apply_state !== 'applied') {
        throw new Error('GeoNames 数据集未能确认当前 Server 实际热加载状态。')
      }
      setGeoNamesConfig(next)
      setGeoNamesDraftDistance(String(next.max_distance_km))
      setGeoNamesDatasetTarget('')
      setGeoNamesNotice(geoNamesDatasetTarget === 'deployment'
        ? '已持久保存部署数据源为目标，当前实例校验后热生效；其他实例仍需分别确认。'
        : '已持久保存归档指纹并热应用到当前实例；重启会重新验证快照完整性，缺失时保持待生效，其他实例仍需单独校验。')
      const latest = await source.load()
      if (epoch === geoNamesEpochRef.current) setSnapshot(latest)
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 数据集校验或热应用失败，原索引继续生效。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesBusy(false)
        setGeoNamesDatasetConfirmOpen(false)
      }
    }
  }

  const restoreMissingGeoNamesSnapshot = async () => {
    if (!geoNamesConfig?.restore_missing_enabled || !geoNamesConfig.desired_dataset_fingerprint ||
        !source.restoreMissingGeoNamesSnapshot || geoNamesBusy) return
    const epoch = ++geoNamesEpochRef.current
    const expected = geoNamesConfig.desired_dataset_fingerprint
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const next = await source.restoreMissingGeoNamesSnapshot({
        revision: geoNamesConfig.revision,
        expected_version: geoNamesConfig.current_version,
        expected_fingerprint: geoNamesConfig.active_dataset_fingerprint ?? '',
      })
      if (epoch !== geoNamesEpochRef.current) return
      if (next.desired_dataset_fingerprint !== expected ||
          next.active_dataset_fingerprint !== expected || next.apply_state !== 'applied' ||
          next.active_dataset_persistent !== true || next.restore_missing_enabled !== false) {
        throw new Error('恢复接口尚未确认当前 Server 的持久目标归档已正确重建及实际生效。')
      }
      setGeoNamesConfig(next)
      setGeoNamesNotice('受信任部署挂载与原归档审计指纹完全一致；缺失目录已恢复，当前 Server 热生效。未覆盖已有目录、未改变期望修订；其他实例未被自动修复。')
      const latest = await source.load()
      if (epoch === geoNamesEpochRef.current) setSnapshot(latest)
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : '缺失归档未恢复；当前生效索引与历史记录保持不变。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesBusy(false)
        setGeoNamesRestoreConfirmOpen(false)
      }
    }
  }

  const stageGeoNamesSnapshot = async () => {
    if (!geoNamesConfig?.snapshot_supported || !source.stageGeoNamesSnapshot || geoNamesBusy) return
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const result = await source.stageGeoNamesSnapshot({
        revision: geoNamesConfig.revision,
        expected_version: geoNamesConfig.current_version,
      })
      if (epoch !== geoNamesEpochRef.current) return
      if (!result.staged || result.applied || !result.snapshot.fingerprint) {
        throw new Error('GeoNames 版本快照未完成验证，当前运行索引不变。')
      }
      const next = await source.loadGeoNamesConfig?.()
      if (epoch !== geoNamesEpochRef.current) return
      if (next) setGeoNamesConfig(next)
      setGeoNamesNotice('数据集已完成有界复制、完整索引校验和审计，并保存为不可变快照；尚未应用，不影响现有地名解析。')
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 版本快照创建失败；当前索引不变。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesBusy(false)
        setGeoNamesSnapshotConfirmOpen(false)
      }
    }
  }

  // Read-only GeoNames status is separate from reloadGeoNames: never validate,
  // copy, switch or reapply a dataset just to check the applied revision.
  const refreshGeoNamesReadOnly = async () => {
    if (!source.loadGeoNamesConfig || geoNamesBusy || unsavedRef.current) return
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const next = await source.loadGeoNamesConfig()
      if (epoch !== geoNamesEpochRef.current) return
      setGeoNamesConfig(next)
      // Verification is read-only: keep the local editor's clean baseline in
      // sync with the newly observed desired revision, never invent a dirty edit.
      setGeoNamesDraftDistance(String(next.max_distance_km))
      setGeoNamesNotice('已只读刷新当前 Server 与已观测在线实例的索引修订；未校验数据文件或执行热加载。')
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 实际修订只读检测失败；当前索引未改变。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) setGeoNamesBusy(false)
    }
  }

  const reloadGeoNames = async () => {
    if (!geoNamesConfig?.reload_supported || !source.reloadGeoNames || geoNamesBusy) return
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const result = await source.reloadGeoNames(geoNamesConfig.current_version)
      if (epoch !== geoNamesEpochRef.current) return
      if (!result.applied || !result.current_version) throw new Error('GeoNames 未能完成生效校验。')
      const effective = source.loadGeoNamesConfig ? await source.loadGeoNamesConfig() : null
      if (epoch !== geoNamesEpochRef.current) return
      if (effective) {
        setGeoNamesConfig(effective)
        setGeoNamesDraftDistance(String(effective.max_distance_km))
      } else {
        setGeoNamesConfig((old) => old ? { ...old, current_version: result.current_version } : old)
      }
      setGeoNamesNotice(result.changed
        ? '已验证并热加载新索引。后续地名任务使用新版本，运行中的任务保持旧快照。'
        : '数据集验证通过，版本未变化，无需替换当前索引。')
      const next = await source.load()
      if (epoch === geoNamesEpochRef.current) setSnapshot(next)
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 数据校验失败，当前已生效索引未改变。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) setGeoNamesBusy(false)
    }
  }

  const savePhotoAutoPolicy = async () => {
    if (!photoPolicy?.editable || !source.savePhotoAutoConfig || photoPolicyBusy) return
    const epoch = ++photoPolicyEpochRef.current
    setPhotoPolicyBusy(true)
    setPhotoPolicyError('')
    setPhotoPolicyNotice('')
    try {
      const next = await source.savePhotoAutoConfig({
        revision: photoPolicy.revision,
        auto_enabled: photoAutoDraft,
        ...(photoPolicy.kinds ? { kinds: photoKindsDraft } : {}),
      })
      if (epoch !== photoPolicyEpochRef.current) return
      setPhotoPolicy(next)
      setPhotoAutoDraft(next.auto_enabled)
      setPhotoKindsDraft(next.kinds ?? defaultPhotoAutoKinds)
      setPhotoRollbackTarget('')
      setPhotoRollbackConfirmOpen(false)
      setPhotoPolicyNotice(next.apply_state === 'applied'
        ? '设置已持久化并审计，当前 Server 的新自动分析任务立即遵循此策略；其他实例将定期同步。'
        : '设置已保存，但当前 Server 尚未确认生效，请刷新状态。')
      if (source.loadPhotoAutoRevisions) {
        const historyEpoch = ++photoHistoryEpochRef.current
        try {
          const history = await source.loadPhotoAutoRevisions()
          if (epoch === photoPolicyEpochRef.current && historyEpoch === photoHistoryEpochRef.current) {
            setPhotoRevisions(history.items)
            setPhotoHistoryError('')
          }
        } catch {
          if (epoch === photoPolicyEpochRef.current && historyEpoch === photoHistoryEpochRef.current) {
            setPhotoHistoryError('策略已保存，但无法刷新历史修订。请刷新页面后重试。')
          }
        }
      }
    } catch (err) {
      if (epoch === photoPolicyEpochRef.current) {
        setPhotoPolicyError(err instanceof Error ? err.message : '保存失败，当前运行策略未确认更新。')
      }
    } finally {
      if (epoch === photoPolicyEpochRef.current) setPhotoPolicyBusy(false)
    }
  }

  const rollbackPhotoAuto = async () => {
    if (!photoPolicy?.editable || !source.rollbackPhotoAuto || photoPolicyBusy) return
    const target = photoRevisions.find(
      (item) => String(item.revision) === photoRollbackTarget && item.revision < photoPolicy.revision,
    )
    if (!target) {
      setPhotoPolicyError('请选择一个比当前配置更早的有效修订。')
      setPhotoRollbackConfirmOpen(false)
      return
    }
    const epoch = ++photoPolicyEpochRef.current
    const historyEpoch = ++photoHistoryEpochRef.current
    setPhotoPolicyBusy(true)
    setPhotoPolicyError('')
    setPhotoPolicyNotice('')
    try {
      const effective = await source.rollbackPhotoAuto({
        revision: photoPolicy.revision,
        target_revision: target.revision,
      })
      if (epoch !== photoPolicyEpochRef.current) return
      setPhotoPolicy(effective)
      setPhotoAutoDraft(effective.auto_enabled)
      setPhotoKindsDraft(effective.kinds ?? defaultPhotoAutoKinds)
      setPhotoRollbackTarget('')
      setPhotoHistoryError('')
      setPhotoPolicyNotice(effective.apply_state === 'applied'
        ? '历史自动分析策略已写入新修订并通过审计，当前 Server 已热生效；其他实例需按策略周期刷新。'
        : '历史策略已保存为新修订，但当前实例仍待生效，请刷新检查。')
      if (source.loadPhotoAutoRevisions) {
        try {
          const history = await source.loadPhotoAutoRevisions()
          if (epoch === photoPolicyEpochRef.current && historyEpoch === photoHistoryEpochRef.current) {
            setPhotoRevisions(history.items)
            setPhotoHistoryError('')
          }
        } catch {
          if (epoch === photoPolicyEpochRef.current && historyEpoch === photoHistoryEpochRef.current) {
            setPhotoHistoryError('回滚已完成，但历史记录刷新失败。请手动刷新页面。')
          }
        }
      }
      const status = await source.load().catch(() => null)
      if (status && epoch === photoPolicyEpochRef.current) setSnapshot(status)
    } catch (err) {
      if (epoch === photoPolicyEpochRef.current) {
        setPhotoPolicyError(err instanceof Error ? err.message : '历史策略回滚失败，请刷新后重试。')
        // A 409 or an interrupted response makes the displayed revision stale.
        // Read the authoritative desired/effective policy again, never assume rollback succeeded.
        if (source.loadPhotoAutoConfig) {
          const actual = await source.loadPhotoAutoConfig().catch(() => null)
          if (actual && epoch === photoPolicyEpochRef.current) {
            setPhotoPolicy(actual)
            setPhotoAutoDraft(actual.auto_enabled)
            setPhotoKindsDraft(actual.kinds ?? defaultPhotoAutoKinds)
          }
        }
      }
    } finally {
      if (epoch === photoPolicyEpochRef.current) {
        setPhotoPolicyBusy(false)
        setPhotoRollbackConfirmOpen(false)
      }
    }
  }

  const rollbackGeoNames = async () => {
    if (!geoNamesConfig?.editable || !source.rollbackGeoNames || geoNamesBusy) return
    const target = geoNamesRevisions.find(
      (item) => String(item.revision) === geoNamesRollbackTarget && item.revision < geoNamesConfig.revision,
    )
    if (!target) {
      setGeoNamesError('请选择一个比当前配置更早的有效修订。')
      setGeoNamesRollbackConfirmOpen(false)
      return
    }
    const epoch = ++geoNamesEpochRef.current
    setGeoNamesBusy(true)
    setGeoNamesError('')
    setGeoNamesNotice('')
    try {
      const effective = await source.rollbackGeoNames({
        revision: geoNamesConfig.revision,
        target_revision: target.revision,
      })
      if (epoch !== geoNamesEpochRef.current) return
      setGeoNamesConfig(effective)
      setGeoNamesDraftDistance(String(effective.max_distance_km))
      setGeoNamesRollbackTarget('')
      setGeoNamesNotice(effective.apply_state === 'applied'
        ? '历史距离已回滚、审计并热应用至当前 Server；其他实例每 30 秒尝试自动校验并应用，失败时仍显示待生效。'
        : '已保存回滚配置；当前实例尚未确认生效，请执行校验并热加载。')
      if (source.loadGeoNamesRevisions) {
        const history = await source.loadGeoNamesRevisions().catch(() => null)
        if (history && epoch === geoNamesEpochRef.current) setGeoNamesRevisions(history.items)
      }
      const status = await source.load().catch(() => null)
      if (status && epoch === geoNamesEpochRef.current) setSnapshot(status)
    } catch (err) {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesError(err instanceof Error ? err.message : 'GeoNames 回滚失败，已生效配置保持不变。')
      }
    } finally {
      if (epoch === geoNamesEpochRef.current) {
        setGeoNamesBusy(false)
        setGeoNamesRollbackConfirmOpen(false)
      }
    }
  }

  const coldReadPending = !snapshot && !visibleError
  const checkedAt = snapshot?.checked_at
    ? new Date(snapshot.checked_at).toLocaleString()
    : ''
  // Ignore user-level connector rows returned by older Server versions.
  const systemServices = xDriveVisibleSystemDependencies(snapshot?.services ?? [])
  const photoKindsChanged = !!photoPolicy?.kinds && photoAutoKindChoices.some(
    (kind) => photoPolicy.kinds![kind.key] !== photoKindsDraft[kind.key],
  )
  const selectedPhotoRevision = photoRevisions.find(
    (item) => String(item.revision) === photoRollbackTarget && item.revision < (photoPolicy?.revision ?? 0),
  )
  const overviewEntries = xDriveSystemDependenciesOverviewEntries(systemServices)
  const overviewCounts = xDriveSystemDependenciesOverviewCoverage(systemServices, XDRIVE_SYSTEM_DEPENDENCY_IDS.length)
  const dashboardCounts = xDriveDashboardCounts(overviewEntries)
  // These five buckets are mutually exclusive; a failed health probe is
  // included in "需关注" with a separate failure subcount.
  const dashboardMetrics = [
    { label: '全部服务', value: String(dashboardCounts.total),
      hint: '已报告 ' + overviewCounts.reported + ' · 未报告 ' + overviewCounts.unreported,
      color: 'text.primary', filter: 'all' },
    { label: '健康正常', value: String(dashboardCounts.healthy),
      hint: '真实健康探针通过', color: 'success.main', filter: 'healthy' },
    { label: '需关注', value: String(dashboardCounts.attention + dashboardCounts.failed),
      hint: '异常 ' + dashboardCounts.failed + ' · 待处理 ' + dashboardCounts.attention,
      color: dashboardCounts.failed ? 'error.main' : 'warning.main', filter: 'attention' },
    { label: '未启用／未接入', value: String(dashboardCounts.disabled),
      hint: '未启用或尚未接入', color: 'text.secondary', filter: 'disabled' },
    { label: '状态未知', value: String(dashboardCounts.unknown),
      hint: '缺少可信的健康证据', color: 'info.main', filter: 'unknown' },
  ] as const
  const selectedItem = systemServices.find((item) => item.id === selectedPage)
  const selectedServiceMissing = xDriveSystemDependencySelectionMissing(selectedPage, systemServices)
  const selectedGroup = selectedPage === 'photo-auto' ? 'intelligence' : selectedItem?.group
  const choosePage = (page: string) => {
    if (page === 'overview') navigateTo({})
    else if (page === 'photo-auto') navigateTo({ policy: 'photo-auto', tab: 'config' })
    else navigateTo({ service: page as XDriveSystemDependenciesLocation['service'], tab: 'status' })
  }
  const dependencyNote = (
    <Typography variant="caption" color="text.secondary" data-xdrive-system-dependencies-safety-note>
      状态概览只展示已取得的证据：“未知”和“未检测”不等于健康，“已配置”不等于已生效。
      “已核验”仅限对应服务的观测范围，不代表全集群。启停权限和生效检测以各项详情为准。
    </Typography>
  )

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="系统依赖"
      subtitle="仅管理整个 xDrive 实例的系统服务：查看配置来源、生效方式与真实健康状态；用户同步文件夹不在此管理。"
      pageActions={(
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshRoundedIcon fontSize="small" />}
          onClick={() => setRefreshID((value) => value + 1)}
          disabled={loading || refreshing || unsavedRef.current}
          aria-busy={refreshing || undefined}
          sx={{ minWidth: 112 }}
        >
          刷新状态
        </Button>
      )}
    >
      {/* Keep a real late refresh error visible, but never insert it as a new
          MUI spacing child ahead of the already-accepted service workspace. */}
      <Box data-xdrive-system-dependencies-feedback-owner sx={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)',
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        width: 'min(calc(100vw - 24px), 560px)',
        maxHeight: 'min(34dvh, 220px)', overflowY: 'auto',
        pointerEvents: 'none', zIndex: theme => theme.zIndex.snackbar,
      }}>
        {snapshot && visibleError ? (
          <Box data-xdrive-system-dependencies-refresh-error role="alert" sx={{ pointerEvents: 'auto' }}>
            <XDriveStatusAlert tone="bad">
              刷新失败，当前显示上次成功检测的快照，状态可能已过期：{visibleError}
            </XDriveStatusAlert>
          </Box>
        ) : null}
      </Box>
      <Stack spacing={2.5} data-xdrive-admin-service-dependencies>
        <Typography variant="body2" color="text.secondary" role="status"
          data-xdrive-system-dependencies-quiet-status
          sx={{ minHeight: 24 }}>
          {snapshot ? '最近检测：' + checkedAt + ' · 服务状态快照'
            : coldReadPending ? '' : '尚未取得服务检测结果'}
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} alignItems="flex-start">
          <Box component="nav" aria-label="系统依赖页内导航" sx={{
            width: 198, flexShrink: 0, position: { md: 'sticky' }, top: 12,
            display: { xs: 'none', md: selectedPage === 'overview' ? 'none' : 'block' }, maxHeight: 'calc(100dvh - 196px)',
            overflowY: 'auto', borderRight: 1, borderColor: 'divider', pr: 1.5,
          }}>
            <Button fullWidth size="small" variant="text" color="inherit"
              aria-current={selectedPage === 'overview' ? 'page' : undefined}
              sx={{ ...pageLocalNavSx(selectedPage === 'overview'), mb: 1.5 }}
              onClick={() => choosePage('overview')}>总览</Button>
            {groups.map((group) => (
              <Box key={group.id} sx={{ mb: 1.5 }}>
                <Typography variant="overline" fontWeight={700} color="text.secondary"
                  sx={{ display: 'block', px: 1.25, mb: 0.25, lineHeight: 1.75 }}>{group.label}</Typography>
                {overviewEntries.filter((item) => item.group === group.id).map((service) => (
                  <Button key={service.id} size="small" fullWidth color="inherit" variant="text"
                    aria-current={selectedPage === service.id ? 'page' : undefined}
                    sx={{ ...pageLocalNavSx(selectedPage === service.id), mb: 0.25, gap: 0.75 }}
                    onClick={() => choosePage(service.id)}>
                    <Box component="span" aria-hidden sx={{
                      flexShrink: 0, width: 7, height: 7, borderRadius: '50%',
                      bgcolor: service.service?.health_state === 'ready' ? 'success.main'
                        : service.service?.health_state === 'failed' ? 'error.main' : 'text.disabled',
                    }} />
                    <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                      {service.service?.label ?? service.label}{service.service ? '' : '（未报告）'}
                    </Box>
                  </Button>
                ))}
                {group.id === 'intelligence' && (
                  <Button size="small" fullWidth variant="text" color="inherit"
                    aria-current={selectedPage === 'photo-auto' ? 'page' : undefined}
                    sx={pageLocalNavSx(selectedPage === 'photo-auto')}
                    onClick={() => choosePage('photo-auto')}>全局分析策略</Button>
                )}
              </Box>
            ))}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
            <TextField select size="small" fullWidth label="选择系统依赖"
              sx={{ display: { xs: selectedPage === 'overview' ? 'none' : 'block', md: 'none' }, mb: 2,
                '& .MuiInputBase-root': { minHeight: 44 },
              }}
              value={selectedPage}
              onChange={(event) => choosePage(event.target.value)}>
              <MenuItem value="overview">总览</MenuItem>
              {groups.map((group) => [
                <MenuItem key={group.id + '-heading'} value={group.id} disabled>{group.label}</MenuItem>,
                ...overviewEntries.filter((item) => item.group === group.id).map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.service?.label ?? item.label}{item.service ? '' : '（未报告）'}
                  </MenuItem>
                )),
                ...(group.id === 'intelligence'
                  ? [<MenuItem key="photo-auto" value="photo-auto">全局分析策略</MenuItem>] : []),
              ])}
            </TextField>
            {!snapshot && (
              <Box data-xdrive-system-dependencies-cold-slot
                aria-busy={coldReadPending || undefined}
                sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                {visibleError ? (
                  <Box data-xdrive-system-dependencies-first-read-error role="alert"
                    sx={{ width: '100%', maxHeight: 180, overflowY: 'auto', p: 1 }}>
                    <XDriveStatusAlert tone="bad">{visibleError}</XDriveStatusAlert>
                  </Box>
                ) : null}
              </Box>
            )}
            {!loading && snapshot && selectedPage === 'overview' && (
              <Box component="section" aria-label="系统依赖总览" data-xdrive-system-dependencies-overview>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
                  alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between"
                  sx={{ mb: 1.5 }}>
                  <Box>
                    <Typography variant="h6" component="h2" fontWeight={700}>服务概览</Typography>
                    <Typography variant="body2" color="text.secondary">
                      先看真实健康与目标修订，再进入单项服务配置、检测或查看历史。
                    </Typography>
                  </Box>
                  <Chip size="small" variant="outlined"
                    label={'已报告 ' + overviewCounts.reported + ' / ' + XDRIVE_SYSTEM_DEPENDENCY_IDS.length + ' 项'} />
                </Stack>
                <Box component="section" aria-label="系统依赖状态统计与筛选"
                  data-xdrive-system-dependencies-metrics sx={{
                    display: 'grid', gap: 1, mb: 1.5,
                    gridTemplateColumns: {
                      xs: 'repeat(2, minmax(0,1fr))', sm: 'repeat(3, minmax(0,1fr))',
                      xl: 'repeat(5, minmax(0,1fr))',
                    },
                  }}>
                  {dashboardMetrics.map((metric) => (
                    <Button key={metric.filter} variant="outlined" color="inherit"
                      aria-pressed={overviewFilter === metric.filter}
                      aria-label={'筛选' + metric.label + '，' + metric.value + '项'}
                      onClick={() => setOverviewFilter(metric.filter)}
                      data-xdrive-system-dependencies-filter={metric.filter}
                      sx={{ p: 1.5, minHeight: 90, minWidth: 0, borderRadius: 2,
                        flexDirection: 'column', alignItems: 'flex-start', gap: 0.5,
                        textTransform: 'none', textAlign: 'left',
                        bgcolor: overviewFilter === metric.filter ? 'action.selected' : 'background.paper',
                        borderColor: overviewFilter === metric.filter ? 'primary.main' : 'divider',
                        gridColumn: metric.filter === 'unknown' ? { xs: 'span 2', sm: 'auto' } : undefined,
                        '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
                        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                      }}>
                      <Typography variant="caption" color="text.secondary">{metric.label}</Typography>
                      <Typography variant="h6" fontWeight={700}
                        sx={{ color: metric.color, lineHeight: 1.2 }}
                        data-xdrive-system-dependencies-metric-value={metric.label}>
                        {metric.value}
                      </Typography>
                      <Typography variant="caption" color="text.secondary"
                        sx={{ overflowWrap: 'anywhere' }}>{metric.hint}</Typography>
                    </Button>
                  ))}
                </Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center"
                  spacing={1} sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary" role="status"
                    data-xdrive-system-dependencies-active-filter>
                    点击统计可筛选服务；当前：
                    {dashboardMetrics.find((metric) => metric.filter === overviewFilter)?.label}
                  </Typography>
                  {overviewFilter !== 'all' && (
                    <Button size="small" variant="text" onClick={() => setOverviewFilter('all')}>
                      清除筛选
                    </Button>
                  )}
                </Stack>
                <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 }, mb: 2, borderRadius: 2 }}
                  data-xdrive-system-dependencies-capability-matrix>
                  <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}
                    alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
                    <Box>
                      <Typography variant="subtitle2" fontWeight={700}>配置、启停与生效检测支持度</Typography>
                      <Typography variant="caption" color="text.secondary">
                        这里只列出已实现的操作范围，不代表服务运行、已应用或全实例生效；实际权限和结果以详情及 Server 为准。
                      </Typography>
                    </Box>
                    <Button size="small" variant="outlined"
                      onClick={() => setShowCapabilityMatrix((value) => !value)}>
                      {showCapabilityMatrix ? '隐藏配置能力' : '显示 11 项配置能力'}
                    </Button>
                  </Stack>
                  {showCapabilityMatrix && (
                    <Box sx={{
                      display: 'grid', gap: 1, mt: 1.5,
                      gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'repeat(2, minmax(0,1fr))' },
                    }} data-xdrive-system-dependencies-capability-rows>
                      {overviewEntries.map((item) => {
                        const capability = XDRIVE_SYSTEM_DEPENDENCY_CAPABILITIES[item.id]
                        const { configTarget, verifyTarget, activationTarget } = xDriveSystemDependencyAvailableTargets(
                          item.id, systemServices, source,
                        )
                        // Older Agent/Server response without both scope/mode
                        // has no defensible configuration or verification link.
                        const recognized = !!(item.service && item.service.config_mode && item.service.apply_mode)
                        return (
                          <Box key={item.id} sx={{
                            border: 1, borderColor: 'divider', borderRadius: 1.5,
                            p: 1.25, minWidth: 0,
                          }} data-xdrive-system-dependency-capability={item.id}>
                            <Stack direction="row" justifyContent="space-between" gap={1} sx={{ mb: 0.75 }}>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                                {item.service?.label ?? item.label}
                              </Typography>
                              <Chip size="small" variant="outlined"
                                label={recognized ? '功能合同' : '服务能力未报告'} />
                            </Stack>
                            {([
                              ['配置与修改', capability.configure],
                              ['安全启停', capability.enable],
                              ['生效检测', capability.verify],
                              ['历史与回滚', capability.history],
                            ] as const).map(([label, value]) => (
                              <Stack key={label} direction="row" gap={1} sx={{ py: 0.25, minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70 }}>
                                  {label}
                                </Typography>
                                <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                                  {recognized ? value : '尚无当前 Server/Agent 能力合同，不能执行'}
                                </Typography>
                              </Stack>
                            ))}
                            {recognized && (configTarget || verifyTarget) && (
                              <Stack direction="row" gap={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                                {configTarget && (
                                  <Button size="small" variant="outlined"
                                    onClick={() => navigateTo(configTarget)}>
                                    {activationTarget ? capability.activationLabel : '查看配置入口'}
                                  </Button>
                                )}
                                {verifyTarget && (
                                  <Button size="small" variant="text"
                                    onClick={() => navigateTo(verifyTarget)}>
                                    {item.id === 'storage' ? '存储就绪检测' : '查看检测入口'}
                                  </Button>
                                )}
                              </Stack>
                            )}
                            {recognized && activationTarget && (
                              <Typography variant="caption" color="text.secondary"
                                data-xdrive-dependency-existing-activation>
                                此处只进入已有受控配置页面；保存目标不等于已启用，需在详情页核验实际权限和生效结果。
                              </Typography>
                            )}
                            {recognized && (
                              (capability.configTarget && !configTarget) ||
                              (capability.verifyTarget && !verifyTarget)
                            ) && (
                              <Typography variant="caption" color="text.secondary"
                                data-xdrive-dependency-missing-action-port>
                                当前连接未确认对应的配置或检测接口；不显示无效快捷操作。
                              </Typography>
                            )}
                          </Box>
                        )
                      })}
                    </Box>
                  )}
                </Paper>
                {groups.map((group) => {
                  const items = overviewEntries.filter((item) =>
                    item.group === group.id &&
                    xDriveDashboardMatches(xDriveDashboardAssessment(item.service).state, overviewFilter))
                  const reported = items.filter((item) => item.service !== null).length
                  if (items.length === 0) return null
                  return (
                    <Box key={group.id} component="section" aria-label={group.label} sx={{ mb: 2.5 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5}
                        alignItems={{ xs: 'flex-start', sm: 'baseline' }} sx={{ mb: 1 }}>
                        <Typography variant="subtitle1" component="h3" fontWeight={700}>{group.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {items.length} 项 · 其中 {reported} 项已报告
                        </Typography>
                      </Stack>
                      <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: 'minmax(0,1fr)',
                          sm: 'repeat(2, minmax(0,1fr))',
                          lg: 'repeat(3, minmax(0,1fr))',
                          xl: 'repeat(4, minmax(0,1fr))',
                        },
                        gap: 1.25,
                      }}>
                        {items.map((item) => item.service
                          ? <ServiceOverviewCard key={item.id} service={item.service}
                              onOpen={() => choosePage(item.id)} />
                          : <UnreportedServiceOverviewCard key={item.id} id={item.id} label={item.label}
                              onOpen={() => choosePage(item.id)} />
                        )}
                      </Box>
                      {group.id === 'intelligence' && (
                        <Button size="small" color="inherit" sx={{ mt: 1 }}
                          onClick={() => choosePage('photo-auto')}>
                          全局分析策略（独立管理，不计入 11 项服务）
                          <ChevronRightRoundedIcon sx={{ ml: 0.25, fontSize: 18 }} />
                        </Button>
                      )}
                    </Box>
                  )
                })}
                {overviewFilter !== 'all' && !overviewEntries.some((item) =>
                  xDriveDashboardMatches(xDriveDashboardAssessment(item.service).state, overviewFilter)) && (
                  <Paper role="status" variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      当前筛选没有匹配的服务。可点击「全部服务」恢复列表。
                    </Typography>
                  </Paper>
                )}
              </Box>
            )}
            {!loading && snapshot && selectedServiceMissing && (
              <Paper variant="outlined" role="status" data-xdrive-system-dependency-unreported
                sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
                <Stack spacing={1.5}>
                  <Typography variant="subtitle2" fontWeight={700}>系统依赖状态未报告</Typography>
                  <XDriveStatusAlert tone="warning">
                    当前 Server/Agent 未返回此项固定系统依赖（ID：{selectedPage}）的可信状态；
                    无法确认配置、安装、健康或实际生效。不会伪造默认绿色状态，也不会显示未知的配置或启停操作。
                  </XDriveStatusAlert>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button variant="outlined" size="small" disabled={loading || refreshing || unsavedRef.current}
                      onClick={() => setRefreshID((value) => value + 1)}>重新检测状态</Button>
                    <Button variant="text" size="small" onClick={() => navigateTo({})}>返回总览</Button>
                  </Stack>
                </Stack>
              </Paper>
            )}
            {!loading && snapshot && selectedPage !== 'overview' && groups
              .filter((group) => group.id === selectedGroup).map((group) => {
              const items = selectedItem ? [selectedItem] : []
              if (!items.length && selectedPage !== 'photo-auto') return null
              return (
                <Box key={selectedPage} component="section" aria-label={
                  selectedPage === 'photo-auto' ? '全局分析策略' : selectedItem?.label ?? group.label
                } data-xdrive-system-dependency-detail>
                  <Button size="small" variant="text" color="inherit" startIcon={<ArrowBackRoundedIcon />}
                    sx={{ mb: 1, color: 'text.secondary' }}
                    onClick={() => choosePage('overview')}>返回总览</Button>
                  <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                    {selectedPage === 'photo-auto' ? '全局分析策略' : selectedItem?.label}
                  </Typography>
                  {selectedPage === 'photo-auto' && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {group.description}
                    </Typography>
                  )}
                  {selectedPage === 'caddy' && selectedItem ? (
                    <XDriveCaddyDetailV1
                      source={source} service={selectedItem} checkedAt={checkedAt}
                      activeTab={currentTab} refreshing={refreshing}
                      hasUnsavedEdits={hasUnsavedEdits}
                      onTabChange={(tab) => navigateTo({ service: 'caddy', tab })}
                      onRefreshStatus={() => setRefreshID((value) => value + 1)}
                      onHTTPSDirtyChange={setCaddyHTTPSDirty}
                      onAliDNSDirtyChange={setCaddyAliDirty}
                      onConfigurationChanged={invalidateCaddyEvidence}
                      evidenceRevision={caddyEvidenceRevision}
                    />
                  ) : (<>
                  <Typography variant="caption" color="text.secondary"
                    sx={{ display: 'block', mb: 1.5 }} data-xdrive-unified-detail-intro>
                    展开只查看；配置保存和在线检测均需明确操作。
                  </Typography>
                  {selectedTabs.filter((tab) => tab !== 'verify').map((sectionTab) => {
                    const sectionKey = `${selectedPage}:${sectionTab}`
                    const expanded = expandedSections[sectionKey] ??
                      (sectionTab === (currentTab === 'verify' ? 'status' : currentTab))
                    return (
                      <Accordion key={sectionKey} expanded={expanded}
                        onChange={(_event, next) => {
                          // A live form with unsaved changes must not be unmounted.
                          if (!next && unsavedRef.current) return
                          if (!next && selectedPage === 'baidu-map' && sectionTab === 'config')
                            hideBaiduAK()
                          setExpandedSections((prior) => ({ ...prior, [sectionKey]: next }))
                        }}
                        data-xdrive-unified-detail-section={sectionTab}
                        disableGutters elevation={0}
                        sx={{ border: 1, borderColor: 'divider', borderRadius: '8px !important',
                          mb: 1.25, '&:before': { display: 'none' }, overflow: 'hidden' }}>
                        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}
                          aria-controls={`dependency-${selectedPage}-${sectionTab}-content`}
                          id={`dependency-${selectedPage}-${sectionTab}-header`}
                          sx={{ px: { xs: 1.5, sm: 2 }, minHeight: 48 }}>
                          <Typography fontWeight={700} variant="subtitle2">
                            {sectionTab === 'status' && selectedTabs.includes('verify')
                              ? '状态与检测' : dependencyTabLabels[sectionTab]}
                          </Typography>
                        </AccordionSummary>
                        <AccordionDetails id={`dependency-${selectedPage}-${sectionTab}-content`}
                          sx={{ pt: 0.5, px: { xs: 1.5, sm: 2 }, pb: 2 }}>
                          {expanded && ([sectionTab,
                            ...(sectionTab === 'status' && showVerify ? ['verify' as XDriveSystemDependencyTab] : []),
                          ]).map((currentTab) => {
                            const selectedRuntimeSection = currentTab === 'verify' ? 'verify'
                              : currentTab === 'history' ? 'history' : 'config'
                            return (
                              <Box key={currentTab} data-xdrive-unified-detail-content={currentTab}
                                id={currentTab === 'verify' ? `dependency-${selectedPage}-verify-content` : undefined}>
                                {currentTab === 'verify' && (
                                  <Typography id={`dependency-${selectedPage}-verify-header`}
                                    fontWeight={700} variant="subtitle2" sx={{ mt: 1, mb: 1 }}>
                                    检测与生效证据
                                  </Typography>
                                )}
                          {currentTab === 'history' && hasUnsavedEdits && (
                            <Typography variant="caption" color="warning.main">
                              当前服务有未保存的修改。请先保存或放弃编辑，再执行历史回滚。
                            </Typography>
                          )}
                          <Box component="fieldset" disabled={currentTab === 'history' && hasUnsavedEdits}
                            sx={{ m: 0, p: 0, border: 0, minWidth: 0, width: '100%' }}>
                  {currentTab === 'status' && items.length > 0 && (
                    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                      {items.map((service) => <ServiceRow key={service.id} service={service} />)}
                    </Paper>
                  )}
                  {currentTab === 'status' && selectedTabs.includes('verify') && (
                    <Button variant="text" size="small" sx={{ mt: 1 }}
                      data-xdrive-unified-verify-toggle aria-expanded={showVerify}
                      aria-controls={`dependency-${selectedPage}-verify-content`}
                      onClick={() => setExpandedSections((prior) => ({
                        ...prior, [`${selectedPage}:verify`]: !showVerify,
                      }))}>
                      {showVerify ? '收起检测与生效证据' : '查看检测与生效证据'}
                    </Button>
                  )}
                  {['photo-face', 'photo-smart', 'photo-semantic'].includes(selectedPage) && currentTab === 'status' && (
                    <Button size="small" variant="outlined" sx={{ mt: 1.5 }}
                      onClick={() => choosePage('photo-auto')}>管理全局自动分析策略</Button>
                  )}
                  {['photo-face', 'photo-smart', 'photo-semantic', 'photo-creative'].includes(selectedPage) && currentTab === 'status' && (
                    <Button size="small" variant="text" sx={{ mt: 1 }}
                      onClick={() => navigateTo({ service: 'photo-face', tab: 'config' })}>
                      管理共享 Photo Intelligence 宿主（仅支持安全启用）
                    </Button>
                  )}
                  {selectedPage === 'photo-auto' && currentTab === 'status' && (
                    <Typography variant="body2" color="text.secondary">
                      全局策略集中控制后续自动分析任务的准入，并不启动、停止或证明模型容器健康。
                      请进入「配置」调整任务开关，或进入「历史」检查已审计修订。
                    </Typography>
                  )}
                  {currentTab === 'verify' &&
                    !['baidu-map', 'geonames']
                      .includes(selectedPage) && (
                    <Stack spacing={1.5} sx={{ mt: 1 }}>
                      {selectedPage === 'storage' ? (
                      <Typography variant="body2" color="text.secondary" data-xdrive-storage-readiness-scope>
                        本次检测通过管理员服务清单重新请求当前 Server 的存储 Ready 探针（限时、只读）。
                        「可用」仅代表此次当前实例的后端就绪，不是文件实际读写、内容校验、冗余完整、
                        数据快照恢复、迁移或所有节点生效的证明；不会修改挂载或启停存储服务。
                      </Typography>
                      ) : selectedPage === 'database' ? (
                        <Typography variant="body2" color="text.secondary" data-xdrive-postgres-liveness-scope>
                          此处重新请求当前 Server 的 PostgreSQL PingContext 连接探针（共享两秒超时）；
                          「可用」仅证明此次本实例能连通数据库，不能证明读写事务、备份恢复、
                          主从复制、其他实例状态或连接池目标修订已在全实例生效。
                          下方连接池配置修订需单独核对；不会启停或迁移数据库。
                        </Typography>
                      ) : selectedPage === 'background-worker' ? (
                        <Typography variant="body2" color="text.secondary" data-xdrive-pull-worker-liveness-scope>
                          此处重新请求当前 Server 从数据库读取的 Pull Worker 限时心跳状态；
                          「可用」仅代表本次观察到新鲜心跳，不证明单个同步任务成功、
                          全部 Worker 都已应用目标修订或容器已安全启停。
                          下方调度修订需单独核对；不会启动、停止或重启 Worker。
                        </Typography>
                      ) : selectedPage === 'media-worker' ? (
                        <Typography variant="body2" color="text.secondary" data-xdrive-media-worker-liveness-scope>
                          此处重新请求当前 Server 的 Media Worker 服务清单状态（共享两秒超时、只读）。
                          受管启用状态只有在宿主目标修订、内存／CPU／PID 实际限制及 FFmpeg/FFprobe 探针
                          都通过核验后才会显示「可用」；受管安全停用会显示「未启用」。
                          未受管的旧模式「可用」仅说明独立 FFmpeg/FFprobe 探针通过，并非宿主配额生效。
                          下方「验证实际生效」单独读取 Host Manager 的目标／应用修订和配额；
                          两次读取不是原子快照，也不证明媒体作业成功，不会在本页执行容器启停。
                        </Typography>
                      ) : selectedPage === 'caddy' ? (
                        <Typography variant="body2" color="text.secondary" data-xdrive-caddy-liveness-scope>
                          此处只读刷新当前 Server 实际观测到的 Caddy 容器健康、本机 HTTPS 握手与证书状态；
                          「可用」可能只证明内部 HTTP 代理健康或本机 TLS 校验，不证明公网 HTTPS 可访问，
                          也不证明当前目标修订已经应用。缺少可信本机 TLS 结果必须保持未知／不可用。
                          下方另有七项独立的只读安全预检，用于确认缺失的操作员救援与回滚条件；
                          预检通过也绝不在此处启用、停用、重启或应用 Caddy。
                        </Typography>
                      ) : (
                      <Typography variant="body2" color="text.secondary">
                        当前检测基于 Server 提供的真实探针和本实例生效修订，
                        不代表所有部署节点，也不等同于一次实际媒体分析或同步任务成功。
                      </Typography>
                      )}
                      {['photo-smart', 'photo-semantic', 'photo-creative'].includes(selectedPage) && (
                        <Typography variant="body2" color="text.secondary"
                          data-xdrive-direct-shared-photo-verify>
                          此服务由共享 Photo Intelligence 宿主提供。下方可直接手动检测四类模型的真实固定输入执行状态；
                          不包含单独的模型启停操作，也不代表真实图库任务或其他 Server 实例生效。
                        </Typography>
                      )}
                      <Button variant="outlined" size="small" sx={{ alignSelf: 'flex-start' }}
                        onClick={() => setRefreshID((value) => value + 1)}
                        disabled={loading}>重新检测此服务状态</Button>
                    </Stack>
                  )}
                  
              {((selectedPage === 'photo-face' && currentTab !== 'status') ||
                (['photo-smart', 'photo-semantic', 'photo-creative'].includes(selectedPage) &&
                  currentTab === 'verify')) &&
                <XDrivePhotoHostDesiredPanel source={source}
                  section={currentTab === 'history' ? 'history' : currentTab === 'verify' ? 'verify' : 'config'}
                  onDirtyChange={currentTab === 'config' ? setChildDirty : undefined} />}
              {selectedPage === 'media-worker' && currentTab !== 'status' &&
                <XDriveMediaWorkerConfigPanel source={source} refreshID={0}
                  section={selectedRuntimeSection} onDirtyChange={currentTab === 'config' ? setChildDirty : undefined} />}
              {selectedPage === 'database' && currentTab !== 'status' &&
                <XDrivePostgresPoolConfigPanel source={source} refreshID={0}
                  section={selectedRuntimeSection} onDirtyChange={currentTab === 'config' ? setChildDirty : undefined} />}
              {selectedPage === 'caddy' && (currentTab === 'config' || currentTab === 'history') &&
                <XDriveCaddyHTTPSDesiredPanel source={source} refreshID={0}
                  section={currentTab} onDirtyChange={currentTab === 'config' ? setCaddyHTTPSDirty : undefined}
                  onConfigurationChanged={invalidateCaddyEvidence} />}
              {selectedPage === 'caddy' && currentTab === 'config' &&
                <XDriveCaddyAliDNSPanel source={source} refreshID={0}
                  onDirtyChange={setCaddyAliDirty} onConfigurationChanged={invalidateCaddyEvidence} />}
              {selectedPage === 'caddy' && currentTab === 'verify' && <XDriveCaddyPreflightPanel source={source}
                refreshID={caddyEvidenceRevision} />}
              {selectedPage === 'background-worker' && currentTab !== 'status' &&
                <XDriveSourceWorkerConfigPanel source={source} refreshID={0}
                  section={selectedRuntimeSection} onDirtyChange={currentTab === 'config' ? setChildDirty : undefined} />}
              {selectedPage === 'photo-auto' && (currentTab === 'config' || currentTab === 'history') && (
                <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" fontWeight={700}>全局自动分析调度</Typography>
                    <Typography variant="body2" color="text.secondary">
                      仅控制新的人脸检测、人物聚类、动物/物体与 OCR、语义分析自动任务。
                      已运行的任务正常完成；手动重分析和独立 GeoNames 地名解析不受影响。
                      此开关不会安装、启动或停止 AI 容器。
                    </Typography>
                    {photoPolicy ? (
                      <Typography variant="body2" color={photoPolicy.apply_state === 'pending' ? 'warning.main' : 'text.secondary'}>
                        期望状态：{photoPolicy.auto_enabled ? '自动分析开启' : '自动分析暂停'}
                        {' · '}当前实例：{photoPolicy.effective_auto_enabled ? '开启' : '暂停'}
                        {' · '}修订号：{photoPolicy.revision}
                        {' · '}{photoPolicy.apply_state === 'applied' ? '当前实例已生效' : '当前实例待生效'}
                        {' · '}来源：{photoPolicy.source === 'saved' ? '管理员持久化设置' : '默认策略'}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        当前 Server/Agent 暂不支持管理全局自动分析策略；请检查版本。
                      </Typography>
                    )}
                    {currentTab === 'config' && <Stack spacing={1.5}>
                    <FormControlLabel
                      label="自动安排照片智能分析"
                      control={<Switch checked={photoAutoDraft}
                        onChange={(_event, value) => setPhotoAutoDraft(value)}
                        disabled={!photoPolicy?.editable || !source.savePhotoAutoConfig || photoPolicyBusy} />}
                    />
                    {photoPolicy?.kinds && photoPolicy.effective_kinds ? (
                      <Stack spacing={0.5} sx={{ pl: 1.5, borderLeft: '2px solid', borderColor: 'divider' }}>
                        <Typography variant="body2" fontWeight={600}>自动分析分项策略</Typography>
                        {photoAutoKindChoices.map((kind) => (
                          <FormControlLabel key={kind.key}
                            control={<Switch size="small" checked={photoKindsDraft[kind.key]}
                              onChange={(_event, value) => setPhotoKindsDraft((old) => ({ ...old, [kind.key]: value }))}
                              disabled={!photoPolicy.editable || !source.savePhotoAutoConfig || photoPolicyBusy} />}
                            label={(
                              <Stack spacing={0}>
                                <Typography variant="body2">{kind.title} · 当前实例分项策略：{photoPolicy.effective_kinds![kind.key] ? '开启（全局开关优先）' : '暂停'}</Typography>
                                <Typography variant="caption" color="text.secondary">{kind.description}</Typography>
                              </Stack>
                            )} />
                        ))}
                        <Typography variant="caption" color="text.secondary">
                          全局暂停优先于分项开关。分项状态只代表任务准入策略是否生效，
                          不代表模型已安装或容器健康；实际健康以每项服务探针为准。
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        当前 Server 尚不支持分项自动分析设置，请升级 Server 后使用。现有全局开关仍可操作。
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Button variant="contained" size="small"
                        disabled={!photoPolicy?.editable || !source.savePhotoAutoConfig || photoPolicyBusy ||
                          (photoPolicy.auto_enabled === photoAutoDraft && !photoKindsChanged)}
                        onClick={() => { void savePhotoAutoPolicy() }}>
                        {photoPolicyBusy ? '正在保存…' : '保存并应用到当前实例'}
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        保存后当前 Server 立即按新的准入策略执行；其他实例在周期刷新后尝试生效。模型与资源仍由受控部署管理。
                      </Typography>
                    </Stack>
                    </Stack>}
                    {currentTab === 'history' && source.loadPhotoAutoRevisions && source.rollbackPhotoAuto && (
                      <Stack spacing={1.25}>
                        <Typography variant="subtitle2" fontWeight={700}>配置历史与安全回滚</Typography>
                        <TextField select fullWidth size="small" label="回滚至历史自动分析策略"
                          value={photoRollbackTarget}
                          onChange={(event) => setPhotoRollbackTarget(event.target.value)}
                          disabled={photoPolicyBusy || !photoPolicy?.editable || !photoPolicy.kinds ||
                            !photoRevisions.some((item) => item.revision < (photoPolicy?.revision ?? 0))}
                          helperText="回滚完整的全局与四类任务准入配置，另存为新修订并审计；不会重启模型或停止运行中任务。">
                          <MenuItem value="">请选择较早的配置版本</MenuItem>
                          {photoRevisions.filter((item) => item.revision < (photoPolicy?.revision ?? 0))
                            .map((item) => (
                              <MenuItem key={item.revision} value={String(item.revision)}>
                                <Stack spacing={0}>
                                  <Typography variant="body2">
                                    修订 #{item.revision} · {item.auto_enabled ? '全局自动开启' : '全局自动暂停'}
                                    {' · '}{item.origin === 'default' ? '初始默认' : item.origin === 'rollback' ? '历史回滚' : '管理员保存'}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {photoAutoKindSummary(item.kinds)} · {new Date(item.created_at).toLocaleString()}
                                  </Typography>
                                </Stack>
                              </MenuItem>
                            ))}
                        </TextField>
                        <Button variant="outlined" size="small"
                          disabled={photoPolicyBusy || !photoPolicy?.editable || !selectedPhotoRevision}
                          onClick={() => setPhotoRollbackConfirmOpen(true)}>
                          确认回滚自动分析策略
                        </Button>
                        {photoHistoryError && (
                          <Typography variant="caption" color="warning.main">{photoHistoryError}</Typography>
                        )}
                        <XDriveConfirmDialog
                          open={photoRollbackConfirmOpen}
                          title="确认回滚照片智能分析调度策略"
                          description={selectedPhotoRevision
                            ? `将回滚到修订 #${selectedPhotoRevision.revision}：
全局自动分析${selectedPhotoRevision.auto_enabled ? '开启' : '暂停'}；${photoAutoKindSummary(selectedPhotoRevision.kinds)}。
将重新保存完整策略、写入审计并应用到当前 Server，之前未保存的编辑会被覆盖。
已运行分析任务不会中断，用户/管理员手动重分析及 GeoNames 不受影响；其他实例可能尚待刷新。`
                            : '历史修订已失效，请刷新配置后重新选择。'}
                          confirmLabel="确认并回滚完整策略"
                          loading={photoPolicyBusy}
                          onCancel={() => setPhotoRollbackConfirmOpen(false)}
                          onConfirm={() => { void rollbackPhotoAuto() }}
                        />
                      </Stack>
                    )}
                    {photoPolicyError && <XDriveStatusAlert tone="bad">{photoPolicyError}</XDriveStatusAlert>}
                    {photoPolicyNotice && <XDriveStatusAlert tone="good">{photoPolicyNotice}</XDriveStatusAlert>}
                  </Stack>
                </Paper>
              )}
              {selectedPage === 'baidu-map' && (currentTab === 'config' || currentTab === 'verify') && (
                <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      {currentTab === 'config' ? '百度地图 Server AK' : '静态地图 · 在线生效验证'}
                    </Typography>
                    {currentTab === 'config' ? (
                      <Typography variant="body2" color="text.secondary">
                        静态地图专用。保存后立即生效；管理员主动点击“显示”时才临时解密，30 秒后自动隐藏。
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        手动请求一张固定的 Static Map v2 图像（消耗一次 API 配额），不验证动态 JSAPI 4.0。
                      </Typography>
                    )}
                    {currentTab === 'config' && baiduConfig && (
                      <Typography variant="caption" color="text.secondary">
                        {baiduConfig.source === 'environment' ? '部署环境变量' : '管理员持久化设置'}
                        {' · '}修订 #{baiduConfig.revision}
                        {' · '}{baiduConfig.requires_restart ? '需重启' : '无需重启'}
                      </Typography>
                    )}
                    {currentTab === 'config' && baiduConfig && (
                      <XDriveStoredCredentialField
                        label="当前 Server AK"
                        configured={baiduConfig.configured}
                        revealedValue={baiduReveal?.field === 'ak' ? baiduReveal.value : ''}
                        loading={revealingAK}
                        expiresInSeconds={Math.min(30, Math.max(1, baiduReveal?.expires_in_seconds ?? 30))}
                        updatedAtLabel={baiduConfig.updated_at ? new Date(baiduConfig.updated_at).toLocaleString('zh-CN') : undefined}
                        configuredDescription={baiduConfig.source === 'environment'
                          ? 'AK 由部署环境提供；按权限审计读取。'
                          : 'AK 已加密保存；按权限审计读取。'}
                        onReveal={() => { void revealBaiduAK() }}
                        onHide={hideBaiduAK}
                      />
                    )}
                    {currentTab === 'config' && (baiduConfig?.editable ? (
                      <>
                        <FormControlLabel
                          label="启用百度地图"
                          control={
                            <Switch checked={baiduEnabled} onChange={(_event, value) => { ++baiduVerifyEpochRef.current; setBaiduVerification(null); setBaiduEnabled(value) }}
                              disabled={baiduBusy} />
                          }
                        />
                        <TextField
                          label="Server AK"
                          type="password"
                          size="small"
                          fullWidth
                          autoComplete="new-password"
                          value={baiduAK}
                          onChange={(event) => { ++baiduVerifyEpochRef.current; setBaiduVerification(null); setBaiduAK(event.target.value) }}
                          placeholder={baiduConfig.configured ? '留空则保留当前 AK' : '请输入百度地图 Server 类型 AK'}
                          inputProps={{ maxLength: 256 }}
                          disabled={baiduBusy}
                          helperText="只在保存时发送新 AK；主动显示的 AK 不会自动填入替换输入框。"
                        />
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button variant="contained" size="small" disabled={baiduBusy}
                            onClick={() => { void applyBaiduMap() }}>
                            {baiduBusy ? '正在保存…' : '保存并立即生效'}
                          </Button>
                          <Button color="error" variant="outlined" size="small"
                            disabled={baiduBusy || !baiduConfig.configured}
                            onClick={() => setClearConfirmOpen(true)}>
                            清除 AK
                          </Button>
                        </Stack>
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {baiduConfig
                          ? '当前部署尚未配置服务端凭据加密密钥环，无法在线修改 AK。请先配置 XD_CONNECTOR_SECRET_KEYS 并重新部署一次。'
                          : '当前 Server/Agent 不支持在线配置 AK；更新后即可在此编辑。'}
                      </Typography>
                    ))}
                    {currentTab === 'verify' && (
                    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                      <Button size="small" variant="outlined"
                        disabled={!baiduConfig?.enabled || !baiduConfig.configured ||
                          !source.verifyBaiduMap || baiduBusy || baiduVerifyBusy ||
                          baiduEnabled !== baiduConfig.enabled || baiduAK.trim() !== ''}
                        onClick={() => { void verifyBaiduMap() }}>
                        {baiduVerifyBusy ? '正在向百度验证…' : '验证当前 AK 在线生效'}
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        固定 128×128 · 不传用户 GPS · 不自动轮询或修改配置。
                      </Typography>
                    </Stack>
                    )}
                    {baiduVerification && (
                      <XDriveStatusAlert tone={baiduVerification.image_verified ? 'good' : 'bad'}>
                        {baiduVerification.image_verified
                          ? '本次检测：当前 Server 的 AK 修订 #' + baiduVerification.revision + ' 成功取得并解析百度在线 PNG 图像；不保证所有副本或未来请求。'
                          : baiduVerification.detail}
                        {' · '}检测于 {new Date(baiduVerification.checked_at).toLocaleString()}
                      </XDriveStatusAlert>
                    )}
                    {baiduVerifyError && <XDriveStatusAlert tone="bad">{baiduVerifyError}</XDriveStatusAlert>}
                    {baiduError && <XDriveStatusAlert tone="bad">{baiduError}</XDriveStatusAlert>}
                    {baiduNotice && <XDriveStatusAlert tone="good">{baiduNotice}</XDriveStatusAlert>}
                  </Stack>
                  <XDriveConfirmDialog
                    open={clearConfirmOpen}
                    title="确认清除百度地图 AK"
                    description="清除后百度地图将立即停用，但不会回退到其他地图。普通图库、文件服务及同步不受影响。"
                    confirmLabel="清除 AK 并停用地图"
                    confirmIntent="danger"
                    loading={baiduBusy}
                    onCancel={() => setClearConfirmOpen(false)}
                    onConfirm={() => { void applyBaiduMap(true) }}
                  />
                </Paper>
              )}
              {selectedPage === 'baidu-map' && (currentTab === 'config' || currentTab === 'verify') && (
                <XDriveBaiduJSAPIDesiredPanel source={source} mode={currentTab}
                  onDirtyChange={currentTab === 'config' ? setBaiduJSAPIDirty : undefined} />
              )}
              {selectedPage === 'geonames' && currentTab === 'verify' && (
                <Stack spacing={1.5} sx={{ mt: 1 }} data-xdrive-geonames-readonly-runtime>
                  <Typography variant="body2" color="text.secondary">
                    本次只读状态检测重新读取当前 Server 已加载的 GeoNames 解析器及其版本，
                    不扫描文件、不重新计算 SHA-256、不中断地名解析，也不会切换数据集。
                    「可用」仅代表此 Server 当前已加载索引，不等于持久目标修订、所有副本或地名标签结果已验证。
                    下方「只读刷新目标与副本修订」读取当前受限管理状态；
                    「校验并热加载」才会修改正在使用的索引，两类操作必须明确区分。
                  </Typography>
                  <Button variant="outlined" size="small" sx={{ alignSelf: 'flex-start' }}
                    onClick={() => setRefreshID((value) => value + 1)}
                    disabled={loading || refreshing}>只读刷新当前实例索引状态</Button>
                </Stack>
              )}
              {selectedPage === 'geonames' && (currentTab === 'config' || currentTab === 'verify' || currentTab === 'history') && (
                <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" fontWeight={700}>GeoNames 地名索引</Typography>
                    <Typography variant="body2" color="text.secondary">
                      GeoNames 只负责地名标签，地图仍只使用百度地图。数据文件位置保持受信任的只读部署挂载；
                      匹配距离可在本页修改并持久化，验证完整索引后在当前 Server 热生效，运行中批次不受影响。
                    </Typography>
                    {geoNamesConfig ? (
                      <Stack spacing={1}>
                        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                          {geoNamesConfig.dataset_configured ? '索引已加载' : '未加载地名索引'}
                          {' · '}当前索引版本：{geoNamesConfig.current_version || '无'}
                          {' · '}配置来源：{geoNamesConfig.source === 'saved' ? '管理员持久化设置' : '部署环境'}
                          {' · '}修订号：{geoNamesConfig.revision}
                        </Typography>
                        <Typography variant="body2" color={geoNamesConfig.apply_state === 'pending' ? 'warning.main' : 'text.secondary'}>
                          期望匹配距离：{geoNamesConfig.max_distance_km} km
                          {' · '}当前实例实际距离：{geoNamesConfig.effective_max_distance_km || '不可用'} km
                          {' · '}{geoNamesConfig.apply_state === 'applied'
                            ? '当前实例已生效（不代表其他实例）'
                            : geoNamesConfig.apply_state === 'pending' ? '当前实例待生效' : '索引不可用'}
                          {typeof geoNamesConfig.effective_revision === 'number'
                            ? ` · 当前实例实际修订 #${geoNamesConfig.effective_revision}` : ''}
                        </Typography>
                        {geoNamesConfig.replica_apply_state ? (
                          <Stack spacing={0.5} data-xdrive-geonames-replica-status>
                            <Typography variant="body2"
                              color={geoNamesConfig.replica_apply_state === 'pending' ? 'warning.main' : 'text.secondary'}>
                              已观察的在线 Server：{geoNamesConfig.observed_instances ?? 0} 个
                              {' · '}半径修订已确认：{geoNamesConfig.applied_instances ?? 0} 个
                              {' · '}未加载数据集：{geoNamesConfig.unconfigured_instances ?? 0} 个
                              {' · '}{geoNamesConfig.replica_apply_state === 'applied'
                                ? '已观察实例的修订和数据集版本一致'
                                : geoNamesConfig.replica_apply_state === 'pending'
                                  ? '部分在线实例尚未生效或数据集版本不一致'
                                  : geoNamesConfig.replica_apply_state === 'unmanaged'
                                    ? '尚无管理员持久化修订；不能确认集群生效'
                                    : geoNamesConfig.replica_apply_state === 'unavailable'
                                      ? '没有有效的在线实例心跳'
                                      : '跨实例状态暂不可验证'}
                            </Typography>
                            {geoNamesConfig.dataset_versions?.map((item) => (
                              <Typography key={item.version} variant="caption" color="text.secondary">
                                数据集指纹 {item.version} · {item.count} 个在线实例
                              </Typography>
                            ))}
                            <Typography variant="caption" color="text.secondary">
                              仅汇总最近 20 秒内有心跳的实例，不是部署节点名册；
                              未观测的实例不能判定为已生效。心跳约每 5 秒更新。
                              {geoNamesConfig.replica_status_truncated
                                ? ' 在线实例超过 100 个观测上限，不能声明全部已生效。' : ''}
                            </Typography>
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            当前 Server/Agent 未提供跨实例应用确认；只能验证当前 Server。
                          </Typography>
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        当前 Server/Agent 尚未提供 GeoNames 配置状态，请检查版本或连接。
                      </Typography>
                    )}
                    {currentTab === 'config' && <Stack spacing={1.5}>
                    <TextField
                      label="地名匹配最大距离（km）"
                      size="small"
                      type="number"
                      fullWidth
                      value={geoNamesDraftDistance}
                      onChange={(event) => setGeoNamesDraftDistance(event.target.value)}
                      inputProps={{ min: 0.001, max: 500, step: 'any' }}
                      disabled={geoNamesBusy || !geoNamesConfig?.editable || !source.saveGeoNamesConfig}
                      helperText="范围 (0, 500] km；保存会验证只读数据集并立即应用到当前实例，不改变百度地图。"
                    />
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Button variant="contained" size="small"
                        disabled={geoNamesBusy || !geoNamesConfig?.editable || !source.saveGeoNamesConfig}
                        onClick={() => { void saveGeoNamesConfig() }}>
                        {geoNamesBusy ? '正在验证并保存…' : '保存距离并应用'}
                      </Button>
                      <Button variant="outlined" size="small"
                        disabled={geoNamesBusy || !geoNamesConfig?.reload_supported || !source.reloadGeoNames}
                        onClick={() => { void reloadGeoNames() }}>
                        {geoNamesBusy ? '正在验证和热加载…' : '校验并热加载 GeoNames 数据'}
                      </Button>
                    </Stack>
                    </Stack>}
                    {currentTab === 'verify' && <Stack spacing={1.5}>
                    <Button variant="outlined" size="small" sx={{ alignSelf: 'flex-start' }}
                      disabled={geoNamesBusy || !source.loadGeoNamesConfig || unsavedRef.current}
                      onClick={() => { void refreshGeoNamesReadOnly() }}
                      data-xdrive-geonames-readonly-revision>
                      {geoNamesBusy ? '正在读取修订…' : '只读刷新目标与副本修订'}
                    </Button>
                    <Typography variant="caption" color="text.secondary">
                      仅重新读取期望／实际修订及最近心跳副本；不会校验、复制、应用或切换 GeoNames 数据集。
                      下一个「校验并热加载」是独立修改操作，不属于只读检测。
                    </Typography>
                    <Button variant="outlined" size="small" sx={{ alignSelf: 'flex-start' }}
                      disabled={geoNamesBusy || !geoNamesConfig?.reload_supported || !source.reloadGeoNames}
                      onClick={() => { void reloadGeoNames() }}>
                      {geoNamesBusy ? '正在验证和热加载…' : '校验并热加载 GeoNames 数据'}
                    </Button>
                    <Stack spacing={1} data-xdrive-geonames-dataset-snapshots>
                      <Typography variant="subtitle2" fontWeight={700}>
                        GeoNames 数据集版本快照
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        只对已挂载的受信任 GeoNames 三文件进行限额复制和完整索引校验，
                        保存为本 Server 可读取的历史快照。创建快照不会切换当前索引；
                        在线上传及跨实例文件分发仍待后续安全控制；历史快照可经验证后选为持久化目标。
                      </Typography>
                      {geoNamesConfig?.active_dataset_source && (
                        <Typography variant="body2" color="text.secondary">
                          当前 Server 实际数据来源：{geoNamesConfig.active_dataset_source === 'snapshot'
                            ? '历史快照' : '部署只读挂载'}
                          {geoNamesConfig.active_dataset_fingerprint
                            ? ` · 指纹 ${geoNamesConfig.active_dataset_fingerprint.slice(0, 16)}…` : ''}
                          {' · '}{geoNamesConfig.active_dataset_persistent
                            ? '已匹配持久化目标；重启后重新校验' : '与期望配置不一致，等待本实例校验应用'}
                        </Typography>
                      )}
                      {geoNamesConfig?.desired_dataset_fingerprint !== undefined && (
                        <Typography variant="body2" color={geoNamesConfig.apply_state === 'applied' ? 'text.secondary' : 'warning.main'}>
                          期望版本：{geoNamesConfig.desired_dataset_fingerprint
                            ? '已存档指纹 ' + geoNamesConfig.desired_dataset_fingerprint.slice(0, 16) + '…' : '部署只读挂载'}
                          {' · '}当前实例：{geoNamesConfig.apply_state === 'applied' ? '已校验生效' : '待验证或未生效'}
                          {' · '}重启重新校验，归档缺失时不得标记为已生效。
                        </Typography>
                      )}
                      {geoNamesConfig?.desired_dataset_fingerprint &&
                        geoNamesConfig.missing_archive_state !== undefined &&
                        geoNamesConfig.missing_archive_state !== 'present-unverified' && (
                        <Stack spacing={1}>
                          <Typography variant="body2" color="warning.main">
                            当前期望归档：{geoNamesConfig.missing_archive_state === 'missing' ? '本实例缺失' :
                              geoNamesConfig.missing_archive_state === 'invalid' ? '路径存在但不可信' : '恢复条件不可用'}。
                            {' '}{geoNamesConfig.restore_missing_hint}
                          </Typography>
                          {geoNamesConfig.missing_archive_state === 'missing' && (
                            <>
                              <Button variant="outlined" size="small"
                                disabled={geoNamesBusy || !geoNamesConfig.restore_missing_enabled ||
                                  !source.restoreMissingGeoNamesSnapshot}
                                onClick={() => setGeoNamesRestoreConfirmOpen(true)}>
                                {geoNamesBusy ? '正在验证恢复…' : '从受信任挂载恢复缺失的目标归档'}
                              </Button>
                              <XDriveConfirmDialog
                                open={geoNamesRestoreConfirmOpen}
                                title="确认恢复当前 Server 的缺失 GeoNames 归档"
                                description="只复制部署已挂载的三个固定文件，并严格校验与期望 SHA-256 及审计字节数一致后，恢复缺失目录、写入审计并热应用当前实例。目录存在但损坏时不会覆盖；不会分发到其他 Server。"
                                confirmLabel="校验并恢复缺失归档"
                                loading={geoNamesBusy}
                                onCancel={() => setGeoNamesRestoreConfirmOpen(false)}
                                onConfirm={() => { void restoreMissingGeoNamesSnapshot() }}
                              />
                            </>
                          )}
                        </Stack>
                      )}
                      <Button variant="outlined" size="small"
                        disabled={geoNamesBusy || !geoNamesConfig?.snapshot_supported ||
                          !source.stageGeoNamesSnapshot}
                        onClick={() => setGeoNamesSnapshotConfirmOpen(true)}>
                        {geoNamesBusy ? '正在校验并保存快照…' : '建立不可变数据集快照'}
                      </Button>
                      {!geoNamesConfig?.snapshot_supported && (
                        <Typography variant="caption" color="text.secondary">
                          {geoNamesConfig?.snapshot_requirement ??
                            '当前 Server/Agent 尚未支持数据集快照；需先配置独立可写的持久目录。'}
                        </Typography>
                      )}
                      {geoNamesConfig?.snapshot_history_known && (geoNamesConfig.snapshots?.length ?? 0) === 0 && (
                        <Typography variant="caption" color="text.secondary">当前还没有保存数据集快照。</Typography>
                      )}
                      {geoNamesConfig?.snapshots?.map((entry) => (
                        <Box key={entry.fingerprint} sx={{
                          border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1,
                          overflowWrap: 'anywhere',
                        }}>
                          <Typography variant="caption" fontWeight={700}>
                            数据集指纹 {entry.fingerprint.slice(0, 16)}…
                            {' · '}{entry.fingerprint === geoNamesConfig?.active_dataset_fingerprint
                              ? (geoNamesConfig.active_dataset_persistent ? '当前实例已生效且目标持久化' : '当前实例已生效')
                              : entry.fingerprint === geoNamesConfig?.desired_dataset_fingerprint ? '目标已保存，本实例待生效' : '已暂存，未应用'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {entry.total_bytes} 字节 · 验证时匹配距离 {entry.checked_radius_km} km
                            {' · '}配置修订 #{entry.checked_revision}
                            {' · '}{entry.locally_present ? '本 Server 存储目录存在（未重新验签）' : '本 Server 未确认存储目录'}
                            {' · '}{new Date(entry.created_at).toLocaleString('zh-CN')}
                          </Typography>
                        </Box>
                      ))}
                      {source.applyGeoNamesDataset && geoNamesConfig?.snapshot_apply_supported &&
                        geoNamesConfig.desired_dataset_fingerprint !== undefined && (
                        <Stack spacing={1}>
                          <TextField select fullWidth size="small"
                            label="校验并持久保存目标版本，应用到当前 Server"
                            value={geoNamesDatasetTarget}
                            onChange={(event) => setGeoNamesDatasetTarget(event.target.value)}
                            disabled={geoNamesBusy}
                            helperText="目标与审计持久保存，当前实例热应用；重启需重新验证。不会修改部署目录或跨实例分发。">
                            <MenuItem value="">选择要重新验证并加载的数据源</MenuItem>
                            <MenuItem value="deployment">恢复部署只读数据集</MenuItem>
                            {geoNamesConfig.snapshots?.filter((entry) => entry.locally_present)
                              .map((entry) => (
                                <MenuItem key={entry.fingerprint} value={entry.fingerprint}>
                                  历史版本 {entry.fingerprint.slice(0, 16)}… · {entry.total_bytes} 字节
                                </MenuItem>
                              ))}
                          </TextField>
                          <Button variant="outlined" size="small"
                            disabled={geoNamesBusy || !geoNamesDatasetTarget ||
                              (geoNamesDatasetTarget === 'deployment'
                                ? geoNamesConfig.active_dataset_source !== 'snapshot' &&
                                  geoNamesConfig.desired_dataset_fingerprint === ''
                                : geoNamesDatasetTarget === geoNamesConfig.active_dataset_fingerprint &&
                                  geoNamesDatasetTarget === geoNamesConfig.desired_dataset_fingerprint)}
                            onClick={() => setGeoNamesDatasetConfirmOpen(true)}>
                            校验并应用到当前 Server
                          </Button>
                          <XDriveConfirmDialog
                            open={geoNamesDatasetConfirmOpen}
                            title="确认持久保存并热应用 GeoNames 数据集"
                            description="校验目标归档真实内容，在一个事务内保存目标指纹与审计，再热切换当前实例。重启会重新校验；缺失时保持待生效，不代表其他实例已应用。"
                            confirmLabel="确认保存并热应用"
                            loading={geoNamesBusy}
                            onCancel={() => setGeoNamesDatasetConfirmOpen(false)}
                            onConfirm={() => { void applyGeoNamesDataset() }}
                          />
                        </Stack>
                      )}
                      <XDriveConfirmDialog
                        open={geoNamesSnapshotConfirmOpen}
                        title="建立 GeoNames 数据集历史快照"
                        description="从已有只读挂载复制三个 GeoNames 文件到独立持久目录，并完成实际索引校验后记录审计。不会修改当前索引或影响同步；不会分发、应用或回滚至该快照。"
                        confirmLabel="确认校验并暂存"
                        loading={geoNamesBusy}
                        onCancel={() => setGeoNamesSnapshotConfirmOpen(false)}
                        onConfirm={() => { void stageGeoNamesSnapshot() }}
                      />
                    </Stack>
                    </Stack>}
                    {currentTab === 'history' && source.loadGeoNamesRevisions && source.rollbackGeoNames && (
                      <Stack spacing={1.25}>
                        <TextField select fullWidth size="small" label="回滚至历史匹配距离"
                          value={geoNamesRollbackTarget}
                          onChange={(event) => setGeoNamesRollbackTarget(event.target.value)}
                          disabled={geoNamesBusy || !geoNamesConfig?.editable ||
                            !geoNamesRevisions.some((item) => item.revision < (geoNamesConfig?.revision ?? 0))}
                          helperText="仅回滚匹配距离；会重新校验当前只读数据集并产生新的修订，不会回滚磁盘数据文件。">
                          <MenuItem value="">请选择较早的配置版本</MenuItem>
                          {geoNamesRevisions.filter((item) => item.revision < (geoNamesConfig?.revision ?? 0))
                            .map((item) => (
                              <MenuItem key={item.revision} value={String(item.revision)}>
                                修订 #{item.revision} · {item.max_distance_km} km · {item.origin === 'environment'
                                  ? '初始部署' : item.origin === 'rollback' ? '历史回滚' : '管理员保存'}
                              </MenuItem>
                            ))}
                        </TextField>
                        <Button variant="outlined" size="small"
                          disabled={geoNamesBusy || !geoNamesConfig?.editable || !geoNamesRollbackTarget}
                          onClick={() => setGeoNamesRollbackConfirmOpen(true)}>
                          确认回滚历史配置
                        </Button>
                        {geoNamesHistoryError ? (
                          <Typography variant="caption" color="warning.main">{geoNamesHistoryError}</Typography>
                        ) : null}
                        <XDriveConfirmDialog
                          open={geoNamesRollbackConfirmOpen}
                          title="确认回滚 GeoNames 匹配距离"
                          description={`将回滚到修订 #${geoNamesRollbackTarget} 的匹配距离，重新验证当前只读数据集，
并在通过审计后立即应用到当前 Server。已有地名任务保持原快照；其他实例可能需要单独重载。`}
                          confirmLabel="校验并回滚配置"
                          loading={geoNamesBusy}
                          onCancel={() => setGeoNamesRollbackConfirmOpen(false)}
                          onConfirm={() => { void rollbackGeoNames() }}
                        />
                      </Stack>
                    )}
                    {!geoNamesConfig?.reload_supported && (
                      <Typography variant="caption" color="text.secondary">
                        需先部署只读 GeoNames 数据集并加载初始索引。本页不提供任意宿主路径修改，也不宣称所有 Server 实例已同时生效。
                      </Typography>
                    )}
                    {geoNamesError && <XDriveStatusAlert tone="bad">{geoNamesError}</XDriveStatusAlert>}
                    {geoNamesNotice && <XDriveStatusAlert tone="good">{geoNamesNotice}</XDriveStatusAlert>}
                  </Stack>
                </Paper>
              )}
                          </Box>
                              </Box>
                            )
                          })}
                        </AccordionDetails>
                      </Accordion>
                    )
                  })}
                  </>)}
            </Box>
          )
            })}
          </Box>
        </Stack>
        <XDriveConfirmDialog
          open={pendingNavigation !== null}
          title="离开未保存的系统依赖配置？"
          description="当前服务的编辑尚未保存。确认离开将放弃这些修改；已经发起的后台操作不会被取消。"
          confirmLabel="放弃修改并切换"
          onCancel={() => {
            if (pendingNavigation?.external) onLocationChange?.(visibleLocation, { replace: true })
            setPendingNavigation(null)
          }}
          onConfirm={() => {
            if (!pendingNavigation) return
            setChildDirty(false)
            setCaddyHTTPSDirty(false)
            setCaddyAliDirty(false)
            setVisibleLocation(pendingNavigation.next)
            if (!pendingNavigation.external) onLocationChange?.(pendingNavigation.next)
            setPendingNavigation(null)
          }}
        />
        {dependencyNote}
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
