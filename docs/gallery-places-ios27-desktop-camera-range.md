# iOS27 Places · Desktop direct BD09 viewport Media Range transport

The shared Web/Mobile map remains the signed HTTPS Baidu Child and trusted
Gallery Parent; Desktop secure HTTPS Web Gallery still uses the same original
sparse media wall. This patch adds parity for the **native Desktop Agent** when
the shared Gallery requests a BD09 camera photo wall.

Fixed transport:
Desktop shared Gallery DataSource → abortable Electron Preload →
Main process (strict fixed coordinate space/window/filters) →
authenticated local Agent IPC → Go Client →
signed Server `/api/v1/media/places/baidu-jsapi/viewport-items` →
original Owner/Consent/source revision/media Range.

The fixed API always returns distinct Owner PhotoAsset counts and bounded
Range/Timeline/Anchor, never all-media on unsupported Agents. Cancellation
stops the IPC client-side HTTP read and Go request context. Server rechecks
the signed release, Owner/epoch, per-photo consent/source and returned nodes.

No WGS84 reverse conversion, third-party map provider, new photo index,
Browser AK/JWT exposure, or stored derived coordinates. Filtering is a strict
subset (sort, anchor, favorite, capture dates, time zone, image/video kind);
unsupported options fail closed instead of silently widening a query.

Acceptance: exact-head Linux/Windows Go, Go API Race, Web, Desktop,
negative parser tests, 100k virtual range, Final Gate. Real iOS/physical
100k browser perf not claimed; inaccessible production-only security
acceptance remains 按用户决定跳过（未验收）.
