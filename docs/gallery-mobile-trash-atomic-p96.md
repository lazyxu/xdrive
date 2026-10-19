# P96 · Mobile Gallery Trash navigation uses first Range acceptance

## Source defect
Compact Collections→Trash already waited for the authenticated first Trash Range using the shared onCommitted callback. Ordinary compact Gallery section navigation previously called setSection and onSectionRouteChange before the first range was accepted, briefly exposing an unverified blank on slow/failed reads.

## Fix
Move the existing shared staged openTrashFromCollections callback before selectSection, and route only compact Trash navigation through that callback. The existing loadFirstPage current Owner/request check and virtualCollection.primePage authenticate first Range (including a true zero), then one callback commits the section, route, and content. Failed or superseded reads do not call that callback. Keep wide Web/Desktop, API/Agent, 100k sparse pagination, media thumbnails/Live Photo and real transfers unchanged.

## Regression and honesty
desktop/tests/gallery-mobile-trash-atomic-p96.cjs mounts actual shared Gallery Navigation and executes actual production Gallery callbacks across >365ms pending, failure, superseded/current success and wide parity. Original P93 first-page source acceptance checks remain. Require full exact-head CI plus browser 375/390/899px and native evidence before declaring overall zero jitter. Physical iOS/Android/PWA/WAN/real 100k CLS/FPS NOT RUN for this source-only change.
