import { Button, Stack, Tooltip } from '@mui/material'

export type MediaGallerySection =
  | 'library'
  | 'memories'
  | 'people'
  | 'places'
  | 'albums'
  | 'favorites'
  | 'media-types'

type GallerySectionOption = {
  value: MediaGallerySection
  label: string
  disabled?: boolean
  disabledReason?: string
}

const gallerySections: GallerySectionOption[] = [
  { value: 'library', label: '图库' },
  {
    value: 'memories',
    label: '回忆',
    disabled: true,
    disabledReason: '回忆会在本地 Memories 阶段启用',
  },
  { value: 'people', label: '人物' },
  { value: 'places', label: '地点' },
  { value: 'albums', label: '相册' },
  { value: 'favorites', label: '收藏' },
  { value: 'media-types', label: '媒体类型' },
]

export function XDriveMediaGalleryNavigation({
  value,
  onChange,
}: {
  value: MediaGallerySection
  onChange: (value: MediaGallerySection) => void
}) {
  return (
    <Stack
      direction="row"
      spacing={0.5}
      role="navigation"
      aria-label="图库导航"
      sx={{
        minWidth: 0,
        overflowX: 'auto',
        pb: 0.25,
        scrollbarWidth: 'thin',
      }}
    >
      {gallerySections.map((section) => {
        const button = (
          <Button
            key={section.value}
            size="small"
            disabled={section.disabled}
            variant={value === section.value ? 'contained' : 'text'}
            aria-current={value === section.value ? 'page' : undefined}
            data-xdrive-gallery-section={section.value}
            onClick={() => onChange(section.value)}
            sx={{ flexShrink: 0, borderRadius: 999, px: 1.5 }}
          >
            {section.label}
          </Button>
        )
        if (!section.disabled || !section.disabledReason) return button
        return (
          <Tooltip key={section.value} title={section.disabledReason}>
            <span>{button}</span>
          </Tooltip>
        )
      })}
    </Stack>
  )
}
