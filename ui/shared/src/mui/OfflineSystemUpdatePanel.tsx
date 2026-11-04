import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, FormControlLabel, LinearProgress, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import type { XDriveOfflineImportPort, XDriveOfflineImportStatus, XDriveOfflineImportSummary } from '../offline-update'
import { XDRIVE_OFFLINE_CHUNK_BYTES, xDriveValidOfflineDigest, xDriveValidOfflineFilename, xDriveValidOfflineImportID } from '../offline-update'
import { formatBytes } from '../format'
import { XDriveConfirmDialog } from './ConfirmDialog'

async function hashChunk(chunk: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('此浏览器不支持 HTTPS 环境下的 SHA-256。')
  // WebCrypto sees only one bounded 8 MiB chunk, never the entire huge file.
  const value = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', await chunk.arrayBuffer()))
  return Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The same presentation accepts a Web API or Desktop Agent port. Upload
 * checksums are transport integrity, NOT independent publisher trust. */
export function XDriveOfflineSystemUpdatePanel({ port, disabled = false, onSubmitted }: {
  port: XDriveOfflineImportPort
  disabled?: boolean
  onSubmitted?: () => void
}) {
  const [items, setItems] = useState<XDriveOfflineImportSummary[]>([])
  const [id, setID] = useState('')
  const [status, setStatus] = useState<XDriveOfflineImportStatus | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [fileName, setFileName] = useState('')
  const [manifestSHA, setManifestSHA] = useState('')
  const [goSHA, setGoSHA] = useState('')
  const [backupFiles, setBackupFiles] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let mounted = true
    void port.list().then((result) => {
      if (!mounted) return
      setItems(result.items)
      setID((current) => current || result.items[0]?.id || '')
    }).catch((e: unknown) => { if (mounted) setError(e instanceof Error ? e.message : '离线暂存服务不可用。') })
    return () => { mounted = false; abortRef.current?.abort() }
  }, [port])

  useEffect(() => {
    let mounted = true
    if (!xDriveValidOfflineImportID(id)) { setStatus(null); return }
    void port.get(id).then((value) => {
      if (mounted) setStatus(value)
    }).catch((e: unknown) => { if (mounted) setError(e instanceof Error ? e.message : '无法读取导入状态。') })
    return () => { mounted = false }
  }, [id, port])

  const refresh = async () => {
    if (!id) return
    try { setStatus(await port.get(id)); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : '导入状态获取失败。') }
  }
  const create = async () => {
    if (disabled || busy) return
    setBusy(true); setError('')
    try {
      const result = await port.create()
      if (!xDriveValidOfflineImportID(result.id) || result.chunk_bytes !== XDRIVE_OFFLINE_CHUNK_BYTES) {
        throw new Error('导入协议版本或 ID 不受支持。')
      }
      setID(result.id)
      setStatus({ id: result.id, files: [], chunk_bytes: result.chunk_bytes, ready_to_verify: false })
      setItems((previous) => [{ id: result.id, modified_at: new Date().toISOString() }, ...previous])
      setMessage('已创建专用目录；可以上传文件，也可通过 SSH/SFTP 将离线包放入对应目录。')
    } catch (e) { setError(e instanceof Error ? e.message : '创建导入目录失败。') }
    finally { setBusy(false) }
  }
  const upload = async () => {
    if (disabled || busy || !xDriveValidOfflineImportID(id) || files.length === 0) return
    if (files.some((file) => !xDriveValidOfflineFilename(file.name) || file.size === 0)) {
      setError('仅允许 Manifest、Go 安装器和五组件内容寻址包，且文件不得为空。')
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true); setUploading(true); setError(''); setMessage('')
    const total = files.reduce((n, file) => n + file.size, 0)
    let done = 0
    try {
      for (const file of files) {
        setFileName(file.name)
        await port.register(id, file.name, file.size)
        const existing = (await port.get(id)).files.find((item) => item.name === file.name)
        if (existing?.state === 'ready') {
          done += file.size
          setProgress(Math.round(done / total * 100))
          continue
        }
        // All chunks, including acknowledged ones, are re-checked on resume.
        // The Host treats identical retries as idempotent, never append-twice.
        for (let offset = 0, index = 0; offset < file.size; offset += XDRIVE_OFFLINE_CHUNK_BYTES, index++) {
          if (controller.signal.aborted) throw new Error('上传已暂停；选择同一文件可以续传。')
          const piece = file.slice(offset, offset + XDRIVE_OFFLINE_CHUNK_BYTES)
          await port.putChunk(id, file.name, index, piece, await hashChunk(piece), controller.signal)
          setProgress(Math.round((done + offset + piece.size) / total * 100))
        }
        const receipt = await port.finalize(id, file.name)
        if (receipt.state !== 'ready') throw new Error('暂存文件未完成。')
        done += file.size
        await refresh()
      }
      setFiles([])
      setMessage('传输完成；请从独立可信渠道获取 Manifest 与 Go ELF 的 SHA-256 后再执行更新。')
    } catch (e) { setError(e instanceof Error ? e.message : '上传失败，已完成的分块可重试。') }
    finally { abortRef.current = null; setBusy(false); setUploading(false); setFileName('') }
  }
  const remove = async () => {
    if (disabled || busy || !id) return
    setBusy(true); setError('')
    try {
      await port.remove(id)
      const result = await port.list()
      setItems(result.items)
      setID(result.items[0]?.id || '')
      setStatus(null)
      setMessage('已清理该目录内的受控暂存文件。')
    } catch (e) { setError(e instanceof Error ? e.message : '暂存目录无法安全清理。') }
    finally { setBusy(false) }
  }
  const activate = async () => {
    setConfirmOpen(false)
    if (disabled || busy || !status?.ready_to_verify || !xDriveValidOfflineDigest(manifestSHA) ||
      !xDriveValidOfflineDigest(goSHA)) return
    setBusy(true); setError('')
    try {
      await port.start(id, manifestSHA, goSHA, backupFiles)
      onSubmitted?.()
      setMessage('已提交 Host 更新请求。真正状态以服务端更新任务为准。')
    } catch (e) { setError(e instanceof Error ? e.message : '提交离线升级失败。') }
    finally { setBusy(false) }
  }
  const canStart = !disabled && !busy && status?.ready_to_verify &&
    xDriveValidOfflineDigest(manifestSHA) && xDriveValidOfflineDigest(goSHA)
  return (
    <Box data-xdrive-admin-offline-update sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Stack spacing={2}>
        <Typography variant="subtitle1" fontWeight={700}>离线包更新 · Linux AMD64</Typography>
        <Alert severity="warning">上传成功并不证明发布者身份。只能输入从独立可信渠道获得的 Manifest 和 Go 安装器 SHA-256；不能把本地上传摘要当作签名。</Alert>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button variant="outlined" disabled={disabled || busy} onClick={() => { void create() }}>创建导入</Button>
          <Select size="small" displayEmpty value={id} disabled={disabled || busy || items.length === 0}
            onChange={(event) => { setID(event.target.value); setError('') }} sx={{ flex: 1 }}>
            {items.length === 0 ? <MenuItem value="">暂无导入</MenuItem> : null}
            {items.map((item) => <MenuItem value={item.id} key={item.id}>{item.id}</MenuItem>)}
          </Select>
          <Button disabled={disabled || busy || !id} onClick={() => { void refresh() }}>刷新</Button>
          <Button color="error" disabled={disabled || busy || !id} onClick={() => { void remove() }}>清理</Button>
        </Stack>
        {id ? (
          <Typography variant="body2" color="text.secondary">
            宿主机目录导入：通过 SSH/SFTP 将 Manifest、Go ELF 和组件包放入 xDrive Home 下的
            <Box component="code" sx={{ mx: 0.5 }}>state/update-imports/{id}/</Box>，然后刷新。网页不允许指定其他宿主机路径。
          </Typography>
        ) : null}
        <Stack spacing={1}>
          <Typography variant="body2" fontWeight={600}>浏览器分块上传 / 续传</Typography>
          <input type="file" multiple aria-label="选择离线发布文件" disabled={disabled || busy || !id}
            onChange={(event) => setFiles(Array.from(event.target.files || []))} />
          {files.length > 0 ? <Typography variant="caption">待传输：{files.length} 个文件，{formatBytes(files.reduce((sum, f) => sum + f.size, 0))}</Typography> : null}
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" disabled={disabled || busy || !id || files.length === 0} onClick={() => { void upload() }}>上传所选文件</Button>
            {uploading ? <Button color="warning" onClick={() => abortRef.current?.abort()}>暂停</Button> : null}
          </Stack>
          {uploading ? <>
            <Typography variant="caption">{fileName} · {progress}%</Typography>
            <LinearProgress value={progress} variant="determinate" />
          </> : null}
        </Stack>
        {status?.files.length ? <Stack spacing={0.5}>
          <Typography variant="body2" fontWeight={600}>候选文件（尚未经发布者验证）</Typography>
          {status.files.map((file) => <Typography variant="caption" color="text.secondary" key={file.name}>
            {file.state === 'ready' ? '传输完成' : '正在上传'} · {file.name} · {formatBytes(file.uploaded_bytes)} / {formatBytes(file.size)}
          </Typography>)}
        </Stack> : null}
        <Typography variant="body2" fontWeight={600}>独立信任凭据</Typography>
        <TextField label="可信 Manifest SHA-256" size="small" value={manifestSHA}
          onChange={(e) => setManifestSHA(e.target.value.trim().toLowerCase())}
          error={Boolean(manifestSHA) && !xDriveValidOfflineDigest(manifestSHA)}
          inputProps={{ maxLength: 64, autoComplete: 'off' }} />
        <TextField label="可信 Go ELF SHA-256" size="small" value={goSHA}
          onChange={(e) => setGoSHA(e.target.value.trim().toLowerCase())}
          error={Boolean(goSHA) && !xDriveValidOfflineDigest(goSHA)}
          inputProps={{ maxLength: 64, autoComplete: 'off' }} />
        <FormControlLabel label="额外备份文件数据（数据库和一致性备份始终保留）"
          control={<Checkbox checked={backupFiles} disabled={disabled || busy}
            onChange={(_, checked) => setBackupFiles(checked)} />} />
        <Button variant="contained" disabled={!canStart} onClick={() => setConfirmOpen(true)}>提交离线更新</Button>
        {message ? <Alert severity="info">{message}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
      <XDriveConfirmDialog open={confirmOpen} title="确认执行离线系统更新？"
        description={'导入 ID：' + id + '。Host 将再次核对独立信任、组件、镜像身份、备份及回滚；文件数据备份：' + (backupFiles ? '开启' : '关闭') + '。服务可能短暂中断。'}
        confirmLabel="提交宿主机" confirmIntent="warning" loading={busy}
        onCancel={() => setConfirmOpen(false)} onConfirm={() => { void activate() }} />
    </Box>
  )
}
