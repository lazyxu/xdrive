import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

export type XDrivePointerDragPoint = { clientX: number; clientY: number }

type Options<Source> = {
  ownerRef: RefObject<HTMLElement | null>
  scrollHostRef: RefObject<HTMLElement | null>
  enabled: boolean
  scopeKey: string
  onMove: (source: Source, point: XDrivePointerDragPoint) => void
  onDrop: (source: Source, point: XDrivePointerDragPoint) => void
  onCancel?: (source: Source) => void
  autoScrollDelta: (pointerY: number, top: number, bottom: number) => number
}

type Session<Source> = {
  source: Source
  scopeKey: string
  pointerID: number
  owner: HTMLElement
  view: Window
  start: XDrivePointerDragPoint
  point: XDrivePointerDragPoint
  phase: 'pending' | 'dragging' | 'cancelled'
  frame: number | null
  detach: () => void
}

function stopFrame<Source>(session: Session<Source>) {
  if (session.frame !== null) session.view.cancelAnimationFrame(session.frame)
  session.frame = null
}

function releaseCapture<Source>(session: Session<Source>) {
  try {
    if (session.owner.hasPointerCapture(session.pointerID)) session.owner.releasePointerCapture(session.pointerID)
  } catch { /* The owner may have left the document during cancellation. */ }
}

function disposeSession<Source>(session: Session<Source>) {
  session.detach()
  stopFrame(session)
  releaseCapture(session)
}

// Keep only the contact ID and document after a completed/cancelled drag. Native
// touch click may arrive in a later task and use the original down coordinates.
// A new primary contact ends this guard before any new intended activation.
function consumePointerReleaseClick(document: Document, pointerID: number) {
  const view = document.defaultView
  let listening = true
  const clear = () => {
    if (!listening) return
    listening = false
    document.removeEventListener('click', click, true)
    document.removeEventListener('pointerdown', nextContact, true)
    document.removeEventListener('pointercancel', cancelled, true)
    view?.removeEventListener('pagehide', clear)
    view?.removeEventListener('blur', clear)
  }
  const click = (event: MouseEvent) => {
    if (event.detail === 0) return
    const clickID = (event as PointerEvent).pointerId
    if (clickID > 0 && clickID !== pointerID) return
    event.preventDefault()
    event.stopImmediatePropagation()
    clear()
  }
  const nextContact = (event: PointerEvent) => { if (event.isPrimary) clear() }
  const cancelled = (event: PointerEvent) => { if (event.pointerId === pointerID) clear() }
  document.addEventListener('click', click, true)
  document.addEventListener('pointerdown', nextContact, true)
  document.addEventListener('pointercancel', cancelled, true)
  view?.addEventListener('pagehide', clear)
  view?.addEventListener('blur', clear)
  return { clear }
}

/** Pointer mechanics only. Each mounted owner keeps its source, targets and mutations. */
export function useXDrivePointerDrag<Source>(options: Options<Source>) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const sessionRef = useRef<Session<Source> | null>(null)
  const releaseClickRef = useRef<null | { clear: () => void }>(null)
  const [active, setActive] = useState(false)

  const clearReleaseClick = useCallback(() => {
    releaseClickRef.current?.clear()
    releaseClickRef.current = null
  }, [])

  const suppressReleaseClick = useCallback((session: Session<Source>) => {
    clearReleaseClick()
    releaseClickRef.current = consumePointerReleaseClick(session.owner.ownerDocument, session.pointerID)
  }, [clearReleaseClick])

  const cancel = useCallback(() => {
    const session = sessionRef.current
    if (!session || session.phase === 'cancelled') return
    session.phase = 'cancelled'
    stopFrame(session)
    releaseCapture(session)
    setActive(false)
    optionsRef.current.onCancel?.(session.source)
    // Retain only this contact's release observation. A held, cancelled finger
    // must not later activate the handle or a target that moved beneath it.
  }, [])

  const refreshTarget = useCallback(() => {
    const session = sessionRef.current
    if (!session || session.phase !== 'dragging') return
    const current = optionsRef.current
    if (!current.enabled || current.scopeKey !== session.scopeKey || current.ownerRef.current !== session.owner) {
      cancel()
      return
    }
    current.onMove(session.source, session.point)
  }, [cancel])

  const begin = useCallback((event: ReactPointerEvent<HTMLElement>, source: Source) => {
    const current = optionsRef.current
    const owner = current.ownerRef.current
    const view = owner?.ownerDocument.defaultView
    if (!current.enabled || !owner || !view || event.button !== 0 || !event.isPrimary || sessionRef.current
      || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false
    clearReleaseClick()
    event.stopPropagation()
    const document = owner.ownerDocument
    const point = { clientX: event.clientX, clientY: event.clientY }
    const session: Session<Source> = {
      source, scopeKey: current.scopeKey, pointerID: event.pointerId, owner, view,
      start: point, point, phase: 'pending', frame: null, detach: () => {},
    }
    sessionRef.current = session

    const currentSession = () => {
      const latest = optionsRef.current
      if (sessionRef.current !== session || session.phase === 'cancelled') return false
      if (!latest.enabled || latest.scopeKey !== session.scopeKey || latest.ownerRef.current !== owner) {
        cancel()
        return false
      }
      return true
    }
    const scrollDelta = () => {
      const host = optionsRef.current.scrollHostRef.current
      if (!host) return { host, delta: 0 }
      const rect = host.getBoundingClientRect()
      const boundary = owner.getBoundingClientRect()
      const top = Math.max(0, rect.top, boundary.top)
      const bottom = Math.min(view.innerHeight, rect.bottom, boundary.bottom)
      const left = Math.max(0, rect.left, boundary.left)
      const right = Math.min(view.innerWidth, rect.right, boundary.right)
      const { clientX, clientY } = session.point
      const inside = clientX >= left && clientX <= right && clientY >= top && clientY <= bottom
      return { host, delta: inside ? optionsRef.current.autoScrollDelta(clientY, top, bottom) : 0 }
    }
    const frame = () => {
      session.frame = null
      if (!currentSession() || session.phase !== 'dragging') return
      const { host, delta } = scrollDelta()
      if (!host || delta === 0) return
      const before = host.scrollTop
      host.scrollTop += delta
      optionsRef.current.onMove(source, session.point)
      if (host.scrollTop !== before && currentSession()) session.frame = view.requestAnimationFrame(frame)
    }
    const update = () => {
      optionsRef.current.onMove(source, session.point)
      const { delta } = scrollDelta()
      if (delta === 0) stopFrame(session)
      else if (session.frame === null) session.frame = view.requestAnimationFrame(frame)
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== session.pointerID || !currentSession()) return
      if (!Number.isFinite(next.clientX) || !Number.isFinite(next.clientY)) return
      session.point = { clientX: next.clientX, clientY: next.clientY }
      if (session.phase === 'pending') {
        if (Math.hypot(next.clientX - session.start.clientX, next.clientY - session.start.clientY) < 8) return
        session.phase = 'dragging'
        try { owner.setPointerCapture(session.pointerID) } catch { /* Document listeners still own this contact. */ }
        setActive(true)
      }
      next.preventDefault()
      next.stopPropagation()
      update()
    }
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== session.pointerID || sessionRef.current !== session) return
      currentSession()
      const phase = session.phase
      const endPoint = { clientX: next.clientX, clientY: next.clientY }
      sessionRef.current = null
      disposeSession(session)
      setActive(false)
      if (phase !== 'pending') {
        next.preventDefault()
        next.stopPropagation()
        suppressReleaseClick(session)
      }
      if (phase === 'dragging') optionsRef.current.onDrop(source, endPoint)
    }
    const pointerCancel = (next: PointerEvent) => {
      if (next.pointerId !== session.pointerID || sessionRef.current !== session) return
      cancel()
      sessionRef.current = null
      disposeSession(session)
    }
    const secondPointer = (next: PointerEvent) => {
      if (next.pointerId === session.pointerID) return
      cancel()
      next.preventDefault()
      next.stopPropagation()
    }
    const key = (next: KeyboardEvent) => {
      if (next.key !== 'Escape') return
      next.preventDefault()
      next.stopPropagation()
      cancel()
    }
    const lostCapture = (next: PointerEvent) => {
      if (next.target === owner && next.pointerId === session.pointerID && session.phase === 'dragging') cancel()
    }
    const blur = () => {
      cancel()
      sessionRef.current = null
      disposeSession(session)
    }
    const visibility = () => { if (document.hidden) blur() }
    document.addEventListener('pointermove', move, { capture: true, passive: false })
    document.addEventListener('pointerup', finish, true)
    document.addEventListener('pointercancel', pointerCancel, true)
    document.addEventListener('pointerdown', secondPointer, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('visibilitychange', visibility)
    owner.addEventListener('lostpointercapture', lostCapture)
    view.addEventListener('blur', blur)
    session.detach = () => {
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', finish, true)
      document.removeEventListener('pointercancel', pointerCancel, true)
      document.removeEventListener('pointerdown', secondPointer, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('visibilitychange', visibility)
      owner.removeEventListener('lostpointercapture', lostCapture)
      view.removeEventListener('blur', blur)
    }
    return true
  }, [cancel, clearReleaseClick, suppressReleaseClick])

  useEffect(() => {
    const session = sessionRef.current
    if (session && (!options.enabled || session.scopeKey !== options.scopeKey || session.owner !== options.ownerRef.current)) cancel()
  }, [options.enabled, options.scopeKey, options.ownerRef, cancel])

  useEffect(() => () => {
    const session = sessionRef.current
    sessionRef.current = null
    if (session) {
      disposeSession(session)
      // Replacement UI must not inherit this held contact's eventual click.
      // The release guard retains no source, owner element or React callback.
      suppressReleaseClick(session)
    }
  }, [suppressReleaseClick])

  return { begin, active, cancel, refreshTarget }
}
