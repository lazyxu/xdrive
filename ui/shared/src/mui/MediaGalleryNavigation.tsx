import { Button, Stack, Tooltip } from '@mui/material'

export type MediaGallerySection =
  | 'library'
  | 'memories'
  | 'people'
  | 'places'
  | 'albums'
  | 'favorites'
  | 'media-types'
  | 'cleanup'
  | 'trash'

type GallerySectionOption = {
  value: MediaGallerySection
  label: string
  disabled?: boolean
  disabledReason?: string
}

const gallerySections: GallerySectionOption[] = [
  { value: 'library', label: '图库' },
  { value: 'memories', label: '回忆' },
  { value: 'people', label: '人物与宠物' },
  { value: 'places', label: '地点' },
  { value: 'albums', label: '相册' },
  { value: 'favorites', label: '收藏' },
  { value: 'media-types', label: '媒体类型' },
  { value: 'cleanup', label: '清理建议' },
  { value: 'trash', label: '回收站' },
]

export function XDriveMediaGalleryNavigation({
  value,
  onChange,
  layout = 'horizontal',
}: {
  value: MediaGallerySection
  onChange: (value: MediaGallerySection) => void
  layout?: 'horizontal' | 'drawer'
}) {
  return (
    <Stack
      direction={layout === 'drawer' ? 'column' : 'row'}
      spacing={layout === 'drawer' ? 0.5 : 0.5}
      role="navigation"
      aria-label="图库导航"
      sx={{
        minWidth: 0,
        overflowX: layout === 'drawer' ? 'hidden' : 'auto',
        pb: 0.25,
        px: layout === 'drawer' ? 1.5 : undefined,
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
            sx={{
              flexShrink: 0,
              borderRadius: layout === 'drawer' ? 2 : 999,
              px: 1.5,
              justifyContent: layout === 'drawer' ? 'flex-start' : undefined,
              minHeight: layout === 'drawer' ? 48 : undefined,
              '@media (max-width:899.95px)': { minHeight: 44 },
            }}
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
