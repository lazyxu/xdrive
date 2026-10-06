const { partial } = require('filesize')

const formatIECBytes = partial({
  standard: 'iec',
  round: 1,
})

export function formatBytes(bytes: number) {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  return formatIECBytes(value)
}

export function formatBytesPerSecond(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ''
  return `${formatIECBytes(bytesPerSecond)}/s`
}
