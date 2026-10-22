import type { MediaPlaceFacet, MediaPlacesViewportBounds } from './models'

export type XDrivePlacesPrototypeCluster = Readonly<{
  id: string
  x: number
  y: number
  latitude: number
  longitude: number
  photoCount: number
  place?: MediaPlaceFacet
  coverNodeID?: number
  bbox?: MediaPlacesViewportBounds
}>

const radians = Math.PI / 180
const mercator = (latitude: number) => {
  const sine = Math.sin(Math.max(-85, Math.min(85, latitude)) * radians)
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)
}

/** First-party prototype projection of the *WGS84* Static Baidu image.
 * The server still owns all media authorization and original GPS filtering.
 * This is a visual approximation, never a new Baidu BD-09/SDK authorization. */
export function xDrivePlacesPrototypeClusters(
  places: readonly MediaPlaceFacet[],
  center: { latitude: number; longitude: number },
  zoom: number,
  width = 512, height = 512,
): XDrivePlacesPrototypeCluster[] {
  if (!Array.isArray(places) ||
      ![center?.latitude, center?.longitude, zoom, width, height].every(Number.isFinite) ||
      Math.abs(center.latitude) > 85 || Math.abs(center.longitude) > 180 ||
      zoom < 3 || zoom > 18 || width <= 0 || height <= 0) return []
  const world = 256 * Math.pow(2, zoom)
  const originX = (center.longitude + 180) / 360
  const originY = mercator(center.latitude)
  type Bucket = {
    id: string; x: number; y: number; latitude: number; longitude: number
    count: number; entries: number; place: MediaPlaceFacet
    coverNodeID?: number; south: number; north: number; west: number; east: number
  }
  const groups = new Map<string, Bucket>()
  for (const place of places) {
    if (!place || !Number.isSafeInteger(place.item_count) || place.item_count < 1 ||
        !Number.isFinite(place.sample_latitude) || !Number.isFinite(place.sample_longitude)) continue
    const latitude = place.sample_latitude!
    const longitude = place.sample_longitude!
    if (Math.abs(latitude) > 85 || Math.abs(longitude) > 180) continue
    const positionX = (longitude + 180) / 360
    // Shortest antimeridian distance relative to the current camera.
    const dx = (((positionX - originX + 1.5) % 1) + 1) % 1 - 0.5
    const x = width / 2 + dx * world
    const y = height / 2 + (mercator(latitude) - originY) * world
    if (x < 0 || x > width || y < 0 || y > height) continue
    const key = Math.floor(x / 76) + ':' + Math.floor(y / 76)
    // Each Place ID is an existing, owner-scoped 0.01-degree grid, not an
    // invented GPS position; derive the complete bin for Gallery bbox paging.
    const hit = /^place:(-?\d+):(-?\d+)$/.exec(place.id)
    const latCell = hit ? Number(hit[1]) / 100 : latitude - 0.005
    const lonCell = hit ? Number(hit[2]) / 100 : longitude - 0.005
    const south = Math.max(-90, latCell)
    const north = Math.min(90, latCell + 0.01)
    const west = Math.max(-180, lonCell)
    const east = Math.min(180, lonCell + 0.01)
    const prior = groups.get(key)
    if (prior) {
      prior.count += place.item_count
      prior.entries += 1
      prior.south = Math.min(prior.south, south)
      prior.north = Math.max(prior.north, north)
      prior.west = Math.min(prior.west, west)
      prior.east = Math.max(prior.east, east)
      if (!prior.coverNodeID && place.cover_node_id) prior.coverNodeID = place.cover_node_id
    } else {
      groups.set(key, {
        id: key, x, y, latitude, longitude,
        count: place.item_count, entries: 1, place,
        coverNodeID: place.cover_node_id,
        south, north, west, east,
      })
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 64)
    .map((item) => {
      const latSpan = item.north - item.south
      const lonSpan = item.east - item.west
      const bbox = latSpan > 0 && lonSpan > 0 && latSpan <= 20 && lonSpan <= 20
        ? { west: item.west, south: item.south, east: item.east, north: item.north }
        : undefined
      return {
        id: item.id, x: item.x, y: item.y,
        latitude: item.latitude, longitude: item.longitude,
        photoCount: item.count,
        coverNodeID: item.coverNodeID,
        ...(item.entries === 1 ? { place: item.place } : {}),
        ...(bbox ? { bbox } : {}),
      }
    })
}
