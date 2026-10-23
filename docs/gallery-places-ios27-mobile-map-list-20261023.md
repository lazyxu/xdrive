# Gallery Places — iOS 27 compact Map/List milestone

Source baseline b204dc5b1cfc3aaf14d0cf1b413cc586cdd6a8a9 (2026-10-23). This is a scoped UX increment, not 1:1
visual acceptance or a new photo map backend.

The compact Mobile Web / PWA Places index opens in Map mode, with accessible
44px Map/List buttons. Map mode does not mount the country/region/city panel or
Place page below the large map. List mode shows the existing paged Place cards
without a second collapsed disclosure. The list retains the same authorized
Owner search, photo covers and existing photo-wall navigation.

Wide Web and Electron keep the original map, hierarchy and list together.
Returning from a photo-wall collection retains the compact presentation mode
and the original separately restored map-camera state. Existing authentic
HTTPS isolated Baidu Child continues to own projection and gestures;
the Parent's trusted photo covers can fill compact edge-to-edge map framing.
No GPS, private thumbnail URLs, Asset IDs, JWTs or original photo bytes enter
third-party JS, and the existing /cells -> /cell-items Owner Range/Viewer is
untouched.

Future 1:1 work: visible-camera photo Grid, scoped album/Trip maps, no nested
app chrome, true iOS screenshot and gesture calibration, accessible gestures
and genuine 100k map/frame-time pairing. Re-run source-exact Desktop contract,
Web build, Desktop typechecks and complete 77-job CI before merging. Unreachable
production acceptance is 按用户决定跳过（未验收）; code-level security remains.

## Signed isolated Child transport precedence (P0 map runtime)

The Web adapter exposes both prototype and signed Child ports. The shared
Gallery now chooses Child whenever those complete transports coexist; a
Server signed-release denial must stay on Static Map diagnostics, never
retry the unsandboxed prototype. Old clients lacking Child transport retain
the original prototype behavior. Correct JSAPI 4.0 global is BMap, as in the
Baidu official docs; do not change to BMapGL or claim a live AK pass.
See desktop/tests/gallery-places-ios27-runtime-choice.cjs and both updated
legacy prototype source tests. This does not provide production acceptance.
