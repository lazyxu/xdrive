import { useEffect, useState } from 'react'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Box, Paper, Stack, Typography } from '@mui/material'
import type { XDriveSynologyBackupLocalClient, XDriveSynologyLocalSource } from '../synology-backup-adapter'
import type { QuotaUsage } from '../models'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveMetricCard, XDriveMetricGrid } from './MetricCards'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

const previewLimit = 8

/**
 * DSM only: original Agent-proven local Sources and Server Owner quota.
 * These are separate authenticated reads; neither may be synthesized from
 * DSM username, another device, browser storage, or OS disk statistics.
 */
export function XDriveSynologyHomeOverview({
  client, onOpenBackup, onOpenTasks, onOpenDiagnostics, onOpenCloudStorage,
}: {
  client: XDriveSynologyBackupLocalClient
  onOpenBackup?: () => void
  onOpenTasks?: () => void
  onOpenDiagnostics?: () => void
  onOpenCloudStorage?: () => void
}) {
  const [sources, setSources] = useState<XDriveSynologyLocalSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<QuotaUsage | null>(null)
  const [quotaLoading, setQuotaLoading] = useState(true)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    const abort = new AbortController()
    setSources([])
    setQuota(null)
    setQuotaLoading(true)
    setLoading(true)
    setError('')
    void client.list(abort.signal).then((items) => {
      if (active) setSources(items)
    }).catch(() => {
      if (active) setError('DSM 会话或本机 Agent 来源列表读取失败；未确认任何设备和同步状态。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    // Independent Owner capability; a disabled Server session must not hide
    // an otherwise verified local Source list or substitute false zeroes.
    void client.ownerQuota(abort.signal).then((value) => {
      if (active) setQuota(value)
    }).catch(() => {
      if (active) setQuota(null)
    }).finally(() => {
      if (active) setQuotaLoading(false)
    })
    return () => { active = false; abort.abort() }
  }, [client, revision])

  return (
    <XDriveWorkspaceSurface presentation="page" title="主页"
      subtitle="查看经 DSM 验证的本机备份与 Agent 当前 Server 账号配额；未授权的统计不作推断。"
      pageActions={<XDriveActionButton startIcon={<RefreshRoundedIcon />}
        compact disabled={loading} onClick={() => setRevision((n) => n + 1)}>刷新</XDriveActionButton>}>
      <Stack spacing={2.25}>
        <XDriveStatusAlert tone="neutral">
          本页只读当前 NAS 上经过 DSM 登录和 Agent Source 授权验证的备份来源。
          云端容量仅取自 Agent 当前 xDrive Server 账号的授权结果；
          云端文件、NAS 磁盘及完整后台任务不在此验证范围。
        </XDriveStatusAlert>
        {loading ? (
          <Box data-xdrive-nas-home-first-read aria-busy="true" sx={{ minHeight: 180 }} />
        ) : error ? (
          <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>
        ) : (
          <>
            <XDriveMetricGrid>
              <XDriveMetricCard title="本机同步文件夹"
                value={sources.length.toLocaleString('zh-CN')}
                suffix="当前 DSM 会话允许读取的本机来源" />
              <XDriveMetricCard title="本机 Agent"
                value="已认证读取" tone="good" suffix="仅确认来源列表可读，不代表上传成功" />
              <XDriveMetricCard title="云端账号配额"
                value={quota
                  ? quota.quota_bytes > 0
                    ? `${formatBytes(quota.physical_used_bytes)} / ${formatBytes(quota.quota_bytes)}`
                    : `${formatBytes(quota.physical_used_bytes)} / 不限配额`
                  : quotaLoading ? '读取中' : '未检测'}
                suffix={quota
                  ? 'xDrive Server 当前账号占用与配额，并非 NAS 磁盘容量'
                  : 'Agent Server 会话或只读配额能力不可用，不推断空闲容量'} />
              <XDriveMetricCard title="NAS 物理磁盘"
                value="未检测" suffix="浏览器存储与 NAS 磁盘不同" />
            </XDriveMetricGrid>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <XDriveSectionHeader level="h3" title="本机同步文件夹"
                actions={onOpenBackup
                  ? <XDriveActionButton compact onClick={onOpenBackup}>查看全部</XDriveActionButton>
                  : undefined} />
              {sources.length === 0 ? (
                <XDriveStatePanel variant="plain"
                  message="当前 DSM 用户没有已授权的本机备份来源；不代表云端或其他设备没有文件。" />
              ) : (
                <Stack spacing={0.75} sx={{ mt: 1.5 }}>
                  {sources.slice(0, previewLimit).map((item) => (
                    <Box key={item.source_id} sx={{ px: 1.25, py: 1,
                      border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                      <Typography variant="body2" fontWeight={650} noWrap>{item.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        已验证本机来源 · 尚未读取批次状态
                      </Typography>
                    </Box>
                  ))}
                  {sources.length > previewLimit ? (
                    <Typography variant="caption" color="text.secondary">
                      仅展示前 {previewLimit} 项，另有 {sources.length - previewLimit} 项；
                      可进入设备备份查看本轮授权列表。
                    </Typography>
                  ) : null}
                </Stack>
              )}
            </Paper>
          </>
        )}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <XDriveSectionHeader level="h3" title="快捷操作" />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            {onOpenBackup ? (
              <XDriveActionButton onClick={onOpenBackup}>设备备份</XDriveActionButton>
            ) : null}
            {onOpenTasks ? (
              <XDriveActionButton onClick={onOpenTasks}>本机备份任务</XDriveActionButton>
            ) : null}
            {onOpenDiagnostics ? (
              <XDriveActionButton onClick={onOpenDiagnostics}>有限诊断</XDriveActionButton>
            ) : null}
            {onOpenCloudStorage ? (
              <XDriveActionButton onClick={onOpenCloudStorage}>云端存储</XDriveActionButton>
            ) : null}
          </Stack>
        </Paper>
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
