// One chronology contract for the shared Gallery, date filters, Memories and Viewer.
// Server validates the same IANA identifier before using it in SQL.
export const XDRIVE_MEDIA_TIME_ZONE_KEY = 'xdrive.gallery.time-zone.v1'

export function xDriveValidMediaTimeZone(value: string): boolean {
  if (!value || value.length > 80 || !/^[A-Za-z0-9_+\/-]+$/.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function xDriveReadMediaTimeZone(): string {
  try {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(XDRIVE_MEDIA_TIME_ZONE_KEY) ?? ''
      if (xDriveValidMediaTimeZone(saved)) return saved
    }
    const system = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    return xDriveValidMediaTimeZone(system) ? system : 'UTC'
  } catch {
    return 'UTC'
  }
}

export function xDriveWriteMediaTimeZone(zone: string): boolean {
  if (!xDriveValidMediaTimeZone(zone)) return false
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(XDRIVE_MEDIA_TIME_ZONE_KEY, zone)
  } catch {
    // Storage is optional; the current mounted Gallery still uses its selected zone.
  }
  return true
}

function dateParts(date: Date, formatter: Intl.DateTimeFormat): string {
  const fields: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      fields[part.type] = part.value
    }
  }
  return `${fields.year}-${fields.month}-${fields.day}`
}

export function xDriveMediaDayKey(instant: Date | string, zone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (!Number.isFinite(date.getTime()) || !xDriveValidMediaTimeZone(zone)) return ''
  return dateParts(date, new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone,
  }))
}

function validDayKey(dayKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return false
  const date = new Date(`${dayKey}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dayKey
}

export function xDriveMediaNextDayKey(dayKey: string): string {
  if (!validDayKey(dayKey)) return ''
  const date = new Date(`${dayKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

// Binary-search the first UTC instant belonging to a local date. DST means
// that a 'day' is not always 24 hours; never add 86_400_000 to the UTC start.
export function xDriveMediaDayStartISO(dayKey: string, zone: string): string | undefined {
  if (!validDayKey(dayKey) || !xDriveValidMediaTimeZone(zone)) return undefined
  const midnight = Date.parse(`${dayKey}T00:00:00Z`)
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone,
  })
  let low = midnight - 2 * 86_400_000
  let high = midnight + 2 * 86_400_000
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2)
    if (dateParts(new Date(middle), formatter) >= dayKey) high = middle
    else low = middle
  }
  return new Date(high).toISOString()
}

export function xDriveMediaCaptureDisplay(capturedAt?: string, zone = xDriveReadMediaTimeZone()): string {
  const date = capturedAt ? new Date(capturedAt) : null
  if (!date || !Number.isFinite(date.getTime())) return '未记录'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(date)
  } catch {
    return '未记录'
  }
}

export function xDriveMediaTimeZoneChoices(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  const defaults = [
    'UTC', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo',
    'Europe/London', 'Europe/Berlin', 'America/New_York',
    'America/Los_Angeles', 'Australia/Sydney',
  ]
  const all = typeof intl.supportedValuesOf === 'function'
    ? intl.supportedValuesOf('timeZone')
    : defaults
  return Array.from(new Set([...defaults, ...all, xDriveReadMediaTimeZone()]))
    .filter(xDriveValidMediaTimeZone)
    .sort((a, b) => a.localeCompare(b))
}
