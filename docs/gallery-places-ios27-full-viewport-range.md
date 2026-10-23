# iOS27 · Authenticated current BD09 viewport Media Range (Server stage)

This is the **Server-only prerequisite** for the complete current-map Photos
wall. The already merged /cells → /cell-items lets one selected 8×8 cell open
Gallery. This extension adds /media/places/baidu-jsapi/viewport-items for ALL
currently authorized members of a precise BD09 native map camera. It returns
the original, paginated Gallery Range DTO: distinct Owner Count, Timeline,
Anchor, authenticated thumbnails/Viewer metadata, no second photo index.

- Explicit `range=true` and exact BD09 rectangle; limit 1–100 / offset bounded.
- Optional album, date window, media kind, favorite, timezone, sorting and anchor.
  The original Media Range applies these as narrowing predicates.
- Signed release + Bearer Owner, current DB SessionVersion and epoch before SQL,
  post-query returned-node consent/revision checks, and repeated Owner/release
  authentication before returning bytes. Revocations of returned nodes during
  SQL fail closed (HTTP 409). No untrusted direct WGS84/BD09 reverse conversion.
- No private original WGS84, image bytes, Node IDs, JWT or thumbnail URL is
  introduced into the third-party isolated Baidu Child. Only trusted xDrive
  Gallery/Parent may call this Owner media endpoint.
- First backend stage only: the complete camera Photos UI, Web/Desktop Agent
  transports, scrolling/anchor identity and true 10k/100k physical-image
  benchmarking are separate follow-up. The current max-10 strip remains a
  cluster preview, not a full viewport wall.

Automated source regressions cover query admission, no signed release,
Owner/consent/stale-node ID protection and the existing real PostgreSQL
A3h Cell fixture. Production environment access remains
**按用户决定跳过（未验收）**; code-level security/CI is required.
