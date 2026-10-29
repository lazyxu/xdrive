# iOS P0: real bounded original media execution inside BGProcessingTask

This PR stacks on [#3187](https://github.com/lazyxu/xdrive/pull/3187)
to turn a grant-only BGProcessingTask into an actual **bounded attempt to
back up a still, full-size video, or complete still+motion Live ZIP**.

## What actually executes

1. At a system-admitted BGProcessingTask, read the single explicitly
   user-approved native grant from `AfterFirstUnlockThisDeviceOnly`
   Keychain; independently verify **both** installed Device secret and the
   revocable Owner/Root/Server/SessionVersion grant over HTTPS with an
   unconditional redirect-denying ephemeral URLSession. No WKWebView
   cookie, refresh JWT, or general SourceRun permission is required.
2. **Fail closed while protected data is unavailable.** Existing ledger key
   is `WhenUnlockedThisDeviceOnly`, original exported files and sealed
   ledger use `FileProtection.complete`. No silent migration or lowering of
   those security settings: this is background execution **while unlocked**,
   not verified locked-screen or force-quit unattended backup.
3. Recheck PhotoKit Full/Limited authorization, acquire the same native
   foreground/background serial gate, and reserve the Owner-scoped,
   non-secret due/cursor **before any network mutation**. No raw PHAsset ID,
   original filename, Server grant or Device secret is saved in this state.
4. Reuse **the exact same** PhotoKit scanner, resource exporter, original
   video/Live archive, AES-GCM keyed intent and journaled Go UploadSession
   writer as the visible iOS PWA. The only new branch in the writer is an
   Owner-scoped authentication envelope: either a short-lived foreground
   Web bearer or the **restricted** background grant. Neither can be used
   to execute arbitrary Desktop source paths or a different Owner Root.
5. BG work is deliberately limited to **one new complete original item**
   and one 256-item PhotoKit window per system invocation. Live counts as
   one ZIP **only after both original resources and final Server Node
   SHA/revision are proved**. A confirmed item is independently re-read
   rather than trusting an old local "uploaded" flag.
6. Before each BG UploadSession GET/POST/chunk/finalize, the native
   transport rechecks the installed grant's local Keychain ID/Root/Device
   so offline user stop immediately fences **future** network requests.
   The Go middleware independently checks remote revocation, expiry,
   current Owner/Device/Root on every scoped API call.
7. A lost create/finalize ACK remains uncertain, is not replayed blindly,
   and pauses the stored BG cursor until deliberate read-only review.
   System expiration cancels the current Swift Task; a failed job never
   returns a false successful backup receipt.

## Limits before the *full* automatic backup MVP

- The old AES-GCM ledger cap is still 1024 operations in one scope; a
  sharded journal with migration/integrity tests is required for 10k/100k
  photos. The PhotoKit offset cursor is positional, not a stable source ID.
- **This BGTask will skip media work while the phone is locked**, even
  though the dedicated approved grant is after-first-unlock accessible.
  The older ledger encryption key, file protection, PhotoKit exporter and
  staging/ZIP inputs are intentionally *not* downgraded. A user-approved
  migration with physical security regression is necessary first.
- Upload uses the same redirect-denying **ephemeral** URLSession while
  the OS is running the BGProcessingTask. It does NOT claim upload
  persistence after OS suspension or force-quit. Long-lived grant and
  Device credentials must never be placed in a redirectable system
  background file task; issue one-use per-chunk tickets first.
- Reuses the grant and Go UploadSession code in #3187. This branch ports
  the already-merged #3147 original-video/Live and foreground scheduling
  source where necessary because #3187 is still stacked on a previous
  master SHA. Once #3187 is merged/rebased, compare these source files
  before merging to avoid reintroducing older still-only logic.
- iCloud-only originals default to unavailable in the BG run, not
  downloaded without a separate explicit background iCloud approval.
- Apple owns the BGProcessingTask wake time; the next pending request
  is **only an advisory earliest time**, not a timer guarantee.

## Evidence and CI

Adds a focused Node source/contract test with checks for authorization
ordering, fail-closed protected-data, same Swift Video/Live/journal path,
local cancellation, Owner-root restrictions, one-new-item bound and
no untrusted URLSession redirect. This test must execute together with
the exact-HEAD iPhoneOS IPA, Web, Go/Owner/CAS and required CI checks
before merge.

No physical iOS/SideStore, locked-screen, iCloud, reboot/force-quit,
data-protection migration or large album validation yet:
**跳过（未验收）**. Do not report this as complete reliable
locked-screen or 100k automatic backup.
