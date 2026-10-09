import { useEffect, useState } from 'react'

export type XDriveMobilePanelViewport = {
  top: number
  bottom: number
  height: number
}

type ViewportDimensions = { height: number; offsetTop: number }

/** Geometry of the visible viewport inside the layout viewport; accommodates overlay keyboards. */
export function xDriveMobilePanelViewportMetrics(
  layoutHeight: number,
  viewport: ViewportDimensions | null | undefined,
): XDriveMobilePanelViewport {
  const layout = Number.isFinite(layoutHeight) ? Math.max(0, layoutHeight) : 0
  const top = viewport && Number.isFinite(viewport.offsetTop)
    ? Math.min(layout, Math.max(0, viewport.offsetTop))
    : 0
  const height = viewport && Number.isFinite(viewport.height)
    ? Math.max(0, Math.min(layout - top, viewport.height))
    : layout - top
  return {
    top: Math.floor(top),
    bottom: Math.max(0, Math.ceil(layout - top - height)),
    height: Math.floor(height),
  }
}

/** Passive observer. Never changes root viewport, document scroll or keyboard policy. */
export function useXDriveMobilePanelViewport(active: boolean) {
  const [metrics, setMetrics] = useState<XDriveMobilePanelViewport | null>(null)
  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      setMetrics(null)
      return
    }
    const viewport = window.visualViewport
    let frame: number | null = null
    const update = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        const next = xDriveMobilePanelViewportMetrics(window.innerHeight, window.visualViewport)
        setMetrics((current) => current &&
          current.top === next.top &&
          current.bottom === next.bottom &&
          current.height === next.height ? current : next)
      })
    }
    update()
    window.addEventListener('resize', update)
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [active])
  return metrics
}
