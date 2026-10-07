import type { MediaPlaceFacet } from '../models'

export const XDRIVE_MEDIA_PLACES_MAP_MIN_ZOOM = 0
export const XDRIVE_MEDIA_PLACES_MAP_MAX_ZOOM = 8

export type XDriveMediaPlacesMapViewport = {
  centerLatitude: number
  centerLongitude: number
  zoom: number
}

export type XDriveMediaPlacesMapCluster = {
  key: string
  latitude: number
  longitude: number
  itemCount: number
  places: MediaPlaceFacet[]
  coverNodeID?: number
}

export function xDriveMediaPlacesClampLatitude(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(-90, Math.min(90, value))
}

export function xDriveMediaPlacesNormalizeLongitude(value: number) {
  if (!Number.isFinite(value)) return 0
  let normalized = ((value + 180) % 360 + 360) % 360 - 180
  if (normalized === -180 && value > 0) normalized = 180
  return normalized
}

export function xDriveMediaPlacesClampZoom(value: number) {
  if (!Number.isFinite(value)) return XDRIVE_MEDIA_PLACES_MAP_MIN_ZOOM
  return Math.max(
    XDRIVE_MEDIA_PLACES_MAP_MIN_ZOOM,
    Math.min(XDRIVE_MEDIA_PLACES_MAP_MAX_ZOOM, Math.round(value)),
  )
}

function minimalLongitudeArc(values: number[]) {
  if (values.length === 0) return { center: 0, span: 360 }
  if (values.length === 1) {
    return { center: xDriveMediaPlacesNormalizeLongitude(values[0]), span: 0 }
  }
  const sorted = values
    .map((value) => ((xDriveMediaPlacesNormalizeLongitude(value) + 360) % 360))
    .sort((left, right) => left - right)

  let largestGap = -1
  let largestGapIndex = 0
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]
    const next = index === sorted.length - 1 ? sorted[0] + 360 : sorted[index + 1]
    const gap = next - current
    if (gap > largestGap) {
      largestGap = gap
      largestGapIndex = index
    }
  }
  const start = sorted[(largestGapIndex + 1) % sorted.length]
  const span = Math.max(0, 360 - largestGap)
  const center360 = (start + span / 2) % 360
  return {
    center: xDriveMediaPlacesNormalizeLongitude(center360),
    span,
  }
}

export function xDriveMediaPlacesFitViewport(
  places: readonly MediaPlaceFacet[],
): XDriveMediaPlacesMapViewport {
  if (places.length === 0) {
    return { centerLatitude: 15, centerLongitude: 0, zoom: 0 }
  }
  let minLatitude = 90
  let maxLatitude = -90
  const longitudes: number[] = []
  for (const place of places) {
    const latitude = xDriveMediaPlacesClampLatitude(place.latitude)
    minLatitude = Math.min(minLatitude, latitude)
    maxLatitude = Math.max(maxLatitude, latitude)
    longitudes.push(place.longitude)
  }
  const longitudeArc = minimalLongitudeArc(longitudes)
  const latitudeSpan = Math.max(6, maxLatitude - minLatitude)
  const longitudeSpan = Math.max(10, longitudeArc.span)
  const fitScale = Math.min(
    (180 / latitudeSpan) * 0.72,
    (360 / longitudeSpan) * 0.72,
  )
  const zoom = xDriveMediaPlacesClampZoom(Math.floor(Math.log2(Math.max(1, fitScale))))
  return {
    centerLatitude: xDriveMediaPlacesClampLatitude((minLatitude + maxLatitude) / 2),
    centerLongitude: longitudeArc.center,
    zoom,
  }
}

export function xDriveMediaPlacesProject({
  latitude,
  longitude,
  viewport,
  width,
  height,
}: {
  latitude: number
  longitude: number
  viewport: XDriveMediaPlacesMapViewport
  width: number
  height: number
}) {
  const normalizedWidth = Math.max(1, Number.isFinite(width) ? width : 1)
  const normalizedHeight = Math.max(1, Number.isFinite(height) ? height : 1)
  const scale = 2 ** xDriveMediaPlacesClampZoom(viewport.zoom)
  const worldWidth = normalizedWidth * scale
  const worldHeight = normalizedHeight * scale
  const centerX = ((xDriveMediaPlacesNormalizeLongitude(viewport.centerLongitude) + 180) / 360) * worldWidth
  const centerY = ((90 - xDriveMediaPlacesClampLatitude(viewport.centerLatitude)) / 180) * worldHeight
  const rawX = ((xDriveMediaPlacesNormalizeLongitude(longitude) + 180) / 360) * worldWidth
  const rawY = ((90 - xDriveMediaPlacesClampLatitude(latitude)) / 180) * worldHeight
  const wrappedCandidates = [rawX - worldWidth, rawX, rawX + worldWidth]
  let nearestX = wrappedCandidates[0]
  for (const candidate of wrappedCandidates) {
    if (Math.abs(candidate - centerX) < Math.abs(nearestX - centerX)) {
      nearestX = candidate
    }
  }
  return {
    x: normalizedWidth / 2 + (nearestX - centerX),
    y: normalizedHeight / 2 + (rawY - centerY),
  }
}

export function xDriveMediaPlacesCluster(
  places: readonly MediaPlaceFacet[],
  zoom: number,
): XDriveMediaPlacesMapCluster[] {
  const boundedZoom = xDriveMediaPlacesClampZoom(zoom)
  const columns = 12 * 2 ** boundedZoom
  const rows = 6 * 2 ** boundedZoom
  const buckets = new Map<string, MediaPlaceFacet[]>()

  for (const place of places) {
    const longitude = xDriveMediaPlacesNormalizeLongitude(place.longitude)
    const latitude = xDriveMediaPlacesClampLatitude(place.latitude)
    const x = Math.min(columns - 1, Math.max(0, Math.floor(((longitude + 180) / 360) * columns)))
    const y = Math.min(rows - 1, Math.max(0, Math.floor(((90 - latitude) / 180) * rows)))
    const key = `${x}:${y}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(place)
    else buckets.set(key, [place])
  }

  const clusters: XDriveMediaPlacesMapCluster[] = []
  for (const [key, bucket] of buckets) {
    let weightTotal = 0
    let latitudeTotal = 0
    let longitudeTotal = 0
    let cover: MediaPlaceFacet | undefined
    for (const place of bucket) {
      const weight = Math.max(1, Math.trunc(place.item_count) || 1)
      weightTotal += weight
      latitudeTotal += xDriveMediaPlacesClampLatitude(place.latitude) * weight
      longitudeTotal += xDriveMediaPlacesNormalizeLongitude(place.longitude) * weight
      if (!cover || place.item_count > cover.item_count) cover = place
    }
    clusters.push({
      key,
      latitude: latitudeTotal / Math.max(1, weightTotal),
      longitude: xDriveMediaPlacesNormalizeLongitude(longitudeTotal / Math.max(1, weightTotal)),
      itemCount: weightTotal,
      places: [...bucket],
      coverNodeID: cover?.cover_node_id,
    })
  }

  return clusters.sort((left, right) => (
    right.itemCount - left.itemCount ||
    left.key.localeCompare(right.key)
  ))
}

export function xDriveMediaPlacesPanViewport(
  viewport: XDriveMediaPlacesMapViewport,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
): XDriveMediaPlacesMapViewport {
  const scale = 2 ** xDriveMediaPlacesClampZoom(viewport.zoom)
  const longitudeDelta = (deltaX / Math.max(1, width)) * (360 / scale)
  const latitudeDelta = (deltaY / Math.max(1, height)) * (180 / scale)
  return {
    ...viewport,
    centerLongitude: xDriveMediaPlacesNormalizeLongitude(
      viewport.centerLongitude - longitudeDelta,
    ),
    centerLatitude: xDriveMediaPlacesClampLatitude(
      viewport.centerLatitude + latitudeDelta,
    ),
  }
}
