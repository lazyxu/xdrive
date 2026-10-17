import { useEffect, useState } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography } from '@mui/material'
import {
  XDRIVE_MANUAL_LAN_ENTRY_KEY,
  XDRIVE_MANUAL_PUBLIC_ENTRY_KEY,
  xDriveManualEndpoint,
} from './manualConnection'

/**
 * A pure navigation aid: it never changes the running API base, migrates tokens,
 * performs background discovery, or changes the Server/Caddy network listener.
 */
export default function XDriveManualConnectionDialog({
  open, onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [lan, setLan] = useState('')
  const [publicURL, setPublicURL] = useState('')
  const [allowInsecureLAN, setAllowInsecureLAN] = useState(false)
  const [message, setMessage] = useState('')
  const currentOrigin = window.location.origin

  useEffect(() => {
    if (!open) return
    const currentPublic = xDriveManualEndpoint('public', currentOrigin)
    try {
      setLan(window.localStorage.getItem(XDRIVE_MANUAL_LAN_ENTRY_KEY) || '')
      setPublicURL(window.localStorage.getItem(XDRIVE_MANUAL_PUBLIC_ENTRY_KEY) ||
        (!currentPublic.error ? currentPublic.origin : ''))
    } catch {
      setLan('')
      setPublicURL(!currentPublic.error ? currentPublic.origin : '')
    }
    setAllowInsecureLAN(false)
    setMessage('')
  }, [open, currentOrigin])

  const lanTarget = xDriveManualEndpoint('lan', lan)
  const publicTarget = xDriveManualEndpoint('public', publicURL)
  const lanReady = !lanTarget.error && lanTarget.origin !== currentOrigin &&
    (!lanTarget.insecure || allowInsecureLAN)
  const publicReady = !publicTarget.error && publicTarget.origin !== currentOrigin

  const save = () => {
    if (lan.trim() && lanTarget.error) { setMessage(lanTarget.error); return }
    if (publicURL.trim() && publicTarget.error) { setMessage(publicTarget.error); return }
    if (!lan.trim() && !publicURL.trim()) {
      setMessage('至少填写一个连接入口。')
      return
    }
    try {
      // Store public endpoint metadata only, in this origin's own localStorage.
      // No password, access token, refresh token or cross-origin session moves.
      if (lan.trim()) window.localStorage.setItem(XDRIVE_MANUAL_LAN_ENTRY_KEY, lanTarget.origin)
      else window.localStorage.removeItem(XDRIVE_MANUAL_LAN_ENTRY_KEY)
      if (publicURL.trim()) window.localStorage.setItem(XDRIVE_MANUAL_PUBLIC_ENTRY_KEY, publicTarget.origin)
      else window.localStorage.removeItem(XDRIVE_MANUAL_PUBLIC_ENTRY_KEY)
      setMessage('连接入口已保存在当前站点。其他域名/IP 的浏览器存储相互独立。')
    } catch {
      setMessage('浏览器不允许保存当前站点设置；仍可手动打开有效入口。')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"
      aria-labelledby="xdrive-manual-connection-title"
      data-xdrive-manual-connection-dialog>
      <DialogTitle id="xdrive-manual-connection-title">手动切换连接入口</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            当前站点：{currentOrigin}。仅手动打开另一个入口，不修改 DNS、路由器或 Server。
            新地址是独立浏览器站点，可能需要重新登录；不会复制 Token 或中断此标签页的传输。
          </Typography>
          <TextField size="small" fullWidth label="局域网 IP 入口"
            placeholder="https://192.168.1.10:8443"
            autoComplete="off" value={lan}
            onChange={(event) => {
              setLan(event.target.value)
              setAllowInsecureLAN(false)
              setMessage('')
            }}
            error={Boolean(lan.trim() && lanTarget.error)}
            helperText={lan.trim() && lanTarget.error
              ? lanTarget.error : '只允许私有 IPv4。HTTPS IP 需要浏览器信任并且证书包含该 IP。'}
          />
          {lanTarget.insecure && !lanTarget.error && (
            <Alert severity="warning">
              这个 LAN HTTP 地址没有加密。用户名、密码以及后续 Token 可能被局域网窃听。
              当前设备若使用 DMZ，开放 HTTP 端口前必须另行检查防火墙；不建议作为日常登录入口。
              <FormControlLabel
                sx={{ display: 'flex', mt: 0.5 }}
                control={<Checkbox size="small" checked={allowInsecureLAN}
                  onChange={(_event, checked) => setAllowInsecureLAN(checked)} />}
                label="我了解明文登录风险，仍要手动打开此私网入口"
              />
            </Alert>
          )}
          <TextField size="small" fullWidth label="公网 HTTPS 域名入口"
            placeholder="https://drive.example.com:8443"
            autoComplete="off" value={publicURL}
            onChange={(event) => { setPublicURL(event.target.value); setMessage('') }}
            error={Boolean(publicURL.trim() && publicTarget.error)}
            helperText={publicURL.trim() && publicTarget.error
              ? publicTarget.error : '公网入口只允许 HTTPS 域名。不要填写带登录信息或分享令牌的 URL。'}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button component="a" variant="contained" size="small"
              href={lanReady ? lanTarget.origin + '/' : undefined}
              target="_blank" rel="noopener noreferrer"
              disabled={!lanReady} data-xdrive-open-manual-lan>
              新标签页打开局域网入口
            </Button>
            <Button component="a" variant="outlined" size="small"
              href={publicReady ? publicTarget.origin + '/' : undefined}
              target="_blank" rel="noopener noreferrer"
              disabled={!publicReady} data-xdrive-open-manual-public>
              新标签页打开公网入口
            </Button>
          </Stack>
          {message && <Alert severity="info">{message}</Alert>}
          <Box>
            <Typography variant="caption" color="text.secondary">
              新站点必须已经部署可访问的 xDrive Web 与 API。切换入口不会自动开放 Linux 端口，
              不会绕过 TLS 证书警告，也不会让两个 Origin 共享登录状态或 PWA 缓存。
              如果目前没有可信 LAN HTTPS，建议先继续使用公网入口。
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button onClick={save} variant="outlined">保存本地入口地址</Button>
      </DialogActions>
    </Dialog>
  )
}
