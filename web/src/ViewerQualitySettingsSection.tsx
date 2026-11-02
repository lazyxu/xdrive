import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import type {
  XDriveApi, XDriveViewerQualityPreferenceResponse,
  XDriveAdminViewerQualityResponse, XDriveViewerCacheStatus,
} from './api'
import { ApiError } from './api'
import {
  XDRIVE_VIEWER_QUALITY_OPTIONS, xDriveParseViewerQualityPreset,
} from '../../ui/shared/src/viewer-quality-policy'
import type { XDriveViewerQualityPreset } from '../../ui/shared/src/viewer-quality-policy'

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function checkedAccount(value: XDriveViewerQualityPreferenceResponse) {
  if (!validRevision(value.revision)) throw new Error('invalid Viewer preference revision')
  for (const field of [value.preset, value.effective, value.admin_maximum]) {
    // Missing values are invalid network responses. The local parse helper
    // treats an absent *preference* as high, but API snapshots are complete.
    if (typeof field !== 'string' ||
        !XDRIVE_VIEWER_QUALITY_OPTIONS.some(option => option.value === field)) {
      throw new Error('invalid Viewer quality response')
    }
  }
  if (typeof value.capped !== 'boolean') throw new Error('invalid Viewer cap')
  return value
}

function checkedAdmin(value: XDriveAdminViewerQualityResponse) {
  if (!validRevision(value.revision)) throw new Error('invalid Viewer admin revision')
  if (!XDRIVE_VIEWER_QUALITY_OPTIONS.some(option => option.value === value.maximum_preset) ||
      !Number.isSafeInteger(value.cache_budget_bytes) ||
      value.cache_budget_bytes < 1 << 20 || value.cache_budget_bytes > 1 << 40) {
    throw new Error('invalid Viewer administrator response')
  }
  return value
}

// Authenticated, account-scoped settings only. A device-specific override
// belongs to a later rollout and must never write another account's default.
export default function ViewerQualitySettingsSection({
  api, open, isAdmin,
}: { api: XDriveApi; open: boolean; isAdmin: boolean }) {
  const [account, setAccount] = useState<XDriveViewerQualityPreferenceResponse | null>(null)
  const [requested, setRequested] = useState<XDriveViewerQualityPreset>('high')
  const [admin, setAdmin] = useState<XDriveAdminViewerQualityResponse | null>(null)
  const [maximum, setMaximum] = useState<XDriveViewerQualityPreset>('high')
  const [budgetGiB, setBudgetGiB] = useState(10)
  const [cacheStatus, setCacheStatus] = useState<XDriveViewerCacheStatus | null>(null)
  const [cacheReadError, setCacheReadError] = useState(false)
  const [confirmEviction, setConfirmEviction] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [adminLoadFailed, setAdminLoadFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!open) {
      setNotice('')
      return
    }
    const controller = new AbortController()
    setAccount(null)
    setAdmin(null)
    setLoadFailed(false)
    setAdminLoadFailed(false)
    setCacheReadError(false)
    setCacheStatus(null)
    setConfirmEviction(false)
    // Preserve a successful admin Save message while the effective account
    // snapshot reloads, instead of clearing it on the refresh state change.
    void api.viewerQualityPreference(controller.signal).then(value => {
      if (controller.signal.aborted) return
      const checked = checkedAccount(value)
      setAccount(checked)
      setRequested(checked.preset)
    }).catch(() => { if (!controller.signal.aborted) setLoadFailed(true) })
    if (isAdmin) {
      void api.adminViewerQuality(controller.signal).then(value => {
        if (controller.signal.aborted) return
        const checked = checkedAdmin(value)
        setAdmin(checked)
        setMaximum(checked.maximum_preset)
        setBudgetGiB(checked.cache_budget_bytes / (1 << 30))
      }).catch(() => { if (!controller.signal.aborted) setAdminLoadFailed(true) })
      void api.adminViewerCacheStatus(controller.signal).then(value => {
        if (controller.signal.aborted) return
        if (!Number.isSafeInteger(value.observed_bytes) ||
            !Number.isSafeInteger(value.budget_bytes) ||
            !Number.isSafeInteger(value.candidate_bytes) ||
            !Number.isSafeInteger(value.candidate_files) ||
            typeof value.over_budget !== 'boolean') {
          throw new Error('invalid Viewer cache status')
        }
        setCacheStatus(value)
      }).catch(() => { if (!controller.signal.aborted) setCacheReadError(true) })
    }
    return () => controller.abort()
  }, [api, open, isAdmin, refresh])

  if (!open) return null

  const saveAccount = async () => {
    if (!account || saving) return
    setSaving(true)
    setNotice('')
    try {
      const response = checkedAccount(await api.saveViewerQualityPreference(account.revision, requested))
      setAccount(response)
      setRequested(response.preset)
      setNotice('账号 Viewer 画质设置已保存。下一张实况或兼容格式预览将使用新档位。')
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409
        ? '账号画质设置已在其他会话修改。请重新读取后再保存。'
        : '账号画质设置保存失败，请检查服务器连接。')
    } finally {
      setSaving(false)
    }
  }

  const saveAdmin = async () => {
    if (!admin || saving) return
    setSaving(true)
    setNotice('')
    try {
      const response = checkedAdmin(await api.saveAdminViewerQuality(
        admin.revision, maximum, Math.round(budgetGiB * (1 << 30))))
      setAdmin(response)
      setMaximum(response.maximum_preset)
      // Reload the user's effective quality and any changed cap before
      // offering a new snapshot of the account's preference.
      setRefresh(value => value + 1)
      setNotice('服务器最高预览画质已保存。')
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409
        ? '管理员画质策略已在其他会话修改。请重新读取后再保存。'
        : '管理员画质策略保存失败，请检查服务器连接。')
    } finally {
      setSaving(false)
    }
  }

  const evictCache = async () => {
    if (!isAdmin || saving || !confirmEviction) return
    setSaving(true)
    setNotice('')
    try {
      const result = await api.adminViewerCacheEvict(false)
      if (result.dry_run !== false ||
          !Number.isSafeInteger(result.result?.DeletedFiles)) {
        throw new Error('Viewer cache cleanup not confirmed')
      }
      setNotice('Viewer 派生缓存已清理 ' + result.result!.DeletedFiles +
        ' 个文件；原件和 Live Photo 动态视频不受影响。')
      setRefresh(value => value + 1)
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409
        ? '有 Viewer 正在读取图片，稍后再清理缓存。'
        : 'Viewer 缓存清理失败，未能确认删除结果。')
    } finally {
      setConfirmEviction(false)
      setSaving(false)
    }
  }
  const humanBytes = (bytes: number) =>
    Number.isSafeInteger(bytes) && bytes >= 0
      ? (bytes / (1 << 30)).toFixed(2) + ' GiB' : '—'

  return (
    <Box data-xdrive-viewer-quality-settings>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={700}>Viewer 画质</Typography>
        <Typography variant="body2" color="text.secondary">
          账号偏好会随账号跨设备保存；本阶段作用于实况静态图及 HEIC/RAW 等兼容预览。
          原件、实况动态视频和相册缩略图不受影响。
        </Typography>
        {loadFailed ? (
          <Alert severity="warning">当前 Server 不支持读取账号画质设置，或暂时不可用。</Alert>
        ) : account ? (
          <>
            <TextField
              select size="small" fullWidth label="账号默认预览画质"
              value={requested}
              onChange={event => setRequested(xDriveParseViewerQualityPreset(event.target.value))}
              disabled={saving}
            >
              {XDRIVE_VIEWER_QUALITY_OPTIONS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label} · 最长边 {option.maxEdge}px
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              当前实际画质：{XDRIVE_VIEWER_QUALITY_OPTIONS.find(option =>
                option.value === account.effective)?.label || '未知'}
              {account.capped ? '（受管理员最高画质限制）' : ''}
            </Typography>
            <Button variant="outlined" size="small" disabled={saving || requested === account.preset}
              onClick={() => void saveAccount()}>
              保存账号画质
            </Button>
          </>
        ) : <Typography variant="caption" color="text.secondary">正在读取账号画质设置…</Typography>}
        {isAdmin ? (
          <Box data-xdrive-viewer-quality-admin sx={{ pt: 1 }}>
            <Stack spacing={1}>
              <Typography fontWeight={600} variant="body2">管理员：最高预览画质</Typography>
              {adminLoadFailed ? (
                <Alert severity="warning">无法读取管理员画质策略，禁止猜测服务器上限。</Alert>
              ) : admin ? (
                <>
                  <TextField select size="small" fullWidth label="服务器最高画质"
                    value={maximum} disabled={saving}
                    onChange={event => setMaximum(xDriveParseViewerQualityPreset(event.target.value))}>
                    {XDRIVE_VIEWER_QUALITY_OPTIONS.map(option => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label} · 最长边 {option.maxEdge}px
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField select size="small" fullWidth label="Viewer 派生缓存容量预算"
                    value={budgetGiB} disabled={saving}
                    onChange={event => setBudgetGiB(Number(event.target.value))}>
                    {[1, 5, 10, 20, 50, 100].map(value => (
                      <MenuItem key={value} value={value}>{value} GiB</MenuItem>
                    ))}
                  </TextField>
                  <Button variant="outlined" size="small"
                    disabled={saving || (maximum === admin.maximum_preset &&
                      budgetGiB * (1 << 30) === admin.cache_budget_bytes)}
                    onClick={() => void saveAdmin()}>
                    保存管理员画质与缓存上限
                  </Button>
                  {cacheReadError ? (
                    <Alert severity="warning">Viewer 缓存统计不可用。</Alert>
                  ) : cacheStatus ? (
                    <Stack spacing={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        已用 {humanBytes(cacheStatus.observed_bytes)}，
                        预算 {humanBytes(cacheStatus.budget_bytes)}，
                        可回收约 {humanBytes(cacheStatus.candidate_bytes)}
                        （{cacheStatus.candidate_files} 个缓存版本）。
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        只清理可重新生成的 Viewer 图片缓存，不删除原件、
                        Live Photo 动态视频或相册墙缩略图。
                      </Typography>
                      {!confirmEviction ? (
                        <Button size="small" variant="outlined" disabled={saving ||
                          cacheStatus.candidate_files === 0}
                          onClick={() => setConfirmEviction(true)}>
                          清理超出预算的缓存…
                        </Button>
                      ) : (
                        <Stack direction="row" spacing={1}>
                          <Button size="small" color="error" variant="outlined"
                            disabled={saving} onClick={() => void evictCache()}>
                            确认清理
                          </Button>
                          <Button size="small" disabled={saving}
                            onClick={() => setConfirmEviction(false)}>取消</Button>
                        </Stack>
                      )}
                    </Stack>
                  ) : (
                    <Typography variant="caption">正在读取 Viewer 缓存统计…</Typography>
                  )}
                </>
              ) : <Typography variant="caption">正在读取管理员画质策略…</Typography>}
            </Stack>
          </Box>
        ) : null}
        {notice ? <Alert severity={notice.includes('失败') || notice.includes('修改') ? 'warning' : 'success'}>{notice}</Alert> : null}
        <Button size="small" disabled={saving} onClick={() => setRefresh(value => value + 1)}>
          重新读取服务器设置
        </Button>
      </Stack>
    </Box>
  )
}
