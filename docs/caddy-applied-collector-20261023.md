# Caddy Applied Collector — one continuing PR

## Phase 1 — Host-private live route candidate

- Fixed-name Linux Host Docker read retrieves bounded in-memory Caddy /config/ JSON.
- The raw JSON SHA-256 must exactly match the separately sampled running
  Caddy config fingerprint. Neither Host .env nor PostgreSQL Desired is a
  replacement for the live config.
- An HTTPS route matcher arm must contain **only the `host` key**. An
  additional `not`, `expression`, `path` or any unsupported constraint is
  unverified, even if the current host is explicitly listed.
- A current HTTPS route must have an explicit exact host matcher; unknown
  listener, wildcard, catch-all, old origin still present, changed/truncated
  config or missing current origin fails closed.
- The parsed HTTP route tree is insufficient if another Caddy App can
  independently accept TCP/TLS (for example the third-party `layer4` app).
  The candidate rejects all App names outside the built-in `http`, `tls`,
  `pki`, and `events` set. Unknown plugins are unverified, not proof that
  a retired HTTPS endpoint is disabled.
- The resulting route digest is private and **not** disabled-origin proof.

## Phase 2 — genuine bounded TLS transport candidates

- The production path uses a fixed Caddy listener: public domain SNI via
  host loopback and retired RFC1918 LAN via a Host-owned interface with the
  operator-private trusted CA. It sends only GET /api/v1/readyz, no browser
  cookies, tokens, HTTP proxy, arbitrary DNS dial, redirect or Docker action.
- A verified TLS response of 421 is at most a transport *candidate*. HTTP
  200, 401, 403, 404, 302, 503, spoofed HTML/JSON response, TLS failure,
  expired/wrong certificate, wrong CA, oversize output or timeout is UNKNOWN;
  no disabled-origin success is inferred.
- Enabled current entry TLS+Ready, bounded retired-origin TLS candidates,
  raw live route map and the Caddy Docker generation/config before and after
  run within one strictly bounded Host-private collection window. Mismatched
  fingerprints or generation, missing proof or canceled context all fail.
- Before reading any live Caddy routing fields, reject **duplicate JSON keys at
  every depth** (including escaped key aliases), excessive nesting and trailing
  JSON objects. Such ambiguous input cannot be canonical trusted route absence;
  a matching SHA alone does not resolve conflicting parser interpretations.
- Candidate structs are package-private; no new Admin/Agent/Desktop API,
  signature or Applied status is exposed. Raw Caddy JSON, network identities,
  certificates, AliDNS secrets, cookies and Host paths are not published.
- Unit and genuine synthetic TLS tests cover both current origins, wrong
  TLS roots/SANs, ambiguous statuses, certificate errors, cancellation,
  changed generation, untrusted targets and false-ready route maps.

## Phase 3 — current Host .env authority, not caller Desired

- Reuse the installed Linux Host `caddy-env-config.py snapshot` under its
  existing shared installer lock and the operator-owned fixed Host home. Reject
  symlinks, unsafe ownership/modes, missing journals/lock, redirects, arbitrary
  scripts and oversized output before invoking it; no browser/Server parameters
  or AliDNS secrets enter the collector.
- Strictly validate the Host snapshot's protocol, domain/LAN flags, canonical
  hostname/RFC1918 IP, AliDNS configuration flag, configuration SHA, freshness,
  duplicate JSON fields, unknown keys, and `pending_redeploy=false`.
- Bind authoritative current targets and their four-managed-key fingerprint
  before and after the existing positive TLS/retired-origin/live Caddy window.
  Both reads also require a stable Host `.env` **file epoch** (device, inode,
  ctime, mtime, size and mode, compared using no-follow file descriptors).
  It rejects atomic Save A→B→A when the content SHA returns to A, as well as
  in-place edits, hardlinks, unexpected replacements and stale snapshots.
  Any changed source, mismatch or pending Host edit makes the candidate
  unavailable; Windows fails closed.
- This only authenticates the **current** Host target and local Host file identity. Retired targets still
  require immutable Host-only historical provenance and true negative ingress
  proof. A Save or runtime A→B→A change between snapshots still requires a
  continuous mutation epoch before signing; do not claim Applied yet.

## Phase 4 — immutable Host-only retired target provenance

- Extend the existing **original locked Caddy Deploy commit**, not a new API,
  to read the actual pre-deployment `state/caddy-env/previous.env` while its
  confidential rollback journal still exists. Compare its managed domain/LAN
  to the new authority; archive ONLY retired domain and/or RFC1918 LAN IP.
- The Host writes an original-operation-ID-named, private `0600`,
  no-overwrite, fsynced `caddy-retired-targets/<request-id>.json` beneath an
  owner-only directory, with prior/target SHA-256 and no AliDNS, JWT, database,
  TLS private key, unrelated `.env` keys or raw rollback bytes. A second
  exact same operation may reconcile the same canonical record; conflicting or
  partial records fail closed, never silently overwritten.
- The original immutable `deployed` receipt gains only a
  `retired_targets_sha256` digest bound to its exact 24-hex Operation ID,
  target configuration SHA, Host-local generation and live configuration
  fingerprint. A terminal without the matching Host-private record is refused;
  old legacy receipts still work for historical display but cannot provide
  trusted retired-target provenance.
- Crash recovery revalidates the Host-private proof against the original
  success decision before removing any remaining journal/Active fences. A
  failed deploy cannot be upgraded to success by claiming a digest.
- A Linux-only, non-API Go reader requires the Host UID, fixed file modes,
  no symlinks/hardlinks or unsafe parent replacements, canonical bounded
  JSON, matching private SHA/Request ID/target SHA/**current Caddy generation
  and live config SHA** and an unexpired original terminal. The Go observer
  computes the exact original Host runner's domain-separated
  `xdrive.caddy.host.local-generation.v1` SHA from its fixed five-field
  Docker generation sample; the collector refuses an old terminal after a
  Caddy container recreate even when its live JSON bytes are unchanged.
  If no endpoint was truly retired, it returns unverified. Windows refuses
  the private read.
- Source tests exercise private record creation, idempotence, corruption,
  link/mode attacks, forged receipts, 7-day terminal expiry, wrong target and
  altered runtime. No network data or production credentials are needed.

### Private proof retention (source-only)

The original Host terminal archive remains capped at 64 receipts / 7 days.
After its immutable receipt publication and terminal history pruning, the Host
also scans the owner-only retired-targets directory. It removes **only** safe,
regular, single-linked 0600 private records whose 24-hex Request ID has no
retained terminal and whose private file is **older than seven days**. Recent
orphaned private records remain available for exact-ID crash recovery, and
records with a retained terminal are never removed. Symlinks, hardlinks,
unexpected owners/modes, other files and directory trees are not followed or
deleted. File and directory changes are fsynced; this cleanup does not
authorize or reclassify a Caddy deployment. Retention cleanup is also
performed only when the Host next processes a terminal; it is not a background
sweeper and should not be described as real-time deletion.

**This is provenance, not proof of negative ingress.** The original Host
receipt is local (not independently signed), the current trusted Collector
binding and Caddy memory reload continuity must still be delivered before
any Ed25519 Applied claim. Private proof retention/cleanup must remain
synchronized with immutable receipt retention before production enablement.

## Phase 5 — original-operation provenance wired into one private collection path

- The Linux Host-only `privateObserveOriginalHostIngressCandidates` derives
  the current target from the locked, no-follow `.env` snapshot, and anchors
  the preflight Caddy Docker generation/live JSON digest to its original
  Host-deployed terminal. It reads the retired domain/LAN ONLY through the
  private original Operation ID / SHA / Host-owned file verifier; the caller
  cannot pass arbitrary retired hostnames into this production path.
- The same original Host source is rechecked before/after enabled TLS Ready,
  retired TLS candidate, and live Caddy route-map observation. Both the
  Collector's bounded current generation and active JSON digest must equal
  the original immutable terminal's generation and config digest. The Host
  `.env` file epoch must still match at final recheck.
- Missing original records, stale/replayed Operation IDs, a Caddy recreate
  serving identical JSON, changed source epoch or missing positive/retired
  candidate digests all return unverified with no secret-bearing output.
  Separate operator-pinned private CA roots are required for current/retired
  LAN endpoints; old CA material is never read from a historical record.
- The fixed default `<host-home>/state/control` bridge is supported;
  installations with a customized Host Control bridge fail closed until
  their operator-owned path is independently anchored.
- This is **only a bounded proof candidate**. The preflight Caddy sample and
  the subsequent bracket can still miss an A→B→A *in-memory reload*. There
  is no continuous mutation event witness, independent trusted 421 source
  attribution, Collector signature or enabled Applied API.

## Phase 6 — read-only live Caddy reload timestamp checkpoint

- The production original-Operation Host observer now brackets the entire
  immutable terminal, current Host .env, Docker generation, TLS and route
  candidate with two independent read-only calls to Caddy Admin `/metrics`.
  It strictly reads `caddy_config_last_reload_successful` and
  `caddy_config_last_reload_success_timestamp_seconds` through fixed-name
  Host-only Docker with bounded output and zero credentials.
- Missing/duplicate/extra metrics, failed-state gauges, malformed numbers,
  future timestamps, cancellation or a changed timestamp fail closed.
  Same-JSON forced successful reload and A→B→A can therefore be detected
  during this interval even when the final config SHA matches the first.
- **Not continuous proof**: in-flight/failed reloads, gauge precision or a
  subsequent reload after the second read still require an independent
  continuous Caddy mutation fence and fresh checks at consumption.
  This private digest remains unsigned and cannot enable Applied status.
## Phase 7 — alternative HTTP/TLS ingress rejection

- The live Caddy route-absence check now rejects server-level error handlers,
  named routes and listener wrappers because they can hide a backend-generated
  `421` or an alternative TLS entry outside top-level host matchers.
- Exact-case JSON structural keys are required for apps/http/servers and
  relevant server policy fields. Go's case-insensitive struct decoding must
  never silently reinterpret a Caddy routing key; malformed aliases fail closed.
- TLS policy `fallback_sni` is never treated as a disabled-origin proof.
  `default_sni` and an explicit policy `match.sni` may name only the
  current Host-authoritative domain or LAN IPv4, never retired identities,
  a wildcard or an unknown TLS matcher.
- The existing IP-without-SNI Caddy startup behavior is not modified.
  Standard policy `[{}]` and current LAN `default_sni` remain accepted.
  Unknown/new policy semantics deliberately return unverified until reviewed.
- The parser is used on the actual private Caddy Admin live JSON before an
  unsigned retired-route candidate can succeed. Synthetic source and
  end-to-end checker tests cover backend `421`, independent named/error
  paths, SNI fallback and case-alias negatives.
- **This phase does not authenticate a network 421 by itself.** A distinct
  Caddy-origin negative responder (or equally strong independent attribution)
  plus a continuous mutation epoch remains necessary to issue Applied.

## Phase 8 — production route-bound unmatched Host candidate (replaces old 421 gate)

- Caddy's native `strict_sni_host` creates 421 for **SNI/HTTP Host mismatch**;
  the prior retired-SNI + retired-Host check could not establish that
  condition and would require a retired certificate still trusted by the
  client. It was not a trustworthy negative-ingress source.
- The real Host-only `privateObserveActualHostIngressCandidates` now uses
  `privateProbeNativeRetiredHost` for both old domain and old LAN IP.
  It dials only the current Host-authoritative local :8443 ingress, uses
  the **current** DNS public CA or current RFC1918 IP's operator-pinned CA
  to verify TLS/SAN, and sends the original immutable retired identity ONLY
  as the HTTP Host. It never performs DNS resolution, follows redirects,
  sends credentials, accepts unverified roots or permits caller-defined URLs.
- Only a bounded, plain HTTP **404 route-unmatched candidate** is considered;
  421, 200, authentication errors, redirects, HTML/JSON, cookies, oversized
  replies, wrong CA/SAN and transport failures are unverified. A plain 404
  alone remains forgeable by a backend, so the candidate is accepted ONLY
  in the existing same-generation Docker/TLS/Host-window and alongside the
  independently read, fingerprint-pinned Caddy live-route proof which forbids
  any old-host route, catchall HTTPS, named/error routes and TLS bypass.
- The existing iOS/Windows LAN IP **without SNI** behavior remains unchanged;
  no global `strict_sni_host`, no new port, Caddyfile or TLS trust bypass.
  The old-SNI 421 fixture helper is not used in production.
- Added genuine local TLS synthetic regressions for current SNI vs old
  HTTP Host, private IP SAN without SNI, wrong CA/SAN, stale/malformed Host,
  cross-origin redirects, spoofed 421, HTML/JSON 404 and cancellation.
  These are source-level tests; independently proving the fixed Host port
  belongs to the currently sampled Caddy process, an unbroken mutation
  fence, and signed current Applied still remain future work.

## Phase 9 — pin retired HTTP-Host response to the enabled TLS peer leaf

- The production `privateObserveActualHostIngressCandidates` now uses a
  dedicated package-private observer requiring the verified leaf certificate
  SHA-256 of the enabled Ready probe to equal the leaf presented by the
  retired-HTTP-Host probe **for the same current TLS identity**.
- Current domain + old domain uses today's domain/SNI certificate; current
  LAN + old LAN uses today's LAN IP SAN certificate (no SNI). If only one
  current HTTPS entry exists, old domain/IP use that entry's leaf.
- Certificate rollover, a TLS-terminating proxy substitution, an absent or
  malformed leaf digest, or a different identity cannot satisfy this
  candidate. The actual certificate bytes never appear in Web/API responses.
  The check retains existing immutable prior Host ID, TLS trust, active Caddy
  route absence, generation and reload-window requirements.
- **Not independent process attribution**: two different servers can
  possess the same leaf/private key; Caddy container PID, Docker port routing
  and continuous reload epoch still need independent trusted witnesses.
  Only a private unsigned candidate is produced; no Applied signing.

## Phase 10 — local Docker-published 8443 and Caddy process socket ownership

- The original Host-only production candidate now brackets the existing
  current verified TLS Ready + retired HTTP Host 404 + active Caddy JSON
  route check with independently sampled **fixed-name** Docker port ownership.
  The source only executes a bounded, fixed `/usr/bin/docker inspect
  --format ... xdrive-caddy`; no arbitrary Docker commands or endpoints are
  available to Server/Web/Agent. The only accepted published HTTPS path is
  current Host-authoritative IPv4 `8443 -> 443/tcp`, with optional routed
  IPv6 metadata that never substitutes for the required IPv4 path. The
  upstream Caddy image's extra `443/udp` and `2019/tcp` EXPOSE entries are
  accepted **only when unpublished (`null`)**; any actual external binding
  for those ports is unverified, not evidence of a safe HTTPS route.
- Independently inspect Linux `/proc/<Docker.State.Pid>`: the container init
  executable and comm must identify `/usr/bin/caddy`, a `443` TCP LISTEN
  socket inode must exist in its network namespace, and **that same PID**
  must actually hold that socket inode in its `fd` table. Furthermore, the
  listener must bind `0.0.0.0:443` or `[::]:443` (kernel wildcard), as the
  shipped Caddyfiles use `:443`. A 127.0.0.1-only or specific-unicast
  socket in the container cannot attest Docker's published external port.
  Linux /proc IPv4/IPv6 wildcard and loopback/unicast negative fixtures
  explicitly enforce this distinction.
  Unowned listeners, changed PID, wrong bind port/interface, failed Docker
  health, ambiguous JSON, symlinks to other processes, missing privileges,
  malformed socket tables and platform mismatch all fail closed.
- A domain-separated private digest binds Docker container ID, exact published
  mapping, host PID and owned socket inode. Compare it before and after the
  current TLS/route/generation window; any changed source is unverified.
  Real Linux synthetic /proc tree, bogus ownership, Docker dualstack,
  invalid published mapping and window drift are exercised in Go Race tests.
- This is **Host-local Caddy process/port evidence**, not proof of the
  actual network packets' destination under an independently modified NAT,
  proxy or kernel network stack. It also does not resolve continuous runtime
  reload/ABA or post-observation mutation. No Ed25519 Applied is issued.

## Phase 11 — completed Caddy Admin mutation counters (read-only checkpoint)

- The Host-only Caddy Admin `/metrics` reader captures two
  last-successful-reload gauges **and all** instrumented Admin request
  counters `caddy_admin_http_requests_total{code,handler,method,path}`
  with a fixed, read-only, in-container `awk` selector (no user arguments).
  Go strictly validates every counter's method, labels, value, uniqueness
  and length before including only `POST/PUT/PATCH/DELETE` in the mutation
  digest. Only explicitly pinned built-in `GET /metrics` and
  `GET /config/` are excluded **after validation**, ensuring the Collector's
  own read-only requests cannot falsely invalidate the candidate. Any other
  GET path and HEAD/OPTIONS are unverified as clarified in Phase 12.
- A strict bounded Go parser rejects unknown gauges/labels, unexpected
  mutations, duplicates, counter overflow, fractional/NaN values and
  oversized output. It sorts the canonical completed-write counter set,
  retaining only a private domain-separated SHA-256, never raw Admin paths.
- Compare this digest before/after the immutable original Host operation,
  TLS Ready, retired HTTP Host route, Docker listener/PID/socket ownership,
  generation and Caddy live JSON observation. A completed failed reload,
  API config write or successful A→B→A sequence changes the counter set
  even if the last-success timestamp remains equal within its resolution.
- **Still not continuous mutation proof**: a request already in flight when
  the second scrape occurs, other mutation channels not represented in
  Caddy Admin metrics, a change after the last read, a process restart,
  or a non-atomic metrics scrape require separate runtime continuity and
  fresh consumption checks. This feature cannot sign or display Applied.
  An unavailable/invalid counter sample always returns unverified.
- Unit and isolated Go Race tests include canonical order, successful
  writes, completed failed writes, same-time reload, fake label injection,
  duplicates, fractional/nonfinite/oversized counters and cancellation.

### Phase 12 — only known native Admin GET paths are ignored

- The Admin mutation parser now ignores only canonical `GET` counter series
  for `handler="metrics", path="/metrics"` or
  `handler="admin", path="/config/"` after full label/value validation.
  These are the fixed read-only API calls performed by the current Host
  observer. Other `GET` handlers/paths and any `HEAD/OPTIONS` counters
  are **unverified**, never silently assumed safe. Plugin-defined Admin
  modules could attach non-read-only behavior to a different request path.
- This narrows Phase 11 without changing Caddy Admin configuration or
  exposing a new endpoint; it prevents unknown, potentially mutating Admin
  requests from being erased by a method-only whitelist. Source regression
  exercises real Caddy documented read-only labels, plugin GET, mismatched
  handler/path, unexpected HEAD/OPTIONS and ambiguous metrics. The result
  remains private unsigned evidence, not Applied.

## Phase 13 — independent Caddy Admin error counters

- Extend the same fixed, read-only Linux Host `/metrics` collector with
  `caddy_admin_http_request_errors_total{handler,method,path}`, which
  Caddy publishes separately from `caddy_admin_http_requests_total`.
  Only correctly labeled, integral, bounded counters can be canonicalized.
  Every Admin error series is strictly parsed; error counters for
  `POST/PUT/PATCH/DELETE` contribute to the same private domain-separated
  mutation SHA as completed Admin write requests.
- As in Phase 12, only `GET` for the exact built-in
  `handler=metrics,path=/metrics` or `handler=admin,path=/config/`
  is excluded after validation. Unknown Admin GET, HEAD/OPTIONS, unexpected
  modules, malformed labels, duplicate counters and fractional/nonfinite
  values fail closed, including error counters.
- A completed rejected/failed Admin write that advances the error series
  invalidates the bounded original-Host/TLS/route/port-owner observation
  even when the last-successful reload gauge and active JSON SHA remain
  unchanged. Dedicated source-level Go Race tests cover count changes,
  canonical ordering, read errors, malformed errors, and distinct failed
  write signals. The Caddy Admin metrics endpoint remains container-private;
  no credentials, raw paths, signing key, or public API are added.
- **Limit:** the Caddy instrumentation might not record every rejected
  request, and these are completed counters, not an in-flight mutation
  fence. External changes after the final sample remain unproven.
  This is still an *unsigned Host-private candidate*, never current Applied.

## Phase 14 — Prometheus scientific counters and precision safety

- Both completed Caddy Admin request and error series accept ordinary integral
  counters or finite scientific notation such as `1e+06` and `3.2E+01`.
  Numerically equal encodings canonicalize to the same private digest so
  Prometheus presentation changes do not invalidate a stable Host observation.
- Counters must remain exactly integral and **strictly below 2^53** in
  float64. At that boundary consecutive integer increments can round to
  the same observed value and hide a real mutation. Overlarge/fractional,
  nonfinite, malformed exponent and unexpectedly labeled metrics fail closed
  instead of silently masking an Admin config change.
- Regression coverage includes request and error counters, equivalent
  decimal/scientific encodings, precision boundary and overflow. This still
  does not establish a continuous fence against in-flight or later changes.

## Phase 15 — wire Admin error metrics into the production sampler

- Accurate prior-head [CI #40075447033](https://github.com/lazyxu/xdrive/actions/runs/40075447033)
  failed on **Go Linux and Go Windows** in the same
  `TestReloadEpochRejectsCompletedAdminErrorCounterAdvance` regression.
  The Admin error counter parser and unit tests existed, but
  `privateCaddyReloadMetricScript` had not included
  `caddy_admin_http_request_errors_total`, and the outer
  `privateParseCaddyReloadEpoch` dispatch rejected valid error series.
- The Host-only fixed in-container `awk` sampler now admits both
  `caddy_admin_http_requests_total` and
  `caddy_admin_http_request_errors_total`, while the strict Go dispatcher
  accepts precisely those two series plus the two reload gauges.
  Unknown, malformed or duplicate rows remain fail-closed.
  A completed failed mutation advances the digest even if current
  Caddy JSON and last-successful reload timestamp remain identical.
- This is a **CI-backed regression fix**, verified separately with an
  isolated Go Race harness. The harness does not substitute for the
  new exact HEAD full CI, and still cannot prove an in-flight or
  subsequently completed mutation was absent at receipt consumption.
  No signed Applied claim or external Admin write API is enabled.

## Still required to issue a trusted Applied receipt

1. Bind the newly archived Host-private retired-target identity and original
   immutable local terminal to an **independently trusted Collector identity**;
   do not accept a local unsigned digest alone as signed Applied evidence.
2. Validate retired-origin negative service behavior against an independently
   defined Caddy-specific policy. A TLS 421 is not inherently a negative
   security proof; prove the response came from the current Caddy generation
   and is not a backend response or SNI/default-route bypass.
3. Introduce a Host mutation/continuity fence that detects Caddy reload,
   A→B→A ABA and runtime changes during *and after* publication.
4. Read an operator-pinned, isolated Collector signing key; bind the original
   request ID, Host/Server/Collector identities, trusted config and generation,
   observed positive/negative ingress to a canonical short-lived Ed25519
   Applied Receipt. Fail closed if any evidence is missing.
5. Consume exactly once with the merged #2463 PostgreSQL nonce ledger; serve
   only currently valid status through admin-only, no-store APIs and shared
   Web/Mobile/Desktop UI. Expiry or new runtime must immediately downgrade.
6. Run real Host/Docker, TLS, cross-Server, concurrent race and upgrade
   regressions before merging the full Collector PR.

Until all steps pass, historical "deployed" and unsigned "matching-local" are
**not** independent current Applied. Host ~/.xd/config/.env remains the only
authoritative Caddy configuration; Save and Caddy-only Redeploy stay separate.

Production-only safety acceptance: 按用户决定跳过（未验收）. Source, negative,
PostgreSQL Race, Linux/Windows and full CI tests remain mandatory.
