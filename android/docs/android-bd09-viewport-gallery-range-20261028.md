# Native Android: verified BD09 viewport → ordinary Gallery Range

Go already implements `GET /api/v1/media/places/baidu-jsapi/viewport-items`.
The target is the *current authenticated Owner's camera-visible photo wall*,
not the original WGS84 `media/places/viewport` route and not unscoped
`media/items`.

This independent Android Core slice adds a real authenticated transport and
uses the existing Gallery Range decoder. Bounds remain BD09LL and must be valid.
The query must contain only the reviewed Go allowlist fields: west/south/
east/north, limit/offset/range and the ordinary captured/added sort order.
No Browser AK, user ID, WGS84 `coordinate_space`, synthetic grants or URLs
are sent.

On every page, the Go handler rechecks current Owner, Map release/epoch,
source Node/GPS and per-item authorization. 409 is an actual changed viewport,
not an empty map; 403/503 remain errors. Client must not automatically retry,
widen to all photos or pretend a sparse page covers the whole library.

The following separate UI integration will choose the current camera's
BD09 rectangle and bind it to the same native Gallery viewer, preserving
the return anchor. This PR is **only** transport/DTO and safety tests; it is
independent of in-memory camera request gate #2979, Share #2957 and transfer
recovery #2965. SDK camera + installed device/iOS screenshot comparisons
remain 跳过（未验收）. Exact-HEAD Android JVM/Core CI and branch gates are
mandatory before merge.
