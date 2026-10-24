# Android UI parity implementation plan

2026-10-24 user amendment: generate the exact PWA MobileFolderIcon blue vector,
gradients and flat mobile list tokens in Task1b, then consume them in Task2.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing native Android server/login/password/files screens
visually consistent with Web/Desktop using their actual assets and design values.

**Architecture:** Generate native presentation data from canonical shared sources;
copy the approved brand raster at build time. Compose remains the renderer and
the existing controller remains the sole behavior/session owner.

**Tech Stack:** Kotlin2.1.20, Compose2025.04.01, AGP8.9.2/Gradle8.11.1, Node22+.

**Spec:** docs/superpowers/specs/2026-10-23-android-ui-parity-design.md

## Global Constraints

- Android min29/target35 and existing dependency/toolchain versions unchanged.
- Existing Web/Desktop canonical sources and Go/API/controller logic unchanged.
- MUI auth primary #4177e6 light/#5f8ff4 dark; original PWA blue gradient folders.
- Use approved PWA512 raster; in-app corner ratio242/1024; native controls48dp minimum.
- Memory-only credentials, explicit HTTP opt-in, FLAG_SECURE and backup exclusions remain.
- No upload/Gallery/sync/WebView/fake navigation; one verified GitHub PR commit.
- Task temp is D:/code/xdrive/tmp/android-ui-parity-20261023; every child inherits TEMP/TMP/TMPDIR there.

## Review Focus

- Upstream theme/MUI changes must fail verification instead of silently retaining stale native assets (Task1).
- Filename case, hidden files and unknown extensions must not misclassify or crash (Task1).
- Long values, large fonts and the keyboard must leave actions reachable (Task2).
- Password reveal must not persist across blur, emptying, server/account/navigation changes (Task2).
- Restyling must not disable error retry, paging, back, account switch or mandatory-password gating (Task2).

## Task 1: Canonical native presentation assets

**Files:**
- Create android/scripts/shared-ui.mjs, android/scripts/shared-ui.test.mjs.
- Create android/design/material-rounded-icons.json, shared-ui snapshot and license/provenance notice.
- Generate android/app/src/main/java/com/tfluid/xdrive/SharedVisuals.kt and res/drawable/xd_*.xml.
- Create android/app/src/main/java/com/tfluid/xdrive/XDriveTheme.kt and FilePresentation.kt.
- Modify android/app/build.gradle.kts and launcher resources; remove obsolete X foreground only.
- Create android/app/src/test/java/com/tfluid/xdrive/FilePresentationTest.kt.

**Interfaces:**
- Produces `@Composable XDriveTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit)`.
- Produces `@Composable XDriveBrand(modifier: Modifier = Modifier, size: Dp = 34.dp)` using R.drawable.xdrive_brand.
- Produces `@Composable XDriveFileIcon(node: DriveNode, modifier: Modifier = Modifier)` in a40dp slot (folder38dp, other glyph24dp) and `fileKind(name: String, directory: Boolean): String`.
- Resource names for UI: xd_arrow_back, xd_refresh, xd_more_vert, xd_visibility, xd_visibility_off, xd_logout, xd_settings; exact rounded MUI glyphs. File type resources for Image/Movie/AudioFile/PictureAsPdf/TableChart/ViewCarousel/FolderZip/Description/Code/InsertDriveFile. xd_folder derives from the PWA's own SVG.
- CLI: `node android/scripts/shared-ui.mjs --check` verifies repo-generated outputs without writes; `--write` regenerates; tests import pure helpers and use controlled temp fixtures only.

- [ ] Write generator tests that fail for missing output, changed palette/extension input, invalid source, package-version drift and modified vector output; run and observe real RED.
- [ ] Implement bounded fail-closed source extraction, generated outputs and glyph provenance. Regeneration may use the existing TypeScript/MUI packages to execute the canonical theme; --check validates source fingerprints and all generated outputs without dependencies. Obtain exact MUI paths matching web/package-lock.json with integrity verification; reject unsupported icon nodes.
- [ ] Write JVM filename classification cases before implementation (dir.jpg, PHOTO.JPG, .gitignore, a., README, movie.MOV, notes.txt, code.kt, book.pdf, data.csv, slides.pptx, archive.zip and unknown.ext); observe RED then implement native presentation adapter.
- [ ] Implement XDriveTheme + brand/file composables, Gradle resource copy and launcher reuse; no changes to DriveApp/MainActivity in this task.
- [ ] Run Node test/check, focused JVM and Android compile/lint against the coordinated test environment. Review task diff. Do not commit; root commits once after integrated validation.

## Task 2: Shared-look native screens and visual acceptance

**Files:**
- Modify android/app/src/main/java/com/tfluid/xdrive/DriveApp.kt and MainActivity.kt.
- Create android/app/src/main/java/com/tfluid/xdrive/AuthScreens.kt and FileScreens.kt as needed to keep files focused.
- Modify android/app/src/androidTest/java/com/tfluid/xdrive/DriveAppTest.kt; add VisualParityTest.kt and test-only fixture helpers if needed.
- Modify android/README.md and .github/workflows/ci.yml (Android job only, root integration).
- Create docs/android-ui-parity-validation-20261023.md (root integration).

**Interfaces:** Consumes Task1 theme/brand/icons. Keeps `DriveApp(controller: DriveController)` and controller unchanged. Test-only image capture/fixtures must not add production debug entrypoints or remove FLAG_SECURE.

- [ ] Add real Compose tests for password reveal/reset on blur, mandatory password flow, dark theme rendered colors, brand/type glyph rendering, paging/retry/logout preservation and responsive form reachability. Run before UI implementation and record real failures.
- [ ] Apply spec auth-card and file-list design with reusable native controls. Keep auth fields `remember`, never `rememberSaveable`; add local visibility state reset and matching new-password confirmation before invoking the existing controller. External labels and original test tags remain accessible.
- [ ] Add fixture screenshots for light/dark login and mixed file types, plus narrow large-font/landscape states. Capture only synthetic data to test app private output and export into task-owned D evidence. Inspect actual pixels for spacing/clipping/contrast.
- [ ] Run complete Android unit/lint/build/instrumentation, Node generator tests/check and APK install. Root checks canonical Web/Desktop source is unchanged.
- [ ] Add Node verification to Android GitHub job; keep existing complete gates unchanged. Document actual coverage/limits and persistent APK. Independent task/whole-branch review; scoped fixes verified.
- [ ] Root makes exactly one scoped commit, pushes only new GitHub branch, creates attached Draft PR, waits exact HEAD full CI/Final Gate, checks actual master compatibility, marks Ready and rebase-merges. No second post-merge master-CI wait.

## Preflight

Task1 owns generated assets/theme/file adapter; Task2 only consumes their explicit
interfaces and owns screens. Environment preparation uses an immutable baseline
snapshot and does not edit source. Root owns docs/CI and the single commit. No
parallel worker source overlap or simultaneous Gradle builds.
