# Official GitHub release provenance

## Evidence published with the installers

`.github/workflows/release.yml` generates `SHA256SUMS.txt` and then uses
`actions/attest@v4` to sign SLSA provenance for the exact bytes of
`xdrive-server-install.sh` and `SHA256SUMS.txt` using GitHub OIDC / Sigstore.
The reusable workflow verifies the signed bundle locally before publication.
`xdrive-release-attestation.json` is distributed alongside the assets. A
separate signing private key or production credential is not required.

Both official snapshot and stable releases use the same workflow. Releases
predating this change have no bundle and will not satisfy strict mode.

## Host updater

The default `XD_GITHUB_ATTESTATION_POLICY=off` preserves #2497's checksum
verification without imposing a new runtime dependency or changing GitLab and
custom URL distribution.

Explicit `XD_GITHUB_ATTESTATION_POLICY=required` enables additional fail-closed
verification for official GitHub master/stable releases only. It requires an
installed compatible GitHub CLI (`gh`) and refuses custom URL overrides or
GitLab to avoid a downgrade. It verifies both downloaded file digests using the
downloaded Sigstore bundle, pinning the exact `lazyxu/xdrive` repository,
its immutable numeric GitHub repository ID `1382670236` for both artifacts,
`lazyxu/xdrive/.github/workflows/release.yml` signer workflow, and (for master)
the `refs/heads/master` source ref. Offline bundles otherwise enforce only
historical repository names; the numeric ID guards against name reuse after a
repository rename. `XD_REPOSITORY` cannot redirect strict mode to a fork. An invalid/missing bundle, unavailable
verifier, or signature mismatch causes a full retry of all assets (maximum
three attempts) and **never** executes unverified installer bytes.

Strict stable verification pins the publisher workflow and repository identity.
It does not itself provide monotonically increasing version anti-rollback
protection; that is a separate policy.

This is a staged rollout, **not a claim that publisher verification is now the
default**. The host uses GH CLI only if strict mode was explicitly enabled.

## Acceptance

CI host fixtures cover both policy paths, source/override downgrade rejection,
missing/rejected evidence, wrong/missing/malformed/mixed repository IDs,
and forbidden installer execution. The publication
workflow performs genuine cryptographic verification, not just shell fixtures.
Production-only inaccessible acceptance: **按用户决定跳过（未验收）**.
