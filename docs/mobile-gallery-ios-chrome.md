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

## P0-B — latest photos at the bottom (opt-in Mobile Web sort)

- **Independent sort preference:** Mobile Web uses `xdrive.gallery.mobile.sort.v1`, default `captured + asc`. Wide Web/Desktop continue `xdrive.gallery.sort.v1` and their original sort/default. A resize switches preference profiles without altering either stored value.
- **Sparse tail:** Only a first ranged request adds `initial_position=latest`. Server counts its owner/album/filter/fold scope, computes date groups, reverse-queries no more than the tail's page-aligned remainder (≤ page limit), reverses that small result, and returns `offset`, `total_count`, `anchor_index = total-1` and groups. No client loop from 0 to 100k. Subsequent `VirtualCollection`/Viewer requests do **not** carry `initial_position`.
- **Unknown captured date:** Mobile `captured + asc` opts into `unknown_first=true`. Unknown group appears before all valid capture dates in both SQL sort and timeline group indices. Wide/desktop behavior is unchanged. Added-date groups ignore unrelated missing capture EXIF.
- **Navigation:** Viewer return remembers the active Node for the same account/scope and uses the existing SQL `anchor_node_id` rank to restore its logical index. Sort changes keep the existing anchor behavior. New photos appended to the tail never implicitly reset a user viewing older dates.
- **Acceptance:** Go validation + Postgres mixed-date paging tests, shared timeline nearest-date/transport contract tests, and an optional step in the parity-preserving `go-linux-api` CI job using a real PostgreSQL 100k/115k logical/physical Gallery fixture. The 100k job logs baseline and tail first-range timings separately. Real iOS/Android device layout, keyboard, back navigation and safe-area QA remain separate and must not be reported as completed from emulation.

- **Old-photo position across Mobile app re-entry/refresh:** the Gallery records only the current visible Node ID, collection/section, and normalized query signature (no media data) for the active preference scope. The next matching entry supplies `anchor_node_id` and uses the existing SQL anchor rank instead of jumping to the new tail. A different filter, album, account or sort does not reuse that anchor. PostgreSQL tests append a later photo and verify the previously visible historical anchor remains stable.
