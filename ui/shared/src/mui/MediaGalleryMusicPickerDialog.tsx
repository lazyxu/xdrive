import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  Stack,
  Typography,
} from '@mui/material'
import type { Node } from '../models'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import {
  XDriveFileExplorer,
  xDriveFileKind,
} from './FileExplorer'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerID,
  XDriveFileExplorerItem,
} from './FileExplorer'

const musicExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'wma'])

function musicExtension(name: string) {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function xDriveMediaGalleryMusicNodeSupported(node: Node) {
  return node.type === 'file' && musicExtensions.has(musicExtension(node.name))
}

function musicPickerItem(node: Node): XDriveFileExplorerItem {
  return {
    id: node.id,
    name: node.name || '我的文件',
    kind: node.type,
    size: node.size,
    createdAt: node.created_at,
    updatedAt: node.updated_at,
    revision: node.revision,
    sha256: node.sha256,
    fileKind: xDriveFileKind(node.name, node.type),
  }
}

function musicPickerCrumb(node: Node): XDriveFileExplorerCrumb {
  return {
    id: node.id,
    name: node.name || '我的文件',
  }
}

export function XDriveMediaGalleryMusicPickerDialog({
  open,
  loadRoot,
  listChildren,
  onChoose,
  onClose,
}: {
  open: boolean
  loadRoot: () => Promise<Node>
  listChildren: (parentID: number) => Promise<Node[]>
  onChoose: (node: Node) => void
  onClose: () => void
}) {
  const requestRef = useRef(0)
  const [stack, setStack] = useState<Node[]>([])
  const [nodes, setNodes] = useState<Node[]>([])
  const [selectedIDs, setSelectedIDs] = useState<XDriveFileExplorerID[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const visibleNodes = useMemo(
    () => nodes.filter((node) => node.type === 'dir' || xDriveMediaGalleryMusicNodeSupported(node)),
    [nodes],
  )
  const items = useMemo(() => visibleNodes.map(musicPickerItem), [visibleNodes])
  const selectedNode = useMemo(() => {
    if (selectedIDs.length !== 1) return null
    const id = Number(selectedIDs[0])
    const node = visibleNodes.find((value) => value.id === id)
    return node && xDriveMediaGalleryMusicNodeSupported(node) ? node : null
  }, [selectedIDs, visibleNodes])

  const loadDirectory = useCallback(async (node: Node, nextStack: Node[]) => {
    const request = ++requestRef.current
    setLoading(true)
    setError('')
    setSelectedIDs([])
    try {
      const children = await listChildren(node.id)
      if (request !== requestRef.current) return
      setStack(nextStack)
      setNodes(children)
    } catch (loadError) {
      if (request !== requestRef.current) return
      setError(loadError instanceof Error ? loadError.message : '无法读取文件夹')
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [listChildren])

  useEffect(() => {
    if (!open) {
      requestRef.current += 1
      setLoading(false)
      return
    }
    const request = ++requestRef.current
    setLoading(true)
    setError('')
    setStack([])
    setNodes([])
    setSelectedIDs([])
    void loadRoot()
      .then(async (root) => {
        if (request !== requestRef.current) return
        const children = await listChildren(root.id)
        if (request !== requestRef.current) return
        setStack([root])
        setNodes(children)
      })
      .catch((loadError) => {
        if (request !== requestRef.current) return
        setError(loadError instanceof Error ? loadError.message : '无法读取我的文件')
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false)
      })
    return () => {
      requestRef.current += 1
    }
  }, [listChildren, loadRoot, open])

  const openItem = (item: XDriveFileExplorerItem) => {
    const node = visibleNodes.find((value) => value.id === Number(item.id))
    if (!node) return
    if (node.type === 'dir') {
      void loadDirectory(node, [...stack, node])
      return
    }
    if (xDriveMediaGalleryMusicNodeSupported(node)) onChoose(node)
  }

  const openCrumb = (crumb: XDriveFileExplorerCrumb, index: number) => {
    const node = stack.find((value) => value.id === Number(crumb.id))
    if (!node) return
    void loadDirectory(node, stack.slice(0, index + 1))
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { ...xDriveDialogPaperProps, sx: { ...xDriveDialogPaperProps.sx, height: 'min(720px, calc(100vh - 48px))' } } }}
      data-xdrive-gallery-music-picker
    >
      <XDriveDialogTitle
        title="选择电影配乐"
        subtitle="从 xDrive 中选择一个音频文件；原音频不会被修改。"
        onClose={onClose}
      />
      <XDriveDialogContent dividers flush>
        <Stack spacing={1} sx={{ height: '100%', minHeight: 0, p: 1.25 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Typography variant="caption" color="text.secondary">
            支持 AAC、FLAC、M4A、MP3、OGG、WAV、WMA。双击音频可直接选择。
          </Typography>
          <Stack sx={{ minHeight: 0, flex: 1 }}>
            <XDriveFileExplorer
              items={items}
              crumbs={stack.map(musicPickerCrumb)}
              interactionLifecycleKey={stack.map((node) => node.id).join('/')}
              loading={loading}
              presentation="card"
              searchEnabled={false}
              groupingEnabled={false}
              viewMode="details"
              canGoUp={stack.length > 1}
              onUp={() => {
                if (stack.length <= 1) return
                const parent = stack[stack.length - 2]
                void loadDirectory(parent, stack.slice(0, -1))
              }}
              selectedIDs={selectedIDs}
              onSelectionChange={(ids) => {
                const last = ids.at(-1)
                if (last === undefined) {
                  setSelectedIDs([])
                  return
                }
                const node = visibleNodes.find((value) => value.id === Number(last))
                setSelectedIDs(
                  node && xDriveMediaGalleryMusicNodeSupported(node) ? [last] : [],
                )
              }}
              onOpenItem={openItem}
              onCrumbClick={openCrumb}
              emptyMessage="此文件夹没有可用的音频文件"
              statusText="仅显示文件夹和可用音频"
              commandBarStart={(
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <MusicNoteRoundedIcon fontSize="small" />
                  <Typography variant="body2">电影配乐</Typography>
                </Stack>
              )}
            />
          </Stack>
        </Stack>
      </XDriveDialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          disabled={!selectedNode}
          startIcon={<MusicNoteRoundedIcon />}
          onClick={() => {
            if (selectedNode) onChoose(selectedNode)
          }}
        >
          选择配乐
        </Button>
      </DialogActions>
    </Dialog>
  )
}
