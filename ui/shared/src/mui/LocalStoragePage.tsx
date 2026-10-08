import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Box, Chip, IconButton, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveMetricCard, XDriveMetricGrid } from './MetricCards'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

export type XDriveLocalStorageMode = 'default' | 'exclude' | 'always-local'

export type XDriveBrowserStorageStats = {
  supported: boolean
  reason?: string
  total_used_bytes?: number
  quota_bytes?: number
  cache_bytes?: number
  cache_entries?: number
  clear_supported: boolean
  scope_label?: string
  detail?: string
}

export type XDriveBrowserStorageClearResult = {
  released_bytes?: number
  cleared_entries?: number
}

export type XDriveDesktopStorageCacheStats = {
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

export type XDriveLocalStorageTreeNode = {
  path: string
  name: string
  mode: XDriveLocalStorageMode
  effective_mode: XDriveLocalStorageMode
  file_count: number
  total_bytes: number
  children?: XDriveLocalStorageTreeNode[]
}

export type XDriveDesktopStorageSnapshot = {
  supported: boolean
  reason?: string
  storagePoliciesSupported: boolean
  cacheStats?: XDriveDesktopStorageCacheStats | null
  storageTree?: XDriveLocalStorageTreeNode | null
}

export type XDriveDesktopStorageReleaseResult = {
  released_files: number
  released_bytes: number
  failed_files: number
}

export type XDriveLocalStorageSnapshot = {
  browserStorage: XDriveBrowserStorageStats
  desktopStorage?: XDriveDesktopStorageSnapshot | null
}

export type XDriveLocalStorageDataSource = {
  load: () => Promise<XDriveLocalStorageSnapshot>
  clearBrowserCache?: () => Promise<XDriveBrowserStorageClearResult>
  releaseDesktopCache?: () => Promise<XDriveDesktopStorageReleaseResult>
  setFolderMode?: (path: string, mode: XDriveLocalStorageMode) => Promise<void>
}

function modeLabel(mode: XDriveLocalStorageMode) {
  if (mode === 'exclude') return '不同步'
  if (mode === 'always-local') return '始终保留'
  return '默认'
}

function bytesOrDash(value: number | undefined) {
  return value === undefined ? '—' : formatBytes(Math.max(0, value))
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
  node: XDriveLocalStorageTreeNode
  depth: number
  expanded: Set<string>
  busy: boolean
  policySupported: boolean
  onToggle: (path: string) => void
  onModeChange?: (path: string, mode: XDriveLocalStorageMode) => void
}) {
  const children = node.children || []
  const open = expanded.has(node.path)
  const inherited = node.mode === 'default' && node.effective_mode !== 'default'

  return (
    <>
      <Box
        sx={{
          minHeight: 48,
          display: { xs: 'grid', sm: 'flex' },
          gridTemplateColumns: { xs: 'auto auto minmax(0, 1fr)', sm: undefined },
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
          sx={{ width: { xs: 44, sm: 28 }, height: { xs: 44, sm: 28 } }}
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
            {policySupported && inherited ? ' · 继承：' + modeLabel(node.effective_mode) : ''}
          </Typography>
        </Box>
        {policySupported && onModeChange ? (
          <Stack
            direction="row"
            spacing={0.5}
            useFlexGap
            flexWrap="wrap"
            sx={{
              gridColumn: { xs: '1 / -1', sm: 'auto' },
              pl: { xs: 6.5, sm: 0 },
              minWidth: 0,
            }}
          >
            {(['default', 'exclude', 'always-local'] as XDriveLocalStorageMode[]).map((mode) => (
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
          <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, pl: { xs: 6.5, sm: 0 } }}>
            <Chip size="small" variant="outlined" label="按需访问" />
          </Box>
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

export function XDriveLocalStoragePage({ source }: { source: XDriveLocalStorageDataSource }) {
  const [snapshot, setSnapshot] = useState<XDriveLocalStorageSnapshot | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState('')
  const [pendingAction, setPendingAction] = useState<'browser' | 'desktop' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await source.load()
      setSnapshot(next)
      const tree = next.desktopStorage?.storageTree
      if (tree) {
        setExpanded((current) => current.size > 0
          ? current
          : new Set((tree.children || []).map((child) => child.path)))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载本地存储信息失败')
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => { void load() }, [load])

  const browser = snapshot?.browserStorage
  const desktop = snapshot?.desktopStorage
  const cache = desktop?.cacheStats
  const treeChildren = useMemo(() => desktop?.storageTree?.children || [], [desktop?.storageTree])
  const browserHasClearableCache = Boolean(
    browser?.clear_supported &&
    (
      (browser.cache_bytes !== undefined && browser.cache_bytes > 0) ||
      (browser.cache_entries !== undefined && browser.cache_entries > 0) ||
      (browser.cache_bytes === undefined && browser.cache_entries === undefined)
    ),
  )

  const clearBrowserCache = async () => {
    if (!source.clearBrowserCache) return
    setPendingAction(null)
    setAction('browser-cache')
    setError('')
    setNotice('')
    try {
      const result = await source.clearBrowserCache()
      const released = Math.max(0, result.released_bytes || 0)
      const entries = Math.max(0, result.cleared_entries || 0)
      setNotice(released > 0
        ? '已清理浏览器缓存 ' + formatBytes(released) + '。'
        : entries > 0
          ? '已清理 ' + entries.toLocaleString() + ' 个浏览器缓存容器。'
          : '当前没有可清理的浏览器缓存。')
      await load()
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : '清理浏览器缓存失败')
    } finally {
      setAction('')
    }
  }

  const releaseDesktopCache = async () => {
    if (!source.releaseDesktopCache) return
    setPendingAction(null)
    setAction('desktop-cache')
    setError('')
    setNotice('')
    try {
      const result = await source.releaseDesktopCache()
      const failed = result.failed_files > 0
        ? ' · ' + result.failed_files.toLocaleString() + ' 个文件无法释放'
        : ''
      setNotice(result.released_files > 0
        ? '已从 ' + result.released_files.toLocaleString() + ' 个文件释放 ' +
          formatBytes(result.released_bytes) + failed + '。'
        : '当前没有可释放的 Desktop 缓存。')
      await load()
    } catch (releaseError) {
      setError(releaseError instanceof Error ? releaseError.message : '释放 Desktop 缓存失败')
    } finally {
      setAction('')
    }
  }

  const setFolderMode = async (path: string, mode: XDriveLocalStorageMode) => {
    if (!source.setFolderMode) return
    setAction('mode:' + path)
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

  const browserCacheDescription = browser?.cache_bytes === undefined
    ? '浏览器未提供精确的可清理缓存字节数。'
    : '预计可释放 ' + formatBytes(browser.cache_bytes) + '。'
  const desktopCacheDescription = cache ? '预计可释放 ' + formatBytes(cache.reclaimable_bytes) + '。' : ''

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="本地存储"
      subtitle={desktop
        ? '分别管理浏览器缓存、Desktop 本地文件缓存与离线保留策略。'
        : '查看当前浏览器为 xDrive 使用的本地存储与可安全清理缓存。'}
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
        <XDriveStatePanel variant="plain" loading={loading} message={loading ? '正在加载本地存储信息…' : '暂无本地存储信息'} />
      ) : null}

      {snapshot ? (
        <Stack spacing={3}>
          <Stack spacing={1.5}>
            <XDriveSectionHeader level="h3" title="浏览器存储" subtitle={browser?.scope_label || '当前 xDrive 客户端的浏览器侧存储'} />
            {!browser?.supported ? (
              <XDriveStatusAlert tone="neutral">{browser?.reason || '当前环境不提供浏览器存储统计。'}</XDriveStatusAlert>
            ) : (
              <>
                <XDriveMetricGrid>
                  <XDriveMetricCard title="站点总占用" value={bytesOrDash(browser.total_used_bytes)} suffix={browser.total_used_bytes === undefined ? '当前环境未提供精确总量' : '当前 xDrive 站点'} />
                  <XDriveMetricCard title="浏览器配额" value={bytesOrDash(browser.quota_bytes)} suffix={browser.quota_bytes === undefined ? '由浏览器管理' : '站点可用上限'} />
                  <XDriveMetricCard title="可清理缓存" value={bytesOrDash(browser.cache_bytes)} suffix={browser.cache_bytes === undefined ? '可安全清理部分' : '不会清除登录状态'} />
                  <XDriveMetricCard title="缓存容器" value={browser.cache_entries === undefined ? '—' : browser.cache_entries.toLocaleString()} suffix={browser.cache_entries === undefined ? '当前环境未提供' : '当前站点 Cache Storage'} />
                </XDriveMetricGrid>
                <XDriveStatusAlert tone="neutral">
                  {browser.detail || '清理操作只删除可重新生成的浏览器缓存，不会清除 Cookie、登录令牌、主题、布局或其他应用偏好。'}
                </XDriveStatusAlert>
                <Box>
                  <XDriveActionButton
                    startIcon={<DeleteSweepRoundedIcon />}
                    disabled={Boolean(action) || !source.clearBrowserCache || !browserHasClearableCache}
                    onClick={() => setPendingAction('browser')}
                  >
                    清理浏览器缓存
                  </XDriveActionButton>
                </Box>
              </>
            )}
          </Stack>

          {desktop ? (
            <Stack spacing={2}>
              <XDriveSectionHeader level="h3" title="Desktop 存储" subtitle="管理 xdrive-agent 在当前设备保存的本地文件缓存；与浏览器缓存相互独立。" />
              {!desktop.supported ? (
                <XDriveStatusAlert tone="neutral">{desktop.reason || '当前 Desktop 核心组件不提供本地文件缓存管理。'}</XDriveStatusAlert>
              ) : (
                <>
                  {cache ? (
                    <>
                      <XDriveMetricGrid>
                        <XDriveMetricCard title="已使用" value={formatBytes(cache.used_bytes)} suffix={cache.cached_files.toLocaleString() + ' 个缓存文件'} />
                        <XDriveMetricCard title="上限" value={cache.limit_bytes > 0 ? formatBytes(cache.limit_bytes) : '不限'} suffix="已固定内容受保护" />
                        <XDriveMetricCard title="可释放" value={formatBytes(cache.reclaimable_bytes)} suffix={cache.reclaimable_files.toLocaleString() + ' 个文件'} />
                        <XDriveMetricCard title="已固定" value={formatBytes(cache.pinned_bytes)} suffix={cache.pinned_files.toLocaleString() + ' 个文件'} />
                      </XDriveMetricGrid>
                      {cache.supported ? (
                        <Box>
                          <XDriveActionButton
                            startIcon={<DeleteSweepRoundedIcon />}
                            disabled={Boolean(action) || cache.reclaimable_bytes <= 0 || !source.releaseDesktopCache}
                            onClick={() => setPendingAction('desktop')}
                          >
                            释放可回收 Desktop 缓存
                          </XDriveActionButton>
                        </Box>
                      ) : (
                        <XDriveStatusAlert tone="neutral">{cache.reason || '当前平台不支持持久化 Desktop 缓存管理。'}</XDriveStatusAlert>
                      )}
                    </>
                  ) : (
                    <XDriveStatePanel variant="plain" message="暂无 Desktop 缓存统计。" />
                  )}

                  <Stack spacing={1.5}>
                    <XDriveSectionHeader
                      level="h3"
                      title="文件夹本地策略"
                      subtitle={desktop.storagePoliciesSupported
                        ? '默认 / 不同步 / 始终保留'
                        : '当前平台按需访问云端内容，不提供 Windows CfAPI 本地保留策略。'}
                    />
                    {!desktop.storagePoliciesSupported ? (
                      <XDriveStatusAlert tone="neutral">
                        当前平台不提供 Windows CfAPI 的“不同步”“始终保留”或持久化本地缓存语义。
                      </XDriveStatusAlert>
                    ) : null}
                    {!desktop.storageTree ? (
                      <XDriveStatePanel variant="plain" message={desktop.reason || '暂无可配置文件夹。'} />
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
                            policySupported={desktop.storagePoliciesSupported}
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
                </>
              )}
            </Stack>
          ) : null}
        </Stack>
      ) : null}

      <XDriveConfirmDialog
        open={pendingAction !== null}
        title={pendingAction === 'browser' ? '清理浏览器缓存？' : '释放 Desktop 缓存？'}
        description={pendingAction === 'browser'
          ? browserCacheDescription + ' 只会删除可重新生成的浏览器缓存，不会清除 Cookie、登录状态、token、主题或布局偏好。'
          : desktopCacheDescription + ' 只会释放可回收的按需文件缓存；已固定或“始终保留”的内容不会删除。'}
        confirmLabel={pendingAction === 'browser' ? '清理缓存' : '释放缓存'}
        confirmIntent="warning"
        loading={action === 'browser-cache' || action === 'desktop-cache'}
        loadingLabel="正在清理…"
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (pendingAction === 'browser') void clearBrowserCache()
          else if (pendingAction === 'desktop') void releaseDesktopCache()
        }}
      />
    </XDriveWorkspaceSurface>
  )
}
