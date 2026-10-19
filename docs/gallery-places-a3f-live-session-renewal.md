# P0-Places-A3f — JSAPI4 live-map session renewal and truthful activation (2026-10-20)

## Starting point (already merged)
- #2139 real Loader probe, #2146 shared Web/Mobile/Desktop Admin probe, #2159 auto-managed release identity, and #2167 bounded Baidu serviceHost Go proxy are all merged. No remaining open A3 PR was found at the frozen base.
- Browser and Server AK already exist in the operator installation. Never ask for or log either credential.
- Current Web/Mobile Gallery and Desktop's isolated HTTPS window share the same authenticated Server APIs and photo viewport/Range/Viewer; no new basemap and no App Frame / 52px title-bar changes.

## Fixed runtime failure
- A map-only, Secure/HttpOnly Cookie lasts **2 minutes** (`MapSessionTTL`). The native map previously minted this once at mount; an otherwise successful session would expire during idle/pan/zoom, breaking later JS, tiles and SDK services.
- Active same-origin, Server-authorized BD09 map surfaces now renew after 60 seconds, checking every 30 seconds. Hidden mobile/PWA documents skip renewal, but `visibilitychange` and Safari `pageshow` promptly revalidate on foreground. Repeated events coalesce one flight.
- The existing authenticated, private POST is reused; JS never sees the Cookie, Browser AK or bearer. Signal abort, unmount, rejected release, logout, AK rotation and renew failures cancel and dispose the entire BMap+ClusterLayer before exposing stale map visuals. Static Baidu map remains the fallback.
- The shared System Dependencies panel displays the actual saved response's `runtime_enabled` and still distinguishes Server approval from three-device testing; its save button no longer emits the stale claim that every signed release remains impossible.

## Operator activation (no new key)
1. Deploy the latest compatible Server/Web/Desktop release including #2167; production runtime is not changed by a GitHub PR alone.
2. Log into xDrive as Admin: 系统依赖 → 地理位置与地图 → 百度地图 → 配置与修改 → 启用 JSAPI 4.0 → 保存并应用. Leave stored Browser AK unchanged.
3. Under 检测与生效证据, inspect `runtime_enabled` / release blockers. The Server refreshes its managed release on save; desired flag alone does not grant runtime.
4. Open Gallery → Places → Map on HTTPS Web, Mobile Web and Desktop's independent HTTPS window; confirm real pan/zoom, photo click/Viewer, 100k cell counts, 2+ minute session, background/foreground resume, logout and AK rotation.
5. Review actual provider agreement, network leakage/CSP and trust isolation, genuine provider resources and physical platform/iOS 27 screenshots before formal **production GO**. This PR has no live Server/HAR/physical-device access and must not claim those checks passed.

## Hard conditions
- Baidu is the only provider; fixed HTTPS serviceHost proxy stays Server-owned, route/path/query/MIME/size caps unchanged.
- Preserve 52px App Frame, shared endpoints / virtualized Gallery, original WGS84 ↔ BD09 distinction, explicit opt-in geo index and secure media Range.
- Verify current PR HEAD with the full required CI (real PostgreSQL Go API Race, Web/Desktop Linux/Windows, Rootless, installer packages and Final Gate). One work commit; don't touch other work branches.
- In a follow-up security hardening phase, prevent execution of third-party provider script in any document that exposes xDrive account bearer/refresh tokens. A Server release status is **not** proof of script-origin isolation.
