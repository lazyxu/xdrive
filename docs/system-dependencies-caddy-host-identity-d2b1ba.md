# D2b-1b-a · signed Host running-identity read-only verifier

Date: 2026-10-21. Binding contract: [System Dependencies UI v1.1](system-dependencies-ui-v1-https-8443.md) and [Host adoption #2253](https://github.com/lazyxu/xdrive/issues/2253).

## What is implemented

`internal/caddyhostidentity/verify.go` provides a **standard-library-only**, private, in-process Ed25519 verifier for a canonical, strictly bounded JSON+LF Host claim. Exactly one signature domain (`xdrive.caddy.running-identity.read-only.v1`) is accepted. The verifier requires independently pinned SHA-256 digests for **the Ed25519 SubjectPublicKeyInfo DER public key (44 bytes), Host identity and Server identity**. This DER pin matches the existing signed Host review convention; the read-only message itself is additionally domain separated. All pins must be supplied by a trusted operator/Host source, never copied from the signed document, browser, DB desired configuration or deployment environment hint.

The envelope includes Host and Server identity, fixed Caddy instance and process generation digests, nonempty Live Config fingerprint, separately claimed domain/LAN running values, per-ingress proof digests and enable/disable local-observation states, observation timestamp and expiry. Both ingress-off is invalid. Time is canonical UTC, 45s maximum, with a maximum 5s future skew. The JSON field order is alphabetic to support deterministic cross-language signing. Duplicate, reordered, unknown, null and noncanonical fields fail closed even when correctly signed.

The tests generate deterministic Ed25519 signatures and cover: pin mismatch, cross-protocol and tampered signatures, digest/instance/config absence, invalid FQDN/RFC1918 address, missing or fabricated disabled-entry state, stale/expired/future windows, extra/duplicate JSON, and inability to serialize raw private witness content.

## Deliberately NOT delivered

This is **only D2b-1b-a verifier preparation**. No independent Host Manager publisher/consumer integration is shipped; no signed evidence is currently available to the Server through this code. A signature over a claimed negative probe is **not** proof that an independent observer really checked a disabled ingress. A future D2b-1b-b must pin the real Host Manager identity and source, bind full live Caddy observation to the fixed container generation and independent positive/negative entry checks, verify safe private-file transport and source freshness, and expose only sanitized reasons from the administrator-only read endpoint.

`VerifiedReadOnly` deliberately stores **no raw witness fields at all**, because ordinary Go `%+v`/`%#v` logging would expose even unexported fields. JSON encoding and diagnostic formatting cannot disclose private FQDN/IP or Host/probe digests. It always returns `CandidateComplete=false`, `CanAdopt=false` and `ApplySupported=false`. Do not make this class an authorization primitive. No adoption POST, SQL changes, Host/Docker/DNS/ACME/CA/8443, local CA or Caddy restart is implemented; no Applied Receipt or public/WAN reachability can be inferred.

Later D2b-2 requires independently scoped Operator signature, expiring one-use nonce, both DB revisions under PostgreSQL CAS, Host Pending fences, audit rollback and simulated race/failure tests. Actual Host Apply/Rescue/watchdog and rollback remain in [#2075](https://github.com/lazyxu/xdrive/issues/2075).

Production-only acceptance: **按用户决定跳过（未验收）**. Source-level cryptographic negative tests, CI and privilege boundaries are mandatory. Only re-run CI based on actual conflicts/semantic change per the merged new `AGENTS.md` rules; this new code requires its own initial tests and CI.
