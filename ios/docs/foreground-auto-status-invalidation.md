# iOS foreground auto PhotoKit status — native-authoritative refresh

This is a narrow follow-up stacked on #3248. It changes no native
PhotoKit scan, BGProcessingTask, AES-GCM journal, Owner/Root grant or Go
UploadSession/CAS writer.

When the visible shared Web/PWA scheduler finishes a *genuine* due native
`photos.auto.tick`, it now emits a browser-only invalidation event containing
only `ownerID` and `username`. It does **not** emit the short-lived Web
bearer, PhotoKit localIdentifier, filenames, private resume HMACs, upload
counts or a success flag.

The existing shared React/MUI Photos Settings listens only while mounted for
the **same** current Owner. It treats the event as untrusted: it uses the
current live Host `autoStatus(session)` call, which re-verifies the exact
Server Owner/Root natively. It updates the displayed schedule window/due time
only on a successful verified response. Owner switch, token rotation and
unmount fence stale responses; errors do not fabricate progress.

Node executable contracts test native successful ticks, non-due ticks,
cancellation/late results, scope-only event data and the shared UI's safe
authoritative re-read. No second native Login/Gallery/Photos page.

The parent #3248 exact HEAD already has active iOS IPA/full CI, so this
separate stacked Draft does **not** modify it. This PR must independently
pass Web/Node/iOS-host relevant checks after its base is accepted.
Real iPhone and 100k physical success: **跳过（未验收）**.
