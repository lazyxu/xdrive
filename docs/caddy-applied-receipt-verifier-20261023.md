# Independent signed Caddy Applied Receipt: fail-closed verifier

A new internal Ed25519 verifier enforces canonical JSON, a domain-separated
signature, an out-of-band pinned Host/Server/Collector identity and public-key
SPKI digest, exact operation/config/generation fingerprints, positive and
negative ingress evidence, <=30 s validity, and caller-owned atomic durable
anti-replay nonce consumption. Tests cover signature tampering, stale evidence,
different generation, spoofed collector, missing negative verification and
nonce replays.

**Important:** This is verification logic, not a trusted Collector daemon or
signed Applied publication. The current Host does not yet issue such receipts;
the UI must continue to display historical `deployed` and unsigned
`matching-local` only, never `applied`. The positive/negative proof hashes
must be independently produced and trusted at a later integration boundary.

No PostgreSQL Desired authority, Docker action, AK/SK exposure or WAN claim.
Production-only environment acceptance: 按用户决定跳过（未验收）.
