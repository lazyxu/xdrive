# iOS native automatic Photos: unknown-ACK enable fencing

Stacked iOS-only safety fix on the currently validated native Photos
integration; parent PR #3280's running CI and exact HEAD are unchanged.
No new writer or Server API.

## Reproduced source-level bypass
The native UI correctly pauses automatic backup on uncertain upload ACK and
offers explicit read-only reconciliation. However the current "Disable" action
removes the schedule from UserDefaults; users can then tap "Enable", which
previously called `PhotoAutoScheduleStore.configure` without first checking
the *existing encrypted receipt ledger*. That would turn auto scanning back
on even when receipts were still uncertain.

## Fix
The manual enable path verifies the exact Owner first, acquires the existing
shared original-run gate, reads the **existing** scope only (never creates a
new Keychain identity merely for validation), and rejects a paused schedule,
any pending ledger receipt, or an existing enabled schedule missing its
verifiable ledger. Reverify Owner/root, local emergency-stop generation and
PhotoKit/foreground state after the await. Release the gate before the
first `tickIfDue`, so the new schedule can obtain it normally. Manual
receipt review/resume remains separate and unchanged. A genuinely new Owner
without an existing scope may still explicitly opt in.

All unknown receipts remain encrypted and unchanged. No blind retry, silent
acknowledgment, or ledger deletion is allowed.

## Validation
`node --test desktop/tests/ios-native-photo-auto-ack-enable-guard.cjs`
is appended to the iOS native unsigned IPA workflow alongside the existing
Owner/receipt contracts. The child needs **its own** macOS IPA, CI and Final
Gate on this exact HEAD. Physical lost-ACK, disabled/re-enabled schedule and
Owner A→B→A tests remain 跳过（未验收） until exercised.
