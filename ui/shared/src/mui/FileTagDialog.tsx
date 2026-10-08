import { useEffect, useMemo, useRef, useState } from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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

const defaultTagColor = '#6B7280'

export function XDriveFileTagDialog({
  open,
  nodeIDs,
  tags,
  busy = false,
  queryNodeTags,
  onSetTag,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onClose,
}: {
  open: boolean
  nodeIDs: number[]
  tags: readonly XDriveFileTag[]
  busy?: boolean
  queryNodeTags: (nodeIDs: number[]) => Promise<XDriveFileNodeTags[]>
  onSetTag: (tagID: number, nodeIDs: number[], assigned: boolean) => Promise<void>
  onCreateTag: (name: string, color: string) => Promise<XDriveFileTag>
  onUpdateTag: (id: number, input: { name?: string; color?: string }) => Promise<XDriveFileTag>
  onDeleteTag: (tagID: number) => Promise<unknown>
  onClose: () => void
}) {
  const [assignments, setAssignments] = useState<XDriveFileNodeTags[]>([])
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(defaultTagColor)
  const [editingTagID, setEditingTagID] = useState<number | null>(null)
  const [error, setError] = useState('')
  const dialogGenerationRef = useRef(0)
  const signature = nodeIDs.join(',')

  useEffect(() => {
    const generation = dialogGenerationRef.current + 1
    dialogGenerationRef.current = generation
    if (!open || nodeIDs.length === 0) {
      setAssignments([])
      setEditingTagID(null)
      setName('')
      setColor(defaultTagColor)
      return
    }
    let active = true
    setLoading(true)
    setError('')
    void queryNodeTags(nodeIDs).then((value) => {
      if (active) setAssignments(value)
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      if (dialogGenerationRef.current === generation) {
        dialogGenerationRef.current += 1
      }
    }
  }, [open, queryNodeTags, signature])

  const counts = useMemo(() => {
    const next = new Map<number, number>()
    for (const assignment of assignments) {
      for (const tag of assignment.tags) next.set(tag.id, (next.get(tag.id) ?? 0) + 1)
    }
    return next
  }, [assignments])

  const toggle = async (tag: XDriveFileTag) => {
    const generation = dialogGenerationRef.current
    const assignedCount = counts.get(tag.id) ?? 0
    const assign = assignedCount !== nodeIDs.length
    setError('')
    try {
      await onSetTag(tag.id, nodeIDs, assign)
      if (dialogGenerationRef.current !== generation) return
      setAssignments((current) => current.map((entry) => {
        const has = entry.tags.some((item) => item.id === tag.id)
        if (assign && !has) return { ...entry, tags: [...entry.tags, tag] }
        if (!assign && has) return { ...entry, tags: entry.tags.filter((item) => item.id !== tag.id) }
        return entry
      }))
    } catch (reason) {
      if (dialogGenerationRef.current === generation) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
  }

  const submitTag = async () => {
    const generation = dialogGenerationRef.current
    const trimmed = name.trim()
    if (!trimmed) return
    setError('')
    try {
      if (editingTagID !== null) {
        const updated = await onUpdateTag(editingTagID, { name: trimmed, color })
        if (dialogGenerationRef.current !== generation) return
        setAssignments((current) => current.map((entry) => ({
          ...entry,
          tags: entry.tags.map((tag) => tag.id === editingTagID ? { ...tag, ...updated } : tag),
        })))
        setEditingTagID(null)
        setName('')
        setColor(defaultTagColor)
        return
      }
      const tag = await onCreateTag(trimmed, color)
      if (dialogGenerationRef.current !== generation) return
      await onSetTag(tag.id, nodeIDs, true)
      if (dialogGenerationRef.current !== generation) return
      setName('')
      setColor(defaultTagColor)
      setAssignments((current) => current.map((entry) => ({ ...entry, tags: [...entry.tags, tag] })))
    } catch (reason) {
      if (dialogGenerationRef.current === generation) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>标签</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {nodeIDs.length === 1 ? '为此项目添加或移除标签。' : `为已选择的 ${nodeIDs.length} 个项目批量设置标签。`}
        </Typography>
        {loading ? (
          <Box sx={{ py: 3, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box>
        ) : (
          <List dense disablePadding>
            {tags.map((tag) => {
              const assignedCount = counts.get(tag.id) ?? 0
              const checked = nodeIDs.length > 0 && assignedCount === nodeIDs.length
              const indeterminate = assignedCount > 0 && assignedCount < nodeIDs.length
              return (
                <ListItem
                  key={tag.id}
                  disablePadding
                  secondaryAction={(
                    <Stack direction="row" spacing={0.25}>
                      <Tooltip title="编辑标签">
                        <span>
                          <IconButton
                            size="small"
                            disabled={busy}
                            onClick={() => {
                              setEditingTagID(tag.id)
                              setName(tag.name)
                              setColor(tag.color || defaultTagColor)
                            }}
                            aria-label={`编辑标签 ${tag.name}`}
                          >
                            <EditRoundedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="删除标签">
                        <span>
                          <IconButton
                            size="small"
                            disabled={busy}
                            onClick={() => { void onDeleteTag(tag.id) }}
                            aria-label={`删除标签 ${tag.name}`}
                          >
                            <DeleteOutlineRoundedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  )}
                >
                  <ListItemButton disabled={busy} onClick={() => { void toggle(tag) }}>
                    <Checkbox checked={checked} indeterminate={indeterminate} edge="start" tabIndex={-1} />
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: tag.color || 'text.disabled', mr: 1 }} />
                    <ListItemText primary={tag.name} secondary={tag.item_count ? `${tag.item_count} 个项目` : undefined} />
                  </ListItemButton>
                </ListItem>
              )
            })}
            {tags.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>还没有标签。</Typography>
            ) : null}
          </List>
        )}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
          <TextField
            size="small"
            label={editingTagID === null ? '新标签' : '标签名称'}
            value={name}
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
            onChange={(event) => setColor(event.target.value)}
            sx={{ width: 62, '& input': { p: 0.5, height: 28 } }}
            inputProps={{ 'aria-label': '标签颜色' }}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={editingTagID === null ? <AddRoundedIcon /> : <EditRoundedIcon />}
            disabled={busy || !name.trim()}
            onClick={() => { void submitTag() }}
          >
            {editingTagID === null ? '添加' : '保存'}
          </Button>
        </Stack>
        {editingTagID !== null ? (
          <Button
            size="small"
            sx={{ mt: 0.75 }}
            disabled={busy}
            onClick={() => {
              setEditingTagID(null)
              setName('')
              setColor(defaultTagColor)
            }}
          >
            取消编辑
          </Button>
        ) : null}
        {error ? <Typography color="error" variant="caption" sx={{ display: 'block', mt: 1 }}>{error}</Typography> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>完成</Button>
      </DialogActions>
    </Dialog>
  )
}
