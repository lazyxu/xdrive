import { useEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import type { FileShare, OwnerFileShare, OwnerFileSharePage, XDriveShareAccess } from '../models'
import { XDriveShareStatusBadge } from './ShareStatusBadge'

export interface XDriveShareCenterPort {
  listPage(cursor: number, limit: number, signal?: AbortSignal): Promise<OwnerFileSharePage>
  getShareLink(shareID: number): Promise<string>
  updateShare(shareID: number, input: { expires_at: string | null; access: XDriveShareAccess }): Promise<FileShare>
  revokeShare(shareID: number): Promise<unknown>
}

function localTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}

export function XDriveShareCenterPage({ port }: { port: XDriveShareCenterPort }) {
  const [items, setItems] = useState<OwnerFileShare[]>([])
  const [cursor, setCursor] = useState(0)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [manualLink, setManualLink] = useState('')
  const [editing, setEditing] = useState<OwnerFileShare | null>(null)
  const [expiry, setExpiry] = useState('')
  const [access, setAccess] = useState<XDriveShareAccess>('read_only')
  const [revoking, setRevoking] = useState<OwnerFileShare | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    const current = ++generation.current
    setLoading(true)
    setItems([])
    setCursor(0)
    setError('')
    setManualLink('')
    void port.listPage(0, 50, controller.signal).then(page => {
      if (controller.signal.aborted || current !== generation.current) return
      setItems(page.items)
      setCursor(page.next_cursor)
    }).catch(err => {
      if (!controller.signal.aborted && current === generation.current) setError(errorText(err))
    }).finally(() => {
      if (!controller.signal.aborted && current === generation.current) setLoading(false)
    })
    return () => { controller.abort(); generation.current++ }
  }, [port, reload])

  const loadMore = async () => {
    if (!cursor || busy) return
    const current = generation.current
    setBusy(true)
    try {
      const page = await port.listPage(cursor, 50)
      if (generation.current !== current) return
      setItems(previous => {
        const ids = new Set(previous.map(share => share.id))
        return [...previous, ...page.items.filter(share => !ids.has(share.id))]
      })
      setCursor(page.next_cursor)
    } catch (err) {
      if (generation.current === current) setError(errorText(err))
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }

  const copy = async (share: OwnerFileShare) => {
    if (busy || share.status === 'revoked' || share.node_missing) return
    setBusy(true)
    setError('')
    const current = generation.current
    try {
      const link = await port.getShareLink(share.id)
      if (current !== generation.current) return
      try {
        await navigator.clipboard.writeText(link)
        if (current === generation.current) setNotice('分享链接已复制；旧链接、权限和有效期均不变。')
      } catch {
        if (current === generation.current) setManualLink(link)
      }
    } catch (err) {
      if (current === generation.current) setError(errorText(err))
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }

  const edit = (share: OwnerFileShare) => {
    setEditing(share)
    setExpiry(localTime(share.expires_at))
    setAccess(share.node_type === 'dir' ? share.access ?? 'read_only' : 'read_only')
  }

  const save = async () => {
    if (!editing || busy) return
    const date = expiry ? new Date(expiry) : null
    if (date && (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())) {
      setError('请输入未来的过期时间，或留空表示永久有效。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await port.updateShare(editing.id, {
        expires_at: date ? date.toISOString() : null,
        access: editing.node_type === 'dir' ? access : 'read_only',
      })
      setEditing(null)
      setNotice('分享已更新，链接保持不变。')
      setReload(current => current + 1)
    } catch (err) {
      setError(errorText(err))
    } finally { setBusy(false) }
  }

  const revoke = async () => {
    if (!revoking || busy) return
    setBusy(true)
    setError('')
    try {
      await port.revokeShare(revoking.id)
      setRevoking(null)
      setNotice('已撤销分享，所有历史链接同时失效。')
      setReload(current => current + 1)
    } catch (err) {
      setError(errorText(err))
    } finally { setBusy(false) }
  }

  return <Box data-xdrive-share-center sx={{ height: '100%', overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 3 }}>
    <Stack spacing={1} sx={{ mb: 3 }}>
      <Typography variant="h5" fontWeight={700}>分享中心</Typography>
      <Typography variant="body2" color="text.secondary">集中查看当前账号的全部文件和文件夹分享，复制、编辑权限或有效期、撤销。</Typography>
    </Stack>
    {error ? <Typography color="error" role="alert" sx={{ mb: 2 }}>{error}</Typography> : null}
    {notice ? <Typography role="status" sx={{ mb: 2 }}>{notice}</Typography> : null}
    {loading ? <Typography role="status">正在加载分享…</Typography> : items.length === 0
      ? <Typography color="text.secondary">暂无分享。可在文件管理器中选择文件或文件夹创建分享。</Typography>
      : <>
        <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Table size="small" aria-label="我的分享">
            <TableHead><TableRow>
              <TableCell>文件或文件夹</TableCell><TableCell>状态</TableCell><TableCell>权限</TableCell>
              <TableCell>过期时间</TableCell><TableCell>创建时间</TableCell><TableCell align="right">操作</TableCell>
            </TableRow></TableHead>
            <TableBody>{items.map(share => <TableRow key={share.id} hover>
              <TableCell>
                <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere', maxWidth: 240 }}>{share.node_name}</Typography>
                <Typography variant="caption" color="text.secondary">{share.node_missing ? '文件已删除' : share.node_type === 'dir' ? '文件夹' : '文件'}{share.has_password ? ' · 密码保护' : ''}</Typography>
              </TableCell>
              <TableCell><XDriveShareStatusBadge status={share.status} /></TableCell>
              <TableCell>{share.access === 'view_upload' ? '查看 + 上传' : '只读'}</TableCell>
              <TableCell>{share.expires_at ? new Date(share.expires_at).toLocaleString() : '永不过期'}</TableCell>
              <TableCell>{new Date(share.created_at).toLocaleString()}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <Button size="small" disabled={busy || share.status === 'revoked' || share.node_missing} onClick={() => void copy(share)}>复制链接</Button>
                <Button size="small" disabled={busy || share.status === 'revoked' || share.node_missing} onClick={() => edit(share)}>编辑</Button>
                <Button size="small" color="error" disabled={busy || share.status === 'revoked'} onClick={() => setRevoking(share)}>撤销</Button>
              </TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">已加载 {items.length} 条</Typography>
          {cursor > 0 ? <Button size="small" disabled={busy} onClick={() => void loadMore()}>加载更多</Button> : null}
          <Button size="small" onClick={() => setReload(current => current + 1)}>刷新</Button>
        </Stack>
      </>}
    <Dialog open={Boolean(editing)} onClose={() => { if (!busy) setEditing(null) }} fullWidth maxWidth="xs">
      <DialogTitle>编辑分享</DialogTitle>
      <DialogContent sx={{ pt: '12px !important', display: 'grid', gap: 2 }}>
        <TextField size="small" label="过期时间（留空表示永久）" type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        {editing?.node_type === 'dir' ? <TextField select size="small" label="访问权限" value={access} onChange={e => setAccess(e.target.value as XDriveShareAccess)}>
          <MenuItem value="read_only">只读</MenuItem><MenuItem value="view_upload">查看 + 上传</MenuItem>
        </TextField> : null}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button variant="contained" disabled={busy} onClick={() => void save()}>保存</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(revoking)} onClose={() => { if (!busy) setRevoking(null) }}>
      <DialogTitle>撤销这条分享？</DialogTitle>
      <DialogContent>所有已经发出去的链接都会失效，此操作不会生成新链接。</DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setRevoking(null)}>取消</Button><Button color="error" disabled={busy} onClick={() => void revoke()}>确认撤销</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(manualLink)} onClose={() => setManualLink('')} fullWidth>
      <DialogTitle>手动复制链接</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }}>浏览器未允许自动写入剪贴板，请手动选择并复制。</Typography>
        <TextField fullWidth multiline minRows={2} value={manualLink} slotProps={{ input: { readOnly: true } }} />
      </DialogContent>
      <DialogActions><Button onClick={() => setManualLink('')}>关闭</Button><Button onClick={() => {
        void navigator.clipboard.writeText(manualLink).then(() => setManualLink('')).catch(() => undefined)
      }}>复制</Button></DialogActions>
    </Dialog>
  </Box>
}
