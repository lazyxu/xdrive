# iOS native PhotoKit backup -> cloud Gallery refresh

Stacked in #3290 after detecting a specific UI continuity gap. The root
PhotoKit original writer persists its encrypted receipt and reports
`uploaded` only when a new Server Node was confirmed. The cloud Gallery
previously loaded its 48-item Owner-root page only on initial mount or
manual "刷新"; if a foreground auto/manual backup completed while Gallery
was visible, the user would not see new originals without manual action.

This change adds a **read-only** `ConfirmedOriginalUpdate` notification
owned by the existing native backup controller. It is emitted only after
a completed verified original run with `result.uploaded > 0`, bound to
the exact Owner/root/Server and carrying an ephemeral UUID. No local
PhotoKit ID, token, filename, byte count or assertion of an unknown ACK
enters the event. Owner switching clears a stale notification.

The currently visible cloud original grid reacts to a same-Owner event:
reload 48-entry verified root pagination immediately if no Viewer is
present. If the full-screen signed Viewer is active, defer until
`fullScreenCover.onDismiss`, preserving playback/source selection.
Logout/Owner switch clears the pending invalidation and existing cloud
credentials before any new-Owner reload.

Existing manual cloud refresh, Owner preview-ticket checks, background
work serialization, CAS/UploadSession writer and receipt reconciliation
are unchanged. This is UI freshness, not a new backup confirmation or
duplicate upload. Source test:
`desktop/tests/ios-native-photo-cloud-confirmed-refresh.cjs`.
Exact child SHA still needs independent macOS unsigned iOS IPA, complete
applicable CI and Final Gate, with physical iPhone validation
**跳过（未验收）**.
