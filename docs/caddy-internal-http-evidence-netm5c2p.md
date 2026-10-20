# NET-M5-C2-P — Observe a fixed internal Caddy reverse-proxy route without Host Control

## Operator symptom and source facts

An existing healthy Caddy can be reachable over HTTPS while System Dependencies reports `snapshot-missing`. The trusted `xdrive-caddy` observation requires Host Control heartbeat plus its fresh, validated Caddy status JSON and local TLS identity. Upstream #2155/#2161/#2171/#2182 repair sampling, host import and installer warning, but GitHub source alone cannot verify that a user's **running production Server** has upgraded.

## Separate weak evidence, never a replacement Host witness

When and only when the Server is using the official fixed `/host-control` mount and the trustworthy snapshot is unavailable, one admin-only service-snapshot request additionally performs a **bounded 500ms read-only HTTP GET** to the fixed Docker-internal `http://caddy:80/api/v1/readyz`, with:

- A dial target allowlist containing only `tcp caddy:80`; no browser input, dynamic target or proxy environment, no redirects, no headers carrying auth/cookies, no Docker socket/commands
- JSON response constrained to 256 bytes, HTTP 200 and `ok:true, database:ok, storage:ok`; redirects, SPA fallbacks, failures, oversize and malformed JSON fail closed
- Optional `caddy_internal_http_state=reachable|unavailable` in the shared Admin Services JSON, Go Desktop Agent DTO and shared MUI screen

A **reachable internal HTTP route** only means the fixed Docker service-name path to the Server returned the expected readiness response. It is not an authenticated Caddy process identity, installed Host Manager, Docker health, a TLS handshake or certificate chain, private IP SAN, DNS-01 credential validity, WAN reachability, an operator rescue path, or a Host-DB applied revision. Therefore `status`, `installation_state`, `health_state`, `https_configured`, TLS and `activation_state` MUST remain UNKNOWN when trusted Host evidence is missing. A negative result does not prove an existing standalone or externally managed Caddy is uninstalled or stopped. An arbitrary Caddy outside the fixed Docker service network cannot be automatically authenticated by this probe.

Separately, a syntactically valid `XD_DOMAIN` or private `XD_LAN_HTTPS_IP` in the running Server's deployment environment can mark only the **Server configuration declaration** as configured. The UI explicitly calls this a declaration with unverified live host. An unsaved admin revision `#0` is NOT proof that the older deployment had no ingress.

The shared Web/Mobile Web/PWA/Desktop service view presents this supplementary evidence without new transient loading screens or duplicate service APIs. No Host Apply, Stop/Restart, import, DNS mutation, credential transfer, TLS bypass or signed applied receipt is added: `apply_supported=false` and the gated NET-M5-C1–C4 chain remain.

## Validation and deployment

Go unit regression tests bind test-only dialers to a local HTTP server and check the fixed hostname, method, path, no credentials/proxies, exact success, SPA/redirect/503/invalid response and no false Host/TLS promotion. Client serialization and Desktop cross-source tests assert Web/Desktop parity. Source must pass full current-HEAD 77+ CI, real PostgreSQL Go API Race, Windows/Linux Go/Web/Desktop, Rootless/installers/artifacts and Final Gate before Ready/Rebase merge. Physical confirmation still requires upgrading the actual Server/Host Control and checking `xdrive-server doctor`, then independently verifying local HTTPS identity and the external login paths.