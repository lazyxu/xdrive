# Android first-increment visual parity

## User amendment — 2026-10-24

The user explicitly corrected the mobile folder choice: Android must use the
blue iOS-style folder already shipped in Web PWA, not the shared Desktop yellow
folder. This supersedes the earlier builder choice below. Reuse the exact
`MobileFolderIcon` paths, colors and gradients in `web/src/MobileFiles.tsx`,
with its 64×54 viewBox and 38dp display width. Generate a native gradient vector
with source-drift checks, not a blue tint over the Desktop silhouette. File rows
follow the existing mobile 68dp minimum and aligned icon slot. The mobile list
is flat, white in light mode, black-backed with #1c1c1e rows in dark mode, matching
that PWA page. Existing scope, native touch/security behavior and common
brand/auth palette remain unchanged; no new product navigation is introduced.
Other existing file-type/action glyphs keep the shared Rounded MUI source.

## Intent and scope

The user explicitly requests polishing the merged first Android increment so its
icons and UI look almost the same as the existing Web/Desktop product, followed
by the established GitHub PR/verified CI/rebase-merge workflow. Retain pure Kotlin
and Jetpack Compose. This is not the manual upload/Gallery or auto-backup phase.

## Approach

Reuse the canonical brand assets and generate native presentation data from the
existing shared UI sources; implement the same visual hierarchy with native
Compose controls. A WebView would contradict the approved native experience.
Hand-maintained approximations would drift; rewriting the existing Web/Desktop
design system would unnecessarily expand this change. The user has directed
implementation with minimal-version defaults, so no new design questionnaire is
required. The builder decisions below are explicit defaults, not newly approved
user requirements.

## Canonical references

- `assets/icon/master/xdrive-icon-master.svg` is the brand master. The existing
  `assets/icon/web/pwa-512.png` is an approved generated, opaque launcher image.
  Android copies this existing raster at build time, rather than inventing an X.
  In-app display clips the square derivative to the master's 242/1024 corner
  ratio; the OS masks the launcher version. No image-generation service is needed.
- `ui/shared/src/mui/theme.ts`: MUI primary #4177e6 light / #5f8ff4 dark;
  resolved MUI background/text/divider for the corresponding mode, not the legacy
  CSS --primary and not Android dynamic colors. MUI defaults supply text/divider.
- `AuthSurface.tsx`, `AuthForm.tsx`, `BrandLockup.tsx`: decorated background,
  centered card, shared brand hierarchy, external field labels, outlined inputs,
  full-width blue submit, password visibility affordance and subdued helper copy.
- `FileExplorerItemPresentation.tsx`: shared file extension classification and
  exact MUI rounded file-type/action glyphs. `web/src/MobileFiles.tsx` supplies
  the phone's blue gradient folder and flat list colors, per the user's choice.

## Native presentation contract

- Provide one XDriveTheme for light/dark colors and typography, with native system
  sans fonts (matching Web's system fallback), shared 12.5dp auth-control corners,
  14dp phone auth-card corners, 430dp max auth width, 48dp min touch controls.
- Server/login/password screens use a brand card on a softly tinted background,
  external label above each input, unobtrusive server/connection hint, visible
  errors, explicit HTTP opt-in and warning, and a blue full-width submit. Keep
  passwords memory-only; visibility resets on empty value, blur and navigation.
  Password change matches the shared three-field form (current/new/confirmation),
  rejects a mismatched confirmation locally and retains the existing >=8 rule.
  No false promise of mounting/sync and no saved-password/autologin UI.
- Files use a compact 52dp content header (system insets additional), brand,
  functional refresh/account controls, readable breadcrumb, server/account info
  in the account menu, flat mobile surfaces, 24dp file icons and 38dp folders in
  aligned 40dp slots, at least 68dp rows (can grow for font scaling), name plus metadata. File details stay a
  native dialog. Existing paging, retry/retained rows, logout/server change and
  mandatory-password gate must still work. Do not imply file preview is present.
- Long server URLs/names/breadcrumbs cannot force horizontal overflow. Auth forms
  scroll in landscape/IME/large fonts; actions remain reachable. Portrait, dark,
  narrow/large-font and landscape fixtures are exercised. The app retains its
  secure window; screenshots are fixture-only instrumentation, never real users.

## Sharing and guardrails

Generate checked-in Kotlin theme/extension values and Android vector resources
with a Node script. Regeneration resolves the real theme with the existing pinned
TypeScript/MUI dependencies, and reads the existing extension/folder sources and
a bounded snapshot of only the MUI rounded glyphs actually used,
including upstream version, exact SVG paths and license. A verification mode
compares generated outputs, rejects unsupported source structure and detects
canonical source fingerprints/MUI package-version drift without needing npm
dependencies in an Android build. Regeneration must not change canonical Web/Desktop
sources. Android CI executes the generator's behavioral tests and verification.
Gradle copies the existing PWA brand raster to generated resources with declared
inputs/outputs, so the APK cannot silently retain a manually duplicated logo.

No Server/API/controller/auth persistence changes, new permission, network
library, telemetry, WebView, full icon-font pack or new product navigation.
No GitLab changes or direct master push. Preserve all AGENTS and unrelated work.

## Acceptance

Tests prove extension/icon mapping (including uppercase/hidden/unknown names),
light/dark rendering and proper control behavior. Existing 25 JVM tests and real
Compose flows remain green; add visibility/focus, responsive and screenshot
fixtures for auth/files. Inspect actual emulator images, not only source strings.
Build/install the APK; run lint; independently review the scoped diff. Full exact
HEAD GitHub CI/Final Gate and fresh mergeability precede rebase merge. Record
native font/platform differences honestly; no pixel-identical or physical-device
acceptance claim. Preserve the debug APK and small visual evidence on D:.
