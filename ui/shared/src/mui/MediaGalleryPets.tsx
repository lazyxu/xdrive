import { Pets as PetsIcon } from '@mui/icons-material'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import type { MediaPetFacet } from '../models'
import { XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'

type MediaThumbnailLoader = (nodeID: number) => Promise<string | null>

export function XDriveMediaGalleryPets({
  pets,
  loadThumbnail,
  onOpenPet,
}: {
  pets: MediaPetFacet[]
  loadThumbnail: MediaThumbnailLoader
  onOpenPet?: (pet: MediaPetFacet) => void
}) {
  if (pets.length === 0) return null
  return (
    <Box data-xdrive-media-gallery-pets>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={0.75}
        alignItems={{ xs: 'flex-start', sm: 'baseline' }}
        sx={{ mb: 1.25 }}
      >
        <Typography variant="subtitle1" fontWeight={700}>
          宠物
        </Typography>
        <Typography variant="caption" color="text.secondary">
          猫 / 狗类型集合 · 本地视觉识别，不区分单只宠物身份
        </Typography>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 1.5,
        }}
      >
        {pets.map((pet) => (
          <Paper
            key={pet.id}
            variant="outlined"
            role={onOpenPet ? 'button' : undefined}
            tabIndex={onOpenPet ? 0 : undefined}
            onClick={() => onOpenPet?.(pet)}
            onKeyDown={(event) => {
              if (!onOpenPet) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onOpenPet(pet)
            }}
            sx={{
              overflow: 'hidden',
              cursor: onOpenPet ? 'pointer' : 'default',
              transition: 'transform 120ms ease, box-shadow 120ms ease',
              '&:hover': onOpenPet
                ? { transform: 'translateY(-1px)', boxShadow: 2 }
                : undefined,
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              },
            }}
          >
            <Box sx={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
              <XDriveMediaAsyncThumbnail
                nodeID={pet.cover_node_id}
                alt={pet.name}
                loadThumbnail={loadThumbnail}
                fallback={(
                  <Box
                    sx={{
                      width: '100%',
                      height: '100%',
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'action.hover',
                      color: 'text.secondary',
                    }}
                  >
                    <PetsIcon sx={{ fontSize: 44 }} />
                  </Box>
                )}
              />
            </Box>
            <Stack spacing={0.5} sx={{ px: 1.5, py: 1.2 }}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography variant="body2" fontWeight={650} noWrap sx={{ flex: 1 }}>
                  {pet.name}
                </Typography>
                <Chip size="small" variant="outlined" label="类型集合" />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {pet.item_count.toLocaleString('zh-CN')} 张照片 · 本地视觉识别
              </Typography>
            </Stack>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
