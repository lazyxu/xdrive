# Gallery performance

This document is the canonical performance contract for the shared Web/Desktop Gallery.

Only comparable measurements should be presented as timing improvements. Structural changes without stable BEFORE/AFTER timing are recorded as complexity-only evidence.

## Status index

| Area | Status | Evidence |
| --- | --- | --- |
| Timeline viewport group lookup | **Accepted / structural contract** | 100,000 synthetic date groups; a viewport near group 90,000 uses fewer than 64 indexed group reads instead of scanning from group 0. No wall-clock speedup claimed. |

## Timeline viewport group lookup

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- shared `Year / Month / Day` Gallery timeline viewport calculation;
- stable synthetic workload: **100,000 ordered timeline groups**;
- target viewport begins near group **90,000**;
- evidence method: executable regression wraps the group array with a `Proxy` and counts numeric index reads;
- samples: n/a for this structural count.

BEFORE:

- `xDriveMediaGalleryTimelineWindow` starts at group 0 for every viewport calculation;
- a deep viewport therefore inspects essentially every earlier date group before reaching the retained window;
- the named 100,000-group workload is **O(G)** per window calculation and requires roughly 90,000+ group inspections before useful work.

AFTER / current:

- binary search finds the first group whose bottom intersects the retained viewport;
- the forward pass stops as soon as a group's top is beyond the retained viewport;
- the same workload is **O(log G + V)** where `V` is the small number of retained visible/overscan groups;
- regression budget: the named 100,000-group / group-90,000 workload must remain below **64 numeric group-array reads**.

Decision: **Accepted.** Timeline group positions are monotonic by construction, so searching the ordered layout does not change item ranges, group headers, overscan, or VirtualCollection fetch semantics.

Regression command:

- `node --test desktop/tests/media-gallery-virtual.cjs`.

Next action: audit Gallery thumbnail retention/queue work during fast scrolling, then return to FileExplorer sync/delete basic-path performance.
