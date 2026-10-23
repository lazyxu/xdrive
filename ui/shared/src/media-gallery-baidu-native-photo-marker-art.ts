/**
 * Neutral photo-shaped markers for Baidu JSAPI4's ORIGINAL ClusterLayer.
 * Only SDK pointCount may reach this canvas, never Owner media, URLs or GPS.
 * The 64px canvas keeps the SDK's original 64px native pick/zoom target.
 * Numbers on fallback clusters are always PLACE counts (处), never photos.
 */
const MAX_BOUNDED_OWNER_POINTS = 64

function officialPlaceCount(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const props = value as Record<string, unknown>
  const count = props.pointCount ?? props.point_count ?? props.count
  return typeof count === 'number' && Number.isSafeInteger(count) &&
    count >= 2 && count <= MAX_BOUNDED_OWNER_POINTS ? count : null
}

function roundedRect(ctx: CanvasRenderingContext2D,
  x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function drawPhotoMarker(doc: Document, caption: string | null): HTMLCanvasElement {
  const canvas = doc.createElement('canvas')
  // High-density source, 64 CSS-pixel SDK icon.
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('native_photo_marker_canvas_unavailable')
  ctx.scale(2, 2)
  ctx.save()
  ctx.shadowColor = 'rgba(15, 23, 42, 0.23)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  roundedRect(ctx, 6, 6, 52, 52, 14)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
  roundedRect(ctx, 6, 6, 52, 52, 14)
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#dbe2ec'
  ctx.stroke()

  // First-party photo pictogram, no third-party image or cached private media.
  const top = caption === null ? 20 : 13
  roundedRect(ctx, 20, top, 24, 21, 4)
  ctx.strokeStyle = '#566780'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(27, top + 7, 2.5, 0, Math.PI * 2)
  ctx.fillStyle = '#79b2ee'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(22, top + 18)
  ctx.lineTo(28, top + 12)
  ctx.lineTo(32, top + 15)
  ctx.lineTo(37, top + 10)
  ctx.lineTo(42, top + 17)
  ctx.strokeStyle = '#566780'
  ctx.stroke()
  if (caption !== null) {
    ctx.font = '600 12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#334155'
    ctx.fillText(caption, 32, 48, 44)
  }
  return canvas
}

export function xDriveCreateBaiduNativePhotoMarkerArt(doc: Document) {
  const cached = new Map<number, HTMLCanvasElement>()
  const unknown = drawPhotoMarker(doc, '地点')
  const singleIcon = drawPhotoMarker(doc, null)
  return {
    singleIcon,
    clusterIcon(properties: unknown): HTMLCanvasElement {
      const count = officialPlaceCount(properties)
      if (count === null) return unknown
      let marker = cached.get(count)
      if (!marker) {
        marker = drawPhotoMarker(doc, count + '处')
        // Owner's service bounds each frame to at most 64 SDK input points.
        cached.set(count, marker)
      }
      return marker
    },
  }
}
