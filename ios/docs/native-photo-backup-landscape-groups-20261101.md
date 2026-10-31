# Native iOS photo-backup page: short-landscape groups (2026-11-01)

**Purpose:** Make the already implemented Owner-scoped native backup/receipt
controls usable on a short iPhone landscape screen without another set of
controllers, a second writer or a changed navigation level.

## Layout

- Portrait, narrow landscape, or accessibility Dynamic Type: one scrollable
  native Form in the original order (backup scope, manual start, foreground
  automatic schedule, optional background grant, uncertain receipts, backed-up
  originals shortcut, execution result).
- Short landscape with **actual safe-area width >=760 pt and height <500 pt**
  and normal Dynamic Type: two independently scrollable Forms. Left is live
  status/receipt/optional BG grant/results; right is source, manual action and
  foreground schedule settings. Divider is presentation-only. Content widths
  remain bounded; no three-column Desktop treatment.
- The native five-slot bottom navigation remains L1; orientation alone does
  not enter L2 or dismiss the backup feature.
- Seven Section bodies are defined exactly once in parent-owned builders and
  projected into only the active form arrangement. @State for interval/iCloud
  preferences and Owner-pinned consent stays on the owning screen, not on a
  disposable row or a separate view model.

## Safety/acceptance

- No changes to upload scheduling, Owner/root validation, foreground+BG
  consent, shared original writer, encrypted receipt journal, uncertain-ACK
  reconciliation, interruption rules, Server APIs or Session/Keychain.
- Parent-scoped .onAppear/.onDisappear/.onChange and every confirmation dialog
  remain on the same native backup View; layout change does not invoke
  controller.cancel(), revoke BG rights or claim successful upload.
- Existing native iOS IPA workflow's backup contract is expanded to verify
  viewport gating, both layouts, single Section ownership, original consent
  and read lifecycle.
- Exact-HEAD iPhoneOS compilation, repository CI and Final Gate must succeed
  before merge. Actual iPhone landscape/large-text/VoiceOver, authorization
  changes under rotation and SideStore verification: **跳过（未验收）**.
