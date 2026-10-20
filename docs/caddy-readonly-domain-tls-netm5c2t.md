# NET-M5-C2-T — Independently verify existing Caddy domain HTTPS while Host witness is missing

## Baseline / prior work

- Related Caddy fixes #2155, #2161, #2171, #2182, #2184, #2189, #2193 and #2198 are source-merged. #2198 passed full 77-job CI (25 success, 52 conditional skip, Final Gate green), clean Rebase merged and its branch was removed.
- An old xDrive installation may have correctly working public HTTPS yet a missing or unreadable trusted Host Control snapshot inside the running Server. Source merge is NOT operator-host upgrade or TLS verification.

## One additional INDEPENDENT, positive-only HTTPS witness

The already administrator-only, no-store `GET /api/v1/admin/services` checks one **strictly fixed** Compose network target `caddy:443` only when trusted Host Control observation is missing, `HostControlDir=/host-control`, and running Server environment declares a syntactically valid `XD_DOMAIN` hostname. The hostname is used for TLS SNI, certificate hostname verification and HTTP Host; it is NEVER DNS-resolved for dialing. The physical TCP dial target is always fixed `caddy:443`. Network proxy and redirects are disabled; GET is fixed to `/api/v1/readyz` with no cookies, bearer or AliDNS credentials. 650ms total client/handshake/response bound, bounded 256-byte JSON, HTTP 200, valid xDrive `ok/database/storage` required. Go public system CA trust, TLS 1.2+, verified chains and hostname are mandatory; no CA import, `InsecureSkipVerify`, custom caller roots or weak handshake fallback in production.

Only `caddy_local_domain_https_state=verified|unavailable` is added to the existing Admin service JSON and the shared Go Client/Desktop Agent and Web/Mobile Web/PWA/Desktop Caddy status UI. This constitutes a contemporaneous Server→fixed Caddy internal-network HTTPS domain endpoint check, NOT a Docker container identity/installation/health proof; NOT private IP local CA/SAN validation; NOT external WAN/other-device login; NOT an authenticated Host Control status, imported AliDNS credentials, configuration alignment or applied desired revision. All four lifecycle axes and old Host TLS fields remain unchanged until the trusted Host Manager independently verifies them. A failing or absent independent probe is NOT evidence the existing gateway stopped, especially for private-IP-only, externally managed or older deployments.

## Security/tests and implementation boundaries

A new original Go test constructs independent ephemeral ECDSA CA and DNS SAN leaf TLS certificates. Verify successful trusted CA/SNI/Ready and reject wrong SAN, wrong CA, redirects, SPA fallback, too-large body, invalid Ready, invalid domain, canceled request, nil dialer. A test callback allows only fixed `caddy:443`. Independent desktop source contract checks no insecure TLS, Docker, Host action and forwarding of optional field. Do not modify API endpoints, deployment scripts, host observer files, AliDNS/ACME, secret storage, Rootless policy or saved revision logic.

**Still NO production Caddy Apply:** `apply_supported=false`, `restricted-apply=blocked`. Before any future host control enable/disable/restart, separately complete off-host independent Rescue verification, signed revision-bound Host CAS, secret handoff, genuine atomic host configuration rollback, detached watchdog and real enabled/disabled LAN+domain TLS/admin-login acceptance. A source-only CI never proves a user-host upgrade.

Exact single work commit on complete frozen `master@33f34c69ebead94ae11948afdd4c67ba1925a2c8`, source-exact new 77+ CI including genuine PostgreSQL Go API Race, Go/Web/Desktop Linux/Windows, Rootless/installer/images and Final Gate, fresh `mergeable_state=clean` before Ready/Rebase Merge. No unrelated PR or branches touched.
