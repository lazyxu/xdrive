# Snapshot Git ref authorization (master edge)

## Reason

The Snapshot publishing job has previously hit GitHub HTTP 403 when moving
`refs/tags/snapshot` to a commit containing `.github/workflows` changes,
even with ordinary `GITHUB_TOKEN` `contents: write`. The repository's
prepublication temporary-tag probe stops on this error **before** changing
public assets or floating `edge` images. It must not be bypassed.

## Optional scoped publisher App

Only the existing `bundle` release job can mint a short-lived installation
token for the current repository. To enable this one-time configuration:

1. Register a GitHub App with repository permissions **Contents: Read and write**
   and **Workflows: Read and write**, with no organization permissions.
2. Install it **only on `lazyxu/xdrive`**, not on all repositories.
3. Under repository **Settings → Secrets and variables → Actions**, configure
   variable `XD_SNAPSHOT_APP_CLIENT_ID` and secret
   `XD_SNAPSHOT_APP_PRIVATE_KEY` (the App's PEM private key). Never place the
   PEM or token in commits, PR descriptions, logs or chat.
4. After a new `master` CI produces the existing signed client/image assets,
   verify the `publish-master / bundle` job: the scoped-token step succeeds,
   the existing temporary-ref probe passes, remote SHA-256 assets match,
   and the floating Snapshot tag reaches exactly that accepted commit.

The official `actions/create-github-app-token` v3.3.0 action is pinned to the
verified immutable commit `64ab729a6294000f5aa4a4bc0b73d1f32bc45510`
for this privileged release step. It creates a token restricted
to the **current repository**, with only Contents/Workflows write requested;
its post-step revokes the token at job completion. The App is minted only
after the signed provenance bundle is verified and never in PR jobs, ordinary
Go/Web/Desktop CI, or `v*` stable publication. GHCR continues to use the
existing packages-scoped `GITHUB_TOKEN`.

If **both** configuration fields are absent, publishing continues with the
previous `GITHUB_TOKEN` behavior and the same fail-closed ref probe. If only
one field is configured, the bundle fails before public mutation; if the
installation lacks the required permission, token minting fails early.
No `GITHUB_TOKEN` workflow YAML permission escalation is attempted.

## Release vs source state

`master` merged source is not a published Snapshot. Check the exact floating
`snapshot` Git ref, the Release notes commit, `xdrive-backup-linux-amd64.tar.gz`,
`xdrive-backup-windows-amd64.zip`, SHA256SUMS and attestation provenance
against the **same** accepted commit. Never infer publish success from
`build-client-core`, `final-gate`, or an old release's asset timestamps.

Production-only installed-environment acceptance:
**按用户决定跳过（未验收）**. Source-level CI, authorization and asset-integrity
checks remain required.
