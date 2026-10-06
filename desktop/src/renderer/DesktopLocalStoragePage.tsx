import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Box, Chip, IconButton, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatBytes } from '@xdrive/shared'
import {
  XDriveActionButton,
  XDriveMetricCard,
  XDriveMetricGrid,
  XDriveSectionHeader,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveWorkspaceSurface,
} from '@xdrive/ui/mui'

export type DesktopLocalStorageMode = 'default' | 'exclude' | 'always-local'

export type DesktopLocalStorageCacheStats = {
  supported: boolean
  reason?: string
  used_bytes: number
  limit_bytes: number
  reclaimable_bytes: number
  reclaimable_files: number
  cached_files: number
  pinned_bytes: number
  pinned_files: number
}

export type DesktopLocalStorageTreeNode = {
  path: string
  name: string
  mode: DesktopLocalStorageMode
  effective_mode: DesktopLocalStorageMode
  file_count: number
  total_bytes: number
  children?: DesktopLocalStorageTreeNode[]
}

export type DesktopLocalStorageSnapshot = {
  supported: boolean
  reason?: string
  storagePoliciesSupported: boolean
  cacheStats?: DesktopLocalStorageCacheStats | null
  storageTree?: DesktopLocalStorageTreeNode | null
}

export type DesktopLocalStorageReleaseResult = {
  released_files: number
  released_bytes: number
  failed_files: number
}

export type DesktopLocalStorageDataSource = {
  load: () => Promise<DesktopLocalStorageSnapshot>
  releaseCache?: () => Promise<DesktopLocalStorageReleaseResult>
  setFolderMode?: (path: string, mode: DesktopLocalStorageMode) => Promise<void>
}

function modeLabel(mode: DesktopLocalStorageMode) {
  if (mode === 'exclude') return '不同步'
  if (mode === 'always-local') return '始终保留'
  return '默认'
}

function LocalFolderRow({
  node,
  depth,
  expanded,
  busy,
  policySupported,
  onToggle,
  onModeChange,
}: {
  node: DesktopLocalStorageTreeNode
  depth: number
  expanded: Set<string>
  busy: boolean
  policySupported: boolean
  onToggle: (path: string) => void
  onModeChange?: (path: string, mode: DesktopLocalStorageMode) => void
}) {
  const children = node.children || []
  const open = expanded.has(node.path)
  const inherited = node.mode === 'default' && node.effective_mode !== 'default'

  return (
    <>
      <Box
        sx={{
          minHeight: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 1 + depth * 2,
          pr: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
          '&:last-of-type': { borderBottom: 0 },
        }}
      >
        <IconButton
          size="small"
          disabled={children.length === 0}
          aria-label={open ? '折叠文件夹' : '展开文件夹'}
          onClick={() => onToggle(node.path)}
          sx={{ width: 28, height: 28 }}
        >
          {children.length === 0
            ? <ChevronRightRoundedIcon fontSize="small" sx={{ opacity: 0 }} />
            : open
              ? <ExpandMoreRoundedIcon fontSize="small" />
              : <ChevronRightRoundedIcon fontSize="small" />}
        </IconButton>
        <FolderRoundedIcon fontSize="small" sx={{ color: '#ffcb3d' }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap>{node.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {node.file_count.toLocaleString()} 个文件 · {formatBytes(node.total_bytes)}
            {policySupported && inherited ? ` · 继承：${modeLabel(node.effective_mode)}` : ''}
          </Typography>
        </Box>
        {policySupported && onModeChange ? (
          <Stack direction="row" spacing={0.5}>
            {(['default', 'exclude', 'always-local'] as DesktopLocalStorageMode[]).map((mode) => (
              <XDriveActionButton
                key={mode}
                compact
                intent={node.mode === mode ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => onModeChange(node.path, mode)}
              >
                {modeLabel(mode)}
              </XDriveActionButton>
            ))}
          </Stack>
        ) : (
          <Chip size="small" variant="outlined" label="按需访问" />
        )}
      </Box>
      {open ? children.map((child) => (
        <LocalFolderRow
          key={child.path}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          busy={busy}
          policySupported={policySupported}
          onToggle={onToggle}
          onModeChange={onModeChange}
        />
      )) : null}
    </>
  )
}

export function DesktopLocalStoragePage({
  source,
}: {
  source: DesktopLocalStorageDataSource
}) {
  const [snapshot, setSnapshot] = useState<DesktopLocalStorageSnapshot | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await source.load()
      setSnapshot(next)
      if (next.storageTree) {
        setExpanded((current) => current.size > 0
          ? current
          : new Set((next.storageTree?.children || []).map((child) => child.path)))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载本地存储信息失败')
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => {
    void load()
  }, [load])

  const treeChildren = useMemo(() => snapshot?.storageTree?.children || [], [snapshot?.storageTree])

  const releaseCache = async () => {
    if (!source.releaseCache) return
    setAction('release-cache')
    setError('')
    setNotice('')
    try {
      const result = await source.releaseCache()
      const failed = result.failed_files > 0 ? ` · ${result.failed_files} 个文件无法释放` : ''
      setNotice(result.released_files > 0
        ? `已从 ${result.released_files} 个文件释放 ${formatBytes(result.released_bytes)}${failed}。`
        : '当前没有可释放的缓存。')
      await load()
    } catch (releaseError) {
      setError(releaseError instanceof Error ? releaseError.message : '释放本地缓存失败')
    } finally {
      setAction('')
    }
  }

  const setFolderMode = async (path: string, mode: DesktopLocalStorageMode) => {
    if (!source.setFolderMode) return
    setAction(`mode:${path}`)
    setError('')
    setNotice('')
    try {
      await source.setFolderMode(path, mode)
      setNotice('文件夹本地存储策略已更新。')
      await load()
    } catch (modeError) {
      setError(modeError instanceof Error ? modeError.message : '更新文件夹本地存储策略失败')
    } finally {
      setAction('')
    }
  }

  const cache = snapshot?.cacheStats

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="本地存储"
      subtitle="查看和管理当前设备的本地缓存与离线保留策略。"
      pageActions={(
        <XDriveActionButton
          startIcon={<RefreshRoundedIcon />}
          loading={loading}
          loadingLabel="正在刷新…"
          onClick={() => { void load() }}
        >
          刷新
        </XDriveActionButton>
      )}
    >
      {error ? <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>{error}</XDriveStatusAlert> : null}
      {notice ? <XDriveStatusAlert tone="good" sx={{ mb: 2 }}>{notice}</XDriveStatusAlert> : null}

      {!snapshot && !error ? (
        <XDriveStatePanel
          variant="plain"
          loading={loading}
          message={loading ? '正在加载本地存储信息…' : '暂无本地存储信息'}
        />
      ) : null}

      {snapshot && !snapshot.supported ? (
        <XDriveStatusAlert tone="neutral">
          {snapshot.reason || '当前客户端不提供本地存储管理。'}
        </XDriveStatusAlert>
      ) : null}

      {snapshot?.supported ? (
        <Stack spacing={3}>
          <Stack spacing={1.5}>
            <XDriveSectionHeader
              level="h3"
              title="本地缓存"
              subtitle="仅统计当前设备缓存；不会改变云端文件和云端配额。"
            />
            {cache ? (
              <>
                <XDriveMetricGrid>
                  <XDriveMetricCard title="已使用" value={formatBytes(cache.used_bytes)} suffix={`${cache.cached_files.toLocaleString()} 个缓存文件`} />
                  <XDriveMetricCard title="上限" value={cache.limit_bytes > 0 ? formatBytes(cache.limit_bytes) : '不限'} suffix="已固定内容受保护" />
                  <XDriveMetricCard title="可释放" value={formatBytes(cache.reclaimable_bytes)} suffix={`${cache.reclaimable_files.toLocaleString()} 个文件`} />
                  <XDriveMetricCard title="已固定" value={formatBytes(cache.pinned_bytes)} suffix={`${cache.pinned_files.toLocaleString()} 个文件`} />
                </XDriveMetricGrid>
                {cache.supported ? (
                  <Box>
                    <XDriveActionButton
                      disabled={Boolean(action) || cache.reclaimable_bytes <= 0 || !source.releaseCache}
                      loading={action === 'release-cache'}
                      loadingLabel="正在释放…"
                      onClick={() => { void releaseCache() }}
                    >
                      释放可回收缓存
                    </XDriveActionButton>
                  </Box>
                ) : (
                  <XDriveStatusAlert tone="neutral">
                    {cache.reason || '当前平台不支持持久化本地缓存管理。'}
                  </XDriveStatusAlert>
                )}
              </>
            ) : (
              <XDriveStatePanel variant="plain" message="暂无本地缓存统计。" />
            )}
          </Stack>

          <Stack spacing={1.5}>
            <XDriveSectionHeader
              level="h3"
              title="文件夹本地策略"
              subtitle={snapshot.storagePoliciesSupported
                ? '默认 / 不同步 / 始终保留'
                : '当前平台按需访问云端内容，不提供 Windows CfAPI 本地保留策略。'}
            />
            {!snapshot.storagePoliciesSupported ? (
              <XDriveStatusAlert tone="neutral">
                当前平台不提供 Windows CfAPI 的“不同步”“始终保留”或持久化本地缓存语义。
              </XDriveStatusAlert>
            ) : null}
            {!snapshot.storageTree ? (
              <XDriveStatePanel loading={loading} message="正在加载文件夹策略…" />
            ) : treeChildren.length === 0 ? (
              <XDriveStatePanel message="暂无可配置文件夹。" />
            ) : (
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                {treeChildren.map((node) => (
                  <LocalFolderRow
                    key={node.path}
                    node={node}
                    depth={0}
                    expanded={expanded}
                    busy={Boolean(action)}
                    policySupported={snapshot.storagePoliciesSupported}
                    onToggle={(path) => setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(path)) next.delete(path)
                      else next.add(path)
                      return next
                    })}
                    onModeChange={source.setFolderMode ? (path, mode) => { void setFolderMode(path, mode) } : undefined}
                  />
                ))}
              </Box>
            )}
          </Stack>
        </Stack>
      ) : null}
    </XDriveWorkspaceSurface>
  )
}
