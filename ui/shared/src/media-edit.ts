import type {
  MediaEditRecipe,
  MediaEditRecipeInput,
  MediaItem,
  MediaKind,
} from './models'
import type { XDriveFilePreviewMediaTransform } from './file-preview'

export function xDriveDefaultMediaEditInput(
  mediaKind: MediaKind,
  revision = 0,
): MediaEditRecipeInput {
  return {
    revision,
    rotation_degrees: 0,
    flip_horizontal: false,
    flip_vertical: false,
    crop_x: 0,
    crop_y: 0,
    crop_width: 1,
    crop_height: 1,
    exposure_ev: 0,
    contrast: 0,
    saturation: 0,
    trim_start_ms: 0,
    trim_end_ms: 0,
  }
}

export function xDriveMediaEditInputFromRecipe(
  recipe: MediaEditRecipe | undefined,
  mediaKind: MediaKind,
): MediaEditRecipeInput {
  if (!recipe || !recipe.source_current) {
    return xDriveDefaultMediaEditInput(mediaKind, recipe?.revision || 0)
  }
  return {
    revision: recipe.revision,
    rotation_degrees: recipe.rotation_degrees,
    flip_horizontal: recipe.flip_horizontal,
    flip_vertical: recipe.flip_vertical,
    crop_x: recipe.crop_x,
    crop_y: recipe.crop_y,
    crop_width: recipe.crop_width,
    crop_height: recipe.crop_height,
    exposure_ev: recipe.exposure_ev,
    contrast: recipe.contrast,
    saturation: recipe.saturation,
    trim_start_ms: recipe.trim_start_ms,
    trim_end_ms: recipe.trim_end_ms,
  }
}

export function xDriveMediaEditPreviewTransform(
  value: MediaEditRecipe | MediaEditRecipeInput | undefined,
): XDriveFilePreviewMediaTransform | undefined {
  if (!value) return undefined
  if ('source_current' in value && !value.source_current) return undefined
  return {
    rotationDegrees: value.rotation_degrees,
    flipHorizontal: value.flip_horizontal,
    flipVertical: value.flip_vertical,
    cropX: value.crop_x,
    cropY: value.crop_y,
    cropWidth: value.crop_width,
    cropHeight: value.crop_height,
    exposureEV: value.exposure_ev,
    contrast: value.contrast,
    saturation: value.saturation,
    trimStartMS: value.trim_start_ms,
    trimEndMS: value.trim_end_ms,
  }
}

export function xDriveMediaItemSupportsBasicEditing(item: MediaItem | null | undefined) {
  if (!item) return false
  if (item.live_photo) return false
  if (item.metadata.media_kind !== 'image' && item.metadata.media_kind !== 'video') {
    return false
  }
  const kind = item.asset_kind || item.metadata.media_kind
  return kind === 'image' || kind === 'video'
}
