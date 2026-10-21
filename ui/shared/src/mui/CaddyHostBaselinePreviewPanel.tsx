import { useEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography } from '@mui/material'
import type { XDriveCaddyHTTPSConfig, XDriveCaddyHTTPSPreflight } from '../service-dependencies'
import { assessCaddyHostBaselineReadOnly } from '../caddy-host-baseline-preview'
import { verifyCaddyPreflightContract } from './CaddyPreflightValidation'
import type { XDriveCaddyPreflightPort } from './CaddyPreflightPanel'

type PreviewSnapshot = {
  source: XDriveCaddyPreflightPort
  config: XDriveCaddyHTTPSConfig
  evidenceRevision: number
  data: XDriveCaddyHTTPSPreflight
}

const evidenceLabel = (value: string): string => {
  if (value === 'matched-local') return '本机证据与目标一致（非生效回执）'
  if (value === 'mismatch-local') return '本机证据与目标不同（只读差异）'
  return '证据不足，不能判断'
}

export function XDriveCaddyHostBaselinePreviewPanel({
  source, config, active, evidenceRevision, hasUnsavedEdits,
}: {
  source: XDriveCaddyPreflightPort
  config: XDriveCaddyHTTPSConfig | null
  active: boolean
  evidenceRevision: number
  hasUnsavedEdits: boolean
}) {
  const epochRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null)

  // A different Server, saved revision, app view or dirty draft invalidates
  // any in-flight response and displayed proof. Never retain stale evidence.
  useEffect(() => {
    ++epochRef.current
    setOpen(false)
    setBusy(false)
    setError('')
    setSnapshot(null)
    return () => { ++epochRef.current }
  }, [source, config, evidenceRevision, active, hasUnsavedEdits])

  const close = () => {
    ++epochRef.current
    setOpen(false)
    setBusy(false)
    setError('')
    setSnapshot(null)
  }

  const inspect = async () => {
    if (!active || hasUnsavedEdits || !config || !source.loadCaddyHTTPSPreflight || busy) return
    const epoch = ++epochRef.current
    setOpen(true)
    setBusy(true)
    setError('')
    setSnapshot(null)
    try {
      // The existing authenticated local Server preflight is read-only.
      // Never invoke online AliDNS checks, Host Plan Apply, DNS or Docker.
      const next = verifyCaddyPreflightContract(await source.loadCaddyHTTPSPreflight())
      if (epoch === epochRef.current) {
        setSnapshot({ source, config, evidenceRevision, data: next })
      }
    } catch (err) {
      if (epoch === epochRef.current) {
        setError(err instanceof Error ? err.message : '宿主基线只读核对失败。')
      }
    } finally {
      if (epoch === epochRef.current) setBusy(false)
    }
  }

  const current = !hasUnsavedEdits && snapshot?.source === source && snapshot.config === config &&
    snapshot.evidenceRevision === evidenceRevision ? snapshot.data : null
  const preview = assessCaddyHostBaselineReadOnly(config, current)

  return (
    <Box data-xdrive-caddy-baseline-preview-owner>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }}
          justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={700}>现有宿主配置差异</Typography>
            <Typography variant="caption" color="text.secondary">
              手动读取一次本机只读预检；仅看差异和采纳阻断条件，不提供采纳或应用操作。
            </Typography>
          </Box>
          <Button variant="outlined" size="small"
            sx={{ minHeight: 44, flexShrink: 0 }}
            disabled={!active || !config || hasUnsavedEdits || !source.loadCaddyHTTPSPreflight}
            onClick={() => { void inspect() }} data-xdrive-caddy-baseline-preview-open>
            查看只读差异
          </Button>
        </Stack>
        {hasUnsavedEdits && (
          <Typography variant="caption" color="text.secondary">
            配置有未保存草稿，请先保存或放弃，再读取对应修订的证据。
          </Typography>
        )}
      </Paper>
      <Dialog open={open && active && !hasUnsavedEdits} onClose={() => close()} maxWidth="sm" fullWidth
        aria-labelledby="xdrive-caddy-baseline-preview-title"
        data-xdrive-caddy-baseline-preview-dialog>
        <DialogTitle id="xdrive-caddy-baseline-preview-title">宿主基线核对 · 只读</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25} sx={{ minHeight: 154 }}>
            {busy ? (
              <Typography variant="body2" role="status">正在读取本机预检证据…</Typography>
            ) : error ? (
              <Typography variant="body2" color="error.main" role="alert">{error}</Typography>
            ) : current ? (
              <>
                <Typography variant="body2" data-xdrive-caddy-baseline-preview-revision>
                  已保存目标修订：{preview.desired_revision === null ? '未确认' : '#' + preview.desired_revision}
                </Typography>
                <Typography variant="body2" data-xdrive-caddy-baseline-preview-domain>
                  域名 HTTPS：{evidenceLabel(preview.domain_comparison)}
                </Typography>
                <Typography variant="body2" data-xdrive-caddy-baseline-preview-lan>
                  局域网 IP HTTPS：{evidenceLabel(preview.lan_comparison)}
                </Typography>
                <Typography variant="subtitle2" fontWeight={700}>
                  当前不可采纳为管理基线
                </Typography>
                {preview.blockers.map((reason, index) => (
                  <Typography key={index} variant="body2" color="text.secondary">
                    • {reason}
                  </Typography>
                ))}
                <Typography variant="caption" color="text.secondary">
                  无可信 Applied Receipt；宿主 8443、容器 443、公网和终端 CA 均不由此预览验证。
                </Typography>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">尚未取得本次预检结果。</Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button size="small" sx={{ minHeight: 44 }} onClick={close}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
