import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, FormControlLabel, LinearProgress, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import type { XDriveOfflineHostPlanStatus, XDriveOfflineImportPort, XDriveOfflineImportStatus, XDriveOfflineImportSummary, XDriveOfflineTrustMode } from '../offline-update'
import { XDRIVE_OFFLINE_CHUNK_BYTES, xDriveValidOfflineDigest, xDriveValidOfflineFilename, xDriveValidOfflineImportID } from '../offline-update'
import { formatBytes } from '../format'
import { XDriveConfirmDialog } from './ConfirmDialog'

async function hashChunk(chunk: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('此浏览器不支持 HTTPS 环境下的 SHA-256。')
  // WebCrypto sees only one bounded 8 MiB chunk, never the entire huge file.
  const value = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', await chunk.arrayBuffer()))
  return Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('')
}

function offlineHostPlanStateLabel(state: XDriveOfflineHostPlanStatus['state']) {
  switch (state) {
    case 'queued': return '等待宿主机预检'
    case 'running': return '正在只读预检'
    case 'success': return '预检完成'
    case 'failed': return '预检失败'
    case 'unavailable': return '宿主机预检不可用'
    default: return '尚未预检'
  }
}

function offlineHostPlanBlockerLabel(value: string) {
  const labels: Record<string, string> = {
    insufficient_private_temporary_space: '临时目录可用空间不足',
    temporary_space_unavailable: '无法读取临时目录可用空间',
    docker_unavailable: 'Docker 不可用或无法读取 Docker Root',
    pinned_postgres_image_unavailable_or_mismatched: 'PostgreSQL 固定镜像缺失或镜像 ID 不匹配',
    'enabled_optional_image_unavailable_media-worker': '已启用的 Media Worker 镜像不可用',
    'enabled_optional_image_unavailable_photo-intelligence': '已启用的 AI 镜像不可用',
    host_environment_unavailable: '无法读取 Host 环境配置',
    host_profiles_invalid: 'Host 服务 Profile 配置无效',
  }
  return labels[value] || value
}

function offlineHostCheckLabel(value: string) {
  const labels: Record<string, string> = {
    real_running_server_buildinfo: '仍需核对实际运行中的 Server BuildInfo',
    publisher_trust_and_candidate_bytes_at_install_time: '正式安装时重新验证发布者身份及候选文件',
    full_docker_image_layer_and_backup_capacity: '仍需核对 Docker 镜像层及备份所需完整磁盘容量',
    backup_maintenance_health_and_rollback: '正式安装时执行备份、维护、健康检查及回滚验证',
    pinned_cached_postgres_image: '仍需确认固定 PostgreSQL 镜像',
  }
  return labels[value] || value
}

function offlineHostImageStatusLabel(value: string) {
  const labels: Record<string, string> = {
    verified_cached_identity: '镜像 ID 匹配',
    identity_mismatch: '镜像 ID 不匹配',
    unavailable: '镜像不可用',
    missing_configured_reference: '未配置镜像引用',
    present_identity_not_established: '镜像存在，但兼容性尚未确认',
  }
  return labels[value] || value
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
  const [planState, setPlanState] = useState<XDriveOfflineHostPlanStatus | null>(null)
  const [planning, setPlanning] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [fileName, setFileName] = useState('')
  const [trustMode, setTrustMode] = useState<XDriveOfflineTrustMode>('sigstore')
  const [manifestSHA, setManifestSHA] = useState('')
  const [goSHA, setGoSHA] = useState('')
  const [backupFiles, setBackupFiles] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const planInFlight = planState?.state === 'queued' || planState?.state === 'running'

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

  useEffect(() => {
    let mounted = true
    if (!xDriveValidOfflineImportID(id)) { setPlanState(null); return }
    setPlanState(null)
    void port.getPlan(id).then((value) => {
      if (mounted) setPlanState(value)
    }).catch((e: unknown) => { if (mounted) setError(e instanceof Error ? e.message : '无法读取宿主机预检状态。') })
    return () => { mounted = false }
  }, [id, port])

  useEffect(() => {
    if (!id || !planInFlight) return
    let active = true
    const poll = async () => {
      try {
        const value = await port.getPlan(id)
        if (active) setPlanState(value)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '宿主机预检状态刷新失败。')
      }
    }
    const timer = globalThis.setInterval(() => { void poll() }, 1_500)
    return () => { active = false; globalThis.clearInterval(timer) }
  }, [id, planInFlight, port])

  const refreshImport = async () => {
    if (!id) return
    try {
      setStatus(await port.get(id))
      // Any import inventory change invalidates the previous plan.
      setPlanState(null)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : '导入状态获取失败。') }
  }
  const refresh = async () => {
    if (!id) return
    try {
      const [nextStatus, nextPlan] = await Promise.all([port.get(id), port.getPlan(id)])
      setStatus(nextStatus)
      setPlanState(nextPlan)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : '导入及预检状态获取失败。') }
  }
  const create = async () => {
    if (disabled || busy || planning || planInFlight) return
    setBusy(true); setError('')
    try {
      const result = await port.create()
      if (!xDriveValidOfflineImportID(result.id) || result.chunk_bytes !== XDRIVE_OFFLINE_CHUNK_BYTES) {
        throw new Error('导入协议版本或 ID 不受支持。')
      }
      setID(result.id)
      setStatus({ id: result.id, files: [], chunk_bytes: result.chunk_bytes, ready_to_verify: false })
      setPlanState(null)
      setItems((previous) => [{ id: result.id, modified_at: new Date().toISOString() }, ...previous])
      setMessage('已创建专用目录；可以上传文件，也可通过 SSH/SFTP 将离线包放入对应目录。')
    } catch (e) { setError(e instanceof Error ? e.message : '创建导入目录失败。') }
    finally { setBusy(false) }
  }
  const upload = async () => {
    if (disabled || busy || planning || planInFlight || !xDriveValidOfflineImportID(id) || files.length === 0) return
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
        await refreshImport()
      }
      setFiles([])
      setPlanState(null)
      setMessage('传输已完成，但不代表身份可信。请先运行 Host 只读预检，再提交更新。')
    } catch (e) { setError(e instanceof Error ? e.message : '上传失败，已完成的分块可重试。') }
    finally { abortRef.current = null; setBusy(false); setUploading(false); setFileName('') }
  }
  const remove = async () => {
    if (disabled || busy || planning || planInFlight || !id) return
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
  const signedFilesReady = ['manifest.json', 'delivery.json', 'delivery-attestation.jsonl', 'xdrive-offline-linux-amd64']
    .every((name) => status?.files.some((file) => file.name === name && file.state === 'ready') === true)
  const manualSHAReady = xDriveValidOfflineDigest(manifestSHA) && xDriveValidOfflineDigest(goSHA)
  const trustInputsReady = trustMode === 'sigstore' ? signedFilesReady : manualSHAReady
  const planTrustMatches = trustMode === 'sigstore'
    ? planState?.offline_trust_mode === 'sigstore' &&
      !planState.trusted_manifest_sha256 && !planState.trusted_installer_sha256
    : planState?.offline_trust_mode === 'sha256' &&
      planState.trusted_manifest_sha256 === manifestSHA &&
      planState.trusted_installer_sha256 === goSHA
  const visiblePlanState = planState?.offline_id === id &&
    (planState.state === 'idle' || planState.state === 'unavailable' || planTrustMatches)
    ? planState : null
  const hostProbe = visiblePlanState?.plan?.host_probe
  const hostBlockers = hostProbe?.blockers || []
  const canPlan = !disabled && !busy && !planning && !planInFlight &&
    planState !== null && visiblePlanState?.supported !== false &&
    status?.id === id && status?.ready_to_verify && trustInputsReady
  const canStart = !disabled && !busy && !planning && !planInFlight &&
    status?.id === id && status?.ready_to_verify && trustInputsReady &&
    visiblePlanState?.state === 'success' && hostProbe?.read_only === true && hostBlockers.length === 0

  const runPlan = async () => {
    if (!canPlan) return
    setPlanning(true); setError(''); setMessage('')
    try {
      const value = await port.startPlan(id, trustMode === 'sigstore' ? '' : manifestSHA,
        trustMode === 'sigstore' ? '' : goSHA, trustMode)
      setPlanState(value)
      setMessage('只读预检请求已提交。该操作不会启动维护、备份、安装或改变 Docker 状态。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交宿主机只读预检失败。')
    } finally { setPlanning(false) }
  }
  const activate = async () => {
    setConfirmOpen(false)
    if (!canStart) return
    setBusy(true); setError('')
    try {
      await port.start(id, trustMode === 'sigstore' ? '' : manifestSHA,
        trustMode === 'sigstore' ? '' : goSHA, backupFiles, trustMode)
      onSubmitted?.()
      setMessage('已提交 Host 验证与更新请求；成功与否以服务端任务状态为准。')
    } catch (e) { setError(e instanceof Error ? e.message : '提交离线升级失败。') }
    finally { setBusy(false) }
  }
  return (
    <Box data-xdrive-admin-offline-update sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Stack spacing={2}>
        <Typography variant="subtitle1" fontWeight={700}>离线包更新 · Linux AMD64</Typography>
        <Alert severity="warning">上传完成仅表示传输完整，不等于签名受信。默认由宿主机验证独立配置的可信根和 GitHub Sigstore 证明；失败时绝不自动退回未签名安装。</Alert>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button variant="outlined" disabled={disabled || busy || planning || planInFlight} onClick={() => { void create() }}>创建导入</Button>
          <Select size="small" displayEmpty value={id} disabled={disabled || busy || planning || planInFlight || items.length === 0}
            onChange={(event) => { setID(event.target.value); setError('') }} sx={{ flex: 1 }}>
            {items.length === 0 ? <MenuItem value="">暂无导入</MenuItem> : null}
            {items.map((item) => <MenuItem value={item.id} key={item.id}>{item.id}</MenuItem>)}
          </Select>
          <Button disabled={disabled || busy || planning || planInFlight || !id} onClick={() => { void refresh() }}>刷新</Button>
          <Button color="error" disabled={disabled || busy || planning || planInFlight || !id} onClick={() => { void remove() }}>清理</Button>
        </Stack>
        {id ? (
          <Typography variant="body2" color="text.secondary">
            宿主机目录导入：通过 SSH/SFTP 将 Manifest、Go ELF 和组件包放入 xDrive Home 下的
            <Box component="code" sx={{ mx: 0.5 }}>state/update-imports/{id}/</Box>，然后刷新。网页不允许指定其他宿主机路径。
          </Typography>
        ) : null}
        <Stack spacing={1}>
          <Typography variant="body2" fontWeight={600}>浏览器分块上传 / 续传</Typography>
          <input type="file" multiple aria-label="选择离线发布文件" disabled={disabled || busy || planning || planInFlight || !id}
            onChange={(event) => setFiles(Array.from(event.target.files || []))} />
          {files.length > 0 ? <Typography variant="caption">待传输：{files.length} 个文件，{formatBytes(files.reduce((sum, f) => sum + f.size, 0))}</Typography> : null}
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" disabled={disabled || busy || planning || planInFlight || !id || files.length === 0} onClick={() => { void upload() }}>上传所选文件</Button>
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
        <Typography variant="body2" fontWeight={600}>发布者身份验证方式</Typography>
        <Select size="small" value={trustMode} disabled={disabled || busy || planning || planInFlight}
          onChange={(event) => { setTrustMode(event.target.value as XDriveOfflineTrustMode); setPlanState(null) }}
          aria-label="离线发布信任方式">
          <MenuItem value="sigstore">Host 自动验证 Sigstore 签名（优先）</MenuItem>
          <MenuItem value="sha256">手动输入独立双 SHA-256（兼容）</MenuItem>
        </Select>
        {trustMode === 'sigstore' ? (
          <Alert severity={signedFilesReady ? 'info' : 'warning'}>
            自动签名模式需要 Manifest、Delivery、Attestation 和 Go ELF 均传输完成，
            且宿主机已独立配置可信根。Host 会验证签名、发布者身份及文件摘要；
            未配置可信根或验签失败时将拒绝更新，不会切换到手工模式。
          </Alert>
        ) : (
          <>
            <Alert severity="warning">手工模式必须使用两项独立可信来源的发布摘要，禁止将网页上传回执作为信任依据。</Alert>
            <TextField label="可信 Manifest SHA-256" size="small" value={manifestSHA} disabled={disabled || busy || planning || planInFlight}
              onChange={(e) => { setManifestSHA(e.target.value.trim().toLowerCase()); setPlanState(null) }}
              error={Boolean(manifestSHA) && !xDriveValidOfflineDigest(manifestSHA)}
              inputProps={{ maxLength: 64, autoComplete: 'off' }} />
            <TextField label="可信 Go ELF SHA-256" size="small" value={goSHA} disabled={disabled || busy || planning || planInFlight}
              onChange={(e) => { setGoSHA(e.target.value.trim().toLowerCase()); setPlanState(null) }}
              error={Boolean(goSHA) && !xDriveValidOfflineDigest(goSHA)}
              inputProps={{ maxLength: 64, autoComplete: 'off' }} />
          </>
        )}
        <Button variant="outlined" disabled={!canPlan} onClick={() => { void runPlan() }}>
          {planning || planInFlight ? '正在预检…' : visiblePlanState?.state === 'success' ? '重新预检' : '只读预检'}
        </Button>
        {visiblePlanState ? (
          <Stack spacing={1} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Typography variant="body2" fontWeight={700}>宿主机预检：{offlineHostPlanStateLabel(visiblePlanState.state)}</Typography>
            {visiblePlanState.message ? <Typography variant="body2" color="text.secondary">{visiblePlanState.message}</Typography> : null}
            {visiblePlanState.error ? <Alert severity="error">{visiblePlanState.error}</Alert> : null}
            {visiblePlanState.plan && hostProbe ? (
              <>
                <Alert severity={hostBlockers.length ? 'warning' : 'success'}>
                  {hostBlockers.length
                    ? '发现 ' + hostBlockers.length + ' 项阻塞条件，修复后重新预检才能提交安装。'
                    : '未发现当前预检范围内的阻塞条件。正式安装仍会重新验证所有信任、镜像、备份及回滚条件。'}
                </Alert>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Typography variant="caption">Docker：{hostProbe.docker_status}</Typography>
                  <Typography variant="caption">临时空间：{hostProbe.temporary_space_status}</Typography>
                  <Typography variant="caption">最低临时空间：{formatBytes(visiblePlanState.plan.minimum_temporary_bytes)}</Typography>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Typography variant="caption">临时目录可用：{hostProbe.temporary_free_bytes == null ? '未知' : formatBytes(hostProbe.temporary_free_bytes)}</Typography>
                  <Typography variant="caption">Docker Root 可用：{hostProbe.docker_storage_free_bytes == null ? '未知' : formatBytes(hostProbe.docker_storage_free_bytes)}</Typography>
                  <Typography variant="caption">完整磁盘需求：{visiblePlanState.plan.estimated_full_disk_bytes == null ? '无法可靠估算' : formatBytes(visiblePlanState.plan.estimated_full_disk_bytes)}</Typography>
                </Stack>
                {hostProbe.running_server_image_id ? (
                  <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                    当前 Server 镜像：{hostProbe.running_server_image_ref || '未知'} · {hostProbe.running_server_image_id}
                  </Typography>
                ) : null}
                {hostBlockers.length ? (
                  <Stack spacing={0.25}>
                    <Typography variant="caption" fontWeight={700}>阻塞条件</Typography>
                    {hostBlockers.map((item) => <Typography variant="caption" color="error" key={item}>• {offlineHostPlanBlockerLabel(item)}</Typography>)}
                  </Stack>
                ) : null}
                {hostProbe.images.length ? (
                  <Stack spacing={0.25}>
                    <Typography variant="caption" fontWeight={700}>镜像观察</Typography>
                    {hostProbe.images.map((item) => (
                      <Typography variant="caption" key={item.name} sx={{ overflowWrap: 'anywhere' }}>
                        {item.name}：{offlineHostImageStatusLabel(item.status)}{item.reference ? ' · ' + item.reference : ''}{item.observed_id ? ' · ' + item.observed_id : ''}
                      </Typography>
                    ))}
                  </Stack>
                ) : null}
                <Stack spacing={0.25}>
                  <Typography variant="caption" fontWeight={700}>组件计划</Typography>
                  {visiblePlanState.plan.components.map((item) => (
                    <Typography variant="caption" key={item.name}>
                      {item.name}：{item.action === 'verify_and_install' ? '验证并安装' : item.action === 'not_selected' ? '未选择' : '未提供'}
                      {item.archive_present ? ' · 文件已存在' : ' · 文件缺失'}
                      {item.archive_bytes > 0 ? ' · ' + formatBytes(item.archive_bytes) : ''}
                    </Typography>
                  ))}
                </Stack>
                {hostProbe.remaining_host_checks.length ? (
                  <Stack spacing={0.25}>
                    <Typography variant="caption" fontWeight={700}>正式安装仍需执行的检查</Typography>
                    {hostProbe.remaining_host_checks.map((item) => <Typography variant="caption" key={item}>• {offlineHostCheckLabel(item)}</Typography>)}
                  </Stack>
                ) : null}
              </>
            ) : null}
          </Stack>
        ) : null}
        <FormControlLabel label="额外备份文件数据（数据库和一致性备份始终保留）"
          control={<Checkbox checked={backupFiles} disabled={disabled || busy || planning || planInFlight}
            onChange={(_, checked) => setBackupFiles(checked)} />} />
        <Button variant="contained" disabled={!canStart} onClick={() => setConfirmOpen(true)}>提交离线更新</Button>
        {message ? <Alert severity="info">{message}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
      <XDriveConfirmDialog open={confirmOpen} title="确认执行离线系统更新？"
        description={'导入 ID：' + id + '；信任方式：' + (trustMode === 'sigstore' ? 'Host Sigstore 签名验证（失败即拒绝）' : '独立双 SHA-256') + '。已通过只读 Host 预检且未发现阻塞条件；正式安装仍会重新验证组件、镜像身份、备份与回滚。文件数据额外备份：' + (backupFiles ? '开启' : '关闭') + '。服务可能短暂中断。'}
        confirmLabel="提交宿主机" confirmIntent="warning" loading={busy}
        onCancel={() => setConfirmOpen(false)} onConfirm={() => { void activate() }} />
    </Box>
  )
}
