# P86 — System Dependencies verified-first quiet navigation

Scope: the original shared `ui/shared/src/mui/ServiceDependenciesPage.tsx` used a cold `正在检查服务…` caption plus an in-flow `CircularProgress` while its initial authenticated status GET was pending. A fast GET painted a transient decorative frame and changed vertical geometry. Same-scope refresh changed button width and status caption. The page also cleared previous-Owner status in an effect (after render), permitting an unverified frame after switching API owners.

## Production behavior

- Keep the real Server/Agent `source.load()`, identity fencing, status verification, Caddy/Baidu desired/effective limitations, and existing true failure/retry behavior unchanged. Do not synthesize healthy or verified from absent health evidence.
- First cold read (even >300ms): stable, silent 180px content slot with truthful `aria-busy`; fixed-height 24px status caption; no spinner, extra in-flow row or fake empty state.
- Terminal failure: preserve the same slot and visible error; never misreport unknown as healthy.
- Successful authenticated response: reveal counted fixed-service overview once. Current `snapshotSourceRef` gates the visible snapshot synchronously during render when a Server/account API port changes, not only after a later effect; old account health must not flash as a new account.
- Same-source refresh: retain prior verified status and open editor, fixed-width `刷新状态` control with `aria-busy`, keep existing disabled and unsaved-editor guard; no transient `正在刷新` text that changes width or can wrap a status caption.
- Leave real network/media previews, index/background jobs, history loading, config apply checks, transfer byte progress and cancellation untouched. Keep 52px App Frame and shared Web/Desktop MUI component.

## Tests and limits

`desktop/tests/system-dependencies-quiet-first-read-p86.cjs` reads actual source and mounts the original React component, including >365ms deferred first status GET, accepted fixed overview and changed API owner + genuine terminal failure. Require accurate-head 77-job Web/Desktop Linux/Windows/real PostgreSQL Go Race/Rootless/Final Gate and clean PR mergeability. Physical iOS Safari/Android/PWA and built Chromium 375/390/899px, real WAN and physical 100k CLS/FPS **NOT RUN**. No production effect or full-product release GO claimed until checks finish.

P78 is already the mandatory canonical no-jitter rule in `AGENTS.md`; P84 contributes the Web Viewer extension. This scoped P86 leaves AGENTS itself untouched to avoid conflict with active P84/P83/Host branches; the existing P78 rule is a required review gate, not optional.

## Original exact-head CI RED and minimal mounted-harness correction

[P86 first 77-job CI #39189507057](https://github.com/lazyxu/xdrive/actions/runs/39189507057) on `bf7f2b6ba374190346ad21be352e96af72a993d5` first failed two newly introduced React-mounted assertions **before** any visual state assertion: synthetic test `global.document` lacked `querySelector`, invoked by MUI `ThemeProvider/useLayerOrder.js`. This is a test-environment defect, not proof of a product spinner. Mount the ORIGINAL `XDriveServiceDependenciesPage` directly with MUI default theme instead of an unnecessary explicit ThemeProvider; add a minimal `document.querySelector` fallback. Keep >370ms held first GET, genuine snapshot, API owner switch and real error assertions; original production Git blob stays unchanged. The old CI remains RED and cannot authorize merge; require entirely new accurate-head full 77-job CI.
