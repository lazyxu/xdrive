# iOS Native unsigned IPA: direct GitHub Release assets

The iOS workflow has two outputs after a successful **master** build:

1. The existing short-lived Actions Artifact (ZIP) containing `xDrive-unsigned.ipa`
   and `xDrive-unsigned.ipa.sha256`. It remains available for build inspection.
2. A public, **version-pinned** GitHub prerelease, with those same original two
   files as independent assets, **without** a surrounding Actions ZIP.

## Direct download

Every successful trusted master push that triggers the native iOS workflow
publishes an immutable Release tagged `ios-unsigned-<first-12-commit-hex>`.
For example, for source `0123456789abcdef0123456789abcdef01234567`:

```text
https://github.com/lazyxu/xdrive/releases/download/ios-unsigned-0123456789ab/xDrive-unsigned.ipa
https://github.com/lazyxu/xdrive/releases/download/ios-unsigned-0123456789ab/xDrive-unsigned.ipa.sha256
```

These are examples only, not links to a build that has already been published.
Check the actual successful publisher run and Release tag for the current URL.

The file is an **unsigned** device IPA (not an App Store build). SideStore,
AltStore or another suitable signing mechanism is required for installation.

## Publication safety

- Pull requests never publish a public Release. The publishing job runs only
  for a successful master push or a trusted manual workflow dispatch from master.
- The publishing job downloads the exact same-run IPA and checksum after the
  native builder succeeds. It does not rebuild, repackage or sign the app.
- Before public publication, it verifies there are exactly two regular files,
  the SHA-256 matches, the IPA ZIP members stay under Payload/xDriveIOS.app,
  the bundle ID is `com.lazyxu.xdrive.ios`, the executable is `xDriveIOS`,
  and there is no embedded provisioning profile or _CodeSignature directory.
- Every Release tag is fixed to the source commit. GitHub's published remote
  asset digests are rechecked and an existing tag/Release can only be reused
  when both exact file hashes match. No clobber, no mutable/latest alias.
- The `ios-release-contract` job exercises fake GitHub publication success,
  idempotent retries, mismatched source, stale checksums, wrong bundle IDs,
  corrupt remote assets, extraneous files and tag takeover.
- The shared GitHub `snapshot` Release and its exact allowlist remain
  untouched; the separate iOS prerelease is intentionally outside the server
  release bundle.

The public Release is not claimed to exist until the publishing job has
completed and the exact GitHub Release assets are visible. A failed publisher
keeps the existing Actions Artifact available for debugging.
