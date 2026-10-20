# NET-M5-C2-S — Precise Caddy Host witness reasons (read-only)

## Current confirmed baseline

Prior changes #2155, #2161, #2171, #2182, #2184, #2189 and #2193 are merged in source. The operator's older System Dependencies screenshot reports a missing Caddy Host snapshot despite previously working HTTPS. GitHub source is not proof that the actual installed Server and Host Control processes were upgraded; no live host, WAN, certificate or customer data was accessed here.

## Scoped correction

The existing read-only Caddy Host observation helper already differentiates the known and allowlisted failure causes (`control-not-configured`, heartbeat missing/unreadable/invalid/stale, and snapshot missing/unreadable/invalid/stale/invalid-or-changing), but the administrator services snapshot used only Chinese summary prose. This PR exposes one optional, fixed, nonsecret `caddy_host_witness_reason` **only when the trusted Host observation is unavailable**, keeping the reason and summary from the same observation decision. It propagates over the existing Go Client/Desktop Agent JSON roundtrip and shared Web/Mobile Web/PWA/Desktop page.

The row now presents the specific blocker and tailored **read-only** operator triage rather than repeating generic "unknown". The actual host command remains `xdrive-server doctor`, whose existing diagnostics distinguish Host sampler, bind mount, numeric GID/ACL and running image. Existing older Agent versions omit the field and show the safe generic fallback. No new Browser/Server command execution, arbitrary network probe, credential revelation, writable route, trust-store change, Caddy/Docker/Compose operation, Host Apply or DNS change is added.

## Evidence and gates

- API tests: missing Host heartbeat → `heartbeat-missing`; heartbeat present but snapshot absent → `snapshot-missing`; poisoned untrusted snapshot → `snapshot-invalid-or-changing` with no secret disclosure. No case promotes installation, health, TLS or actual applied revision.
- Existing valid trusted Host observation must omit the new reason and preserve original authoritative independent status.
- Go Client roundtrip preserves the new fixed code; original Desktop source contract covers the shared UI and forbidden Host action.
- All current AGENTS history remains verbatim, with a new scoped entry prepended.

Exactly ONE scoped work commit against frozen complete master `fb2af148c1265ad1e2981bb9d76e2b0d39edd166`. Require entirely NEW exact-HEAD full 77+ CI (Linux/Windows Go and Web/Desktop, genuine PostgreSQL API Race, Rootless Caddy, installer/artifacts, Final Gate) and fresh GitHub clean mergeability before Ready/Rebase Merge. This is a source-only change; production gateway remains unverified. Keep `apply_supported=false` and the independent off-host Rescue, signing, rollback and Host Manager restrictions.
