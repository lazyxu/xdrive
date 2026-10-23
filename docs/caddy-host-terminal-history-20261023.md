# Caddy bounded Host terminal history for Web/Mobile/Desktop

The original Host immutable 64-record/7-day archive remains the only source
of Deploy terminal history. A new Admin-only GET returns at most 20 recent,
strictly validated, nonsecret terminals in a single-page UI. It fails closed
on symlink, malformed, oversized or untrusted result files and never presents
a historical `deployed` or unsigned `matching-local` as signed Applied.

This is not PostgreSQL long-lived revision history, credential history, or a
full operational task ledger. Other administrators may have initiated a recent
Deploy, so UI explicitly labels history as the shared Host's latest operations,
not the current browser's own request. A lost Start ACK can be investigated
without guessing/reissuing a deployment request.

Production-only acceptance: 按用户决定跳过（未验收）.
