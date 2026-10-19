import { useCallback, useEffect, useRef, useState } from 'react'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import { Alert, Box, Button, Dialog, Stack, Typography } from '@mui/material'
import {
  xDriveFileExplorerDestinationTargetDisabledReason,
  type XDriveFileExplorerDestinationCrumb,
  type XDriveFileExplorerDestinationSource,
} from '../file-explorer-controller'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from './DialogTitle'
import type { XDriveFileExplorerNavigationTreePage } from './FileExplorerNavigationPane'

export type XDriveFileExplorerDestinationDialogProps = {
  open: boolean
  lifecycleKey: string
  operation: 'move' | 'copy'
  sources: readonly XDriveFileExplorerDestinationSource[]
  initialCrumbs: readonly XDriveFileExplorerDestinationCrumb[]
  loadDirectoryPage: (parentID: number, cursor?: string) => Promise<XDriveFileExplorerNavigationTreePage>
  onSubmit: (targetCrumbs: XDriveFileExplorerDestinationCrumb[]) => Promise<void>
  onClose: () => void
}

function destinationError(error: unknown) {
  return error instanceof Error ? error.message : String(error || '操作未完成，请重试。')
}

export function XDriveFileExplorerDestinationDialog({
  open,
  lifecycleKey,
  operation,
  sources,
  initialCrumbs,
  loadDirectoryPage,
  onSubmit,
  onClose,
}: XDriveFileExplorerDestinationDialogProps) {
  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()
  const sessionKey = JSON.stringify([lifecycleKey, operation, sources])
  // A reopened picker is a new visual session even when its source IDs match.
  const openEpochRef = useRef({ open, epoch: 0 })
  if (openEpochRef.current.open !== open) {
    openEpochRef.current = { open, epoch: openEpochRef.current.epoch + 1 }
  }
  const viewKey = JSON.stringify([sessionKey, openEpochRef.current.epoch])
  const sessionRef = useRef({ open, key: viewKey })
  sessionRef.current = { open, key: viewKey }
  const initialCrumbsRef = useRef(initialCrumbs)
  initialCrumbsRef.current = initialCrumbs
  const loaderRef = useRef(loadDirectoryPage)
  loaderRef.current = loadDirectoryPage
  const sessionGenerationRef = useRef(0)
  const requestRef = useRef(0)
  const submittingRef = useRef(false)
  const [crumbs, setCrumbs] = useState<readonly XDriveFileExplorerDestinationCrumb[]>(initialCrumbs)
  const [cursors, setCursors] = useState([''])
  const [pageIndex, setPageIndex] = useState(0)
  const [page, setPage] = useState<XDriveFileExplorerNavigationTreePage | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingViewKey, setLoadingViewKey] = useState('')
  const [acceptedViewKey, setAcceptedViewKey] = useState('')
  const [loadErrorViewKey, setLoadErrorViewKey] = useState('')
  const failedTargetRef = useRef<{
    viewKey: string
    crumbs: readonly XDriveFileExplorerDestinationCrumb[]
    cursors: string[]
    pageIndex: number
  } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadPage = useCallback(async (
    nextCrumbs: readonly XDriveFileExplorerDestinationCrumb[],
    nextCursors: string[] = [''],
    nextPageIndex = 0,
  ) => {
    const request = ++requestRef.current
    const key = sessionRef.current.key
    const target = nextCrumbs.map((crumb) => ({ ...crumb }))
    // Keep confirmed folder rows, breadcrumbs and pager mounted while this
    // genuine server request is pending. Intent never commits visual state.
    setLoadingViewKey(key)
    setLoading(true)
    setLoadError('')
    setSubmitError('')
    failedTargetRef.current = null
    const parentID = target.at(-1)?.id
    const current = () => sessionRef.current.open && sessionRef.current.key === key && requestRef.current === request
    if (!parentID) {
      if (current()) {
        failedTargetRef.current = { viewKey: key, crumbs: target, cursors: nextCursors, pageIndex: nextPageIndex }
        setLoadErrorViewKey(key)
        setLoadError('无法确定目标文件夹，请重新打开选择窗口。')
        setLoading(false)
      }
      return
    }
    try {
      const result = await loaderRef.current(parentID, nextCursors[nextPageIndex] || undefined)
      if (current()) {
        setCrumbs(target)
        setCursors(nextCursors)
        setPageIndex(nextPageIndex)
        setPage(result)
        setAcceptedViewKey(key)
        failedTargetRef.current = null
      }
    } catch (error) {
      if (current()) {
        failedTargetRef.current = { viewKey: key, crumbs: target, cursors: nextCursors, pageIndex: nextPageIndex }
        setLoadErrorViewKey(key)
        setLoadError(destinationError(error))
      }
    } finally {
      if (current()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    sessionGenerationRef.current += 1
    submittingRef.current = false
    setSubmitting(false)
    setSubmitError('')
    if (open) void loadPage(initialCrumbsRef.current)
    return () => {
      requestRef.current += 1
      sessionGenerationRef.current += 1
      submittingRef.current = false
    }
  }, [loadPage, open, sessionKey])

  const pageAccepted = open && acceptedViewKey === viewKey
  const visibleCrumbs = pageAccepted ? crumbs : initialCrumbs
  const visiblePage = pageAccepted ? page : null
  const visibleLoading = open && loading && loadingViewKey === viewKey
  const visibleLoadError = loadErrorViewKey === viewKey ? loadError : ''
  const visibleSubmitError = pageAccepted ? submitError : ''
  const targetReason = xDriveFileExplorerDestinationTargetDisabledReason(operation, sources, visibleCrumbs)
  const submitDisabled = visibleLoading || !visiblePage || Boolean(visibleLoadError) || Boolean(targetReason) || submitting
  const close = () => {
    if (submittingRef.current) return
    requestRef.current += 1
    onClose()
  }
  const submit = async () => {
    if (submittingRef.current || submitDisabled) return
    const generation = sessionGenerationRef.current
    const key = viewKey
    const current = () => sessionRef.current.open && sessionRef.current.key === key && sessionGenerationRef.current === generation
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError('')
    try {
      await onSubmit(visibleCrumbs.map((crumb) => ({ ...crumb })))
      if (current()) onClose()
    } catch (error) {
      if (current()) setSubmitError(destinationError(error))
    } finally {
      if (current()) {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }
  const verb = operation === 'move' ? '移动' : '复制'
  const path = visibleCrumbs.map((crumb) => crumb.name).join(' / ')
  const buttonSx = { minHeight: 44, minWidth: 44, whiteSpace: 'normal', overflowWrap: 'anywhere' } as const

  return (
    <Dialog
      open={open}
      onClose={close}
      disableEscapeKeyDown={submitting}
      onKeyDown={(event) => event.stopPropagation()}
      fullScreen={compactTouch}
      maxWidth="sm"
      fullWidth
      aria-label={`${verb}到文件夹`}
      data-xdrive-file-explorer-destination-dialog
      slotProps={{ paper: {
        ...dialogPaper,
        sx: {
          ...dialogPaper.sx,
          minHeight: 0,
          '& .MuiDialogTitle-root .MuiIconButton-root': { minHeight: 44, minWidth: 44 },
          // At 200% text and 200px landscape height, keep Cancel/Confirm
          // inside the visible Paper; shrink vertical chrome, not buttons.
          '@media (max-height: 320px)': {
            maxHeight: '100dvh',
            overflow: 'hidden',
            '& .MuiDialogTitle-root': { minHeight: 0, py: 0.5, px: 1.5, flexShrink: 0 },
            '& .MuiDialogContent-root': { minHeight: 0, flex: '1 1 0%', overflowY: 'auto' },
            '& .MuiDialogActions-root': { minHeight: 44, py: 0.5, flexShrink: 0 },
          },
        },
      } }}
    >
      <XDriveDialogTitle
        title={`${verb}到文件夹`}
        subtitle={`${sources.length.toLocaleString('zh-CN')} 个项目`}
        onClose={close}
        closeDisabled={submitting}
      />
      <XDriveDialogContent dividers>
        <Stack spacing={1.25} sx={{ minWidth: 0 }}>
          <Typography variant="body2" data-xdrive-file-explorer-destination-path sx={{ overflowWrap: 'anywhere' }}>
            目标位置：{path || '尚未确定'}
          </Typography>
          <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.5} aria-label="目标文件夹路径">
            {visibleCrumbs.map((crumb, index) => (
              <Button
                key={crumb.id}
                aria-label={`前往 ${crumb.name}`}
                disabled={submitting || index === visibleCrumbs.length - 1}
                onClick={() => { void loadPage(visibleCrumbs.slice(0, index + 1)) }}
                sx={buttonSx}
              >
                {crumb.name}
              </Button>
            ))}
          </Stack>
          {targetReason ? <Alert severity="info" sx={{ overflowWrap: 'anywhere' }}>{targetReason}</Alert> : null}
          {/* Navigating a target folder is not an operation: keep the stable 4px
              slot and semantic busy state but never insert a delayed loader.
              The previously confirmed path/rows stay visible until receipt. */}
          <Box data-xdrive-destination-quiet-loading
            aria-busy={visibleLoading || undefined}
            sx={{ height: 4, flexShrink: 0 }} />
          {visibleLoadError ? (
            <Stack spacing={0.5}>
              <Alert severity="error" sx={{ overflowWrap: 'anywhere' }}>{visibleLoadError}</Alert>
              <Button onClick={() => {
                const failed = failedTargetRef.current
                if (failed?.viewKey === viewKey) {
                  void loadPage(failed.crumbs, failed.cursors, failed.pageIndex)
                } else {
                  void loadPage(visibleCrumbs, cursors, pageIndex)
                }
              }} sx={buttonSx}>重试加载</Button>
            </Stack>
          ) : null}
          {visiblePage ? (
            <>
              <Box role="group" aria-label="目标位置中的文件夹">
                {visiblePage.items.length === 0 ? <Typography variant="body2" color="text.secondary">此位置没有子文件夹。</Typography> : null}
                {visiblePage.items.map((directory) => (
                  <Button
                    key={directory.id}
                    fullWidth
                    startIcon={<FolderOutlinedIcon />}
                    aria-label={`打开文件夹 ${directory.name}`}
                    data-xdrive-file-explorer-destination-directory={directory.id}
                    disabled={submitting}
                    onClick={() => { void loadPage([...visibleCrumbs, { id: directory.id, name: directory.name }]) }}
                    sx={{ ...buttonSx, justifyContent: 'flex-start', textAlign: 'left' }}
                  >
                    {directory.name}
                  </Button>
                ))}
              </Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} useFlexGap flexWrap="wrap">
                <Button aria-label="上一页文件夹" disabled={submitting || pageIndex === 0} onClick={() => { void loadPage(visibleCrumbs, cursors, pageIndex - 1) }} sx={buttonSx}>上一页</Button>
                <Typography variant="body2">第 {pageIndex + 1} 页</Typography>
                <Button aria-label="下一页文件夹" disabled={submitting || !visiblePage.hasMore} onClick={() => {
                  void loadPage(visibleCrumbs, [...cursors.slice(0, pageIndex + 1), visiblePage.nextCursor], pageIndex + 1)
                }} sx={buttonSx}>下一页</Button>
              </Stack>
            </>
          ) : null}
          {visibleSubmitError ? <Alert severity="error" sx={{ overflowWrap: 'anywhere' }}>{visibleSubmitError}</Alert> : null}
        </Stack>
      </XDriveDialogContent>
      <XDriveDialogActions>
        <Button onClick={close} disabled={submitting} sx={buttonSx}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={submitDisabled} sx={buttonSx}>
          {submitting ? '正在提交任务…' : `${verb}到这里`}
        </Button>
      </XDriveDialogActions>
    </Dialog>
  )
}
