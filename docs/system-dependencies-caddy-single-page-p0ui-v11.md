# Caddy HTTPS single-page v1.1 · first UI delivery

Date: 2026-10-21. Product decision: UI v1.1 approved in #2265. This scope changes the active Caddy shared MUI detail to one vertically flowing page with real-status evidence, always-mounted direct FQDN/LAN edit, AliDNS on-demand secret management, manually expanded preflight, and lazily mounted, dirty-draft-fenced history. Old status/verify/config/history links navigate to same-page anchors, not three tabs. Web/Mobile Web/iOS PWA/Desktop share the original API/Agent.

Safety: original desired HTTPS save, AliDNS encryption/30-second temporary reveal, Host read-only baseline and revision invalidation, history CAS, Docker/Host evidence separation remain. No production Caddy/8443, certificate, DNS, Router, Host Manager or independent Rescue operation. This PR intentionally exposes NO fake Apply or Restart; apply_supported=false. Local domain TLS is not WAN proof, LAN Local CA is not device trust, no Applied Receipt is synthesized.

Not yet delivered: combined HTTPS+AliDNS atomic save, independent signed Host Manager Apply, only-Caddy reload/recreate, watchdog rollback, persisted deployment operation and genuine Applied Receipt. These are separate stages from #2075 and #2253. Production-only security acceptance: 按用户决定跳过（未验收）, while source-level tests/accurate-head full CI remain mandatory.
