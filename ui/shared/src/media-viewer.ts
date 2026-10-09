import {
  xDriveMediaCaptureDisplay,
  xDriveReadMediaTimeZone,
} from './media-timezone'

/** The selected Gallery IANA timezone also governs properties and standalone Viewer captions. */
export function xDriveMediaCaptureTimeValue(capturedAt?: string, timeZone = xDriveReadMediaTimeZone()) {
  return xDriveMediaCaptureDisplay(capturedAt, timeZone)
}

export function xDriveMediaCaptureTimeLabel(capturedAt?: string, timeZone = xDriveReadMediaTimeZone()) {
  return `拍摄时间：${xDriveMediaCaptureTimeValue(capturedAt, timeZone)}`
}
