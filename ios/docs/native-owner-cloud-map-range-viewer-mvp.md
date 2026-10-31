# Native iOS Owner cloud map → PhotoAsset Range / Viewer (MVP)

This is the follow-up to merged #3366. The reader uses the existing verified Owner HTTPS bearer scope, an ephemeral cookie-free session, a 2 MiB overview limit and a capped 64-representative WGS84 map response. No independent authentication, persistence of GPS, new Server endpoint, BD-09 reinterpretation or background upload writer is introduced.

## Safety and navigation contract

- Keep the native local PhotoKit map available. The Owner cloud map is a Gallery route, not a second bottom tab.
- Refresh location-specific representatives only on explicit map refresh; Owner, scene and generation changes invalidate the old selection.
- Synthetic map-region aggregates may zoom/refine but cannot become cloud `place` Range identifiers.
- Only canonical, currently visible, verified GPS place IDs may open a fresh, bounded 48-item PhotoAsset wall using the existing Reader with `range=true`, `has_location=true` and exact `place=<id>`.
- A failed Owner/place verification must fail closed, never fallback to the unfiltered Owner photo library.
- Reuse the existing iOS Viewer, preserve its Owner change and foreground-cancel behavior, and do not restart abandoned thumbnail work while Viewer has priority.

## Verification boundary

The existing iOS unsigned IPA workflow must execute both the Foundation canonical-place policy checks and `desktop/tests/ios-native-owner-map-gallery.cjs` on this PR's **latest HEAD**, followed by full applicable PR CI and Final Gate. The parent's green checks cannot be reused. Real iPhone/VoiceOver, large-library 100k map performance and full Apple Photos map equivalence remain **not verified** until measured separately.
