import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, SyntheticEvent } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, Divider,
  List, ListItemButton, ListItemText, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import {
  XDriveNotesMarkdownPreview,
  type XDriveNotesImageResolver,
} from './NotesMarkdownPreview'
import { xDriveNotesSafeRelativeAsset } from '../notes-markdown-policy'

export type XDriveNoteSource = 'mine' | 'ios_notes'

export type XDriveNoteSummary = {
  id: string
  source: XDriveNoteSource
  title: string
  node_id: number
  revision: number
  sha256: string
  bytes: number
  created_at: string
  updated_at: string
}

export type XDriveNoteDetail = XDriveNoteSummary & {
  markdown: string
}

export type XDriveNoteVersion = {
  id: number
  revision: number
  sha256: string
  bytes: number
}

export type XDriveNotesDataPort = {
  /** A stable, verified Server/Owner identity. Must change on account switch,
   * including switching away and back, and must not contain tokens. */
  readonly ownerScopeKey: string
  listNotes(source: XDriveNoteSource, query: string, offset: number, signal?: AbortSignal):
    Promise<{ items: XDriveNoteSummary[]; next_offset: number }>
  readNote(id: string, signal?: AbortSignal): Promise<XDriveNoteDetail>
  createNote(value: { title: string; markdown: string }): Promise<XDriveNoteSummary>
  /** Manual Apple Notes export: a fresh read-only snapshot, never title dedupe. */
  importIOSMarkdown?: (input: { title: string; markdown: string }) => Promise<XDriveNoteSummary>
  saveNote(id: string, value: {
    title: string
    markdown: string
    expected_revision: number
  }): Promise<XDriveNoteSummary>
  deleteNote(id: string, expectedRevision: number): Promise<void>
  listVersions(id: string, signal?: AbortSignal): Promise<XDriveNoteVersion[]>
  /** Historical bytes require the existing Owner-scoped FileVersion read
   * transport. Never construct a public URL from numeric IDs. */
  readVersion?: (nodeID: number, versionID: number, signal?: AbortSignal) => Promise<string>
  /** File downloads remain host-owned and authenticated. */
  exportNote?: (nodeID: number, fileName: string) => Promise<void>
  resolveImage?: XDriveNotesImageResolver
  uploadImage?: (noteID: string, file: File) => Promise<{ relative_path: string }>
  readImageBlob?: (noteID: string, path: string, signal?: AbortSignal) => Promise<Blob>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '备忘录操作失败。请检查当前服务器和账号。'
}

function hasRevisionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { status?: number; statusCode?: number }
  return value.status === 409 || value.statusCode === 409
}

function formatNoteDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : ''
}

export function XDriveNotesPage({ port }: { port: XDriveNotesDataPort }) {
  // Account swaps must dispose the entire page and its in-flight reads, not
  // merely replace a request header while another Owner's note is visible.
  return <XDriveNotesOwnerPage key={port.ownerScopeKey} port={port} />
}

function XDriveNotesOwnerPage({ port }: { port: XDriveNotesDataPort }) {
  const [source, setSource] = useState<XDriveNoteSource>('mine')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [reload, setReload] = useState(0)
  const [items, setItems] = useState<XDriveNoteSummary[]>([])
  const [nextOffset, setNextOffset] = useState(0)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState<XDriveNoteDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [versions, setVersions] = useState<XDriveNoteVersion[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [oldMarkdown, setOldMarkdown] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [showPreview, setShowPreview] = useState(true)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageURLs, setImageURLs] = useState<Record<string, string>>({})
  const readSeq = useRef(0)
  const listSeq = useRef(0)
  const savingRef = useRef(false)
  const latestDraft = useRef({ title: '', markdown: '' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; readSeq.current++ }
  }, [])

  const assetPaths = useMemo(() => {
    if (!selected) return [] as string[]
    const paths = new Set<string>()
    for (const body of [markdown, oldMarkdown ?? '']) {
      for (const match of body.matchAll(/!\[[^\]]{0,180}\]\(([^)\s]{1,500})\)/g)) {
        const path = match[1]
        if (xDriveNotesSafeRelativeAsset(path) &&
            path.startsWith('_assets/' + selected.id + '/')) paths.add(path)
      }
    }
    return [...paths]
  }, [markdown, oldMarkdown, selected?.id])
  const assetPathSignature = assetPaths.join('|')
  useEffect(() => {
    const controller = new AbortController()
    const urls: string[] = []
    setImageURLs({})
    if (selected?.id && port.readImageBlob) {
      for (const path of assetPaths) {
        void port.readImageBlob(selected.id, path, controller.signal).then(blob => {
          if (controller.signal.aborted) return
          const url = URL.createObjectURL(blob)
          urls.push(url)
          setImageURLs(previous => ({ ...previous, [path]: url }))
        }).catch(() => {
          // Missing or invalid assets remain an explicit, safe placeholder.
        })
      }
    }
    return () => {
      controller.abort()
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [selected?.id, port, assetPathSignature])
  const resolveImage = useCallback(
    (path: string) => imageURLs[path] ?? port.resolveImage?.(path) ?? null,
    [imageURLs, port],
  )

  const dirty = selected !== null && selected.source === 'mine' &&
    (title !== selected.title || markdown !== selected.markdown)
  latestDraft.current = { title, markdown }

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    let active = true
    const generation = ++listSeq.current
    const controller = new AbortController()
    setItems([])
    setNextOffset(0)
    setListError('')
    setListLoading(true)
    void port.listNotes(source, debouncedQuery, 0, controller.signal).then(result => {
      if (!active || controller.signal.aborted || listSeq.current !== generation) return
      setItems(result.items)
      setNextOffset(result.next_offset)
    }).catch(error => {
      if (active && !controller.signal.aborted && listSeq.current === generation) setListError(errorMessage(error))
    }).finally(() => {
      if (active && !controller.signal.aborted && listSeq.current === generation) setListLoading(false)
    })
    return () => { active = false; controller.abort() }
  }, [port, source, debouncedQuery, reload])

  const openNote = useCallback(async (id: string) => {
    if (dirty || savingRef.current || busy) {
      setMessage('请先保存当前草稿或放弃修改，再切换备忘录。')
      return
    }
    const seq = ++readSeq.current
    setSelected(null)
    setHistoryOpen(false)
    setVersions([])
    setOldMarkdown(null)
    setConflict(false)
    setMessage('')
    setDetailLoading(true)
    try {
      const note = await port.readNote(id)
      if (readSeq.current !== seq || !mounted.current) return
      setSelected(note)
      setTitle(note.title)
      setMarkdown(note.markdown)
    } catch (error) {
      if (readSeq.current === seq && mounted.current) setMessage(errorMessage(error))
    } finally {
      if (readSeq.current === seq && mounted.current) setDetailLoading(false)
    }
  }, [busy, dirty, port])

  const changeSource = (_event: SyntheticEvent, value: XDriveNoteSource) => {
    if (dirty || savingRef.current) {
      setMessage('当前草稿未保存，无法切换分类。')
      return
    }
    readSeq.current++
    setDetailLoading(false)
    setSelected(null)
    setTitle('')
    setMarkdown('')
    setVersions([])
    setHistoryOpen(false)
    setOldMarkdown(null)
    setMessage('')
    setConflict(false)
    setQuery('')
    setSource(value)
  }

  const save = useCallback(async () => {
    if (!selected || selected.source !== 'mine' || conflict || savingRef.current || !dirty) return
    const current = selected
    const snapshot = { title, markdown, expected_revision: selected.revision }
    const seq = readSeq.current
    savingRef.current = true
    setSaving(true)
    setMessage('')
    try {
      const result = await port.saveNote(current.id, snapshot)
      if (seq !== readSeq.current || !mounted.current) return
      // Commit only the exact snapshot sent to the Server. Any edits made
      // during the awaited write remain dirty and will autosave next.
      setSelected({ ...result, markdown: snapshot.markdown })
      setReload(i => i + 1)
      setConflict(false)
      setMessage('已保存')
    } catch (error) {
      if (seq !== readSeq.current || !mounted.current) return
      if (hasRevisionConflict(error)) {
        setConflict(true)
        setMessage('发现其他设备的更新。当前草稿已保留，先复制或另存草稿，再重新加载。')
      } else {
        setMessage('保存失败，草稿已保留：' + errorMessage(error))
      }
    } finally {
      savingRef.current = false
      if (seq === readSeq.current && mounted.current) setSaving(false)
    }
  }, [port, selected, title, markdown, conflict, dirty])

  useEffect(() => {
    if (!dirty || conflict || saving) return
    const timer = setTimeout(() => { void save() }, 1200)
    return () => clearTimeout(timer)
  }, [dirty, title, markdown, conflict, saving, save])

  const create = async () => {
    if (source !== 'mine' || busy || dirty || savingRef.current) {
      setMessage('请先保存当前草稿，再新建备忘录。')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const item = await port.createNote({ title: '未命名备忘录', markdown: '' })
      if (!mounted.current) return
      setReload(i => i + 1)
      // Create already committed on the Server; open the authoritative read.
      const seq = ++readSeq.current
      const note = await port.readNote(item.id)
      if (readSeq.current !== seq || !mounted.current) return
      setSelected(note)
      setTitle(note.title)
      setMarkdown(note.markdown)
      setConflict(false)
      setVersions([])
    } catch (error) {
      if (mounted.current) setMessage(errorMessage(error))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const importMarkdownSnapshot = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || source !== 'ios_notes' || !port.importIOSMarkdown ||
        busy || dirty || savingRef.current) return
    if (!/\.(?:md|markdown)$/i.test(file.name) ||
        file.size > 1_048_576 || file.size === 0) {
      setMessage('请选择 1 MiB 以内的 .md 或 .markdown 文件。')
      return
    }
    const title = file.name.replace(/\.(?:md|markdown)$/i, '').trim().slice(0, 255)
    if (!title || /[\u0000-\u001f\u007f]/.test(title)) {
      setMessage('文件名不能用作有效的备忘录标题。')
      return
    }
    setBusy(true)
    setMessage('')
    let created: XDriveNoteSummary | null = null
    try {
      // Reject malformed Unicode rather than replacing characters silently.
      const bytes = await file.arrayBuffer()
      if (!mounted.current) return
      const markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      created = await port.importIOSMarkdown({ title, markdown })
      if (!mounted.current) return
      if (created.source !== 'ios_notes') throw new Error('服务器返回的备份来源无效')
      setReload(n => n + 1)
      // A successful POST is authoritative. A failed follow-up GET must NOT
      // cause a second import, since absent stable Notes IDs create snapshots.
      const seq = ++readSeq.current
      try {
        const note = await port.readNote(created.id)
        if (seq !== readSeq.current || !mounted.current) return
        setSelected(note)
        setTitle(note.title)
        setMarkdown(note.markdown)
        setConflict(false)
        setHistoryOpen(false)
        setVersions([])
        setMessage('Markdown 已导入为独立的只读 iOS 备份。')
      } catch {
        if (mounted.current) setMessage('Markdown 已提交；读取回执失败，请刷新 iOS 备份列表核对，勿重复导入。')
      }
    } catch (error) {
      if (mounted.current) setMessage(created
        ? 'Markdown 已提交；后续核对失败，请在列表查找，勿重复导入。'
        : '导入失败或提交结果不确定：' + errorMessage(error) + '。重复导入前请先核对列表。')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const loadMore = async () => {
    if (!nextOffset || listLoading) return
    const position = nextOffset
    const generation = listSeq.current
    const currentSource = source
    const currentQuery = debouncedQuery
    setListLoading(true)
    try {
      const page = await port.listNotes(currentSource, currentQuery, position)
      if (!mounted.current || listSeq.current !== generation ||
        currentSource !== source || currentQuery !== debouncedQuery) return
      setItems(current => {
        const ids = new Set(current.map(x => x.id))
        return [...current, ...page.items.filter(x => !ids.has(x.id))]
      })
      setNextOffset(page.next_offset)
    } catch (error) {
      if (mounted.current && listSeq.current === generation) setListError(errorMessage(error))
    } finally {
      if (mounted.current && listSeq.current === generation) setListLoading(false)
    }
  }

  const loadHistory = async () => {
    if (!selected) return
    const id = selected.id
    setHistoryBusy(true)
    setHistoryError('')
    setOldMarkdown(null)
    setHistoryOpen(true)
    try {
      const items = await port.listVersions(id)
      if (mounted.current && selected?.id === id) setVersions(items)
    } catch (error) {
      if (mounted.current) setHistoryError(errorMessage(error))
    } finally {
      if (mounted.current) setHistoryBusy(false)
    }
  }

  const openVersion = async (item: XDriveNoteVersion) => {
    if (!selected || !port.readVersion) return
    setHistoryBusy(true)
    setHistoryError('')
    try {
      const content = await port.readVersion(selected.node_id, item.id)
      if (mounted.current) setOldMarkdown(content)
    } catch (error) {
      if (mounted.current) setHistoryError(errorMessage(error))
    } finally {
      if (mounted.current) setHistoryBusy(false)
    }
  }

  const remove = async () => {
    if (!selected || selected.source !== 'mine' || busy || savingRef.current) return
    if (dirty) {
      setMessage('当前草稿尚未保存；请先保存后再删除。')
      setDeleteOpen(false)
      return
    }
    setBusy(true)
    try {
      await port.deleteNote(selected.id, selected.revision)
      if (!mounted.current) return
      readSeq.current++
      setSelected(null)
      setVersions([])
      setDeleteOpen(false)
      setMessage('已删除备忘录。')
      setReload(i => i + 1)
    } catch (error) {
      if (mounted.current) setMessage(errorMessage(error))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const discard = () => {
    if (!selected || savingRef.current) return
    setTitle(selected.title)
    setMarkdown(selected.markdown)
    setMessage('已放弃本机未保存的修改。')
    setConflict(false)
  }

  const onTitle = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setTitle(event.target.value)
  const onMarkdown = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setMarkdown(event.target.value)

  const insertImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !selected || selected.source !== 'mine' || !port.uploadImage ||
        busy || savingRef.current) return
    const noteID = selected.id
    const seq = readSeq.current
    setUploadingImage(true)
    setBusy(true)
    setMessage('')
    try {
      const receipt = await port.uploadImage(noteID, file)
      if (seq !== readSeq.current || !mounted.current) return
      if (!xDriveNotesSafeRelativeAsset(receipt.relative_path) ||
          !receipt.relative_path.startsWith('_assets/' + noteID + '/')) {
        throw new Error('服务器返回的图片归属或相对路径无效')
      }
      const alt = file.name.replace(/[\r\n\\\[\]()]/g, ' ').slice(0, 100) || '图片'
      setMarkdown(previous => previous +
        (previous.endsWith('\n') || !previous ? '' : '\n') +
        '\n![' + alt + '](' + receipt.relative_path + ')\n')
      setShowPreview(true)
      setMessage('图片已加入 Markdown，正在自动保存正文。')
    } catch (error) {
      if (mounted.current) setMessage(errorMessage(error))
    } finally {
      if (mounted.current) {
        setUploadingImage(false)
        setBusy(false)
      }
    }
  }


  return <Box data-xdrive-notes-page sx={{ height: '100%', overflow: 'auto', minWidth: 0, pb: 3 }}>
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Typography variant="h5" fontWeight={700}>备忘录</Typography>
      <Typography variant="body2" color="text.secondary">
        Markdown 储存在当前 xDrive 账号的文件内置目录；iOS 备份原件只读。
      </Typography>
      <Tabs value={source} onChange={changeSource} aria-label="备忘录分类">
        <Tab label="我的备忘录" value="mine" />
        <Tab label="iOS 备份" value="ios_notes" />
      </Tabs>
    </Stack>
    {message ? <Alert severity={conflict ? 'warning' : 'info'} sx={{ mb: 2 }}>{message}</Alert> : null}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '275px minmax(0, 1fr)' },
      gap: 2, minHeight: 440 }}>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <TextField size="small" type="search" fullWidth label="搜索标题或正文"
            value={query} onChange={event => setQuery(event.target.value)} />
          {source === 'mine' && <Button disabled={busy || dirty || saving}
            onClick={() => void create()} variant="contained">新建</Button>}
          {source === 'ios_notes' && port.importIOSMarkdown && <Button
            component="label" variant="outlined" disabled={busy || saving}>
            导入 Markdown
            <input hidden type="file" accept=".md,.markdown,text/markdown"
              onChange={event => void importMarkdownSnapshot(event)} />
          </Button>}
        </Stack>
        {listError && <Alert severity="error">{listError}</Alert>}
        <List dense aria-label={source === 'mine' ? '我的备忘录' : 'iOS 备忘录备份'}>
          {items.map(item => <ListItemButton key={item.id}
            selected={selected?.id === item.id}
            onClick={() => void openNote(item.id)}>
            <ListItemText primary={item.title}
              secondary={formatNoteDate(item.updated_at)}
              primaryTypographyProps={{ noWrap: true }}
              secondaryTypographyProps={{ noWrap: true }} />
          </ListItemButton>)}
        </List>
        {listLoading && <CircularProgress size={22} aria-label="正在加载备忘录" />}
        {!listLoading && items.length === 0 && !listError &&
          <Typography sx={{ p: 2 }} color="text.secondary">暂无备忘录</Typography>}
        {nextOffset > 0 && <Button disabled={listLoading}
          onClick={() => void loadMore()}>加载更多</Button>}
      </Box>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, minWidth: 0 }}>
        {detailLoading ? <CircularProgress size={24} />
          : !selected ? <Typography color="text.secondary">
              选择一条备忘录，或点击「新建」开始记录。
            </Typography> : <>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {selected.source === 'ios_notes' ? 'iOS 备份 · 只读' : '我的备忘录'} · 版本 {selected.revision}
              {dirty ? ' · 待保存' : ''}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button onClick={() => void loadHistory()}>历史</Button>
            {port.exportNote && <Button onClick={() => void port.exportNote?.(
              selected.node_id, selected.id + '.md')}>导出</Button>}
            {selected.source === 'mine' && <>
              <Button disabled={saving || busy || !dirty || conflict}
                onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button>
              <Button disabled={saving || !dirty} onClick={discard}>放弃</Button>
              <Button color="error" disabled={busy || saving}
                onClick={() => setDeleteOpen(true)}>删除</Button>
            </>}
          </Stack>
          {selected.source === 'mine' ? <TextField fullWidth label="标题" size="small"
            value={title} onChange={onTitle} sx={{ mb: 2 }} inputProps={{ maxLength: 255 }} />
            : <Typography variant="h6" sx={{ mb: 2 }}>{selected.title}</Typography>}
          {selected.source === 'mine' && <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Button variant={!showPreview ? 'contained' : 'outlined'}
              size="small" onClick={() => setShowPreview(false)}>Markdown 编辑</Button>
            <Button variant={showPreview ? 'contained' : 'outlined'}
              size="small" onClick={() => setShowPreview(true)}>预览</Button>
            {port.uploadImage && <Button component="label" size="small"
              disabled={busy || saving || uploadingImage}>
              {uploadingImage ? '上传图片中…' : '插入图片'}
              <input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/heic"
                onChange={event => void insertImage(event)} />
            </Button>}
          </Stack>}
          {selected.source === 'mine' && !showPreview
            ? <TextField fullWidth multiline minRows={12} maxRows={28} label="Markdown 正文"
                value={markdown} onChange={onMarkdown}
                inputProps={{ spellCheck: true }}
                helperText="编辑停止约 1.2 秒后自动保存；冲突时会保留当前草稿。" />
            : <XDriveNotesMarkdownPreview markdown={markdown} resolveImage={resolveImage} />}
        </>}
      </Box>
    </Box>
    <Dialog open={deleteOpen} onClose={() => !busy && setDeleteOpen(false)}>
      <DialogTitle>删除此备忘录？</DialogTitle>
      <DialogContent><DialogContentText>
        仅删除「我的备忘录」中的当前内容，不影响 iOS 备份。此操作不会自动同步删除 Apple Notes。
      </DialogContentText></DialogContent>
      <DialogActions>
        <Button onClick={() => setDeleteOpen(false)} disabled={busy}>取消</Button>
        <Button color="error" onClick={() => void remove()} disabled={busy}>删除</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={historyOpen} fullWidth maxWidth="sm" onClose={() => setHistoryOpen(false)}>
      <DialogTitle>备忘录版本历史</DialogTitle>
      <DialogContent>
        {historyError && <Alert severity="error">{historyError}</Alert>}
        {historyBusy && <CircularProgress size={22} />}
        <List dense>
          {versions.map(item => <ListItemButton key={item.id}
            disabled={!port.readVersion || historyBusy}
            onClick={() => void openVersion(item)}>
            <ListItemText primary={'版本 ' + item.revision}
              secondary={'大小 ' + item.bytes + ' 字节'} />
          </ListItemButton>)}
        </List>
        {versions.length === 0 && !historyBusy && <Typography color="text.secondary">
          暂无旧版记录
        </Typography>}
        {oldMarkdown !== null && <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 2 }}>旧版内容（只读）</Typography>
          <XDriveNotesMarkdownPreview markdown={oldMarkdown} resolveImage={resolveImage} />
        </>}
      </DialogContent>
      <DialogActions><Button onClick={() => setHistoryOpen(false)}>关闭</Button></DialogActions>
    </Dialog>
  </Box>
}
