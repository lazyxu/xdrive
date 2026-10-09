export type XDriveGalleryPerformanceLongTask = {
  startTime: number
  duration: number
}

export type XDriveGalleryPerformanceLongTaskMetrics = {
  longTaskCount: number
  longTaskDurationMs: number
  longestLongTaskMs: number
  activationLongTaskCount: number
  activationLongTaskDurationMs: number
  activationLongestLongTaskMs: number
  activationLongTaskOverlapDurationMs: number
  activationLongestLongTaskOverlapMs: number
  preActivationLongTaskCount: number
  preActivationLongTaskDurationMs: number
  preActivationLongestLongTaskMs: number
}

// Legacy totals retain every buffered task. Attribution additionally distinguishes
// full overlapping task durations from time actually inside the activation window.
export function xDriveGalleryPerformanceLongTaskAttribution(
  entries: readonly XDriveGalleryPerformanceLongTask[],
  activationStart: number,
  presentationEnd: number,
): XDriveGalleryPerformanceLongTaskMetrics {
  const metrics: XDriveGalleryPerformanceLongTaskMetrics = {
    longTaskCount: entries.length,
    longTaskDurationMs: 0,
    longestLongTaskMs: 0,
    activationLongTaskCount: 0,
    activationLongTaskDurationMs: 0,
    activationLongestLongTaskMs: 0,
    activationLongTaskOverlapDurationMs: 0,
    activationLongestLongTaskOverlapMs: 0,
    preActivationLongTaskCount: 0,
    preActivationLongTaskDurationMs: 0,
    preActivationLongestLongTaskMs: 0,
  }
  for (const entry of entries) {
    const end = entry.startTime + entry.duration
    metrics.longTaskDurationMs += entry.duration
    metrics.longestLongTaskMs = Math.max(metrics.longestLongTaskMs, entry.duration)
    const beforeActivation = Math.max(0, Math.min(end, activationStart) - entry.startTime)
    if (beforeActivation > 0) {
      metrics.preActivationLongTaskCount += 1
      metrics.preActivationLongTaskDurationMs += beforeActivation
      metrics.preActivationLongestLongTaskMs = Math.max(
        metrics.preActivationLongestLongTaskMs, beforeActivation,
      )
    }
    const overlap = Math.max(
      0, Math.min(end, presentationEnd) - Math.max(entry.startTime, activationStart),
    )
    if (overlap > 0) {
      metrics.activationLongTaskCount += 1
      metrics.activationLongTaskDurationMs += entry.duration
      metrics.activationLongestLongTaskMs = Math.max(
        metrics.activationLongestLongTaskMs, entry.duration,
      )
      metrics.activationLongTaskOverlapDurationMs += overlap
      metrics.activationLongestLongTaskOverlapMs = Math.max(
        metrics.activationLongestLongTaskOverlapMs, overlap,
      )
    }
  }
  return metrics
}
