/** Use canonical capture metadata; file modification/import time is a different event. */
export function xDriveMediaCaptureTimeValue(capturedAt?: string) {
  const date = capturedAt ? new Date(capturedAt) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : '未记录'
}

export function xDriveMediaCaptureTimeLabel(capturedAt?: string) {
  return `拍摄时间：${xDriveMediaCaptureTimeValue(capturedAt)}`
}
