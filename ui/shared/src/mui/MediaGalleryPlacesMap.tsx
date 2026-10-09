import { useState } from 'react'
import { Autocomplete, Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import type {
  MediaPlaceFacet,
  XDriveBaiduMapProviderInfo,
  XDriveBaiduStaticMapRequest,
} from '../models'
import { XDriveMediaGalleryBaiduStaticMap } from './MediaGalleryBaiduStaticMap'

/** Only the Baidu Server API image is rendered here. The local GPS SVG map,
 * its map projection, and all offline fallback UI have been retired. */
export function XDriveMediaGalleryPlacesMap({
  places,
  getBaiduMapProvider,
  loadBaiduStaticMap,
  activePlaceID,
  onOpenPlace,
}: {
  places: MediaPlaceFacet[]
  getBaiduMapProvider?: () => Promise<XDriveBaiduMapProviderInfo>
  loadBaiduStaticMap?: (input: XDriveBaiduStaticMapRequest, signal?: AbortSignal) => Promise<Blob>
  activePlaceID?: string
  onOpenPlace?: (place: MediaPlaceFacet) => void
}) {
  const [selectedPlaceID, setSelectedPlaceID] = useState<string | null>(null)
  const selectedPlace = (
    places.find((item) => item.id === selectedPlaceID) ??
    places.find((item) => item.id === activePlaceID) ??
    places[0]
  )

  return (
    <Paper
      variant="outlined"
      data-xdrive-gallery-places-map
      sx={{ borderRadius: 2, overflow: 'hidden' }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={1}
        sx={{ px: 1.5, pt: 1.5, pb: 1 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>地图</Typography>
          <Typography variant="caption" color="text.secondary">
            仅使用百度地图 Server API
          </Typography>
        </Box>
        <Chip size="small" label={`${places.length.toLocaleString('zh-CN')} 个地点`} />
      </Stack>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={1}
        sx={{ px: 1.5, pb: 1 }}
      >
        <Autocomplete
          size="small"
          options={places}
          getOptionLabel={(place) => place.name}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          value={selectedPlace ?? null}
          onChange={(_event, place) => setSelectedPlaceID(place?.id ?? null)}
          renderInput={(params) => (
            <TextField {...params} label="选择地图地点" size="small" />
          )}
          sx={{ flex: 1, minWidth: 0 }}
        />
        {onOpenPlace ? (
          <Button variant="outlined" size="small" disabled={!selectedPlace} onClick={() => {
            if (selectedPlace) onOpenPlace(selectedPlace)
          }}>
            查看此地点照片
          </Button>
        ) : null}
      </Stack>
      <XDriveMediaGalleryBaiduStaticMap
        place={selectedPlace}
        getProvider={getBaiduMapProvider}
        loadStaticMap={loadBaiduStaticMap}
      />
    </Paper>
  )
}
