export function xDriveMediaGalleryErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  const value = String(error ?? '').trim()
  return value && value !== '[object Object]' ? value : '图库加载失败'
}

export function xDriveMediaFormatDuration(durationMS?: number) {
  if (!durationMS || durationMS < 0) return ''
  const total = Math.round(durationMS / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

