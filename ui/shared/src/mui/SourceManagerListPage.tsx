import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Box,
  Button as MuiButton,
  Stack,
  Tooltip,
} from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveSourceKindIcon } from './SourceKindIcon'
import { XDriveSourceSummaryCard } from './SourceSummaryCard'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import {
  externalSourceCardView,
  externalSourceConnectorProfile,
  externalSourceDisplayName,
  externalSourceTriggerActionLabel,
  formatExternalSourceTime,
} from '../external-sources'
import { formatBytes } from '../format'
import type { ExternalSourceRow } from '../external-sources'

export function XDriveSourceManagerListPage({
  title = '来源',
  subtitle = '管理来源连接、凭据、计划和运行状态。',
  rows,
  directionFilter,
  loading,
  hasLoaded,
  loadError,
  failedItemsLoading,
  triggeringSourceID,
  cancellingRunID,
  onRefresh,
  onAdd,
  onOpenError,
  onOpenDetails,
  onOpenSynologyGuide,
  onTriggerNow,
  onCancelRun,
  onOpenSettings,
}: {
  title?: string
  subtitle?: string
  rows: ExternalSourceRow[]
  directionFilter?: 'pull'
  loading: boolean
  hasLoaded: boolean
  loadError: boolean
  failedItemsLoading: boolean
  triggeringSourceID: number | null
  cancellingRunID: string | null
  onRefresh: () => void | Promise<void>
  onAdd: () => void | Promise<void>
  onOpenError: (row: ExternalSourceRow) => void
  onOpenDetails: (row: ExternalSourceRow) => void | Promise<void>
  onOpenSynologyGuide: (row: ExternalSourceRow) => void
  onTriggerNow: (row: ExternalSourceRow) => void | Promise<void>
  onCancelRun: (row: ExternalSourceRow) => void | Promise<void>
  onOpenSettings: (row: ExternalSourceRow) => void
}) {
  const sourceNoun = directionFilter === 'pull' ? '拉取来源' : '来源'
  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title={title}
      subtitle={subtitle}
      pageActions={
        <>
          <XDriveActionButton
            startIcon={<RefreshRoundedIcon />}
            disabled={loading}
            onClick={() => void onRefresh()}
          >
            刷新
          </XDriveActionButton>
          <XDriveActionButton
            intent="primary"
            startIcon={<AddRoundedIcon />}
            onClick={() => void onAdd()}
          >
            添加{sourceNoun}
          </XDriveActionButton>
        </>
      }
    >
      {loadError && rows.length > 0 ? (
        <Box data-xdrive-source-overview-refresh-error
          sx={{
            position: 'fixed',
            left: '50%', transform: 'translateX(-50%)',
            bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
            width: 'min(calc(100vw - 24px), 560px)',
            maxHeight: 'min(34dvh, 220px)', overflowY: 'auto',
            zIndex: (theme) => theme.zIndex.snackbar,
            pointerEvents: 'none', borderRadius: 1,
          }}>
          <XDriveStatusAlert tone="bad">刷新{sourceNoun}失败，仍显示上次成功读取的内容；可重试。</XDriveStatusAlert>
        </Box>
      ) : null}
      {!hasLoaded && loading ? (
        // The initial owner read has no authoritative count. Keep the same
        // 180px footprint all the way to an accepted empty or real failure;
        // never insert a short-lived loading panel during navigation.
        <Box data-xdrive-source-overview-loading-slot
          aria-busy="true"
          sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }} />
      ) : loadError && rows.length === 0 ? (
        <Box data-xdrive-source-overview-first-read-error
          sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
          <XDriveStatusAlert tone="bad">无法读取{sourceNoun}，请点击刷新重试。</XDriveStatusAlert>
        </Box>
      ) : rows.length === 0 ? (
        <Box data-xdrive-source-overview-verified-empty
          sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
          <XDriveStatePanel variant="plain" message={`尚未添加${sourceNoun}`} />
        </Box>
      ) : (
        <Stack spacing={1.75}>
          {rows.map((row) => {
            const card = externalSourceCardView(row)
            const sourceName = externalSourceDisplayName(row.source)
            const latest = row.latestRun
            const stats = !latest
              ? '尚无扫描统计'
              : [
                  `扫描 ${latest.scanned_items.toLocaleString('zh-CN')} 项 · ${formatBytes(latest.scanned_bytes)}`,
                  `已同步 ${latest.synced_file_items === undefined || latest.synced_directory_items === undefined
                    ? '—' : (latest.synced_file_items + latest.synced_directory_items).toLocaleString('zh-CN')}`,
                  `未变化 ${latest.unchanged_items.toLocaleString('zh-CN')}`,
                  `忽略 ${latest.ignored_items.toLocaleString('zh-CN')}`,
                  `失败 ${latest.failed_items.toLocaleString('zh-CN')}`,
                  ...(latest.status === 'cancelled'
                    ? [`已发现未处理 ${latest.unprocessed_items === undefined ? '未知' : latest.unprocessed_items.toLocaleString('zh-CN')}`]
                    : []),
                ].join(' · ')

            return (
              <XDriveSourceSummaryCard
                key={row.source.id}
                name={sourceName}
                icon={<XDriveSourceKindIcon kind={row.source.kind} />}
                modeLabel={sourceName === card.connector.label ? card.modeLabel : `${card.connector.label} · ${card.modeLabel}`}
                statusTone={card.state.tone}
                statusLabel={card.state.label}
                activity={`${card.lastActivityLabel}：${formatExternalSourceTime(card.lastActivityAt)}`}
                stats={stats}
                metaAction={row.source.last_error && !row.source.run_requested_at && row.latestRun?.status !== 'running' ? (
                  <MuiButton
                    size="small"
                    color="error"
                    variant="text"
                    onClick={() => onOpenError(row)}
                    sx={{ minWidth: 'auto', px: 0, justifyContent: 'flex-start' }}
                  >
                    查看最近错误
                  </MuiButton>
                ) : undefined}
                actions={(
                  <>
                    <XDriveActionButton
                      compact
                      disabled={failedItemsLoading}
                      onClick={() => void onOpenDetails(row)}
                    >
                      查看
                    </XDriveActionButton>
                    {externalSourceConnectorProfile(row.source.kind, row.source.direction).manualTriggerExecutor === 'source_agent' ? (
                      <XDriveActionButton compact onClick={() => onOpenSynologyGuide(row)}>
                        DSM 配置
                      </XDriveActionButton>
                    ) : null}
                    <Tooltip title={card.trigger.label}>
                      <span>
                        <XDriveActionButton
                          compact
                          disabled={!card.trigger.ready}
                          loading={triggeringSourceID === row.source.id}
                          loadingLabel="正在请求…"
                          onClick={() => void onTriggerNow(row)}
                        >
                          {externalSourceTriggerActionLabel(row)}
                        </XDriveActionButton>
                      </span>
                    </Tooltip>
                    {row.latestRun?.status === 'running' ? (
                      <XDriveActionButton
                        compact
                        intent="warning"
                        disabled={Boolean(row.latestRun.cancel_requested_at)}
                        loading={cancellingRunID === row.latestRun.id || Boolean(row.latestRun.cancel_requested_at)}
                        loadingLabel="正在取消…"
                        onClick={() => void onCancelRun(row)}
                      >
                        停止
                      </XDriveActionButton>
                    ) : null}
                    <XDriveActionButton compact onClick={() => onOpenSettings(row)}>
                      设置
                    </XDriveActionButton>
                  </>
                )}
              />
            )
          })}
        </Stack>
      )}
    </XDriveWorkspaceSurface>
  )
}
