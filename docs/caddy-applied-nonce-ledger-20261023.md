# Caddy P0-05 · PostgreSQL durable Applied Receipt nonce ledger

The existing Ed25519 Applied Receipt verifier (#2449) already requires a
caller-supplied atomic nonce callback. This change implements that callback
using PostgreSQL's globally unique nonce-hash primary key and atomic
`INSERT ... ON CONFLICT DO NOTHING`, registering the new model in the normal
Server migration.

- The ledger stores a domain-separated nonce SHA-256, strictly pinned
  collector/Host/Server/operation/config/generation/key digests and consumption
  time. It stores NO raw nonce, credentials, key material, TLS proof, network
  target, certificate or private Caddy JSON.
- Duplicate nonces across two Go/Server DB handles, requests, restarts or
  different signed operations always fail closed. Errors, bad pins, missing
  PostgreSQL and canceled contexts never count as successful consumption.
- No automatic deletion or TTL GC is provided: old signed nonces cannot be
  made reusable through administrative history retention.
- Source tests exercise signature verification with genuine PostgreSQL,
  two independent connections, 24 concurrent submissions, replay after
  connection switch, tampered signatures, bad identity and nil DB.
- **This is only anti-replay infrastructure.** It does not create a Host
  Collector, generate true disabled-ingress negative evidence, sign a
  currently running Caddy generation, or publish an Applied status. No new
  HTTP/Agent/Desktop API or Caddy action is enabled. Old Server versions
  without this table must fail closed if later asked to verify Applied.

Host `~/.xd/config/.env` remains the sole current Caddy configuration
authority. Existing Host terminal receipts and recent `matching-local`
remain unsigned, not independent Applied.

Production-only safety acceptance: **按用户决定跳过（未验收）**.
Source security/race and exact-head CI remain mandatory.
