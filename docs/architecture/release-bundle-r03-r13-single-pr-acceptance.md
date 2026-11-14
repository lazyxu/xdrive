# Release Bundle R03–R13 — one-PR closeout with real evidence

This document and the executable matrix are the **single R03–R13 integration
track**. Preserve the merged full-40-hex Commit Bundle design, authenticated
Server verified-cache → same-Commit GitLab → GitHub fallback, independent
client release channels, and Server health/rollback independence.

## Scope and limitations

- Add a **fail-closed, read-only** R03–R13 evidence ledger and source CI
  regressions. A green CI is NOT a real Host, Windows, Linux, DSM, signed
  iOS/Android, or CLI-in-place-upgrade acceptance.
- Provide an operator entry point for **R03** that checks the installed Host
  Commit, actual cached bytes against published Manifest, authenticated Owner
  API, two HTTP Range responses reassembled to exact SHA-256, and both guest
  401/403 denials. Require public Sigstore verification.
- Mark missing external witnesses **unverified**; altered or incomplete
  receipts **rejected**; accept **verified** only after checking one full 40-hex
  source Commit, scenario-specific results and independent evidence hashes.
- Never upload Owner tokens to CI or Git, run unattended production upgrades,
  sign a production application, install an OS package or modify Host data.
- Keep GitHub Release Immutability optional; the separately configured Host
  strict Sigstore mode must be exercised in R09, not assumed from public CI.

## Run R03 on an authorized *real* installed Host

Use an actual Host with an already published current-Commit Bundle and access
to its authenticated Server. Supply the Owner token by secure environment
injection, **not** as an argument or an attached log.

~~~sh
SHA="$(grep -E '^XD_RELEASE_COMMIT=' "$HOME/.xd/config/.env" | tail -1 | cut -d= -f2)"
# The XD_BUNDLE_OWNER_TOKEN environment variable must be supplied securely.
bash scripts/ci/run-live-release-bundle-closeout.sh \
  "$SHA" "$HOME/.xd" "https://YOUR-AUTHENTICATED-SERVER" \
  "$HOME/xdrive-release-acceptance"
~~~

The runner calls the existing live validator with require-sigstore,
check-server-download and check-auth-denial. It rejects a zero-verified cache,
wrong Host/Bundle Commit, missing trusted public signer, altered Manifest,
wrong 206 Content-Range, reassembled SHA mismatch, or guest API/file exposure.

A successful R03 JSON is saved at R03-live.json, with a sanitized report at
R03-R13-matrix.json. It does **not** mark R09 complete. On a disposable Host
staging environment, separately exercise the real
XD_RELEASE_BUNDLE_VERIFY_SIGSTORE=required setting with invalid signer,
wrong Commit, unavailable gh and altered signature, and verify that ONLY
the optional client cache is denied.

## All acceptance rows (one PR, independent witnesses)

Fault injection must be performed in disposable/backed-up staging, not against
a real production installation.

| Row | Real environment | Required independent acceptance |
| --- | --- | --- |
| R03 P0 | Host | .env/current cached bytes, Owner API, two 206 Range SHA checks, both guest 401/403 |
| R04 P0 | Windows device | Personal unsigned consent, real EXE, Agent exit/restart, Desktop/Agent/xd full Commit, intentionally failed post-install validation and rollback |
| R05 P0 | Linux device | PolicyKit allow/deny, DEB SHA, installed three Commit identities, restart, interruption and failed-upgrade recovery |
| R06 P0 | Host staging | Missing optional package, GitLab 404, corrupted SHA, network offline, Worker failure; Server health/rollback independent, verified partial cache still usable |
| R07 P1 | GitLab runner | Safe fast-forward, exact pipeline, Release/Package byte readback, 500 idempotent recovery, GitLab 404 → GitHub digest fallback; see issue #3966 |
| R08 P1 | NAS device | DSM Package Center SPK upgrade, SHA, persistent settings/backup state, live Agent and Owner access |
| R09 P1 | Host staging | Strict Host Sigstore pinned signer/repo/Commit; missing gh, invalid signer, invalid Commit and signature reject ONLY cache |
| R10 P1 | Network staging | Real 404/500, cancel, Range resume SHA, dependency pause, uncapped resume, marker cleanup, independent Server health |
| R11 P1 | Old client matrix | Old Desktop/DSM/iOS/Android use new Server without forced upgrade or Owner leakage |
| R12 P2 | Signing devices | Apple Developer signed IPA and Android fixed-release-key APK, real installs, no test-only/debug automatic installs |
| R13 P2 | Portable CLI runtime | Windows/Linux xd + Agent archives execute at correct Commit; in-place atomic CLI install and failed-install rollback must be actually implemented and tested |

R12 requires approved signing identities and devices. R13 currently supports
xd update --cli-only --download, **not --install**; do not fake an atomic
installation success. External dependencies still missing mean those rows
stay unverified and the PR must remain Draft.

## Real receipt format for R04–R13

Use one file named R04.json through R13.json in a local operator-owned
evidence directory. Never commit the directory. Artifacts reference only
relative paths beneath it with SHA-256, rejecting symlinks, traversal and
altered bytes. Do NOT collect Owner tokens, credentials, personal data or
sensitive filesystem paths.

Example **schema illustration only**, NOT proof of acceptance:

~~~json
{
  "schema_version": 1,
  "row": "R04",
  "commit": "REPLACE_WITH_FULL_40_HEX_SOURCE_COMMIT",
  "environment": "windows-device",
  "executed_at": "2026-11-13T01:00:00Z",
  "operator": "actual-device-witness",
  "result": "unverified",
  "checks": {
    "personal_unsigned_consent": false,
    "installer_sha256_verified": false,
    "agent_exited_before_install": false,
    "electron_restarted": false,
    "agent_restarted": false,
    "deliberate_failed_postinstall_check": false,
    "rollback_to_last_known_good": false
  },
  "observed_commits": {
    "xd": "",
    "agent": "",
    "desktop": ""
  },
  "artifacts": []
}
~~~

A real receipt must have result **passed** only after all tests ran, each
required check actually observed true, the exact installed source Commit
recorded for every component, and at least one independently SHA-256-checked
trace file. Every required field is specified in the ROWS table within
scripts/ci/release_bundle_closeout.py. The parser checks structure/digests;
it cannot prove a human-supplied JSON statement is truthful. Preserve the
original trusted runner or real device logs for independent review.

## Evaluate the whole matrix

~~~sh
python3 scripts/ci/release_bundle_closeout.py \
  --commit FULL_LOWERCASE_40_HEX_SHA \
  --evidence-dir /private/evidence \
  --live-report /private/evidence/R03-live.json \
  --output /private/evidence/R03-R13-matrix.json \
  --strict
~~~

Strict mode fails if any row is missing/rejected. Without strict mode,
missing external witnesses remain unverified rather than failing a source-only
CI; invalid receipts still fail. Tests cannot borrow success from a different
source Commit or from mocked installs.

## Merge safety

All applicable exact-HEAD GitHub CI and Final Gate must pass, which validates
the implementation and safety contracts, not external machines. Do not claim
"R03–R13 accepted" until all real witnesses exist. Keep one Draft PR rather
than multiple overlapping release closeout PRs. Issue #3966 remains open
until live GitLab acceptance is recorded.
