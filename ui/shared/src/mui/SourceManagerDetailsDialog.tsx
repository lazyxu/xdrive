import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box as MuiBox,
  Button as MuiButton,
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
import { XDriveSourceRunSkipItem } from './SourceRunSkipItem'
import { XDriveSourceKindIcon } from './SourceKindIcon'
import { XDriveSourceRunProgress } from './SourceRunProgress'
import { XDriveSourceRunSummary } from './SourceRunSummary'
import {
  externalSourceCardView,
  externalSourceDetailView,
  externalSourceDisplayName,
  externalSourceDisplayTargetPath,
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
  ExternalSourceRunSkip,
} from '../external-sources'

export type XDriveSourceRunFailurePage = {
  items: ExternalSourceRunFailure[]
  page: number
  hasNext: boolean
  loading: boolean
  loaded: boolean
}

export type XDriveSourceRunSkipPage = {
  items: ExternalSourceRunSkip[]
  page: number
  hasNext: boolean
  loading: boolean
  loaded: boolean
}

export type XDriveSourceDetailReadState = 'unverified' | 'ready' | 'error'

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
  collectionsReadState,
  onReloadCollections,
  collectionItemPages,
  collectionPageSize,
  historyRuns,
  historyPage,
  historyHasNext,
  historyLoading,
  historyReadState,
  historyPageSize,
  runFailurePages,
  runSkipPages,
  runFailurePageSize,
  failedItems,
  failedItemsLoading,
  triggeringSourceID,
  cancellingRunID,
  onClose,
  onLoadCollectionItems,
  onLoadRunHistory,
  onLoadRunFailures,
  onLoadRunSkips,
  onCancelRun,
  onCopyRunID,
  onOpenFailedItems,
  onTriggerNow,
  onAuthorizeLocalFolder,
}: {
  row: ExternalSourceRow | null
  collections: ExternalSourceCollection[]
  collectionsLoading: boolean
  collectionsReadState: XDriveSourceDetailReadState
  onReloadCollections: (sourceID: number) => void | Promise<void>
  collectionItemPages: Record<number, XDriveSourceCollectionItemPage>
  collectionPageSize: number
  historyRuns: ExternalSourceRun[]
  historyPage: number
  historyHasNext: boolean
  historyLoading: boolean
  historyReadState: XDriveSourceDetailReadState
  historyPageSize: number
  runFailurePages: Record<string, XDriveSourceRunFailurePage>
  runSkipPages: Record<string, XDriveSourceRunSkipPage>
  runFailurePageSize: number
  failedItems: ExternalSourceItem[]
  failedItemsLoading: boolean
  triggeringSourceID: number | null
  cancellingRunID: string | null
  onClose: () => void
  onLoadCollectionItems: (sourceID: number, collectionID: number, page: number) => void | Promise<void>
  onLoadRunHistory: (sourceID: number, page: number) => void | Promise<void>
  onLoadRunFailures: (sourceID: number, runID: string, page: number) => void | Promise<void>
  onLoadRunSkips: (sourceID: number, runID: string, page: number) => void | Promise<void>
  onCancelRun: (row: ExternalSourceRow) => void | Promise<void>
  onCopyRunID: (runID: string) => void
  onOpenFailedItems: () => void
  onTriggerNow: (row: ExternalSourceRow) => void | Promise<void>
  onAuthorizeLocalFolder?: (row: ExternalSourceRow) => void | Promise<void>
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
        title={row ? `${externalSourceDisplayName(row.source)} · 来源详情` : '来源详情'}
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

            {row.source.kind === 'local_folder' ? (
              <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
                <Stack spacing={1}>
                  <MuiTypography variant="body2">
                    本机文件夹已登记，但同步执行器尚未启用。必须在拥有该目录的 Desktop 上授权；不能从 Web 指定电脑路径。
                  </MuiTypography>
                  {onAuthorizeLocalFolder ? (
                    <MuiButton size="small" variant="outlined" onClick={() => void onAuthorizeLocalFolder(row)}>
                      选择本机目录并授权
                    </MuiButton>
                  ) : (
                    <MuiTypography variant="caption">请在对应的 Desktop 客户端完成本机目录授权。</MuiTypography>
                  )}
                </Stack>
              </XDriveStatusAlert>
            ) : null}

            <XDriveDescriptionGrid columns={4} fullColumnsAt="md">
              <XDriveDescriptionItem label="来源类型">
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <XDriveSourceKindIcon kind={row.source.kind} size="small" />
                  <span>{detail.kindLabel}</span>
                </Stack>
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="工作方式">{detail.modeLabel}</XDriveDescriptionItem>
              <XDriveDescriptionItem label="状态">
                <XDriveStatusBadge tone={detail.state.tone} label={detail.state.label} />
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label={row.source.kind === 'yike_photos' && row.source.direction === 'pull' ? '存储子目录' : '目标目录'}>
                {externalSourceDisplayTargetPath(row.source) || (detail.targetNodeID ? `节点 #${detail.targetNodeID}` : '未配置')}
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
            {collections.length === 0 && collectionsReadState !== 'ready' ? (
              <MuiBox data-xdrive-source-collections-first-read
                aria-busy={collectionsLoading || undefined}
                sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                {collectionsReadState === 'error' ? (
                  <Stack spacing={1} alignItems="center" role="alert">
                    <MuiTypography variant="body2">相册/集合读取失败，请重试。</MuiTypography>
                    <MuiButton size="small" onClick={() => void onReloadCollections(row.source.id)}>重试</MuiButton>
                  </Stack>
                ) : null}
              </MuiBox>
            ) : collections.length === 0 ? (
              <MuiBox data-xdrive-source-collections-empty
                sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                <XDriveStatePanel variant="plain" message="该来源暂无相册/集合元数据" />
              </MuiBox>
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
                        {!page || (page.loading && !page.loaded) ? (
                          <MuiBox data-xdrive-source-collection-members-first-read
                            aria-busy={Boolean(page?.loading) || undefined}
                            sx={{ minHeight: 120, display: 'grid', placeItems: 'center' }} />
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
                          <MuiBox data-xdrive-source-collection-members-empty
                            sx={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>
                            <XDriveStatePanel variant="plain" message="该集合暂无成员" />
                          </MuiBox>
                        ) : (
                          <MuiTypography variant="caption" color="text.secondary">展开后加载成员。</MuiTypography>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  )
                })}
              </Stack>
            )}

            <XDriveSectionHeader level="h3" title="运行记录" sx={{ my: 2 }} />
            {historyRuns.length > 0 ? (
              <Stack spacing={1}>
                {historyRuns.map((run) => {
                  const runDetail = externalSourceRunDetailView(run)
                  const canCancel = run.status === 'running' && row.latestRun?.id === run.id
                  const failurePage = runFailurePages[run.id]
                  const skipPage = runSkipPages[run.id]
                  return (
                    <Accordion
                      key={run.id}
                      disableGutters
                      elevation={0}
                      onChange={(_, expanded) => {
                        if (expanded && run.failed_items > 0 && !failurePage?.loaded && !failurePage?.loading) {
                          void onLoadRunFailures(row.source.id, run.id, 1)
                        }
                        if (expanded && run.skipped_items > 0 && !skipPage?.loaded && !skipPage?.loading) {
                          void onLoadRunSkips(row.source.id, run.id, 1)
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
                          {run.status === 'cancelled' ? (
                            <XDriveDescriptionItem label="未扫描范围">未知（取消任务不代表完整扫描）</XDriveDescriptionItem>
                          ) : null}
                          {runDetail.metrics.map((metric) => (
                            <XDriveDescriptionItem key={metric.key} label={metric.label}>
                              {metric.items === undefined ? (metric.bytes === undefined ? '未知' : formatBytes(metric.bytes)) : `${metric.items.toLocaleString('zh-CN')} 项`}
                              {metric.items !== undefined && metric.bytes !== undefined ? ' · ' + formatBytes(metric.bytes) : ''}
                            </XDriveDescriptionItem>
                          ))}
                        </XDriveDescriptionGrid>
                        <XDriveStatusAlert tone={runDetail.error ? 'bad' : 'good'} sx={{ mt: 1.5 }}>
                          运行日志：{runDetail.error || '无错误日志'}
                        </XDriveStatusAlert>
                        {run.skipped_items > 0 ? (
                          <MuiBox sx={{ mt: 1.5 }}>
                            <MuiTypography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
                              本次跳过项（含当时路径和原因）
                            </MuiTypography>
                            {!skipPage || (skipPage.loading && !skipPage.loaded) ? (
                              <MuiBox data-xdrive-source-run-skips-first-read
                                aria-busy={Boolean(skipPage?.loading) || undefined}
                                sx={{ minHeight: 96, display: 'grid', placeItems: 'center' }} />
                            ) : skipPage?.loaded && skipPage.items.length > 0 ? (
                              <Stack spacing={0.75}>
                                {skipPage.items.map((skip) => (
                                  <XDriveSourceRunSkipItem key={skip.id} skip={skip} />
                                ))}
                                <XDrivePaginationControls
                                  page={skipPage.page}
                                  pageSize={runFailurePageSize}
                                  hasNext={skipPage.hasNext}
                                  loading={skipPage.loading}
                                  labelPrefix="跳过项"
                                  onPrevious={() => void onLoadRunSkips(row.source.id, run.id, skipPage.page - 1)}
                                  onNext={() => void onLoadRunSkips(row.source.id, run.id, skipPage.page + 1)}
                                />
                              </Stack>
                            ) : skipPage?.loaded ? (
                              <MuiBox data-xdrive-source-run-skips-empty
                                sx={{ minHeight: 96, display: 'grid', placeItems: 'center' }}>
                                <XDriveStatusAlert tone="warning">
                                  该历史运行没有可读取的逐项跳过快照（可能在统计升级前执行或明细已过保留期）。
                                </XDriveStatusAlert>
                              </MuiBox>
                            ) : (
                              <MuiTypography variant="caption" color="text.secondary">
                                展开后加载本次跳过项明细。
                              </MuiTypography>
                            )}
                          </MuiBox>
                        ) : null}
                        {runDetail.failedItems > 0 ? (
                          <MuiBox sx={{ mt: 1.5 }}>
                            <MuiTypography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
                              本次失败文件
                            </MuiTypography>
                            {!failurePage || (failurePage.loading && !failurePage.loaded) ? (
                              <MuiBox data-xdrive-source-run-failures-first-read
                                aria-busy={Boolean(failurePage?.loading) || undefined}
                                sx={{ minHeight: 96, display: 'grid', placeItems: 'center' }} />
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
                                    category={failure.category}
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
                              <MuiBox data-xdrive-source-run-failures-empty
                                sx={{ minHeight: 96, display: 'grid', placeItems: 'center' }}>
                                <XDriveStatusAlert tone="warning">
                                  该历史 Run 记录了 {runDetail.failedItems.toLocaleString('zh-CN')} 个失败项，但没有可恢复的逐文件失败快照。
                                </XDriveStatusAlert>
                              </MuiBox>
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
            ) : historyReadState === 'ready' ? (
              <MuiBox data-xdrive-source-run-history-empty
                sx={{ minHeight: 160, display: 'grid', placeItems: 'center' }}>
                <XDriveStatePanel variant="plain" message="尚无运行记录" />
              </MuiBox>
            ) : (
              <MuiBox data-xdrive-source-run-history-first-read
                aria-busy={historyLoading || undefined}
                sx={{ minHeight: 160, display: 'grid', placeItems: 'center' }}>
                {historyReadState === 'error' ? (
                  <Stack spacing={1} alignItems="center" role="alert">
                    <MuiTypography variant="body2">运行历史读取失败，请重试。</MuiTypography>
                    <MuiButton size="small" onClick={() => void onLoadRunHistory(row.source.id, 1)}>重试</MuiButton>
                  </Stack>
                ) : null}
              </MuiBox>
            )}

            <MuiBox data-xdrive-source-failed-items aria-busy={failedItemsLoading || undefined}>
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
            </MuiBox>
          </>
        ) : null}
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton onClick={onClose}>关闭</XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
