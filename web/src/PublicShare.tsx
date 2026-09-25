import { useEffect, useMemo, useState } from 'react'
import { DownloadOutlined, FileOutlined, LockOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Input, Space, Spin, Typography } from 'antd'
import { ApiError, XDriveApi } from './api'
import type { PublicShare } from '../../ui/shared/src'
import { formatSize } from '../../ui/shared/src'

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
          setError('此分享已过期、达到下载上限或已被撤销。')
        } else if (err instanceof ApiError && err.status === 404) {
          setError('此分享链接不存在。')
        } else {
          setError(err instanceof Error ? err.message : '无法加载此分享。')
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
        setError('分享密码错误。')
      } else if (err instanceof ApiError && err.status === 410) {
        setError('此分享已过期、达到下载上限或已被撤销。')
      } else {
        setError(err instanceof Error ? err.message : '下载失败。')
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
            <Typography.Text type="secondary">安全文件分享</Typography.Text>
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
              {share.expires_at ? `过期时间 ${new Date(share.expires_at).toLocaleString()}` : '永不过期'}
              {' · '}
              {share.max_downloads > 0
                ? `剩余 ${Math.max(0, share.max_downloads - share.download_count)} / ${share.max_downloads} 次下载`
                : '不限下载次数'}
            </Typography.Text>

            {share.requires_password && (
              <Input.Password
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onPressEnter={() => void download()}
                prefix={<LockOutlined />}
                placeholder="分享密码"
                autoComplete="current-password"
              />
            )}

            {exhausted && <Alert type="warning" showIcon message="此分享已达到下载上限。" />}

            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloading}
              disabled={exhausted || (share.requires_password && !password)}
              onClick={() => void download()}
              block
            >
              下载
            </Button>
          </Space>
        )}
      </Card>
    </div>
  )
}
