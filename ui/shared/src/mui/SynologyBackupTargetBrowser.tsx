import { useMemo } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type {
  XDriveSynologyBackupLocalClient, XDriveSynologyOwnerFileNode,
} from '../synology-backup-adapter'
import { xDriveSynologyBackupTargetDirectories } from '../synology-backup-target-directory'
import { xDriveSynologyOwnerFilesScopeKey } from '../synology-owner-files-scope'
import {
  useXDriveFileExplorerCursorDirectory,
  type XDriveFileExplorerCursorPort,
} from './FileExplorerCursorDirectoryController'

// This is a read-only capability *within the existing shared Device Backup
// page*, not a DSM-only route or a new backup engine. The same Owner cursor
// controller already drives the common Files page, including stale-response,
// identity and pagination fences.
const targetPageSize = 200
type TargetSort = { key: 'name'; direction: 'asc' }

export function XDriveSynologyBackupTargetBrowser({
  client,
}: { client: XDriveSynologyBackupLocalClient }) {
  const ownerPort = useMemo<XDriveFileExplorerCursorPort<
    XDriveSynologyOwnerFileNode, TargetSort
  >>(() => ({
    readRoot: signal => client.ownerFilesRoot(signal),
    readPage: (parentID, limit, sort, cursor, signal) =>
      client.ownerFilesPage(parentID, limit, sort.key, sort.direction, cursor, signal),
  }), [client])

  const {
    crumbs, setCrumbs, items, itemsRef,
    loadingRoot, rootError, loading, error, paging, hasMore,
    currentScopeVerified, isCurrentOwner, loadMore, refreshAuthenticatedRoot,
  } = useXDriveFileExplorerCursorDirectory({
    host: client, port: ownerPort,
    initialSort: { key: 'name', direction: 'asc' },
    scopeKeyFor: xDriveSynologyOwnerFilesScopeKey,
    limit: targetPageSize,
  })

  const parentID = crumbs[crumbs.length - 1]?.id
  const verified = currentScopeVerified && isCurrentOwner()
  const folders = typeof parentID === 'number'
    ? xDriveSynologyBackupTargetDirectories(items, parentID, verified) : []

  const openVerifiedFolder = (folder: XDriveSynologyOwnerFileNode) => {
    if (!verified || typeof parentID !== 'number' || !isCurrentOwner() ||
      !itemsRef.current.some(item =>
        item.id === folder.id && item.revision === folder.revision &&
        item.parent_id === parentID && item.type === 'dir')) return
    setCrumbs(current =>
      current[current.length - 1]?.id === parentID
        ? [...current, { id: folder.id, name: folder.name }] : current)
  }

  return (
    <Box data-xdrive-dsm-backup-target-browser sx={{
      border: 1, borderColor: 'divider', borderRadius: 1, p: 2,
    }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2" fontWeight={700}>云端备份目标目录（只读）</Typography>
        <Typography variant="body2" color="text.secondary">
          仅浏览当前 Agent 已登录的 xDrive Server Owner 云端目录。这里显示的 ID 可用于 NAS 本机
          xd backup init 的 --target-id；当前 DSM 网页尚不能创建 Source、授权 NAS 本地目录或开始新来源备份。
        </Typography>
        <Box>
          <Button size="small" startIcon={<RefreshRoundedIcon />}
            disabled={loadingRoot} onClick={refreshAuthenticatedRoot}>
            重新验证云端目录
          </Button>
        </Box>
        {rootError ? <Typography role="alert" color="error.main">{rootError}</Typography> : null}
        {loadingRoot ? <Typography role="status">正在验证当前 Owner 云端根目录…</Typography> : null}
        {crumbs.length > 0 && !rootError ? (
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
              {crumbs.map((crumb, index) => (
                <Button key={crumb.id} size="small" variant="text"
                  disabled={index === crumbs.length - 1 || !isCurrentOwner()}
                  onClick={() => {
                    if (!isCurrentOwner()) return
                    setCrumbs(current =>
                      current[index]?.id === crumb.id ? current.slice(0, index + 1) : current)
                  }}>
                  {crumb.name}
                </Button>
              ))}
            </Stack>
            {loading ? <Typography role="status">正在读取当前目录…</Typography> : null}
            {error ? <Typography role="alert" color="error.main">{error}</Typography> : null}
            {verified ? (
              <>
                <Typography variant="body2" data-xdrive-dsm-cloud-target-id={parentID}>
                  当前已验证云端目标 ID：{parentID}
                </Typography>
                {folders.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    当前已读取的目录页没有子文件夹。若有更多页，可继续加载。
                  </Typography>
                ) : (
                  <Stack alignItems="flex-start" spacing={0.5}>
                    {folders.map(folder => (
                      <Button key={folder.id} size="small" variant="text"
                        onClick={() => openVerifiedFolder(folder)}>
                        {folder.name} · ID {folder.id}
                      </Button>
                    ))}
                  </Stack>
                )}
                {hasMore ? (
                  <Box>
                    <Button size="small" variant="outlined" disabled={paging || loading}
                      onClick={loadMore}>
                      {paging ? '正在读取后续目录…' : '加载更多'}
                    </Button>
                  </Box>
                ) : null}
              </>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  )
}
