# D2b-1b-b1 · trusted private Host observation bundle reader (read-only)

2026-10-21. Binding sources: [System Dependencies UI v1.1](system-dependencies-ui-v1-https-8443.md), [Host adoption #2253](https://github.com/lazyxu/xdrive/issues/2253), and the strictly read-only Ed25519 verifier from [#2298](https://github.com/lazyxu/xdrive/pull/2298).

## Scope actually implemented

The standard-library-only Go 1.25 package **internal/caddyhostidentity/private_bundle.go** adds a narrowly scoped private-bundle reader. It opens a **trusted operator-provided absolute directory** with os.OpenRoot; reads only three fixed filenames (canonical JSON+LF, detached Ed25519 signature, 44-byte DER SPKI public key); bounds each read; rejects symlinks, nonregular/oversized/world-readable or group-writable files, unstable inode/mtime/size and group-writable/world-accessible roots; pins the opened directory inode and mode to the validated path; and checks the entire bundle for mutation before returning. It delegates signature/domain/time/identity validation to the existing canonical 45s Ed25519 verifier.

The Ed25519 SPKI SHA-256, Host identity SHA-256 and Server identity SHA-256 must all arrive as explicit **independently trusted caller inputs**. They cannot come from the bundle, a browser session, saved HTTPS/AliDNS desired state, deployment hints or imported Host status. No private key enters Server, HTTP, a database or this reader. A successful read returns only the zero-field VerifiedReadOnly value; its JSON, Go formatting and errors cannot expose raw FQDN, IP or Host/probe digests.

The reader deliberately fails closed on Windows until equivalent secure Host file-ACL/root-confinement verification exists; normal Windows Desktop/FileExplorer and Go APIs are unchanged. No background polling, extra REST endpoint, Host Control Runner edits, Docker, Caddy Admin, certificates, AliDNS, secrets or arbitrary administrator filename.

## Source-level negative tests

Deterministic signed fixtures cover missing/tampered signatures, wrong independent pins, malformed SPKI DER, changed identity values, oversized manifest, expired timestamp, world-readable or group-writable private file, group-writable/world-accessible directory, trusted 0750/0640 read-only group access, symlinked file/root, and nonsecret json.Marshal / Go %+v / %#v output. Fixtures never claim an actual Host observer or production validation. Exact Go/Linux/Windows/Web/Desktop, real PostgreSQL API Race, Host/Rootless and Final Gate remain CI gates once this stacked PR targets the complete merged master.

## Still blocked by design

This is only **D2b-1b-b1 private reader**. There is no trusted Host producer, independently tested positive/negative entry observer, configured Server trust-root integration, consumer in the administrator-only endpoint, signed Host adoption, Caddy deploy, Rescue, watchdog, rollback or Applied Receipt. The existing administrator GET adoption-candidate route stays fail-closed: CandidateComplete=false, CanAdopt=false, ApplySupported=false. D2b-1b-b2 must add the genuine independent producer/observer and private pinned integration; D2b-2 requires one-use signed operator authorization and PostgreSQL dual-revision CAS/audit; D2b-3 explicit confirmation; actual Caddy-only Apply remains [#2075](https://github.com/lazyxu/xdrive/issues/2075).

Production-only acceptance is **按用户决定跳过（未验收）**. Never request production accounts, credentials, AK/JWT/Cookie, HAR, capture or manual signoff, nor treat those as CI/PR blockers. Mandatory code-level crypto/filesystem checks and genuine cross-platform CI remain.
