# NET-M5-U2 · Caddy dual-entry preflight fail-closed legacy state (2026-10-19)

## Existing issue
The Server intentionally supports reading historic saved Caddy desired revisions where LAN IP HTTPS and public domain HTTPS were both disabled; new saves already reject this illegal configuration. The read-only preflight, however, formerly treated any saved revision without domain HTTPS as `configuration_complete=true`. An all-off legacy record could therefore appear locally complete despite providing no valid entry.

## Narrow correction
The seven original Caddy preflight checks, read-only API shape, administrative scope, real Host Manager observation, shared Web/Mobile Web/PWA/Desktop UI, and all non-Caddy services remain unchanged. A configuration is locally complete only if a positive saved revision contains at least ONE valid selected HTTPS ingress. LAN-only requires a canonical RFC1918 IPv4, not AliDNS. Domain-only or dual-origin requires a valid FQDN and the locally decryptable encrypted AliDNS pair. Legacy both-off stays readable but is explicitly `desired=blocked`, `configuration_complete=false`; a new save or historical rollback to both-off remains rejected. Neither positive local completeness nor local TLS evidence is a true applied revision.

## Regression and boundaries
Pure Go cases cover new-install revision zero, legacy both-off, malformed LAN, LAN-only without AliDNS, domain-only with/without AliDNS, both enabled with/without AliDNS, invalid parked hostnames. The existing genuine PostgreSQL admin preflight integration fixture injects a historic both-off record, verifies no false-ready state, no `apply_supported`, unchanged seven checks, and fail-closed admin save/audit behavior. Run original full accurate-head CI (true PostgreSQL API Go Race, Go Linux/Windows, Web/Desktop, Caddy Rootless, artifacts, single-commit and Final Gate) and require fresh GitHub `mergeable_state=clean` before Ready/Rebase merge.

No new Server/Agent/Renderer route, secret exchange, Caddy file write, Docker restart, live Host/DB apply CAS, Rescue, detached watchdog or signed Applied Receipt. **Production `apply_supported=false` and `restricted-apply=blocked` remain mandatory** until independent NET-M5-C3/C4 physical acceptance. Never report configured as applied.
