# P88: eliminate stale one-frame loading indicators across requests

This change affects the actual shared Web/Desktop deferred loading feedback hook and Mobile Web Files Search/populated Trash feedback. It does not change route navigation or authoritative first Range lifecycle.

## Defects verified in original code

- Shared delayed feedback used a Boolean visible flag. When an already-visible spinner is followed by a second request/changed feedback delay, the old true value remains visible in that first React render. Clearing visible only in a passive effect is after paint.
- Mobile Files explicit Search and nonempty Trash refresh stored only the delayed scope. Identical successive scopes could reuse the previous visible status until effect cleanup.

Both now tag every timer with a render-time generation incremented on pending/scope/delay changes. Real network calls are unchanged. Normal directory and Gallery album switching already retain verified old content, use a silent stable 180px Files or 220px Gallery cold slot, and commit once on the authorized first counted Range/index. Do not add folder-level loading messages, skeletons or layout transitions. All thumbnail, video poster, Live Photo, upload/download/sync and genuine task progress remain independent.

## Required regression matrix

| Scenario | Expected |
| --- | --- |
| No request / cold first request before dispatch | Silent stable slot, truthful aria-busy; no invented empty/error |
| Fast request less than 300ms | No intermediate spinner or changing panel height |
| Held longer than 300ms | Normal folder navigation silent, old authenticated content and scroll intact |
| Previously visible indicator to new same-scope request | Zero paint frames of the previous indicator |
| Previously visible indicator to changed feedback delay or query scope | Zero paint frames of the previous indicator |
| Verified empty, failure/retry, cancellation, old Owner or out-of-order response | Correct current identity, stable space, truthful retry; no stale commit |
| Media thumbnails, Live Photo/video poster, transfers, explicit Search | Preserve genuine loading in fixed non-reflowing slots |
| Real Web 375/390/899px and wide browser/Desktop/installed PWA | Confirm one scroll host, header and breadcrumb dimensions vary no more than 1 CSS px during pending, return to same scroll anchor |

### Evidence

The new desktop/tests/navigation-feedback-generation-p88.cjs compiles the **original shared TS hook** and mounts real React 18 via react-test-renderer; its per-render observation checks the exact stale-Boolean regression. Original P62/P78 Files and Gallery source/mounted tests remain in the standard Desktop test suite. GitHub exact-head CI and built-browser checks are separate gates. Physical iOS Safari, Android, installed PWA, slow WAN, real 100k/CLS/FPS are **NOT RUN** and are not claimed.

Independent P83 #2106 and Gallery Inspector P87 #2118 remain Draft and untouched. They need separate exact-HEAD CI and clean merge before claiming all affected surfaces fully shipped.
