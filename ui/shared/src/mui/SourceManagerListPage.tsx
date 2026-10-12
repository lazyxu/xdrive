import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Button as MuiButton,
  Stack,
  Tooltip,
} from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveSourceKindIcon } from './SourceKindIcon'
import { XDriveSourceSummaryCard } from './SourceSummaryCard'
import { XDriveStatePanel } from './StatePanel'
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
            loading={loading}
            loadingLabel="正在刷新…"
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
      {loading && rows.length === 0 ? (
        <XDriveStatePanel variant="plain" loading message={`正在加载${sourceNoun}…`} />
      ) : rows.length === 0 ? (
        <XDriveStatePanel variant="plain" message={`尚未添加${sourceNoun}`} />
      ) : (
        <Stack spacing={1.75}>
          {rows.map((row) => {
            const card = externalSourceCardView(row)
            const sourceName = externalSourceDisplayName(row.source)
            const stats = card.scannedItems === undefined || card.scannedBytes === undefined
              ? '尚无扫描统计'
              : `${card.scannedItems.toLocaleString('zh-CN')} 项 · ${formatBytes(card.scannedBytes)}${card.failedItems ? ` · 失败 ${card.failedItems}` : ''}`

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
