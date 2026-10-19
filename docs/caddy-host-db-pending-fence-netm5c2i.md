# NET-M5-C2-I · PostgreSQL sticky host-apply reservation (DB-only, unapplied)

## Scope
This stage provides a **private, non-routable, database-only** precondition for a future restricted Caddy Host Manager, NOT a restart or deployment. Existing NET-M3/M4 default private IP HTTPS and optional public domain HTTPS, both-on/one-on/no-both-off behavior, UI forms, Caddy private CA and source-auth are unchanged.

A trusted future operator will first authenticate and independently verify an Ed25519 apply intent and Host Plan before invoking any database operation. The new *unexported* `stageCaddyHostDBPendingUnapplied` is NOT such operator validation. It accepts SHA-256 fingerprints (not nonce/plain secrets) and an exact expected Caddy HTTPS + AliDNS revision pair. In a PostgreSQL transaction it locks the saved desired row and, when present, the encrypted AliDNS row, verifies a valid HTTPS entry and a canonical plan SHA-256, decrypts and validates encrypted DNS-01 credentials when the domain is enabled, and inserts ONE fixed-key sticky `pending-unapplied` row. All nonce/operation/intent/plan/candidate values persist as lowercase digest only. A second request, replay, malformed digest, stale revision, corrupted credential, missing keyring or both-off state fails closed. A saved pending row is never implicitly deleted or timed out.

## What this does NOT prove
The transaction ends after the DB-only journal commit. A separate operator could then edit desired/credential rows. This stage does **NOT** fence subsequent UI edits, bind a genuine physical Host identity, consume an independently signed one-use nonce, coordinate DB with host file writes, install AliDNS secrets, start/stop Caddy, establish Rescue, arm a detached watchdog, validate enabled/disabled TLS logins or sign an applied receipt. The pending row MUST NOT be interpreted as a trust grant or production apply permit, and no Server/Agent/Web/Desktop API invokes this helper. **`apply_supported=false`, `restricted-apply=blocked` and all existing security boundaries are unchanged.** Future C2-I continuation must add an independently approved recovery/cleanup path before ever wiring a host caller.

## Verification
- Real PostgreSQL isolated-schema tests use TWO GORM connection pools and EIGHT concurrent attempts; exactly one fixed-name reservation succeeds, all others are rejected, and later replay/different operation cannot overwrite it.
- Invalid digests, old revisions and tampered plan hashes create no pending record.
- LAN-only can stage with credential revision zero and no AliDNS keyring. Domain-only requires a saved valid encrypted AliDNS pair, a matching credential revision and a working keyring; missing or incorrect keyring blocks.
- Existing production Server migrations create the new table without altering old HTTPS/credential records. No Docker, local host files, DNS, certificates or user AKs are touched.

Require this **new exact HEAD** 77+ GitHub CI including genuine PostgreSQL API Race, Linux/Windows Go/Web/Desktop, Rootless, artifacts, single-work-commit/Final Gate plus GitHub `mergeable_state=clean` before Ready/Rebase/Merge. Physical Host Apply remains NO-GO.
