# Android public update sources implementation plan

> **For agentic workers:** Use superpowers:executing-plans in the existing isolated Android worktree. User already authorized direct implementation, validation, commit and push.

**Goal:** Check for Android APK updates from selectable GitHub/GitLab Releases before or after login.

**Architecture:** An account-independent, cancellable public HTTP client reads bounded release metadata. It selects the highest Android versionCode from explicitly named APK assets, not the unrelated Server release version. Native Compose exposes a common update dialog from every screen; explicit download opens the official asset in the external browser, leaving installation and signing continuity to Android.

**Tech stack:** Existing Kotlin, OkHttp, coroutines, Compose; no new dependency.

**Spec:** This document records the user request and the scoped minimum design.

## Global constraints

- Keep existing auth, blue mobile folder UI, Owner ACL and Server/Web/Desktop unchanged.
- Sources: GitHub lazyxu/xdrive (HTTPS), GitLab xuliang/xdrive at http://gitlab.t-fluid.com:1080 (explicit visible insecure-source warning).
- Persist only source selection; no account/session/cookies in update requests. Manual checks only.
- APK naming contract: xdrive-android-<versionCode>-<versionName>.apk, positive Android versionCode <=2100000000. Greater code means update; older/equal code never requests a downgrade.
- Only official provider/project download paths are actionable. No arbitrary external URLs, credentials or scheme downgrade.
- Missing Android assets is NOT proof that the installed version is current. Current releases have no Android APK; debug CI keys are not a stable signing channel. Do not auto-publish debug keys or fabricate a live upgrade test.
- User requests a single scoped validated commit and GitHub PR/push. Permanent delivery order: merge validated GitHub PR into master FIRST, then synchronize GitLab master to the accepted GitHub master (no overwriting diverged history without approval). Preserve all existing AGENTS and other owners' work. Temp/build caches on task-owned D: paths only.

## Review focus

1. Server release numbers must not masquerade as Android versions: test mixed release assets and highest Android code selection.
2. Bad/foreign download URL must not become a browser intent: test origin/path/credential/HTTP cases.
3. Switching/closing while a request finishes must not show stale-source results: test cancellation and generation fencing.
4. No server configured or logged in must still allow both source checks: native Compose tests on connect and login screens.
5. Missing APK, errors, equal/newer installed build and disabled browser must be truthful and retryable: core/controller/UI tests.

## Task 1 — independent release checker

- [x] Add real MockWebServer tests: both provider schemas, exact anonymous request, mixed/absent assets, code comparison, bad URL/size/body, HTTP failure, cancellation.
- [x] Observe RED, implement UpdateSource, AndroidUpdate and AndroidUpdateClient in core/AndroidUpdates.kt, run :core:test GREEN.
- [x] Document/reuse canonical APK naming in a small packaging script; execute it against valid/invalid fixtures and refuse overwrites.

## Task 2 — pre-login native UI

- [x] Add controller tests for source persistence, stale/closed requests, retry, results independent of DriveController.
- [x] Observe RED, implement UpdateController; wire application-owned lifecycle and saved source in MainActivity.
- [x] Add Compose tests for connect/login/files entry points, source switching and actionable update vs missing APK.
- [x] Observe RED, add UpdateDialog and common menu action, passing an actions slot to ConnectionForm. Use native browser action, safely report ActivityNotFoundException.

## Task 3 — validation and delivery

- [x] Run all Android JVM tests, lint, APK build, shared-asset checks, native Compose emulator tests where available; inspect results and limitations.
- [x] Review full diff, append scoped AGENTS history, document packaging/signature and HTTP boundaries.
- [ ] Commit only scoped changes, push codex/android-update-sources and open Draft PR; attach it. Report exact verification and actual publication gap. Full exact-head CI/Final Gate required before Ready/merge.

## Execution evidence before source commit

- Final source base: complete master `de6a4c0ad67b48fa3745c9642f18bbef32d0a0a5`, preserving the independently merged Android password-change fixture wait and new CI contracts. No source changes on the main checkout.
- `:core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest`: PASS; 46 JVM tests, zero failures/errors. Lint has zero errors and three nonblocking advisories: existing OldTargetApi/MonochromeLauncherIcon plus UseKtx for Uri.parse.
- Full real native API36 emulator fixture run after baseline refresh: 20/20 PASS. Includes initial connection/login/files update entry, source switching, actual Activity preference persistence + separate fresh ViewModel reload, missing APK, download/browser failure and all original UI fixtures. This is not a physical-device or WAN acceptance result.
- Node shared/native-asset and update-packaging tests: 24/24 PASS; generator --check PASS. `go test ./internal/cicontract`: PASS on refreshed base. `git diff --check`: PASS.
- Same fixed local release certificate successfully signed versionCode 3 and a private versionCode 4 fixture; native Android accepted install -r (no uninstall between those two release packages) and launched both. The fixture is never published. A source-exact signed code3 artifact is rebuilt after the commit so its VCS metadata does not identify the old parent.
- Independent whole-branch review found one Important GitLab foreign numeric-project URL boundary issue and two test gaps. Foreign-project regression observed RED, namespace-only fix then entire suite GREEN; unsafe URL negatives now preserve matching filenames, and preference loading is exercised with a separate ViewModelStore. No unresolved reviewer findings.
- Anonymous live GitHub and GitLab Release API reads succeeded, but neither lists an Android APK yet. No production publish/signing-secret/project-visibility mutation is claimed. External CI/PR/merge/GitLab synchronization results are recorded in the PR, not fabricated here before they occur.
