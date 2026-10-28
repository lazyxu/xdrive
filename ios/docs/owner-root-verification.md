# Native iOS Owner/Root verification (read-only)

The native diagnostic login uses a rotating refresh credential in Keychain.
The separately mounted PWA WKWebView owns its own same-origin browser session.
Neither session is copied into the other.

This increment adds a user-triggered **验证 Owner 与云端根目录（只读）**
action to the native diagnostic login. It validates two *existing* xDrive Go
Owner-authenticated routes with a short-lived access token held in memory:

- `GET /api/v1/me`: positive numeric Owner ID, exact current session
  username, allowed role, no mandatory password change and the nonempty
  persistent `pwa_offline_instance_id`. This instance ID is public binding
  metadata, not a credential or authorization shortcut.
- `GET /api/v1/nodes/root`: positive root Node ID, type `dir`, no parent,
  positive revision. Same exact Bearer and origin; no alternate LAN IP, token
  forwarding, redirect or bypass of system HTTPS certificate verification.

The result is **display-only, in memory**. It is discarded on native logout,
native login, token restore and failed verification. The UI explicitly states
that Device registration, local PhotoKit Root binding, backup and sync are not
implemented. If a Server omits the installation identity, do not invent one:
the result fails closed rather than permitting durable cross-installation
photo backup state.

## Remaining blockers for native backup

1. Match the native account and selected Device/Root to Server-issued identity
   and rights, not merely username or IP.
2. Build a durable encrypted account/Device/root-scoped queue. Write a stable
   operation ID / resume key **before** a request that may have committed.
3. Export PhotoKit resources only after explicit consent, then use existing
   UploadSession/chunk/finalize, validating the actual Server receipt. Live
   still and motion resources must be coherently paired.
4. On lost ACK, startup, permission change or account switch, reconcile the
   prior Owner's session before creating new work. Do not retry uncertain writes
   as a fresh operation.
5. Verify real iPhone, HTTPS LAN trust and physical upload restart behavior.
   These are **跳过（未验收）** until actually performed.

This is a native sign-in *diagnostic*, not a native/PWA single-sign-on bridge.
