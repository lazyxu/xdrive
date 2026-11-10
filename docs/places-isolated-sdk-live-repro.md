# Isolated Baidu JSAPI 4.0: reproducible failure stages and operator acceptance

The Desktop message `百度地图 SDK 加载失败，已停止显示空白画布` was a **generic Guest health-probe label**, not evidence that a provider script failed. The same `unavailable` came from failed signed release, Owner `/cells`, one-use Child ticket, Child redemption, SDK bootstrap and Map initialization. It also deliberately hides a nonready WebView instead of displaying an empty canvas.

The source-executed tests reproduce the separate stages without any production Browser AK, credentials or real photographs. **CI synthetic Chromium is not acceptance of a deployed, real Baidu CDN/AK/HTTPS Child site.**

## Live reproducer (no secrets)

1. Open the authenticated Desktop Gallery map and switch to **隔离版**. Press **F12** in the actual map Guest; select **Console** and **Network**. Enable Preserve log, then use the existing **重试** action once. Do not turn off web security, CSP, TLS verification or the Child's site isolation.
2. Observe **only the HTTP status/blocked reason**, elapsed time and the fixed **path** for these ordered boundaries:
   - Trusted Gallery status / signed release; note the nonsecret `release_blockers`.
   - Independent Child `/_xdrive_baidu_isolated/index.html`, `/child.js` and `/child.css` (should be 200 and have the exact Parent Origin meta/CSP).
   - Owner's signed initial `/cells` request and `/api/v1/media/places/baidu-jsapi/child-ticket` POST.
   - Child-origin `POST /_xdrive_baidu_isolated/session` (200 and a secure, HttpOnly, Partitioned map-only Cookie, without copying its value).
   - Child-origin `GET /_BMapService/api?v=4.0` and its subsequent same-origin JS/CSS/tile resources. The bootstrap must return JavaScript with 200 and establish `BMap.Map`, `BMap.Point`, `BMap.Label` before the bounded readiness timeout.
3. Classify: HTTP **401/403** usually means a denied identity/Owner/Origin/ticket; **404** points to wrong static deployment or route; **429** indicates an admission/quota limit; **503** on `/_BMapService/` often means a release, map Cookie, policy or upstream check failed; **CSP**, `ERR_CERT_*`, DNS or blocked mixed-origin resources point to the browser/Child deployment. These are *possibilities*, not evidence of a particular live cause.
4. Check that the independently hosted Child **really was redeployed** from the exact active Server/Web source Commit. The main Caddy image contains an unconfigured `index.html` template; it does not activate or upgrade the separately hosted Child. The meta `xdrive-isolated-parent-origin` must be replaced with the exact verified Gallery HTTPS Origin. Different ports or sibling subdomains on the same registrable Cookie site do **not** satisfy the independent-site constraint. A placeholder Child fails to emit the initial `ready` packet, which triggers a **different** Desktop handshake timeout.
5. Verify the Baidu **browser-type AK** allows JavaScript API 4.0 and the **independent Child's domain**. The Server constructs the upstream `Referer` from its approved Child Origin, not the Gallery Origin. A whitelist for the Gallery domain alone might therefore fail when using the isolated mode.

Only report redacted **HTTP status codes**, browser error *categories* and the sanitized UI diagnostic code. Never attach URL query parameters containing AK/ticket, the full HAR, `Authorization`, `Cookie`, `Set-Cookie`, provider response bodies, personal media URLs or GPS.

## Code-owned failure stage relay

The standalone Child sends one of the following finite reasons through the existing exact `Origin + WindowProxy + generation + nonce` message boundary:

| Safe stage | Meaning |
| --- | --- |
| `session_unavailable` | Child session POST/receipt rejected or not reachable, before SDK |
| `sdk_script_failed` | Fixed same-origin bootstrap's `script.onerror` |
| `sdk_script_timeout` | Script did not finish before the bounded deadline |
| `sdk_namespace_missing` | Bootstrap loaded but required BMap capabilities did not appear |
| `sdk_map_initialization_failed` | `BMap.Map` constructor or map binding raised |
| `sdk_load_failed` | Another locally classified SDK load failure |

The trusted Gallery also classifies initial Owner `/cells` and Child-ticket failures from numeric HTTP statuses. The Desktop Guest reads only allowlisted codes from its trusted Web page, shows a stage instead of falsely claiming every failure is a script error, and keeps the failed Guest hidden. No provider exception or credential is serialized.

## Test levels

- **Production-source VM injection:** Session reject/network error, real script `onerror`, missing namespace, Map constructor exception, invalid/extra message fields, no-secret echoes, and invalid Parent-Origin template.
- **Trusted protocol/host:** Exact cross-site Origin, WindowProxy, nonce, generation and finite error-code allowlist; reject injected tokens and forged reasons.
- **Desktop Guest:** Real probe script returns specific `unavailable:<code>`, rejects injected codes, and continues to treat no SDK-ready evidence as pending.
- **Synthetic Chromium:** Actual cross-site HTTPS Child and hostile synthetic provider script prove browser isolation, not the real licensed Baidu service.
- **Manual live acceptance:** Real Child site, current Browser AK, proxy, TLS, Browser CSP, 200 session, 200 loader and tiles, true BMap initialization/Viewer behavior must be verified separately.

Do not weaken authentication, expand the SDK egress allowlist, disclose a Browser AK to the browser, switch to an unsafe same-origin fallback, or claim synthetic tests represent production verification.
