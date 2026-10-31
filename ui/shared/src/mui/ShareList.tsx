import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import {
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { FileShare } from '../models'
import { XDriveActionButton } from './ActionButton'
import { XDriveShareStatusBadge } from './ShareStatusBadge'
import { XDriveTableSurface } from './TableSurface'

export type XDriveShareListVariant = 'table' | 'compact'

function protectionLabel(share: FileShare, compact: boolean) {
  if (share.has_password) return compact ? '密码保护' : '密码'
  return '仅链接'
}

function expiryLabel(share: FileShare, compact: boolean) {
  if (!share.expires_at) return '永不过期'
  const value = new Date(share.expires_at).toLocaleString()
  return compact ? `到期时间 ${value}` : value
}

function accessLabel(share: FileShare) {
  return share.access === 'view_upload' ? '查看 + 上传' : '只读'
}

export function XDriveShareList({
  shares,
  variant = 'table',
  revokeDisabled = false,
  onEdit,
  onRevoke,
}: {
  shares: FileShare[]
  variant?: XDriveShareListVariant
  revokeDisabled?: boolean
  onEdit?: (share: FileShare) => void
  onRevoke: (share: FileShare) => void | Promise<void>
}) {
  if (variant === 'compact') {
    return (
      <Box sx={{ display: 'grid' }}>
        {shares.map((share, index) => (
          <Stack
            key={share.id}
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.75}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
            sx={{
              minHeight: 58,
              px: 1.75,
              py: 1.25,
              borderTop: index === 0 ? 0 : 1,
              borderColor: 'divider',
            }}
          >
            <Box sx={{ minWidth: 0, display: 'grid', gap: 0.375 }}>
              <XDriveShareStatusBadge status={share.status} />
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                {protectionLabel(share, true)}
                {' · '}{expiryLabel(share, true)}
                {' · '}{accessLabel(share)} · 下载不限次
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
            {onEdit && share.status !== 'revoked' ? <XDriveActionButton compact
              onClick={() => onEdit(share)}>编辑</XDriveActionButton> : null}
            <XDriveActionButton
              compact
              intent="danger"
              disabled={revokeDisabled || share.status === 'revoked'}
              onClick={() => void onRevoke(share)}
            >
              撤销
            </XDriveActionButton>
            </Stack>
          </Stack>
        ))}
      </Box>
    )
  }

  return (
    <XDriveTableSurface>
      <Table size="small" aria-label="已有分享">
        <TableHead>
          <TableRow>
            <TableCell>创建时间</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>保护方式</TableCell>
            <TableCell>过期时间</TableCell>
            <TableCell>访问权限</TableCell>
            <TableCell align="right">操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {shares.map((share) => (
            <TableRow key={share.id} hover>
              <TableCell>{new Date(share.created_at).toLocaleString()}</TableCell>
              <TableCell><XDriveShareStatusBadge status={share.status} /></TableCell>
              <TableCell>{protectionLabel(share, false)}</TableCell>
              <TableCell>{expiryLabel(share, false)}</TableCell>
              <TableCell>{accessLabel(share)}</TableCell>
              <TableCell align="right">
                {onEdit && share.status !== 'revoked' ? (
                  <XDriveActionButton compact startIcon={<EditOutlinedIcon />}
                    onClick={() => onEdit(share)}>编辑</XDriveActionButton>
                ) : null}
                <XDriveActionButton
                  compact
                  intent="danger"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  disabled={revokeDisabled || share.status === 'revoked'}
                  onClick={() => void onRevoke(share)}
                >
                  撤销
                </XDriveActionButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </XDriveTableSurface>
  )
}
