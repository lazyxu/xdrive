import { useCallback, useEffect, useRef, useState } from 'react'
import type { XDriveFilePreviewPresentationState, XDriveFilePreviewTarget } from '../file-preview'

/** Readiness belongs to a source, including when an older renderer finishes late. */
export function useXDrivePreviewPresentation(target: XDriveFilePreviewTarget | null, ownerKey?: string | number) {
  // The same Node/revision can be reopened under a different authorized Owner.
  // Include a caller-owned session without changing existing Quick Look identities.
  const identity = [target?.id, target?.revision, target?.kind, target?.name]
  const sourceKey = JSON.stringify(ownerKey === undefined ? identity : [...identity, ownerKey])
  const currentKey = useRef(sourceKey)
  currentKey.current = sourceKey
  const [presentation, setPresentation] = useState<{
    sourceKey: string
    state: XDriveFilePreviewPresentationState
  } | null>(null)
  const onPresentationStateChange = useCallback((state: XDriveFilePreviewPresentationState) => {
    if (currentKey.current !== sourceKey) return
    setPresentation((current) => current?.sourceKey === sourceKey && current.state === state
      ? current : { sourceKey, state })
  }, [sourceKey])
  return {
    sourceKey,
    presentationState: presentation?.sourceKey === sourceKey ? presentation.state : 'loading' as const,
    onPresentationStateChange,
  }
}

/** Count only time for which this source is usable and the page is visible. */
export function useXDrivePreviewSlideshow({
  enabled,
  playing,
  sourceKey,
  presentationState,
  canNext,
  navigationLoading = false,
  onNext,
  onStop,
  intervalMs = 5000,
}: {
  enabled: boolean
  playing: boolean
  sourceKey: string
  presentationState: XDriveFilePreviewPresentationState
  canNext: boolean
  navigationLoading?: boolean
  onNext?: () => void
  onStop: () => void
  intervalMs?: number
}) {
  const callbacks = useRef({ onNext, onStop })
  callbacks.current = { onNext, onStop }
  const dwell = useRef<{ sourceKey: string; remaining: number; advanced: boolean } | null>(null)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  // clearTimeout alone cannot revoke callbacks already queued by the browser.
  // Rotate the identity during render, including an A→B→A that has not yet run effects.
  const timerIntentRef = useRef({ sourceKey, enabled, playing, generation: {} })
  if (timerIntentRef.current.sourceKey !== sourceKey ||
      timerIntentRef.current.enabled !== enabled ||
      timerIntentRef.current.playing !== playing) {
    timerIntentRef.current = { sourceKey, enabled, playing, generation: {} }
  }
  const timerStateRef = useRef({ sourceKey, enabled, playing, presentationState, navigationLoading, visible, canNext })
  timerStateRef.current = { sourceKey, enabled, playing, presentationState, navigationLoading, visible, canNext }
  useEffect(() => {
    if (typeof document === 'undefined') return
    const sync = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  useEffect(() => {
    if (!enabled || !playing) {
      dwell.current = null
      return
    }
    if (presentationState === 'failed') {
      callbacks.current.onStop()
      return
    }
    if (dwell.current?.sourceKey !== sourceKey) {
      dwell.current = { sourceKey, remaining: intervalMs, advanced: false }
    }
    if (presentationState !== 'ready' || !visible || navigationLoading) return
    if (!canNext || !callbacks.current.onNext) {
      callbacks.current.onStop()
      return
    }
    const current = dwell.current
    if (current.advanced) return
    const startedAt = Date.now()
    let fired = false
    const timerGeneration = timerIntentRef.current.generation
    const timer = window.setTimeout(() => {
      const latest = timerStateRef.current
      if (timerIntentRef.current.generation !== timerGeneration ||
          dwell.current !== current || current.advanced ||
          latest.sourceKey !== sourceKey || !latest.enabled || !latest.playing ||
          latest.presentationState !== 'ready' || latest.navigationLoading ||
          !latest.visible || !latest.canNext) return
      fired = true
      current.remaining = 0
      current.advanced = true
      callbacks.current.onNext?.()
    }, current.remaining)
    return () => {
      window.clearTimeout(timer)
      if (!fired) current.remaining = Math.max(0, current.remaining - Math.max(0, Date.now() - startedAt))
    }
  }, [canNext, enabled, intervalMs, navigationLoading, playing, presentationState, sourceKey, visible])
}
