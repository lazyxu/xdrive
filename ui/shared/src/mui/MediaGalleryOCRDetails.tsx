import { useEffect, useState } from 'react'
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { MediaItem } from '../models'

/** A single Owner-authorized detail read on opening Properties: no OCR text
 * is loaded, cached or streamed for the virtualized Gallery grid. */
export function XDriveMediaOCRDetails({
  item, loadMediaItem,
}: {
  item: MediaItem
  loadMediaItem?: (nodeID: number, signal?: AbortSignal) => Promise<MediaItem>
}) {
  const [detail, setDetail] = useState<MediaItem | null>(item.ocr ? item : null)
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'error'>(item.ocr ? 'loaded' : 'loading')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    const abort = new AbortController()
    setPhase('loading')
    setDetail(null)
    setCopyState('idle')
    if (item.ocr) {
      // Dedicated Viewer may already hold the authorized detail response.
      setDetail(item)
      setPhase('loaded')
      return () => abort.abort()
    }
    if (!loadMediaItem) {
      setPhase('loaded')
      return () => abort.abort()
    }
    void loadMediaItem(item.node.id, abort.signal).then(value => {
      if (abort.signal.aborted) return
      if (value.node.id !== item.node.id || value.node.revision !== item.node.revision) {
        setPhase('error')
        return
      }
      setDetail(value)
      setPhase('loaded')
    }).catch(() => {
      if (!abort.signal.aborted) setPhase('error')
    })
    return () => abort.abort()
  }, [item.node.id, item.node.revision, item.ocr, loadMediaItem])

  const ocr = detail?.node.id === item.node.id &&
    detail?.node.revision === item.node.revision ? detail.ocr : undefined
  const readyText = phase === 'loaded' && ocr?.state === 'ready' ? ocr.text?.trim() || '' : ''
  const message = phase === 'loading' ? '正在读取 OCR 结果…'
    : phase === 'error' ? '无法读取识别结果，请重新打开属性'
    : ocr?.state === 'running' ? '正在识别照片文字…'
    : ocr?.state === 'pending' ? '尚未识别，等待后台自动分析'
    : ocr?.state === 'failed' ? '识别失败，将由后台定时重试'
    : ocr?.state === 'stale' ? '照片已更新，等待重新识别'
    : ocr?.state === 'ready' ? '已识别，未检测到文字'
    : '暂无可用 OCR 结果，请检查模型配置'

  return (
    <Box component="section" aria-label="识别文字" data-xdrive-gallery-ocr-details>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>识别文字（OCR）</Typography>
      {readyText ? (
        <Stack spacing={1}>
          <Box sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflowY: 'auto',
            userSelect: 'text' }}>
            <Typography variant="body2" component="div">{readyText}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button size="small" variant="outlined" startIcon={<ContentCopyOutlinedIcon />}
              onClick={() => {
                void navigator.clipboard.writeText(readyText).then(() => setCopyState('copied'))
                  .catch(() => setCopyState('failed'))
              }}>复制文字</Button>
            {copyState !== 'idle' ? (
              <Typography role="status" variant="caption" color={copyState === 'failed' ? 'error' : 'text.secondary'}>
                {copyState === 'copied' ? '已复制' : '复制失败，可直接选择文字'}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      ) : (
        <Typography role="status" variant="body2" color="text.secondary">{message}</Typography>
      )}
    </Box>
  )
}
