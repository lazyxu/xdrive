# NET-M5-C2-L · Restore read-only Caddy observation on an already-deployed xDrive

## Confirmed code-level gap

The **precise** admin reason "Caddy 宿主状态快照缺失" means the Server found a fresh, regular Host Control `heartbeat` file but no `caddy-runtime-status.json` in the same trusted shared mount. It is not evidence of a stopped, broken or never-installed Caddy instance.

The xDrive installer copies a new `bin/server-control.sh` and calls `server-control.sh install`. Before this correction, `start_cmd` observed any still-live `runner.pid` and returned without updating the running Bash code. A pre-feature daemon may continue refreshing `heartbeat` indefinitely while never creating the new Caddy runtime snapshot. Calling the new Server API cannot fix this by itself.

## Compatible observer without disrupting Caddy

- The current host-control daemon records **its own script SHA-256 + PID** on startup, as a nonauthoritative freshness/version hint. On `install`/`start`, a live host runner with a missing or mismatched marker remains **untouched**; it may be processing a server upgrade.
- A separate, fixed, read-only `server-control.sh caddy-observe` process starts with a dedicated nonblocking flock. It samples **only** the existing fixed `xdrive-caddy` container via the repository's original `caddy_host_refresh`: constrained Docker inspect/exec, local TLS/certificate verification, single-generation fences, in-container config digests, and SHA-only local identity checks. It atomically refreshes the same sanitized status every 15 seconds.
- This does **not** stop/restart Caddy, change listener ports, Compose, domain, private IP, AliDNS secrets, local CA or Host Pending reservations; it cannot grant Host Apply. It must not kill or block the old update runner.
- At the next ordinary trusted new-runner start, the code marker becomes current and the supplemental observer exits on its own. Subsequent script updates cause the observer to reload the newest read-only implementation under the single-instance lock. An operator stop uses a cooperative stop marker rather than signaling an untrusted observer PID.
- If the host's Docker/openssl/curl/CA probe fails, the original Server reader and DTO stay unknown/unavailable. Never infer success from an HTTP self-proxy or an untrusted browser request.

## Dashboard and configuration semantics

The shared Web/Mobile Web/PWA/Desktop lifecycle now labels a **freshly observed** Caddy deployment as "宿主已观测", without counting any admin desired revision as applied or marking activation `verified`. Lack of observed evidence stays unknown. Caddy's external reachability and client trust of the private CA remain unverified until physical client acceptance.

A Caddy that worked *before* System Dependencies management existed can have HTTPS desired revision `#0` and AliDNS encrypted-credential revision `#0` in PostgreSQL. These denote **unmanaged in-app edits**, NOT missing host .env/DNS-01 values. Never blindly import, rotate or display host credentials; no operator consent or secret transfer is performed. Actual Host Apply and restart remain `apply_supported=false` until independent signed operator, DB↔Host CAS, verified rescue, timeout rollback watchdog, off-host both-on/one-on tests and immutable Applied Receipt are established.

## Verification

The original Bash fixture simulates a fresh legacy heartbeat and live runner PID **without** the new snapshot, verifies a standalone observer recovers a valid local status without modifying an in-progress update request, then stops it safely and confirms no duplicate observer is launched for a current runner. A Desktop shared Signal regression checks deployed-vs-unconfirmed lifecycle labels and that no false applied-revision counter is added. This is source+mock verification only, not evidence of any user's physical host state.
