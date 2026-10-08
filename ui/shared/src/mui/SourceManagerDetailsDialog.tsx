import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box as MuiBox,
  Button as MuiButton,
  CircularProgress,
  Dialog,
  IconButton,
  Stack,
  Tooltip,
  Typography as MuiTypography,
} from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDescriptionGrid, XDriveDescriptionItem } from './DescriptionGrid'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from './DialogTitle'
import { XDrivePaginationControls } from './PaginationControls'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStatusBadge } from './StatusBadge'
import { XDriveSourceCollectionItem, XDriveSourceCollectionSummary } from './SourceCollection'
import { XDriveSourceFailureItem } from './SourceFailureItem'
import { XDriveSourceKindIcon } from './SourceKindIcon'
import { XDriveSourceRunProgress } from './SourceRunProgress'
import { XDriveSourceRunSummary } from './SourceRunSummary'
import {
  externalSourceCardView,
  externalSourceDetailView,
  externalSourceMirrorSafetyNotice,
  externalSourceMirrorScanNotice,
  externalSourceRunDetailView,
  formatExternalSourceTime,
} from '../external-sources'
import { formatBytes } from '../format'
import type {
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceItem,
  ExternalSourceRow,
  ExternalSourceRun,
  ExternalSourceRunFailure,
} from '../external-sources'

export type XDriveSourceRunFailurePage = {
  items: ExternalSourceRunFailure[]
  page: number
  hasNext: boolean
  loading: boolean
  loaded: boolean
}

export type XDriveSourceCollectionItemPage = {
  items: ExternalSourceCollectionItem[]
  page: number
  hasNext: boolean
  loading: boolean
  loaded: boolean
}

export function XDriveSourceDetailsDialog({
  row,
  collections,
  collectionsLoading,
  collectionItemPages,
  collectionPageSize,
  historyRuns,
  historyPage,
  historyHasNext,
  historyLoading,
  historyPageSize,
  runFailurePages,
  runFailurePageSize,
  failedItems,
  failedItemsLoading,
  triggeringSourceID,
  cancellingRunID,
  onClose,
  onLoadCollectionItems,
  onLoadRunHistory,
  onLoadRunFailures,
  onCancelRun,
  onCopyRunID,
  onOpenFailedItems,
  onTriggerNow,
}: {
  row: ExternalSourceRow | null
  collections: ExternalSourceCollection[]
  collectionsLoading: boolean
  collectionItemPages: Record<number, XDriveSourceCollectionItemPage>
  collectionPageSize: number
  historyRuns: ExternalSourceRun[]
  historyPage: number
  historyHasNext: boolean
  historyLoading: boolean
  historyPageSize: number
  runFailurePages: Record<string, XDriveSourceRunFailurePage>
  runFailurePageSize: number
  failedItems: ExternalSourceItem[]
  failedItemsLoading: boolean
  triggeringSourceID: number | null
  cancellingRunID: string | null
  onClose: () => void
  onLoadCollectionItems: (sourceID: number, collectionID: number, page: number) => void | Promise<void>
  onLoadRunHistory: (sourceID: number, page: number) => void | Promise<void>
  onLoadRunFailures: (sourceID: number, runID: string, page: number) => void | Promise<void>
  onCancelRun: (row: ExternalSourceRow) => void | Promise<void>
  onCopyRunID: (runID: string) => void
  onOpenFailedItems: () => void
  onTriggerNow: (row: ExternalSourceRow) => void | Promise<void>
}) {
  const detail = row ? externalSourceDetailView(row) : null
  const card = row ? externalSourceCardView(row) : null

  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()
  return (
    <Dialog
      open={Boolean(row)}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      fullScreen={compactTouch}
      scroll="paper"
      slotProps={{ paper: dialogPaper }}
    >
      <XDriveDialogTitle
        title={row ? `${row.source.name} · 同步文件夹详情` : '同步文件夹详情'}
        onClose={onClose}
      />
      <XDriveDialogContent dividers>
        {row && detail ? (
          <>
            {detail.error ? (
              <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>
                <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>最近一次运行异常</MuiTypography>
                <MuiTypography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{detail.error}</MuiTypography>
              </XDriveStatusAlert>
            ) : null}
            {row.source.sync_mode === 'mirror' ? (
              <XDriveStatusAlert tone="warning" sx={{ mb: 2 }}>
                <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>当前使用镜像到回收站</MuiTypography>
                <MuiTypography variant="body2">{externalSourceMirrorSafetyNotice}</MuiTypography>
                {row.source.run_mode === 'scan' ? (
                  <MuiTypography variant="body2" sx={{ mt: 0.5 }}>{externalSourceMirrorScanNotice}</MuiTypography>
                ) : null}
              </XDriveStatusAlert>
            ) : null}

            <XDriveDescriptionGrid columns={4} fullColumnsAt="md">
              <XDriveDescriptionItem label="同步文件夹类型">
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <XDriveSourceKindIcon kind={row.source.kind} size="small" />
                  <span>{detail.kindLabel}</span>
                </Stack>
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="工作方式">{detail.modeLabel}</XDriveDescriptionItem>
              <XDriveDescriptionItem label="状态">
                <XDriveStatusBadge tone={detail.state.tone} label={detail.state.label} />
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="目标目录">
                {row.source.target_path || (detail.targetNodeID ? `节点 #${detail.targetNodeID}` : '未配置')}
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="调度">{detail.scheduleLabel}</XDriveDescriptionItem>
              <XDriveDescriptionItem label="上次运行">{formatExternalSourceTime(detail.lastRunAt)}</XDriveDescriptionItem>
              <XDriveDescriptionItem label="上次成功">{formatExternalSourceTime(detail.lastSuccessAt)}</XDriveDescriptionItem>
              {detail.credential ? (
                <XDriveDescriptionItem label={detail.credential.label}>
                  {detail.credential.configured ? '已配置' : '未配置'}
                </XDriveDescriptionItem>
              ) : null}
            </XDriveDescriptionGrid>

            <XDriveSectionHeader level="h3" title="相册与集合" sx={{ my: 2 }} />
            {collectionsLoading ? (
              <XDriveStatePanel loading variant="plain" message="正在加载相册/集合" />
            ) : collections.length === 0 ? (
              <XDriveStatePanel variant="plain" message="该同步文件夹暂无相册/集合元数据" />
            ) : (
              <Stack spacing={1}>
                {collections.map((collection) => {
                  const page = collectionItemPages[collection.id]
                  return (
                    <Accordion
                      key={collection.id}
                      disableGutters
                      elevation={0}
                      onChange={(_, expanded) => {
                        if (expanded && !page?.loaded && !page?.loading) {
                          void onLoadCollectionItems(row.source.id, collection.id, 1)
                        }
                      }}
                    >
                      <AccordionSummary>
                        <XDriveSourceCollectionSummary collection={collection} wideAt="md" />
                      </AccordionSummary>
                      <AccordionDetails>
                        {page?.loading && !page.loaded ? (
                          <XDriveStatePanel loading variant="plain" message="正在加载集合成员" />
                        ) : page?.loaded && page.items.length > 0 ? (
                          <Stack spacing={0.75}>
                            {page.items.map((item) => (
                              <XDriveSourceCollectionItem
                                key={item.external_id}
                                item={item}
                                sizeLabel={formatBytes(item.size)}
                                wideAt="md"
                              />
                            ))}
                            <XDrivePaginationControls
                              page={page.page}
                              pageSize={collectionPageSize}
                              hasNext={page.hasNext}
                              loading={page.loading}
                              labelPrefix="成员"
                              onPrevious={() => void onLoadCollectionItems(row.source.id, collection.id, page.page - 1)}
                              onNext={() => void onLoadCollectionItems(row.source.id, collection.id, page.page + 1)}
                            />
                          </Stack>
                        ) : page?.loaded ? (
                          <XDriveStatePanel variant="plain" message="该集合暂无成员" />
                        ) : (
                          <MuiTypography variant="caption" color="text.secondary">展开后加载成员。</MuiTypography>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  )
                })}
              </Stack>
            )}

            <XDriveSectionHeader level="h3" title="同步历史" sx={{ my: 2 }} />
            {historyRuns.length > 0 ? (
              <Stack spacing={1}>
                {historyRuns.map((run) => {
                  const runDetail = externalSourceRunDetailView(run)
                  const canCancel = run.status === 'running' && row.latestRun?.id === run.id
                  const failurePage = runFailurePages[run.id]
                  return (
                    <Accordion
                      key={run.id}
                      disableGutters
                      elevation={0}
                      onChange={(_, expanded) => {
                        if (expanded && run.failed_items > 0 && !failurePage?.loaded && !failurePage?.loading) {
                          void onLoadRunFailures(row.source.id, run.id, 1)
                        }
                      }}
                      sx={{ border: 1, borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}
                    >
                      <AccordionSummary>
                        <XDriveSourceRunSummary runNumber={run.run_number} detail={runDetail} wideAt="md" />
                      </AccordionSummary>
                      <AccordionDetails>
                        {runDetail.progress ? (
                          <XDriveSourceRunProgress
                            progress={runDetail.progress}
                            canCancel={canCancel}
                            cancelLoading={cancellingRunID === run.id}
                            onCancel={() => void onCancelRun(row)}
                          />
                        ) : null}
                        <XDriveDescriptionGrid columns={3} fullColumnsAt="md" sx={{ p: 1.25 }}>
                          <XDriveDescriptionItem label="运行编号">#{run.run_number > 0 ? run.run_number : '—'}</XDriveDescriptionItem>
                          <XDriveDescriptionItem label="内部运行 ID">
                            <Stack direction="row" spacing={0.5} alignItems="center">
                              <MuiTypography component="code" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{run.id}</MuiTypography>
                              <Tooltip title="复制运行 ID">
                                <IconButton
                                  size="small"
                                  aria-label="复制运行 ID"
                                  onClick={() => onCopyRunID(run.id)}
                                >
                                  <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </XDriveDescriptionItem>
                          <XDriveDescriptionItem label="运行状态">
                            <XDriveStatusBadge tone={runDetail.statusTone} label={runDetail.statusLabel} />
                          </XDriveDescriptionItem>
                          <XDriveDescriptionItem label="耗时">{runDetail.durationLabel}</XDriveDescriptionItem>
                          <XDriveDescriptionItem label="开始时间">{formatExternalSourceTime(runDetail.startedAt)}</XDriveDescriptionItem>
                          <XDriveDescriptionItem label="结束时间">{runDetail.finishedAt ? formatExternalSourceTime(runDetail.finishedAt) : '进行中'}</XDriveDescriptionItem>
                          <XDriveDescriptionItem label="成功项">{runDetail.successItems.toLocaleString('zh-CN')} 项</XDriveDescriptionItem>
                          <XDriveDescriptionItem label="失败项">{runDetail.failedItems.toLocaleString('zh-CN')} 项</XDriveDescriptionItem>
                          {runDetail.metrics.map((metric) => (
                            <XDriveDescriptionItem key={metric.key} label={metric.label}>
                              {metric.items.toLocaleString('zh-CN')} 项
                              {metric.bytes === undefined ? '' : ' · ' + formatBytes(metric.bytes)}
                            </XDriveDescriptionItem>
                          ))}
                        </XDriveDescriptionGrid>
                        <XDriveStatusAlert tone={runDetail.error ? 'bad' : 'good'} sx={{ mt: 1.5 }}>
                          运行日志：{runDetail.error || '无错误日志'}
                        </XDriveStatusAlert>
                        {runDetail.failedItems > 0 ? (
                          <MuiBox sx={{ mt: 1.5 }}>
                            <MuiTypography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
                              本次失败文件
                            </MuiTypography>
                            {failurePage?.loading && !failurePage.loaded ? (
                              <CircularProgress size={18} />
                            ) : failurePage?.loaded && failurePage.items.length > 0 ? (
                              <Stack spacing={0.75}>
                                {failurePage.items.map((failure) => (
                                  <XDriveSourceFailureItem
                                    key={failure.id}
                                    compact
                                    title={failure.path || failure.external_id}
                                    externalID={failure.external_id}
                                    sizeLabel={formatBytes(failure.size)}
                                    failedAt={failure.failed_at}
                                    error={failure.error}
                                  />
                                ))}
                                <XDrivePaginationControls
                                  page={failurePage.page}
                                  pageSize={runFailurePageSize}
                                  hasNext={failurePage.hasNext}
                                  loading={failurePage.loading}
                                  labelPrefix="失败项"
                                  onPrevious={() => void onLoadRunFailures(row.source.id, run.id, failurePage.page - 1)}
                                  onNext={() => void onLoadRunFailures(row.source.id, run.id, failurePage.page + 1)}
                                />
                              </Stack>
                            ) : failurePage?.loaded ? (
                              <XDriveStatusAlert tone="warning">
                                该历史 Run 记录了 {runDetail.failedItems.toLocaleString('zh-CN')} 个失败项，但没有可恢复的逐文件失败快照。
                              </XDriveStatusAlert>
                            ) : (
                              <MuiTypography variant="caption" color="text.secondary">
                                展开后加载本次失败文件明细。
                              </MuiTypography>
                            )}
                          </MuiBox>
                        ) : null}
                      </AccordionDetails>
                    </Accordion>
                  )
                })}
                <XDrivePaginationControls
                  page={historyPage}
                  pageSize={historyPageSize}
                  hasNext={historyHasNext}
                  loading={historyLoading}
                  onPrevious={() => void onLoadRunHistory(row.source.id, historyPage - 1)}
                  onNext={() => void onLoadRunHistory(row.source.id, historyPage + 1)}
                  sx={{ pt: 0.5 }}
                />
              </Stack>
            ) : (
              <XDriveStatePanel variant="plain" message={historyLoading ? '正在加载运行历史' : '尚无运行记录'} />
            )}

            {failedItemsLoading ? (
              <MuiTypography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                正在检查逐文件失败记录…
              </MuiTypography>
            ) : null}
            {!failedItemsLoading && failedItems.length > 0 ? (
              <XDriveStatusAlert
                tone="bad"
                sx={{ mt: 2 }}
                action={(
                  <Stack direction="row" spacing={0.5}>
                    <MuiButton color="inherit" size="small" onClick={onOpenFailedItems}>
                      查看失败项（{failedItems.length}）
                    </MuiButton>
                    <MuiButton
                      color="inherit"
                      size="small"
                      disabled={!card?.trigger.ready || triggeringSourceID === row.source.id}
                      onClick={() => void onTriggerNow(row)}
                    >
                      {triggeringSourceID === row.source.id ? '正在请求…' : '立即重试'}
                    </MuiButton>
                  </Stack>
                )}
              >
                当前仍有 {failedItems.length} 个文件处于失败状态；下一次扫描会自动重试。
              </XDriveStatusAlert>
            ) : null}
          </>
        ) : null}
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton onClick={onClose}>关闭</XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
