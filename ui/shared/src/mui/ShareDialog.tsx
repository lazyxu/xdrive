import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import { Box, Dialog, LinearProgress } from '@mui/material'
import type { FileShare } from '../models'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveFeedbackSnackbar } from './FeedbackSnackbar'
import { XDriveSectionHeader } from './SectionHeader'
import {
  XDriveCreatedShareLink,
  XDriveShareCreateFields,
  type XDriveShareExpiryMode,
} from './ShareFields'
import { XDriveShareList } from './ShareList'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'

export interface XDriveShareNode {
  id: number
  name: string
}

export interface XDriveShareCreateInput {
  expires_at?: string
  password?: string
  max_downloads?: number
}

export interface XDriveShareDialogAdapter {
  listShares(nodeID: number): Promise<FileShare[]>
  createShare(nodeID: number, input: XDriveShareCreateInput): Promise<{ url: string }>
  revokeShare(shareID: number): Promise<unknown>
}

type Feedback = {
  tone: 'good' | 'bad'
  message: string
}

function defaultExpiryInput(mode: XDriveShareExpiryMode) {
  if (mode === 'days') return '7'
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function expiryInput(
  mode: XDriveShareExpiryMode,
  value: string,
): { expiresAt?: string; error?: string } {
  if (mode === 'days') {
    const days = Number(value)
    if (!Number.isSafeInteger(days) || days < 0 || days > 3650) {
      return { error: '分享有效期必须是 0 到 3650 之间的整数天' }
    }
    return {
      expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined,
    }
  }

  if (!value) return {}
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    return { error: '过期时间必须晚于当前时间' }
  }
  return { expiresAt: parsed.toISOString() }
}

export function XDriveShareDialog({
  adapter,
  node,
  onClose,
  onError,
  expiryMode = 'datetime',
  listVariant = 'table',
  showCloseAction = false,
}: {
  adapter: XDriveShareDialogAdapter
  node: XDriveShareNode | null
  onClose: () => void
  onError: (error: unknown) => void
  expiryMode?: XDriveShareExpiryMode
  listVariant?: 'table' | 'compact'
  showCloseAction?: boolean
}) {
  const [shares, setShares] = useState<FileShare[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [revokingID, setRevokingID] = useState<number | null>(null)
  const [createdLink, setCreatedLink] = useState('')
  const [expiresAt, setExpiresAt] = useState(() => defaultExpiryInput(expiryMode))
  const [password, setPassword] = useState('')
  const [maxDownloads, setMaxDownloads] = useState('0')
  const [expiryError, setExpiryError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [maxDownloadsError, setMaxDownloadsError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const loadRequestRef = useRef(0)
  const nodeLifecycleGenerationRef = useRef(0)

  const load = useCallback(async () => {
    if (!node) return
    const requestID = loadRequestRef.current + 1
    loadRequestRef.current = requestID
    setLoading(true)
    try {
      const next = await adapter.listShares(node.id)
      if (requestID !== loadRequestRef.current) return
      setShares(next)
    } catch (error) {
      if (requestID === loadRequestRef.current) onError(error)
    } finally {
      if (requestID === loadRequestRef.current) setLoading(false)
    }
  }, [adapter, node, onError])

  useEffect(() => {
    nodeLifecycleGenerationRef.current += 1
    setCreating(false)
    setRevokingID(null)
    setFeedback(null)
  }, [node?.id])

  useEffect(() => {
    if (!node) return
    setCreatedLink('')
    setExpiresAt(defaultExpiryInput(expiryMode))
    setPassword('')
    setMaxDownloads('0')
    setExpiryError('')
    setPasswordError('')
    setMaxDownloadsError('')
  }, [node?.id, expiryMode])

  useEffect(() => {
    if (!node) {
      loadRequestRef.current += 1
      setShares([])
      setLoading(false)
      return
    }
    void load()
  }, [load, node])

  useEffect(() => () => {
    loadRequestRef.current += 1
    nodeLifecycleGenerationRef.current += 1
  }, [])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!node) return

    const expiry = expiryInput(expiryMode, expiresAt)
    const parsedMaxDownloads = Number(maxDownloads)
    const nextPasswordError = password && password.length < 8 ? '至少需要 8 个字符' : ''
    const nextMaxDownloadsError = !Number.isSafeInteger(parsedMaxDownloads) || parsedMaxDownloads < 0
      ? '最大下载次数必须是非负整数'
      : ''

    setExpiryError(expiry.error ?? '')
    setPasswordError(nextPasswordError)
    setMaxDownloadsError(nextMaxDownloadsError)
    if (expiry.error || nextPasswordError || nextMaxDownloadsError) return

    const lifecycleGeneration = nodeLifecycleGenerationRef.current
    setCreating(true)
    try {
      const created = await adapter.createShare(node.id, {
        expires_at: expiry.expiresAt,
        password,
        max_downloads: parsedMaxDownloads,
      })
      if (lifecycleGeneration !== nodeLifecycleGenerationRef.current) return
      setCreatedLink(created.url)
      setFeedback({ tone: 'good', message: '分享链接已创建' })
      await load()
    } catch (error) {
      if (lifecycleGeneration === nodeLifecycleGenerationRef.current) onError(error)
    } finally {
      if (lifecycleGeneration === nodeLifecycleGenerationRef.current) setCreating(false)
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
    const lifecycleGeneration = nodeLifecycleGenerationRef.current
    setRevokingID(share.id)
    try {
      await adapter.revokeShare(share.id)
      if (lifecycleGeneration !== nodeLifecycleGenerationRef.current) return
      setFeedback({ tone: 'good', message: '分享已撤销' })
      await load()
    } catch (error) {
      if (lifecycleGeneration === nodeLifecycleGenerationRef.current) onError(error)
    } finally {
      if (lifecycleGeneration === nodeLifecycleGenerationRef.current) setRevokingID(null)
    }
  }

  const closeDisabled = creating || revokingID !== null

  return (
    <>
      <Dialog
        open={Boolean(node)}
        onClose={() => {
          if (!closeDisabled) onClose()
        }}
        maxWidth="md"
        fullWidth
        scroll="paper"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={node ? `分享 — ${node.name}` : '分享'}
          subtitle="分享令牌只会在创建时显示一次。"
          onClose={onClose}
          closeDisabled={closeDisabled}
        />
        <XDriveDialogContent dividers>
          <XDriveStatusAlert tone="neutral" title="分享令牌只显示一次" sx={{ mb: 2.25 }}>
            xDrive 只保存单向令牌哈希。请立即复制新创建的链接；已有链接可以撤销，但无法再次显示。
          </XDriveStatusAlert>

          {createdLink ? (
            <XDriveCreatedShareLink
              value={createdLink}
              onCopy={() => void copyCreatedLink()}
              copyLabel="复制链接"
              copyIntent="primary"
              sx={{ mb: 2.25 }}
            />
          ) : null}

          <XDriveSectionHeader level="h3" title="创建下载链接" sx={{ mb: 1.5 }} />
          <Box component="form" onSubmit={(event) => void create(event)}>
            <XDriveShareCreateFields
              expiryMode={expiryMode}
              expiryValue={expiresAt}
              expiryError={Boolean(expiryError)}
              expiryHelperText={expiryError || (expiryMode === 'days' ? '0 表示永不过期。' : ' ')}
              onExpiryChange={(value) => {
                setExpiresAt(value)
                if (expiryError) setExpiryError('')
              }}
              maxDownloadsValue={maxDownloads}
              onMaxDownloadsChange={(value) => {
                setMaxDownloads(value)
                if (maxDownloadsError) setMaxDownloadsError('')
              }}
              maxDownloadsHelperText={maxDownloadsError || (expiryMode === 'days' ? '0 表示不限次数。' : '0 表示不限')}
              password={password}
              passwordError={Boolean(passwordError)}
              passwordHelperText={passwordError || ' '}
              passwordPlaceholder={expiryMode === 'days' ? '至少 8 个字符' : undefined}
              onPasswordChange={(value) => {
                setPassword(value)
                if (passwordError) setPasswordError('')
              }}
              sx={{ mb: 1.5 }}
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
              variant={listVariant}
              revokeDisabled={revokingID !== null}
              onRevoke={(share) => void revoke(share)}
            />
          )}
        </XDriveDialogContent>
        {showCloseAction ? (
          <XDriveDialogActions>
            <XDriveActionButton disabled={closeDisabled} onClick={onClose}>关闭</XDriveActionButton>
          </XDriveDialogActions>
        ) : null}
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
