/** Presentation only. Both modes reuse the same Owner Places controller. */
export type XDrivePlacesMobileMode = 'map' | 'list'

export function xDrivePlacesVisiblePanels(compact: boolean, mode: XDrivePlacesMobileMode) {
  return { map: !compact || mode === 'map', list: !compact || mode === 'list' }
}
