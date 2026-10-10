import { useEffect, useMemo, useRef, useState } from 'react'
import { xDriveTransferActive } from '../transfers'
import type { XDriveTransferTask } from '../transfers'

/** Display cadence, not a transport throttle: bytes and task states stay live. */
export const XDRIVE_TRANSFER_SPEED_DISPLAY_MS = 2000

export type XDriveTransferRateSample = Pick<
  XDriveTransferTask,
  'instant_bytes_per_second' | 'speed_updated_at' | 'updated_at'
>

/**
 * Capture a stable speed field set. In particular keep the original freshness
 * timestamp; a new logical progress event is not a new network-byte sample.
 */
export function xDriveCaptureTransferRateSamples(
  tasks: readonly XDriveTransferTask[],
): ReadonlyMap<string, XDriveTransferRateSample> {
  return new Map(tasks.map((task) => [
    task.id,
    {
      instant_bytes_per_second: task.instant_bytes_per_second,
      speed_updated_at: task.speed_updated_at,
      updated_at: task.updated_at,
    },
  ]))
}

/**
 * Keep live metadata and byte counters, but only use the last displayed rate
 * sample. New tasks with no sample start at zero until the next display tick.
 * An unchanged sample's timestamp must not be renewed by unrelated re-renders.
 */
export function xDriveApplyTransferRateSamples(
  tasks: readonly XDriveTransferTask[],
  samples: ReadonlyMap<string, XDriveTransferRateSample>,
): XDriveTransferTask[] {
  return tasks.map((task) => {
    if (!xDriveTransferActive(task)) {
      return { ...task, instant_bytes_per_second: 0 }
    }
    const sample = samples.get(task.id)
    return {
      ...task,
      instant_bytes_per_second: sample?.instant_bytes_per_second ?? 0,
      speed_updated_at: sample?.speed_updated_at,
      updated_at: sample?.updated_at ?? '1970-01-01T00:00:00.000Z',
    }
  })
}

/** Used by both the header popover and the full Task Center. */
export function useXDriveTransferDisplayedRates(tasks: readonly XDriveTransferTask[]) {
  const latestTasks = useRef(tasks)
  latestTasks.current = tasks
  const [samples, setSamples] = useState(() => xDriveCaptureTransferRateSamples(tasks))
  const [clock, setClock] = useState(Date.now)
  const hasActive = tasks.some(xDriveTransferActive)

  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(() => {
      setSamples(xDriveCaptureTransferRateSamples(latestTasks.current))
      // Expire stale speeds even when the Agent/browser stops sending updates.
      setClock(Date.now())
    }, XDRIVE_TRANSFER_SPEED_DISPLAY_MS)
    return () => clearInterval(timer)
  }, [hasActive])

  const displayed = useMemo(
    () => xDriveApplyTransferRateSamples(tasks, samples),
    [tasks, samples],
  )
  return { tasks: displayed, now: clock }
}
