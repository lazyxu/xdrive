import { useEffect, useState } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import type { PhotoContentSources } from '../photo-content-identity'

export function XDrivePhotoContentSources({ contentKey, load }: {
  contentKey: string
  load: (key: string, cursor?: string, signal?: AbortSignal) => Promise<PhotoContentSources>
}) {
  const [cursor, setCursor] = useState('')
  const [page, setPage] = useState<PhotoContentSources | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setCursor('') }, [contentKey])
  useEffect(() => {
    const abort = new AbortController()
    setPage(null); setFailed(false)
    void load(contentKey, cursor, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.content_key !== contentKey || result.items.length > 50 ||
          new Set(result.items.map(item => item.id)).size !== result.items.length ||
          result.items.some(item => item.id <= 0 || item.type !== 'file') ||
          (result.next_cursor !== undefined && (!Number.isSafeInteger(result.next_cursor) ||
            Number(result.next_cursor) <= Number(cursor)))) throw new Error('Invalid source page')
      setPage(result)
    }).catch(() => { if (!abort.signal.aborted) setFailed(true) })
    return () => abort.abort()
  }, [contentKey, cursor, load])
  const current = page?.content_key === contentKey ? page : null
  return <Stack component="section" spacing={1} aria-label="照片文件副本">
    <Typography variant="subtitle2">照片文件副本</Typography>
    <Typography variant="caption">以下文件共享同一组原件；相册关系不会额外复制文件。</Typography>
    {failed ? <Typography color="error">无法读取文件副本，请重新打开属性。</Typography>
      : !current ? <Typography>正在读取…</Typography>
        : current.items.map(item => <Typography key={item.id} variant="body2">{item.name}</Typography>)}
    {current?.next_cursor && <Button onClick={() => setCursor(String(current.next_cursor!))}>下一页副本</Button>}
    {cursor && <Button onClick={() => setCursor('')}>返回第一页</Button>}
  </Stack>
}
