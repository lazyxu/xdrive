import { useEffect, useMemo, useState } from 'react'
import { DownloadOutlined, FileOutlined, LockOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Input, Space, Spin, Typography } from 'antd'
import { ApiError, PublicShare, XDriveApi } from './api'

function formatSize(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`
}

export default function PublicShareView({ token }: { token: string }) {
  const api = useMemo(() => new XDriveApi(), [])
  const [share, setShare] = useState<PublicShare | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await api.publicShare(token)
        if (active) setShare(result)
      } catch (err) {
        if (!active) return
        if (err instanceof ApiError && err.status === 410) {
          setError('This share has expired, reached its download limit, or was revoked.')
        } else if (err instanceof ApiError && err.status === 404) {
          setError('This share link does not exist.')
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load this share.')
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [api, token])

  const download = async () => {
    if (!share) return
    setDownloading(true)
    setError('')
    try {
      await api.downloadPublicShare(token, password, share.name)
      setShare((current) => current ? { ...current, download_count: current.download_count + 1 } : current)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Incorrect share password.')
      } else if (err instanceof ApiError && err.status === 410) {
        setError('This share has expired, reached its download limit, or was revoked.')
      } else {
        setError(err instanceof Error ? err.message : 'Download failed.')
      }
    } finally {
      setDownloading(false)
    }
  }

  const exhausted = !!share && share.max_downloads > 0 && share.download_count >= share.max_downloads

  return (
    <div className="auth-shell">
      <Card className="auth-card">
        <div className="brand-lockup">
          <div className="brand-mark">x</div>
          <div>
            <Typography.Title level={2} style={{ margin: 0 }}>xDrive</Typography.Title>
            <Typography.Text type="secondary">Secure file share</Typography.Text>
          </div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>}
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 18 }} />}

        {share && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space align="start">
              <FileOutlined style={{ fontSize: 28, marginTop: 4 }} />
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>{share.name}</Typography.Title>
                <Typography.Text type="secondary">{formatSize(share.size)}</Typography.Text>
              </div>
            </Space>

            <Typography.Text type="secondary">
              {share.expires_at ? `Expires ${new Date(share.expires_at).toLocaleString()}` : 'No expiration'}
              {' · '}
              {share.max_downloads > 0
                ? `${Math.max(0, share.max_downloads - share.download_count)} of ${share.max_downloads} downloads remaining`
                : 'Unlimited downloads'}
            </Typography.Text>

            {share.requires_password && (
              <Input.Password
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onPressEnter={() => void download()}
                prefix={<LockOutlined />}
                placeholder="Share password"
                autoComplete="current-password"
              />
            )}

            {exhausted && <Alert type="warning" showIcon message="This share has reached its download limit." />}

            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloading}
              disabled={exhausted || (share.requires_password && !password)}
              onClick={() => void download()}
              block
            >
              Download
            </Button>
          </Space>
        )}
      </Card>
    </div>
  )
}
