import { useEffect, useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { NodeLocation } from '../models'
import { XDriveStatusAlert } from './StatusAlert'
import { xDriveMediaGalleryErrorMessage } from './MediaGalleryUtils'

export type XDriveNodeLocationLoader =
  (nodeID: number, signal?: AbortSignal) => Promise<NodeLocation>

export function XDriveMediaNodeLocationSection({
  nodeID,
  revision,
  loadNodeLocation,
  onShowInFolder,
}: {
  nodeID: number
  revision: number
  loadNodeLocation: XDriveNodeLocationLoader
  onShowInFolder?: (location: NodeLocation) => void
}) {
  const [location, setLocation] = useState<NodeLocation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLocation(null)
    setError('')
    setLoading(true)
    void loadNodeLocation(nodeID, controller.signal)
      .then((result) => {
        if (!active || controller.signal.aborted) return
        if (result.node_id !== nodeID) {
          setError('文件位置响应与当前媒体不一致。')
          return
        }
        setLocation(result)
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return
        setError(xDriveMediaGalleryErrorMessage(reason))
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [nodeID, revision, loadNodeLocation, attempt])

  const currentPath = location?.path ? '/' + location.path.replace(/^\/+/, '') : '/'
  const parentPath = location?.parent_path ? '/' + location.parent_path.replace(/^\/+/, '') : '/'
  const canNavigate = location?.parent_id != null &&
    Number.isSafeInteger(location.parent_id) && location.parent_id > 0 &&
    Boolean(onShowInFolder)

  return (
    <Box component="section" aria-label="来源与位置" data-xdrive-media-node-location>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>来源与位置</Typography>
      {loading ? (
        <Typography variant="body2" color="text.secondary" role="status">
          正在读取文件位置…
        </Typography>
      ) : error ? (
        <Stack alignItems="flex-start" spacing={1}>
          <XDriveStatusAlert tone="warning">{error}</XDriveStatusAlert>
          <Button size="small" variant="outlined" onClick={() => setAttempt((n) => n + 1)}>
            重试
          </Button>
        </Stack>
      ) : location ? (
        <Stack spacing={1}>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            <Typography component="span" variant="body2" color="text.secondary">当前文件路径：</Typography>
            {currentPath}
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            <Typography component="span" variant="body2" color="text.secondary">所在文件夹：</Typography>
            {parentPath}
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            <Typography component="span" variant="body2" color="text.secondary">当前同步文件夹：</Typography>
            {location.sync_folders?.length
              ? location.sync_folders.map((source) => source.source_name).join('、')
              : '不在已登记的同步文件夹目标目录下'}
          </Typography>
          {location.sources?.length ? location.sources.map((source, index) => (
            <Typography
              key={`${source.source_id}:${index}`}
              variant="body2"
              sx={{ overflowWrap: 'anywhere' }}
            >
              <Typography component="span" variant="body2" color="text.secondary">原始来源：</Typography>
              {source.source_name}
              {source.original_path
                ? ` · ${source.original_path}`
                : source.source_item_path
                  ? ` · ${source.source_item_path}`
                  : ' · 未记录原始路径'}
            </Typography>
          )) : (
            <Typography variant="body2" color="text.secondary">
              没有可靠的原始同步来源记录。
            </Typography>
          )}
          {canNavigate ? (
            <Box>
              <Button
                size="small"
                variant="outlined"
                data-xdrive-media-show-in-folder
                sx={{ '@media (max-width:899.95px)': { minHeight: 44 } }}
                onClick={() => onShowInFolder?.(location)}
              >
                显示所在位置
              </Button>
            </Box>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  )
}
