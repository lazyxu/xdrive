import { useState, type MouseEvent } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveSectionHeader,
  XDriveWorkspaceSurface,
  XDriveStatePanel,
  XDriveStatusBadge,
} from '@xdrive/ui/mui'

const diagnosticTitles: Record<string, string> = {
  'client version': '客户端版本',
  'update source': '更新来源',
  'update channel': '更新通道',
  'update metadata': '更新检查',
  'update download': '更新下载',
  'local config': '本地配置',
  'credential store': '凭据保护',
  'cache policy': '缓存策略',
  'sync root': '同步根目录',
  'server URL': '服务器地址',
  'server health': '服务器连接',
  TLS: 'HTTPS 证书',
  'login session': '登录状态',
  'last client update': '最近客户端更新',
  'disk space': '磁盘空间',
  'CfAPI sync root': 'Windows 同步根目录',
  'FUSE mount': 'Linux 文件系统挂载',
  'auto updater': '自动更新',
  'updater timer': '自动更新定时任务',
  'mount agent': 'Linux 后台挂载服务',
  'platform checks': '平台检查',
  'agent process': '后台服务进程',
  'desktop IPC': '桌面通信',
  '桌面版 / Agent 兼容性': '桌面版与后台服务兼容性',
  'Windows 任务栏快捷操作': 'Windows 任务栏快捷操作',
  '桌面图形加速': '桌面图形加速',
}

type UserDiagnosticLevel = 'PASS' | 'INFO' | 'WARN' | 'FAIL'

const statusPresentation = {
  PASS: { label: '正常', tone: 'good' as const },
  INFO: { label: '提示', tone: 'neutral' as const },
  WARN: { label: '需注意', tone: 'warning' as const },
  FAIL: { label: '异常', tone: 'bad' as const },
}

function diagnosticUserLevel(check: AgentDiagnosticCheck): UserDiagnosticLevel {
  if (check.status === 'PASS') return 'PASS'
  if (check.status === 'FAIL') return 'FAIL'

  const detail = check.detail.trim()
  if (
    check.name === 'update metadata' ||
    check.name === 'update download' ||
    check.name === 'update channel' ||
    check.name === 'Windows 任务栏快捷操作' ||
    check.name === '桌面图形加速' ||
    /skipped because/i.test(detail) ||
    (check.name === 'last client update' && /^(preparing|installing|verifying)\b/i.test(detail)) ||
    (check.name === 'auto updater' && /disabled by XD_DISABLE_AUTO_UPDATE=1/i.test(detail))
  ) {
    return 'INFO'
  }
  return 'WARN'
}

const binaryUnitBytes: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
}

function diagnosticTitle(name: string) {
  if (diagnosticTitles[name]) return diagnosticTitles[name]
  return /[\u3400-\u9fff]/.test(name) ? name : '其他检查'
}

function diskSpaceDetail(detail: string, warning: boolean) {
  const match = detail.trim().match(/^([\d.]+)\s+(B|KiB|MiB|GiB|TiB)\s+free of\s+([\d.]+)\s+(B|KiB|MiB|GiB|TiB)$/i)
  if (!match) return warning
    ? '磁盘剩余空间较低，建议释放空间，避免影响同步和更新。'
    : '磁盘空间正常。'

  const [, freeValue, freeUnitRaw, totalValue, totalUnitRaw] = match
  const freeUnit = Object.keys(binaryUnitBytes).find((unit) => unit.toLowerCase() === freeUnitRaw.toLowerCase()) || freeUnitRaw
  const totalUnit = Object.keys(binaryUnitBytes).find((unit) => unit.toLowerCase() === totalUnitRaw.toLowerCase()) || totalUnitRaw
  const freeBytes = Number(freeValue) * (binaryUnitBytes[freeUnit] || 1)
  const totalBytes = Number(totalValue) * (binaryUnitBytes[totalUnit] || 1)
  const percent = totalBytes > 0 ? Math.round(freeBytes * 100 / totalBytes) : null
  const suffix = warning ? '。建议释放空间，避免影响同步和更新。' : '。'
  return `剩余 ${freeValue} ${freeUnit} / ${totalValue} ${totalUnit}${percent === null ? '' : `（约 ${percent}%）`}${suffix}`
}

function diagnosticUserDetail(check: AgentDiagnosticCheck) {
  const detail = check.detail.trim()
  const warning = check.status !== 'PASS'

  switch (check.name) {
    case 'client version':
      return `当前客户端版本：${detail}`
    case 'update source':
      return `更新来源：${detail.toLowerCase() === 'github' ? 'GitHub' : detail.toLowerCase() === 'gitlab' ? 'GitLab' : detail}`
    case 'update channel':
      if (/development build; no automatic channel/i.test(detail)) return '当前是开发构建，没有自动更新通道。'
      return `更新通道：${detail === 'master' ? '开发快照（master）' : detail === 'stable' ? '稳定版（stable）' : detail}`
    case 'update metadata':
      if (/context deadline exceeded|timeout|timed out/i.test(detail)) {
        return '暂时无法确认是否有新版本，可能是网络响应较慢；不影响当前同步使用。'
      }
      if (/update available:/i.test(detail)) {
        const version = detail.match(/update available:\s*([^\s(]+)/i)?.[1]
        return version ? `发现新版本 ${version}，可以在设置中更新。` : '发现可用的新版本。'
      }
      return warning ? '暂时无法检查更新信息；不影响当前同步使用。' : '更新检查正常。'
    case 'update download':
      return warning ? '更新文件的可用性检查失败，请稍后重试；不影响当前同步。' : '更新文件可正常获取。'
    case 'local config':
      return warning ? '本地配置不可用，部分功能可能无法正常工作。' : '本地配置已正常加载。'
    case 'cache policy': {
      const limit = detail.match(/^limit\s+(.+)$/i)?.[1]
      return limit ? `缓存上限：${limit}` : /unlimited/i.test(detail) ? '缓存未设置容量上限。' : warning ? '缓存策略暂时无法读取。' : '缓存策略正常。'
    }
    case 'disk space':
      return diskSpaceDetail(detail, warning)
    case 'CfAPI sync root':
      return warning
        ? 'Windows 云文件集成状态异常，可能影响按需文件功能。'
        : 'Windows 云文件集成状态正常。'
    case 'FUSE mount':
      return warning ? 'Linux 文件系统挂载状态异常，可能影响文件访问。' : 'Linux 文件系统挂载正常。'
    case 'mount agent':
      return warning ? 'Linux 后台挂载服务未正常运行，可能影响文件访问。' : 'Linux 后台挂载服务正常。'
    case 'sync root':
      return warning ? '同步根目录状态异常，可能影响文件同步。' : `同步根目录：${detail}`
    case 'server URL':
      return warning ? '服务器地址配置无效，请检查设置。' : `服务器地址：${detail}`
    case 'server health': {
      const httpCode = detail.match(/HTTP\s+(\d+)/i)?.[1]
      return warning ? '无法正常连接 xDrive Server，请检查网络或服务器状态。' : httpCode ? `服务器连接正常（HTTP ${httpCode}）。` : '服务器连接正常。'
    }
    case 'TLS': {
      const expires = detail.match(/certificate valid until\s+(\d{4}-\d{2}-\d{2})/i)?.[1]
      if (warning && expires) return `HTTPS 证书将在 ${expires} 到期，请尽快续期。`
      return warning ? 'HTTPS 连接或证书状态异常，请检查服务器证书。' : expires ? `HTTPS 证书有效至 ${expires}。` : 'HTTPS 证书状态正常。'
    }
    case 'login session':
      return warning ? '登录状态异常，可能需要重新连接服务器。' : '登录认证正常。'
    case 'credential store':
      return warning ? '系统凭据保护不可用，保存的登录凭据可能无法正常使用。' : '登录凭据已由系统安全保护。'
    case 'auto updater':
      if (/disabled by XD_DISABLE_AUTO_UPDATE=1/i.test(detail)) return '自动更新已由当前运行配置关闭；不影响手动更新。'
      return warning ? '自动更新未正常启用，可能无法自动检查或下载新版本。' : '自动更新状态正常。'
    case 'updater timer':
      return warning ? '自动更新定时任务未正常运行，可能无法后台检查更新。' : '自动更新定时任务正常。'
    case 'last client update':
      if (/rolled_back/i.test(detail)) return '最近一次客户端更新已回滚，当前仍可使用；建议查看日志确认原因。'
      if (/^(preparing|installing|verifying)\b/i.test(detail)) return '客户端更新正在进行中。'
      if (/^success\b/i.test(detail)) return '最近一次客户端更新已成功完成。'
      return check.status === 'FAIL' ? '最近一次客户端更新失败，建议查看日志。' : '最近一次客户端更新状态正常。'
    case 'agent process':
    case 'desktop IPC':
    case '桌面版 / Agent 兼容性':
      return warning ? '桌面版与后台服务通信异常，建议重启后台服务后重新诊断。' : '桌面版与后台服务通信正常。'
    case 'Windows 任务栏快捷操作':
      return warning ? 'Windows 任务栏集成未完全启用，不影响文件同步。' : 'Windows 任务栏集成正常。'
    case '桌面图形加速':
      return warning ? '桌面图形加速已切换到兼容模式，不影响同步功能。' : '桌面图形加速正常。'
    default:
      return warning
        ? '此项检查需要注意。展开“技术检查详情”可查看原始诊断信息。'
        : '检查正常。'
  }
}

function diagnosticCategory(name: string) {
  if (['server URL', 'server health', 'TLS', 'login session'].includes(name)) return '服务器连接'
  if (['sync root', 'disk space', 'CfAPI sync root', 'FUSE mount'].includes(name)) return '本地存储与同步'
  if (['mount agent', 'agent process', 'desktop IPC', '桌面版 / Agent 兼容性', 'Windows 任务栏快捷操作', '桌面图形加速'].includes(name)) return '桌面集成'
  return '客户端与更新'
}

export function DesktopDiagnosticsPage({
  diagnostics,
  busy,
  paused,
  onRun,
  onRestartAgent,
  onReconnect,
  onRepairSyncRoot,
  onOpenStorage,
  onOpenSettings,
  onOpenUpdateSettings,
  onOpenLogs,
  onExport,
}: {
  diagnostics: AgentDiagnosticReport | null
  busy: string
  paused: boolean
  onRun: () => void
  onRestartAgent: () => void
  onReconnect: () => void
  onRepairSyncRoot: () => void
  onOpenStorage: () => void
  onOpenSettings: () => void
  onOpenUpdateSettings: () => void
  onOpenLogs: () => void
  onExport: () => void
}) {
  const disabled = Boolean(busy)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  const closeMenu = () => setMenuAnchor(null)
  const runMenuAction = (action: () => void) => {
    closeMenu()
    action()
  }

  const headerActions = (
    <Stack direction="row" spacing={1} alignItems="center">
      <XDriveActionButton
        intent="primary"
        disabled={disabled}
        loading={busy === 'diagnostics'}
        loadingLabel="正在检查…"
        onClick={onRun}
      >
        重新诊断
      </XDriveActionButton>
      <IconButton
        aria-label="更多诊断操作"
        size="small"
        disabled={disabled}
        onClick={(event: MouseEvent<HTMLElement>) => setMenuAnchor(event.currentTarget)}
      >
        <Typography component="span" sx={{ fontSize: 22, lineHeight: 1 }}>⋯</Typography>
      </IconButton>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
      >
        <MenuItem disabled={disabled} onClick={() => runMenuAction(onOpenLogs)}>打开日志</MenuItem>
        <MenuItem disabled={disabled} onClick={() => runMenuAction(onExport)}>导出诊断报告</MenuItem>
      </Menu>
    </Stack>
  )

  if (!diagnostics) {
    return (
      <XDriveWorkspaceSurface presentation="page" title="诊断">
        <Stack spacing={2.5}>
          <XDriveSectionHeader
            eyebrow="诊断与自修复"
            title="系统状态"
            subtitle="检查连接、同步、更新和系统集成；默认只显示需要处理的问题。"
            actions={headerActions}
          />
          <XDriveStatePanel message="运行诊断后，这里会优先显示需要处理的问题；完整技术检查仍可在详情中查看和导出。" />
        </Stack>
      </XDriveWorkspaceSurface>
    )
  }

  const presentedChecks = diagnostics.checks.map((check) => ({ check, level: diagnosticUserLevel(check) }))
  const issueChecks = presentedChecks.filter(({ level }) => level !== 'PASS')
  const infoCount = presentedChecks.filter(({ level }) => level === 'INFO').length
  const warnCount = presentedChecks.filter(({ level }) => level === 'WARN').length
  const failCount = presentedChecks.filter(({ level }) => level === 'FAIL').length
  const groupedChecks = diagnostics.checks.reduce<Record<string, AgentDiagnosticCheck[]>>((groups, check) => {
    const category = diagnosticCategory(check.name)
    ;(groups[category] ||= []).push(check)
    return groups
  }, {})
  const summaryTone = failCount > 0 ? 'bad' : warnCount > 0 ? 'warning' : 'good'
  const summaryLabel = failCount > 0 ? '异常' : warnCount > 0 ? '需注意' : '正常'
  const summaryTitle = failCount > 0
    ? '发现需要处理的问题'
    : warnCount > 0
      ? '系统总体正常'
      : '系统状态正常'
  const summaryText = failCount > 0
    ? `发现 ${failCount} 项异常${warnCount > 0 ? `，${warnCount} 项需要注意` : ''}${infoCount > 0 ? `，另有 ${infoCount} 项提示` : ''}。建议优先处理异常项。`
    : warnCount > 0
      ? `未发现故障，有 ${warnCount} 项需要注意${infoCount > 0 ? `，另有 ${infoCount} 项提示` : ''}。`
      : infoCount > 0
        ? `未发现需要处理的问题，有 ${infoCount} 项提示。`
        : '未发现需要处理的问题。'

  const issueAction = (check: AgentDiagnosticCheck) => {
    switch (check.name) {
      case 'update metadata':
        if (/update available:/i.test(check.detail)) {
          return { label: '打开更新设置', loading: false, run: onOpenUpdateSettings }
        }
        return { label: '重新检查', loading: busy === 'diagnostics', run: onRun }
      case 'update download':
        return { label: '重新检查', loading: busy === 'diagnostics', run: onRun }
      case 'update source':
      case 'update channel':
        return { label: '打开更新设置', loading: false, run: onOpenUpdateSettings }
      case 'disk space':
        return { label: '查看本地存储', loading: false, run: onOpenStorage }
      case 'CfAPI sync root':
      case 'sync root':
        return { label: '修复同步根目录', loading: busy === 'repair-sync-root', disabled: paused, run: onRepairSyncRoot }
      case 'FUSE mount':
      case 'mount agent':
        return { label: '重启后台服务', loading: busy === 'restart-agent', run: onRestartAgent }
      case 'server URL':
        return { label: '打开设置', loading: false, run: onOpenSettings }
      case 'server health':
      case 'login session':
        return { label: '重新连接', loading: busy === 'reconnect', disabled: paused, run: onReconnect }
      case 'TLS':
        return { label: '查看日志', loading: busy === 'open-logs', run: onOpenLogs }
      case 'auto updater':
      case 'updater timer':
        return { label: '打开设置', loading: false, run: onOpenSettings }
      case 'last client update':
        return { label: '查看日志', loading: busy === 'open-logs', run: onOpenLogs }
      case 'agent process':
      case 'desktop IPC':
      case '桌面版 / Agent 兼容性':
        return { label: '重启后台服务', loading: busy === 'restart-agent', run: onRestartAgent }
      default:
        return null
    }
  }

  return (
    <XDriveWorkspaceSurface presentation="page" title="诊断">
      <Stack spacing={2.5}>
        <XDriveSectionHeader
          eyebrow="诊断与自修复"
          title="系统状态"
          subtitle="优先显示需要处理的问题；完整检查结果保留在下方详情中，原始技术信息可通过导出报告查看。"
          actions={headerActions}
        />

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
              <XDriveStatusBadge tone={summaryTone} label={summaryLabel} />
              <Typography variant="h6" fontWeight={700}>{summaryTitle}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">{summaryText}</Typography>
            <Typography variant="caption" color="text.secondary">
              上次检查：{new Date(diagnostics.generated_at).toLocaleString()}
            </Typography>
          </Stack>
        </Paper>

        {issueChecks.length > 0 ? (
          <Stack spacing={1.25}>
            <Typography variant="subtitle1" fontWeight={700}>提示与问题</Typography>
            {issueChecks.map(({ check, level }, index) => {
              const action = issueAction(check)
              const status = statusPresentation[level]
              return (
                <Paper
                  key={`${check.name}:${index}`}
                  variant="outlined"
                  sx={{ p: 1.75, borderRadius: 2 }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    alignItems={{ xs: 'stretch', sm: 'flex-start' }}
                    justifyContent="space-between"
                  >
                    <Stack direction="row" spacing={1.25} sx={{ minWidth: 0 }}>
                      <Box sx={{ pt: 0.15, flexShrink: 0 }}>
                        <XDriveStatusBadge tone={status.tone} label={status.label} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={700}>
                          {diagnosticTitle(check.name)}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.45, lineHeight: 1.6, overflowWrap: 'anywhere' }}
                        >
                          {diagnosticUserDetail(check)}
                        </Typography>
                      </Box>
                    </Stack>
                    {action ? (
                      <Box sx={{ flexShrink: 0 }}>
                        <XDriveActionButton
                          disabled={disabled || Boolean(action.disabled)}
                          loading={action.loading}
                          loadingLabel="处理中…"
                          onClick={action.run}
                        >
                          {action.label}
                        </XDriveActionButton>
                      </Box>
                    ) : null}
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
        ) : (
          <XDriveStatePanel message="未发现需要处理的问题。" />
        )}

        <Accordion
          disableGutters
          elevation={0}
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: '8px !important',
            '&::before': { display: 'none' },
          }}
        >
          <AccordionSummary
            expandIcon={<Typography component="span" color="text.secondary">⌄</Typography>}
            aria-controls="diagnostic-technical-details"
            id="diagnostic-technical-summary"
          >
            <Box>
              <Typography variant="body2" fontWeight={700}>技术检查详情</Typography>
              <Typography variant="caption" color="text.secondary">
                {diagnostics.summary.pass} 项正常 · {infoCount} 项提示 · {warnCount} 项需注意 · {failCount} 项异常
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails id="diagnostic-technical-details">
            <Stack spacing={2}>
              <Typography variant="caption" color="text.secondary">
                这里保留完整检查列表，但只显示中文可读说明；原始内部检查名和错误信息保留在导出诊断报告中。
              </Typography>
              {Object.entries(groupedChecks).map(([category, checks]) => (
                <Box key={category}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{category}</Typography>
                  <Stack spacing={0.75}>
                    {checks.map((check, index) => {
                      const level = diagnosticUserLevel(check)
                      const status = statusPresentation[level]
                      const translatedTitle = diagnosticTitle(check.name)
                      return (
                        <Paper
                          key={`${check.name}:technical:${index}`}
                          variant="outlined"
                          sx={{
                            p: 1.25,
                            display: 'grid',
                            gridTemplateColumns: '64px minmax(0, 1fr)',
                            alignItems: 'start',
                            gap: 1.25,
                            borderRadius: 1.5,
                          }}
                        >
                          <XDriveStatusBadge tone={status.tone} label={status.label} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={700}>{translatedTitle}</Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block', mt: 0.5, lineHeight: 1.5, overflowWrap: 'anywhere' }}
                            >
                              {diagnosticUserDetail(check)}
                            </Typography>
                          </Box>
                        </Paper>
                      )
                    })}
                  </Stack>
                </Box>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
