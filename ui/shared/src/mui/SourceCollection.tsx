import type { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { StackProps } from '@mui/material/Stack'
import type {
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
} from '../external-sources'
import {
  externalSourceCollectionKindLabel,
  externalSourceCollectionStateLabel,
  externalSourceCollectionStateTone,
  formatExternalSourceTime,
} from '../external-sources'
import { XDriveStatusBadge } from './StatusBadge'

type XDriveSourceCollectionWideAt = 'sm' | 'md'

function responsiveDirection(wideAt: XDriveSourceCollectionWideAt): StackProps['direction'] {
  return wideAt === 'md'
    ? { xs: 'column' as const, md: 'row' as const }
    : { xs: 'column' as const, sm: 'row' as const }
}

function responsiveAlignment(wideAt: XDriveSourceCollectionWideAt): StackProps['alignItems'] {
  return wideAt === 'md'
    ? { xs: 'flex-start' as const, md: 'center' as const }
    : { xs: 'flex-start' as const, sm: 'center' as const }
}

function itemStateTone(state: string) {
  if (state === 'synced') return 'good'
  if (state === 'error') return 'bad'
  if (state === 'missing') return 'warning'
  return 'neutral'
}

function itemStateLabel(state: string) {
  if (state === 'synced') return '已同步'
  if (state === 'missing') return '远端缺失'
  if (state === 'error') return '失败'
  return state
}

export function XDriveSourceCollectionSummary({
  collection,
  wideAt = 'sm',
}: {
  collection: ExternalSourceCollection
  wideAt?: XDriveSourceCollectionWideAt
}) {
  return (
    <Stack
      direction={responsiveDirection(wideAt)}
      spacing={1}
      justifyContent="space-between"
      alignItems={responsiveAlignment(wideAt)}
      sx={{ width: '100%', pr: 1 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
          {collection.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {externalSourceCollectionKindLabel(collection.kind)}
          {' · '}{collection.item_count.toLocaleString('zh-CN')} 项
          {' · '}上次发现 {formatExternalSourceTime(collection.last_seen_at)}
        </Typography>
      </Box>
      <XDriveStatusBadge
        tone={externalSourceCollectionStateTone(collection.state)}
        label={externalSourceCollectionStateLabel(collection.state)}
      />
    </Stack>
  )
}

export function XDriveSourceCollectionItem({
  item,
  sizeLabel,
  wideAt = 'sm',
}: {
  item: ExternalSourceCollectionItem
  sizeLabel: ReactNode
  wideAt?: XDriveSourceCollectionWideAt
}) {
  return (
    <Box sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Stack
        direction={responsiveDirection(wideAt)}
        spacing={0.75}
        justifyContent="space-between"
        alignItems={responsiveAlignment(wideAt)}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
            {item.path || item.external_id}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {item.metadata?.captured_at ? '拍摄 ' + formatExternalSourceTime(item.metadata.captured_at) + ' · ' : ''}
            {sizeLabel}
            {item.metadata?.original_path ? ' · 原始路径 ' + item.metadata.original_path : ''}
          </Typography>
        </Box>
        <XDriveStatusBadge tone={itemStateTone(item.state)} label={itemStateLabel(item.state)} />
      </Stack>
    </Box>
  )
}
