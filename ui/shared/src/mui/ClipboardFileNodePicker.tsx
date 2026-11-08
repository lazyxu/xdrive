import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, List, ListItemButton, ListItemText, Stack, Typography,
} from '@mui/material'

export type ClipboardFileNode = { id: number; name: string; type: 'dir' | 'file'; size: number }
export type ClipboardFileBrowsePort = {
  root(signal: AbortSignal): Promise<ClipboardFileNode>
  page(folder: number, cursor: string | undefined, signal: AbortSignal): Promise<{
    items: ClipboardFileNode[]; next_cursor?: string
  }>
}

/** Owner-scoped read-only picker with <=50 mounted rows and abortable requests.
 * No file content enters Clipboard; the Owner's original CAS file is referenced.
 */
export function ClipboardFileNodePicker({ open, port, kind, onSelect, onClose }: {
  open: boolean; port: ClipboardFileBrowsePort; kind: 'image' | 'file'
  onSelect(node: ClipboardFileNode): void; onClose(): void
}) {
  const [trail, setTrail] = useState<ClipboardFileNode[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [previous, setPrevious] = useState<(string | undefined)[]>([])
  const [page, setPage] = useState<ClipboardFileNode[]>([])
  const [next, setNext] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) { setTrail([]); setPage([]); return }
    const task = new AbortController()
    setLoading(true); setError('')
    void port.root(task.signal).then(root => {
      if (task.signal.aborted) return
      if (!Number.isSafeInteger(root.id) || root.id <= 0 || root.type !== 'dir') throw Error('invalid root')
      setTrail([root]); setCursor(undefined); setPrevious([])
    }).catch(() => { if (!task.signal.aborted) setError('无法读取当前 Owner 的根文件夹') })
      .finally(() => { if (!task.signal.aborted) setLoading(false) })
    return () => task.abort()
  }, [open, port])
  const folder = trail[trail.length - 1]
  useEffect(() => {
    if (!open || !folder) return
    const task = new AbortController()
    setLoading(true); setPage([]); setNext(undefined); setError('')
    void port.page(folder.id, cursor, task.signal).then(result => {
      if (task.signal.aborted) return
      if (!Array.isArray(result.items) || result.items.length > 50 ||
          result.items.some(item => !Number.isSafeInteger(item.id) || item.id <= 0 ||
            (item.type !== 'dir' && item.type !== 'file'))) throw Error('invalid page')
      setPage(result.items)
      setNext(result.next_cursor || undefined)
    }).catch(() => { if (!task.signal.aborted) setError('文件列表读取失败，请重试') })
      .finally(() => { if (!task.signal.aborted) setLoading(false) })
    return () => task.abort()
  }, [open, port, folder, cursor])
  const enter = (node: ClipboardFileNode) => {
    if (loading) return
    if (node.type === 'dir') {
      setTrail(rows => [...rows, node]); setCursor(undefined); setPrevious([])
    } else if (kind === 'image' && !/\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(node.name)) {
      setError('该文件不是常见图片格式，请切换为文件引用')
    } else onSelect(node)
  }
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle>选择已上传的云端{kind === 'image' ? '图片' : '文件'}</DialogTitle>
    <DialogContent dividers>
      <Stack gap={1}>
        <Typography variant="caption">{trail.map(item => item.name).join(' / ') || '读取目录…'}</Typography>
        {error ? <Alert severity="warning">{error}</Alert> : null}
        <Box sx={{ minHeight: 120 }}>
          {loading ? <CircularProgress size={22} /> : <List dense disablePadding>
            {page.map(item => <ListItemButton key={item.id} onClick={() => enter(item)}>
              <ListItemText primary={item.name} secondary={item.type === 'dir' ? '文件夹' : '文件 · ' + item.size + ' B'}/>
            </ListItemButton>)}
            {!page.length && !error ? <Typography color="text.secondary">本页暂无文件</Typography> : null}
          </List>}
        </Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Button size="small" disabled={loading || trail.length <= 1} onClick={() => {
            setTrail(t => t.slice(0,-1)); setCursor(undefined); setPrevious([])
          }}>上一级</Button>
          <Stack direction="row" gap={1}>
            <Button size="small" disabled={loading || previous.length === 0} onClick={() => {
              setCursor(previous[previous.length - 1]); setPrevious(h => h.slice(0,-1))
            }}>上一页</Button>
            <Button size="small" disabled={loading || !next || previous.length >= 100} onClick={() => {
              setPrevious(h => [...h, cursor]); setCursor(next)
            }}>下一页</Button>
          </Stack>
        </Stack>
      </Stack>
    </DialogContent>
    <DialogActions>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 2 }}>
        引用已存在的 CAS 原件
      </Typography>
      <Button onClick={onClose}>取消</Button>
    </DialogActions>
  </Dialog>
}
