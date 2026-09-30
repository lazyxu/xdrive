import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import {
  Box,
  Dialog,
  LinearProgress,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveCreatedShareLink,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDriveFeedbackSnackbar,
  XDriveSectionHeader,
  XDriveShareCreateFields,
  XDriveShareList,
  XDriveStatePanel,
  XDriveStatusAlert,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import type { XDriveApi } from './api'
import type { FileShare, Node } from '../../ui/shared/src'

type Feedback = {
  tone: 'good' | 'bad'
  message: string
}

function defaultExpiryInput() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export default function ShareDialog({
  api,
  node,
  onClose,
  onError,
}: {
  api: XDriveApi
  node: Node | null
  onClose: () => void
  onError: (error: unknown) => void
}) {
  const [shares, setShares] = useState<FileShare[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createdLink, setCreatedLink] = useState('')
  const [expiresAt, setExpiresAt] = useState(defaultExpiryInput)
  const [password, setPassword] = useState('')
  const [maxDownloads, setMaxDownloads] = useState(0)
  const [expiryError, setExpiryError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const load = useCallback(async () => {
    if (!node) return
    setLoading(true)
    try {
      setShares(await api.shares(node.id))
    } catch (err) {
      onError(err)
    } finally {
      setLoading(false)
    }
  }, [api, node, onError])

  useEffect(() => {
    if (!node) return
    setCreatedLink('')
    setExpiresAt(defaultExpiryInput())
    setPassword('')
    setMaxDownloads(0)
    setExpiryError('')
    setPasswordError('')
  }, [node?.id])

  useEffect(() => {
    if (!node) return
    void load()
  }, [load, node])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!node) return

    let nextExpiryError = ''
    let nextPasswordError = ''
    let parsedExpiry: string | undefined

    if (expiresAt) {
      const parsed = new Date(expiresAt)
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        nextExpiryError = '过期时间必须晚于当前时间'
      } else {
        parsedExpiry = parsed.toISOString()
      }
    }
    if (password && password.length < 8) {
      nextPasswordError = '至少需要 8 个字符'
    }

    setExpiryError(nextExpiryError)
    setPasswordError(nextPasswordError)
    if (nextExpiryError || nextPasswordError) return

    setCreating(true)
    try {
      const created = await api.createShare(node.id, {
        expires_at: parsedExpiry,
        password,
        max_downloads: maxDownloads,
      })
      setCreatedLink(`${window.location.origin}/#/s/${created.token}`)
      setFeedback({ tone: 'good', message: '分享链接已创建' })
      await load()
    } catch (err) {
      onError(err)
    } finally {
      setCreating(false)
    }
  }

  const copyCreatedLink = async () => {
    if (!createdLink) return
    try {
      await navigator.clipboard.writeText(createdLink)
      setFeedback({ tone: 'good', message: '分享链接已复制' })
    } catch {
      setFeedback({ tone: 'bad', message: '无法自动复制，请手动复制链接。' })
    }
  }

  const revoke = async (share: FileShare) => {
    try {
      await api.revokeShare(share.id)
      setFeedback({ tone: 'good', message: '分享已撤销' })
      await load()
    } catch (err) {
      onError(err)
    }
  }

  return (
    <>
      <Dialog
        open={!!node}
        onClose={() => {
          if (!creating) onClose()
        }}
        maxWidth="md"
        fullWidth
        scroll="paper"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={node ? `分享 — ${node.name}` : '分享'}
          onClose={onClose}
          closeDisabled={creating}
        />
        <XDriveDialogContent dividers>
          <XDriveStatusAlert tone="neutral" title="分享令牌只显示一次" sx={{ mb: 2.25 }}>
            xDrive 只保存单向令牌哈希。请立即复制新创建的链接；已有链接可以撤销，但无法再次显示。
          </XDriveStatusAlert>

          {createdLink && (
            <XDriveCreatedShareLink
              value={createdLink}
              onCopy={() => void copyCreatedLink()}
              sx={{ mb: 2.25 }}
            />
          )}

          <XDriveSectionHeader level="h3" title="创建下载链接" sx={{ mb: 1.5 }} />
          <Box component="form" onSubmit={(event) => void create(event)}>
            <XDriveShareCreateFields
              expiryMode="datetime"
              expiryValue={expiresAt}
              expiryError={Boolean(expiryError)}
              expiryHelperText={expiryError || ' '}
              onExpiryChange={(value) => {
                setExpiresAt(value)
                if (expiryError) setExpiryError('')
              }}
              maxDownloadsValue={maxDownloads}
              onMaxDownloadsChange={(value) => {
                const parsed = Number.parseInt(value || '0', 10)
                setMaxDownloads(Number.isFinite(parsed) ? Math.max(0, parsed) : 0)
              }}
              password={password}
              passwordError={Boolean(passwordError)}
              passwordHelperText={passwordError || ' '}
              onPasswordChange={(value) => {
                setPassword(value)
                if (passwordError) setPasswordError('')
              }}
            />
            <XDriveActionButton
              intent="primary"
              type="submit"
              loading={creating}
              loadingLabel="正在创建…"
              startIcon={<LinkRoundedIcon />}
            >
              创建分享链接
            </XDriveActionButton>
          </Box>

          <XDriveSectionHeader level="h3" title="已有分享" sx={{ mt: 3, mb: 1.5 }} />

          {loading && shares.length > 0 ? <LinearProgress sx={{ mb: 1 }} /> : null}
          {loading && shares.length === 0 ? (
            <XDriveStatePanel variant="plain" loading message="正在加载已有分享…" />
          ) : shares.length === 0 ? (
            <XDriveStatePanel variant="plain" message="此文件暂无分享链接" />
          ) : (
            <XDriveShareList
              shares={shares}
              variant="table"
              onRevoke={(share) => void revoke(share)}
            />
          )}
        </XDriveDialogContent>
      </Dialog>

      <XDriveFeedbackSnackbar
        open={Boolean(feedback)}
        tone={feedback?.tone ?? 'good'}
        message={feedback?.message ?? ''}
        autoHideDuration={3000}
        onClose={() => setFeedback(null)}
      />
    </>
  )
}
