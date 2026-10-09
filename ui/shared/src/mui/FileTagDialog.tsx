import { useEffect, useMemo, useRef, useState } from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { XDriveFileNodeTags, XDriveFileTag } from '../file-explorer-organization'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from './DialogTitle'

const defaultTagColor = '#6B7280'
type KnownNodeTags = Omit<XDriveFileNodeTags, 'tags'> & { tags: XDriveFileTag[] }
export type XDriveFileTagDialogMode = 'manage' | 'assign'

function tagError(reason: unknown) {
  return (reason instanceof Error ? reason.message : String(reason)) || '操作未完成，请重试。'
}

export function XDriveFileTagDialog({
  open,
  mode = 'assign',
  nodeIDs: selectedNodeIDs,
  tags,
  tagsLoading = false,
  tagsError = '',
  onRetryTags,
  busy = false,
  queryNodeTags,
  onSetTag,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onClose,
}: {
  open: boolean
  mode?: XDriveFileTagDialogMode
  nodeIDs: readonly number[]
  tags: readonly XDriveFileTag[]
  tagsLoading?: boolean
  tagsError?: string
  onRetryTags?: () => void
  busy?: boolean
  queryNodeTags: (nodeIDs: number[]) => Promise<XDriveFileNodeTags[]>
  onSetTag: (tagID: number, nodeIDs: number[], assigned: boolean) => Promise<void>
  onCreateTag: (name: string, color: string) => Promise<XDriveFileTag>
  onUpdateTag: (id: number, input: { name?: string; color?: string }) => Promise<XDriveFileTag>
  onDeleteTag: (tagID: number) => Promise<unknown>
  onClose: () => void
}) {
  const nodeIDs = useMemo(() => [...new Set(selectedNodeIDs)], [selectedNodeIDs])
  const selectionError = mode !== 'assign' ? ''
    : nodeIDs.some((id) => !Number.isSafeInteger(id) || id <= 0)
      ? '所选项目包含无效标识，请重新选择。'
      : nodeIDs.length === 0
        ? '请先选择需要设置标签的项目。'
        : nodeIDs.length > 500
          ? '一次最多为 500 个项目设置标签，请缩小选择范围。'
          : ''
  const [assignments, setAssignments] = useState<KnownNodeTags[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [readError, setReadError] = useState('')
  const [retryVersion, setRetryVersion] = useState(0)
  const [name, setName] = useState('')
  const [color, setColor] = useState(defaultTagColor)
  const [editingTagID, setEditingTagID] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const dialogGenerationRef = useRef(0)
  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()
  const signature = nodeIDs.join(',')
  const actionBusy = busy || pending

  useEffect(() => {
    const generation = dialogGenerationRef.current + 1
    dialogGenerationRef.current = generation
    pendingRef.current = false
    setPending(false)
    setAssignments(null)
    setReadError('')
    setError('')
    if (!open) {
      setLoading(false)
      setEditingTagID(null)
      setName('')
      setColor(defaultTagColor)
      return
    }
    if (mode === 'manage' || selectionError) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    void queryNodeTags(nodeIDs).then((value) => {
      if (active) setAssignments(value.map((entry) => ({
        ...entry,
        // The Server emits null for a node whose tag slice is empty.
        tags: entry.tags === null ? [] : entry.tags,
      })))
    }).catch((reason) => {
      if (active) setReadError(tagError(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      if (dialogGenerationRef.current === generation) {
        dialogGenerationRef.current += 1
      }
    }
  }, [open, mode, queryNodeTags, signature, selectionError, retryVersion])

  const counts = useMemo(() => {
    const next = new Map<number, number>()
    for (const assignment of assignments ?? []) {
      for (const tag of assignment.tags) next.set(tag.id, (next.get(tag.id) ?? 0) + 1)
    }
    return next
  }, [assignments])
  const assignmentReady = assignments !== null && !loading && !readError && !selectionError

  const beginWrite = () => {
    if (busy || pendingRef.current) return null
    pendingRef.current = true
    setPending(true)
    setError('')
    return dialogGenerationRef.current
  }
  const finishWrite = (generation: number) => {
    if (dialogGenerationRef.current !== generation) return
    pendingRef.current = false
    setPending(false)
  }
  const close = () => {
    if (!busy && !pendingRef.current) onClose()
  }
  const toggle = async (tag: XDriveFileTag) => {
    if (mode !== 'assign' || !assignmentReady) return
    const generation = beginWrite()
    if (generation === null) return
    const assignedCount = counts.get(tag.id) ?? 0
    const assign = assignedCount !== nodeIDs.length
    try {
      await onSetTag(tag.id, nodeIDs, assign)
      if (dialogGenerationRef.current !== generation) return
      setAssignments((current) => current?.map((entry) => {
        const has = entry.tags.some((item) => item.id === tag.id)
        if (assign && !has) return { ...entry, tags: [...entry.tags, tag] }
        if (!assign && has) return { ...entry, tags: entry.tags.filter((item) => item.id !== tag.id) }
        return entry
      }) ?? null)
    } catch (reason) {
      if (dialogGenerationRef.current === generation) setError(tagError(reason))
    } finally {
      finishWrite(generation)
    }
  }

  const submitTag = async () => {
    if (busy || pendingRef.current || (mode === 'assign' && editingTagID === null && !assignmentReady)) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请填写标签名称。')
      return
    }
    if (new TextEncoder().encode(trimmed).length > 64) {
      setError('标签名称不能超过 64 个 UTF-8 字节（中文等字符会占多个字节）。')
      return
    }
    const generation = beginWrite()
    if (generation === null) return
    try {
      if (editingTagID !== null) {
        const updated = await onUpdateTag(editingTagID, { name: trimmed, color })
        if (dialogGenerationRef.current !== generation) return
        setAssignments((current) => current?.map((entry) => ({
          ...entry,
          tags: entry.tags.map((tag) => tag.id === editingTagID ? { ...tag, ...updated } : tag),
        })) ?? null)
        setEditingTagID(null)
      } else {
        const tag = await onCreateTag(trimmed, color)
        if (dialogGenerationRef.current !== generation) return
        // The definition is already committed, even if applying it fails.
        setName('')
        setColor(defaultTagColor)
        if (mode === 'assign') {
          try {
            await onSetTag(tag.id, nodeIDs, true)
          } catch (reason) {
            throw new Error('标签已创建，但未能应用到所选项目：' + tagError(reason) + '。请在标签列表中重试添加此标签。')
          }
          if (dialogGenerationRef.current !== generation) return
          setAssignments((current) => current?.map((entry) => ({ ...entry, tags: [...entry.tags, tag] })) ?? null)
        }
      }
      setName('')
      setColor(defaultTagColor)
    } catch (reason) {
      if (dialogGenerationRef.current === generation) setError(tagError(reason))
    } finally {
      finishWrite(generation)
    }
  }

  const deleteTag = async (tagID: number) => {
    const generation = beginWrite()
    if (generation === null) return
    try {
      await onDeleteTag(tagID)
      if (dialogGenerationRef.current !== generation) return
      setAssignments((current) => current?.map((entry) => ({ ...entry, tags: entry.tags.filter((tag) => tag.id !== tagID) })) ?? null)
      if (editingTagID === tagID) {
        setEditingTagID(null)
        setName('')
        setColor(defaultTagColor)
      }
    } catch (reason) {
      if (dialogGenerationRef.current === generation) setError(tagError(reason))
    } finally {
      finishWrite(generation)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      disableEscapeKeyDown={actionBusy}
      aria-label={mode === 'manage' ? '管理标签' : '设置标签'}
      data-xdrive-file-tag-dialog
      maxWidth="xs"
      fullWidth
      fullScreen={compactTouch}
      scroll="paper"
      slotProps={{ paper: { ...dialogPaper, sx: {
        ...dialogPaper.sx,
        minHeight: 0,
        '@media (max-width:899.95px)': {
          '& .MuiButton-root, & .MuiIconButton-root': { minWidth: 44, minHeight: 44 },
          '& .MuiButton-root': { whiteSpace: 'normal' },
          '& .MuiInputBase-root': { minHeight: 44 },
          '& input[type="color"]': { minHeight: 36 },
        },
      } } }}
    >
      <XDriveDialogTitle title={mode === 'manage' ? '管理标签' : '设置标签'} onClose={close} closeDisabled={actionBusy} />
      <XDriveDialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>
          {mode === 'manage' ? '创建、编辑和删除标签定义。'
            : '当前选择 ' + nodeIDs.length + ' 个项目。勾选为全部所选项目添加标签，取消勾选仅移除这些项目的标记。'}
        </Typography>
        {selectionError ? <Alert severity="warning" sx={{ mb: 1.5 }}>{selectionError}</Alert> : null}
        {tagsError ? (
          <Stack spacing={0.5} sx={{ mb: 1.5 }}>
            <Alert severity="error" sx={{ overflowWrap: 'anywhere' }}>{tagsError}</Alert>
            {onRetryTags ? <Button disabled={actionBusy || tagsLoading} onClick={onRetryTags}>重试加载标签</Button> : null}
          </Stack>
        ) : null}
        {mode === 'assign' && readError ? (
          <Stack spacing={0.5} sx={{ mb: 1.5 }}>
            <Alert severity="error" sx={{ overflowWrap: 'anywhere' }}>标记状态未知：{readError}</Alert>
            <Button disabled={actionBusy} onClick={() => setRetryVersion((value) => value + 1)}>重试读取标记</Button>
          </Stack>
        ) : null}
        {tagsLoading || loading ? (
          <Box sx={{ py: 3, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} aria-label={tagsLoading ? '正在加载标签' : '正在读取标记'} /></Box>
        ) : (
          <List dense disablePadding>
            {tags.map((tag) => {
              const assignedCount = counts.get(tag.id) ?? 0
              const checked = assignmentReady && assignedCount === nodeIDs.length
              const indeterminate = assignmentReady && assignedCount > 0 && assignedCount < nodeIDs.length
              const content = (
                <>
                  {mode === 'assign' && assignmentReady ? <Checkbox checked={checked} indeterminate={indeterminate} edge="start" tabIndex={-1} inputProps={{ 'aria-label': '标签 ' + tag.name }} /> : null}
                  <Box sx={{ width: 10, height: 10, flexShrink: 0, borderRadius: '50%', bgcolor: tag.color || 'text.disabled', mr: 1, mt: 0.8 }} />
                  <ListItemText
                    primary={tag.name}
                    secondary={mode === 'assign'
                      ? assignmentReady ? '当前选择 ' + assignedCount + '/' + nodeIDs.length + ' 已标记；全部项目 ' + tag.item_count : '标记状态未知'
                      : '全部项目 ' + tag.item_count}
                    sx={{ minWidth: 0, '& .MuiTypography-root': { overflowWrap: 'anywhere' } }}
                  />
                </>
              )
              return (
                <ListItem key={tag.id} disablePadding sx={{ alignItems: 'flex-start', gap: 0.5 }}>
                  {mode === 'assign' ? (
                    <ListItemButton
                      disabled={actionBusy || !assignmentReady}
                      aria-label={!assignmentReady ? '标签 ' + tag.name + '，标记状态未知'
                        : checked ? '从当前选择移除标签 ' + tag.name : '为当前选择添加标签 ' + tag.name}
                      onClick={() => { void toggle(tag) }}
                      sx={{ minWidth: 0, minHeight: 44, alignItems: 'flex-start', px: 1 }}
                    >{content}</ListItemButton>
                  ) : <Box sx={{ display: 'flex', flex: 1, minWidth: 0, px: 1, py: 1 }}>{content}</Box>}
                  <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                    <Tooltip title="编辑标签">
                      <span><IconButton
                        size="small"
                        disabled={actionBusy}
                        onClick={() => {
                          setEditingTagID(tag.id)
                          setName(tag.name)
                          setColor(tag.color || defaultTagColor)
                          setError('')
                        }}
                        aria-label={'编辑标签 ' + tag.name}
                      ><EditRoundedIcon fontSize="small" /></IconButton></span>
                    </Tooltip>
                    <Tooltip title="删除标签定义">
                      <span><IconButton size="small" disabled={actionBusy} onClick={() => { void deleteTag(tag.id) }} aria-label={'删除标签定义 ' + tag.name}>
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton></span>
                    </Tooltip>
                  </Stack>
                </ListItem>
              )
            })}
            {tags.length === 0 && !tagsError ? <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>还没有标签。可在下方创建。</Typography> : null}
          </List>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, overflowWrap: 'anywhere' }}>
          删除标签定义会移除它与所有项目的关联，文件本身保留。
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 2 }}>
          <TextField
            size="small"
            label={editingTagID === null ? '新标签' : '标签名称'}
            value={name}
            disabled={actionBusy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitTag()
              }
            }}
            fullWidth
          />
          <TextField
            type="color"
            size="small"
            value={color}
            disabled={actionBusy}
            onChange={(event) => setColor(event.target.value)}
            sx={{ width: { xs: '100%', sm: 62 }, flexShrink: 0, '& input': { p: 0.5, minHeight: 32 } }}
            inputProps={{ 'aria-label': '标签颜色' }}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={editingTagID === null ? <AddRoundedIcon /> : <EditRoundedIcon />}
            disabled={actionBusy || !name.trim() || (mode === 'assign' && editingTagID === null && !assignmentReady)}
            onClick={() => { void submitTag() }}
          >{editingTagID === null ? '添加' : '保存'}</Button>
        </Stack>
        {editingTagID !== null ? (
          <Button size="small" sx={{ mt: 0.75 }} disabled={actionBusy} onClick={() => {
            setEditingTagID(null)
            setName('')
            setColor(defaultTagColor)
            setError('')
          }}>取消编辑</Button>
        ) : null}
        {error ? <Alert severity="error" sx={{ mt: 1.5, overflowWrap: 'anywhere' }}>{error}</Alert> : null}
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton intent="primary" onClick={close} disabled={actionBusy}>完成</XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
