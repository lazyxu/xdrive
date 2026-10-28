# xDrive Android · public signed APK · gated manual release

**2026-10-28.** Android Native already builds a Debug APK on every latest master
push. Actions Artifacts require GitHub login, use an ephemeral debug key, and
cannot be a dependable in-place update channel. This separate opt-in workflow
releases **only a fixed-key signed release variant**, from one exact master SHA.
There is no automatic Debug APK release and no requirement for Google Play or
a paid Apple developer certificate.

## Prerequisites — explicit owner setup

Keep and independently back up the existing fixed PKCS12 signing key and
password from \`.signing/android/\` (never commit or upload that directory).
The Android Gradle project uses alias \`xdrive\` and the same keystore password
for the key. A changed signing certificate cannot update an installed APK
in place; never silently rotate keys.

Configure these once, through repository Actions settings:

- **Repository Secrets**:
  \`ANDROID_RELEASE_KEYSTORE_P12_B64\` — base64 of the complete, private
  PKCS12 keystore, and \`ANDROID_RELEASE_KEYSTORE_PASSWORD\` — its password.
  The workflow decodes the keystore only into an isolated runner temp directory
  for a single Gradle build and removes the file on process exit.
- **Repository Variable**:
  \`ANDROID_RELEASE_CERT_SHA256\` — the trusted 64-hex-character fingerprint
  of this key's *signing certificate*, **not** the SHA-256 of the keystore.
  Obtain from a locally built, verified Release APK with
  \`apksigner verify --verbose --print-certs app-release.apk\`.
  Compare independently with your trusted fixed certificate.
- Protect the secrets and limit who can run the release workflow. GitHub rules,
  permissions, and required approvals remain authoritative.

[Actions Secrets](https://github.com/lazyxu/xdrive/settings/secrets/actions)
and [Actions Variables](https://github.com/lazyxu/xdrive/settings/variables/actions)
are repository-owner configuration pages; the app itself never receives the key.

## Running the release (only after this workflow merges)

Open [Android Signed Public Release](https://github.com/lazyxu/xdrive/actions/workflows/android-signed-public-release.yml)
→ **Run workflow**, select \`master\`, enter a new \`version_code\` and
corresponding \`version_name\`, and explicitly check
\`confirm_public_release\`. For example, if the current code is still 4,
the next candidate could be 5 / 0.1.4. Do not repeat a released versionCode.

The job:

1. Checks out the exact dispatch master SHA without retaining Git credentials;
   executes immutable name/code/metadata unit tests; checks published
   Android asset version codes from official public Releases; refuses an
   existing Android tag. The code is required to increase monotonically.
2. Requires both private key secrets and the public certificate fingerprint.
   Builds \`:core:test :app:testDebugUnitTest :app:lintRelease :app:assembleRelease\`
   in an isolated runner. No debug build is ever published as a release.
3. Uses Android SDK \`apksigner\` to verify the actual Release APK and exactly
   one signer matching \`ANDROID_RELEASE_CERT_SHA256\`, and \`aapt\` to match the
   exact application ID \`com.tfluid.xdrive\`, versionCode and versionName.
   Uses the existing \`android/scripts/update-asset.mjs\` to package the
   single **unchanged** APK and creates a verified \`SHA256SUMS.txt\`.
4. Publishes one public GitHub **prerelease** \`android-v<versionCode>\`
   with asset \`xdrive-android-<versionCode>-<versionName>.apk\`.
   It never clobbers an existing Release or tag. The separate
   \`snapshot\`/Server/Desktop publisher and v* stable gates remain untouched.

After a successful run, the direct HTTPS asset link is visible on the workflow
summary and on the corresponding public GitHub Release. Anyone can download the
APK without signing in. This also supplies the canonical Android asset name
understood by the existing anonymous GitHub update checker. Android still
requires the user's approval to install from an external source. Version
upgrades require a higher versionCode and **exactly the same signing key**.

## Fail-closed and validation boundaries

If the key, password, fingerprint, metadata, package identity, version,
source SHA or publication rights do not validate, the workflow fails without
creating a public APK. No credentials or private signing files appear in
Artifacts or Releases. The checksum/fingerprint/source SHA and signing variant
are public evidence; a successful release is not a claim of production Owner,
OEM hardware, network reachability or iOS screenshot acceptance.

The signed-release plan has dependency-free Node unit tests:
\`node --test android/scripts/signed-release-plan.test.mjs\`.
The Android CI job runs those tests as part of its existing native test step,
not a new required job. Real store-free device installation and upgrade:
**跳过（未验收）** until explicitly observed by the owner.

This workflow does **not** configure the owner's secret material for them,
does not publish anything during a pull request, and does not change the
existing GitLab project's visibility or introduce a Google Play dependency.
