# Mobile Gallery — iOS-inspired internal chrome (P0-A)

## Shell boundary
- Keep **XDriveMobileAppHeader** unchanged: 52px, global app Back, current app title, transfer, and exactly one app switcher. No duplicate global switch in Gallery.
- **XDriveMobileGalleryChrome** belongs inside Gallery and only handles collection navigation, selection, sorting, filters, and view preferences.
- The Gallery's internal Back returns to album/place/person/memory parent. The app Back exits Gallery; the Viewer Back returns to its previous media and virtual collection anchor. These contracts remain separate.
- Tap and 450ms hold behavior remain in the existing shared Gallery/Viewer implementations.

## Mobile layout
- Gallery inner sticky action row: selection, sort menu (4 choices), filter drawer and More; a contextual collection Back only where the Gallery actually has a parent.
- Bottom fixed navigation (safe-area aware): category Drawer / Year Month Day All / Search Drawer. Categories reuse the canonical `XDriveMediaGalleryNavigation` data. The default photo wall has no permanent search input, duplicate title, 9-tab strip or density slider.
- Search and filters share the **existing Gallery draft and Server query**, rendered in the mobile filter sheet. There is no new search backend. The desktop FilterToolbar remains unchanged.
- More retains Date/Time Zone, Year/Month jump, Day jump, return anchor, crop/contain, density, duplicate folding, refresh, and existing album/person management actions.
- Selection mode hides the normal bottom tabs and docks the existing shared selection toolbar near the bottom; cancel/exit, review and batch actions remain reachable.
- Compacts at 899.95px; desktop wider view retains full shared Gallery toolbar and full sorting/filtering UI.

## Verification
- React contract tests cover top/bottom controls, categories, selection handoff, independent Back, and no duplicate app navigation.
- CI is required; real iOS Safari/Android Chrome portrait/landscape, safe area, keyboard and scroll-return QA must be recorded separately from emulation.
- No change to initial API paging/sort default belongs in this P0-A PR. P0-B introduces opt-in server-side tail positioning and a separate sort preference without traversing 100k client rows.
