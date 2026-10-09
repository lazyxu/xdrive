/** Use canonical capture metadata; file modification/import time is a different event. */
export function xDriveMediaCaptureTimeLabel(capturedAt?: string) {
  const date = capturedAt ? new Date(capturedAt) : null
  return date && Number.isFinite(date.getTime())
    ? `拍摄时间：${date.toLocaleString()}`
    : '拍摄时间：未记录'
}
