# xDrive Release Bundle — P0/P1/P2 single-PR acceptance

This is the operator acceptance checklist for the **single** Release Bundle
closeout PR. A merged source test, GitHub Actions green job, a published GitHub
asset, a cached package, and an installation on a real machine are five
**different** proof levels. Never label a physical check as passed based on
a unit test or a mocked installer.

## Invariants (do not weaken)

- Full lowercase **40-hex source Git Commit** is the Bundle ID.
- The running Server remains authoritative; no historical version picker and
  **no forced or synchronized client upgrade**. Missing platforms are valid.
- Authenticated local Server cache (if verified) → exact-source GitLab →
  exact-source GitHub as a last resort; each package retains its SHA-256.
- Client mirrors, partial downloads, signing failures and retry errors cannot
  fail or roll back an otherwise healthy Server upgrade.
- All native installs require explicit user request and OS admission.
  `manual_test_only` IPA/APK/unsigned Windows assets never automatically
  become normal signed releases. Personal Windows unsigned consent is separate
  and never bypasses SHA-256, exact Commit or OS installation admission.
- Do not mask the post-publish SHA-256/Sigstore gate or weaken OS checks.
  Owner token must never be sent to GitHub/GitLab or printed in logs.

## Acceptance order and evidence

| ID | Priority | Verification / completion evidence | Execution |
| --- | --- | --- | --- |
| R01 | Deferred | Platform Release Immutability is temporarily unsupported as a mandatory gate; `immutable:false` is allowed, never described as immutable. | Future admin decision |
| R02 | P0 | Independent `verify-published-bundle` / on-demand acceptance checks exact SHA, raw Manifest bytes, complete asset inventory, SHA-256 and Sigstore without requiring platform immutable flag. | GitHub CI |
| R03 | P0 | Installed Host `XD_RELEASE_COMMIT`, verified cached disk bytes, authenticated Owner API, real two-Range resumed download SHA-256 and unauthenticated 401/403 on metadata and cached file. | Authorized real Host |
| R04 | P0 | Windows personal unsigned consent; actual EXE download/install, process exit/restart; installed `xd`, authenticated Agent and launched Electron each report the exact target Commit; deliberately failed post-install verification rolls back to last known good. | Windows device |
| R05 | P0 | Real Linux `pkexec`/PolicyKit prompt, DEB install, `xd`, Agent and Desktop source Commit, restart, denied permission, interrupted install and recovery. | Linux desktop |
| R06 | P0 | Remove optional client package; GitLab 404, corrupt SHA, offline network and cache worker failure; Server transaction still succeeds/rolls back on **Server** health alone. Partial verified clients remain usable. | Host staging |
| R07 | P1 | Safe GitLab fast-forward, current exact Package API + Release links, mirror bytes and GitLab 404 → GitHub fallback. Record pipeline URL and digest evidence; #3966 remains tracked. | GitLab+Host (external) |
| R08 | P1 | DSM Package Center install/upgrade on target NAS, backup state and data retained, Agent launch and Owner status working. | NAS device |
| R09 | P1 | Host `XD_RELEASE_BUNDLE_VERIFY_SIGSTORE=required` with trusted GH CLI: signer workflow, source digest and repo ID pinned. Missing GH or invalid signature rejects **only cache**; signed mutable Release allowed. | Authorized Host |
| R10 | P1 | 404/5xx, cancel, resume, lock/marker cleanup, dependency priority and unlimited client resume; record byte counts/Range and SHA. | Host/network environment |
| R11 | P1 | Old Desktop/DSM/iOS/Android client and new Server scenarios; no forced upgrades, Owner and old-version access only as permitted by API compatibility. | Real/versioned clients |
| R12 | P2 | Apple **signed** iOS IPA and independently fixed-key signed Android production APK, both from the same Commit if published. Unsigned IPA is test-only, debug Android APK excluded. | Apple/Android signing |
| R13 | P2 | Portable `xdrive-cli-*.tar.gz/.zip` contains source-exact `xd` + Agent with same 40-hex Commit and no Desktop/installer. Distinct from `xdrive-backup-*`; download manual only. | Exact-CI archive checks; portable runtime acceptance separately |

## Public release check (safe to run on GitHub Actions)

The repository provides **source-exact signed Bundle publication acceptance** as
a manual GitHub Actions workflow using a **new already-published full SHA**.
This is read-only and has no credentials for real Hosts/devices.

```bash
SHA=NEW_40_HEX_MASTER_SHA
python3 scripts/ci/verify-live-release-bundle.py \
  --commit "$SHA" --require-sigstore
```

A GitHub Release with `immutable:false` is allowed but is **not**
platform-immutable. Exact Commit, full asset inventory, actual SHA-256 and
independent Sigstore remain required for the public check. Manual native
installation takes its authority from authenticated current-Server metadata,
not a GitHub API preflight. This is a weaker supply-chain trust assumption
and must be displayed honestly to the owner.

## Installed real Host and Owner acceptance

On an **authorized Host**, where the actual Server has **already upgraded to
the exact tested Commit** and is reachable over authenticated HTTPS:

```bash
SHA=THE_RUNNING_SERVER_FULL_SHA
export XD_BUNDLE_OWNER_TOKEN='REDACTED_OWNER_TOKEN'
python3 scripts/ci/verify-live-release-bundle.py \
  --commit "$SHA" --require-sigstore \
  --host-home "$HOME/.xd" --server-url https://YOUR_SERVER_ORIGIN \
  --check-server-download --check-auth-denial
unset XD_BUNDLE_OWNER_TOKEN
```

Only **verified cached packages** are streamed and hash checked. A zero
verified cache cannot pass the Range test; missing optional platforms do not
fail an otherwise valid partial cache. The guest check performs a real
unauthenticated GET of metadata and of one cached asset, both requiring
401/403. Do not include tokens or Host paths in public logs or PR comments.

To audit both public mirrors' real bytes (expensive, and may fail where a
same-Commit GitLab mirror was never published), explicitly add
`--check-package-bytes`. Mirror failures are not a Server rollback reason.

## Native device witnesses

Windows: record the actual signed/unsigned mode, explicit consent (only for
personal master), installer SHA, prior and installed `xd version --json`,
Agent `--build-info-json`, Electron resource build-info, restart process
health and failed-install rollback receipt. A queued detached transaction
is **not** verified success. Linux: record actual PolicyKit prompt, package
SHA, installed `xd`/Agent/Desktop identity, denied authorization and failure
recovery. DSM: record Package Center operation, verified SPK SHA, settings/data
survival and actual running Agent identity.

For iOS and Android, Apple Developer/fixed signing keys and physical devices
are external prerequisites. GitHub unsigned IPA and Android debug workflow
success are **not** evidence of a production signed update.

CI success cannot grant repository admin settings, access GitLab/Host, click
PolicyKit/Package Center prompts, sign Apple packages or attest device
behavior. Such rows remain **blocked / not accepted** until the corresponding
external witness is attached to the same exact Commit. Never merge a PR as
“all real devices passed” without these independent receipts.
