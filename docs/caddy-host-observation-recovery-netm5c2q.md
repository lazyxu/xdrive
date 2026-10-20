# NET-M5-C2-Q — Recover missing Caddy Host witness without gateway restart

## Status and exact scope

Previous Caddy observation changes #2155/#2161/#2171/#2182/#2184 have been merged to master. The user's old screen shows a missing Caddy Host Control snapshot despite previously functional IP/domain HTTPS. The visible error is older than current source; **no GitHub merge proves the physical Server image and Host Control process were upgraded**. Do not automatically conclude that the Caddy container is missing or reinstall the certificate stack.

This update addresses a specific remaining post-upgrade blind spot: even after the installer starts Host Control and confirms actual Caddy HTTPS, it could only wait for a Server-visible snapshot and issue a warning. If the Server reports the exact fixed `snapshot-missing` or `snapshot-stale` reason, the trusted **installer**, not the admin browser or API, now runs *one bounded, single-lock read-only sampler* using the already reviewed `server-control.sh caddy-observe` with `XD_CADDY_OBSERVER_ONCE=1` and a 30-second command bound. Then the same running Server witness is rechecked. No Host service stop/start, Docker restart/Compose mutation, CA, AliDNS, .env, certificate or DNS change; no modification to Host Pending or any signed applied revision. If the Server CLI is old/missing or returns an unexpected value, no host operation is attempted. Failed observer or Server mount results in a warning, never rollback/restart of a working gateway.

## More precise `xdrive-server doctor` evidence

The doctor now reads only `Lstat/stat`-equivalent metadata (never the contents) of two fixed Host Control files: `heartbeat` and `caddy-runtime-status.json`, under the configured official Host Control directory. States are allowlisted and distinguish missing, invalid/symlink, stale and fresh (45-second freshness; up to 15-second future timestamp tolerance). Report includes no paths, domains, snapshots, credentials, container IDs or data from these files. A *fresh host file* is only evidence a file was updated; it is never proof of valid Caddy, a successful TLS handshake, or an applied revision.

The doctor independently invokes `xdrive-server caddy-host witness-check` inside the **running Server**. The fixed correlation messages distinguish:

- **host-snapshot-not-produced:** host snapshot absent; inspect the Host Control producer, without stopping Caddy
- **host-snapshot-present-server-unreadable:** host file metadata exists, but running Server says absent/unreadable; inspect Docker `/host-control` bind mount, permissions and server GID
- **host-snapshot-stale:** sampling is not keeping up; inspect main/compatibility observer cadence
- **running-server-witness-cli-unavailable:** old/misrouted/unavailable binary; verify the actual deployed Server image, not merely GitHub source

The doctor's prior untrusted Server stdout remains strictly reason-allowlisted. No arbitrary Server stdout and no raw host snapshot is printed, and no remediation occurs during doctor. A failed check is not evidence Caddy was never deployed.

## Admin UI and validation

Shared Web/Mobile Web/PWA/Desktop System Dependencies adds a short instruction when trusted Host observation is unknown, advising the **actual host** `xdrive-server doctor` while preserving the separate weak fixed internal HTTP reachability signal added by #2184. The status/installation/health/TLS/activation axes cannot be upgraded by a host file's mere presence or a successful HTTP proxy request. `apply_supported=false` and the NET-M5-C1–C4 operator Rescue/rollback gates remain unchanged.

Original installer/Doctor Bash and Desktop contract tests check the bounded and one-time sampling path, host vs Server mismatch, stale evidence and poisoned snapshot text. CI must pass on the **exact single scoped work commit** including real PostgreSQL API Go Race, Go/Linux/Windows, Web/Desktop, Rootless Caddy, installer/build packages, Final Gate and current GitHub `mergeable_state=clean` before Ready/Rebase.

Production still requires a real user-host upgrade, `xdrive-server doctor`, trusted local LAN/domain TLS verification, and external-device HTTPS/login validation. Code-only results must never be called a live production fix.
