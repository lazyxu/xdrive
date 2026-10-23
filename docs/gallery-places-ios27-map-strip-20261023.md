# iOS 27 Photos map — bounded location-photo strip (P0-03 slice)

Stacked on #2405 compact Map/List view. The trusted Gallery Parent adds an
accessible horizontally-scrollable bottom strip of at most 10 representative
photos from the CURRENT `/cells` map snapshot and SDK-projected visible points.
It is **not** a full list of photos in the viewport. The strip shows exact
authorized cluster counts; selecting a thumbnail invokes the same original
Owner-revalidated `/cell-items` Media Range, virtual photo wall and Viewer.
No new Server endpoint, SDK provider, GPS conversion, image stream or
client-side 100k index is introduced.

Accepted representative Asset/Node/revision/count and BD09 camera bounds must
match the CURRENT Parent cells page and independently approved selections. A stale Child position/duplicate/wrong ID cannot promote
an Owner thumbnail. Pan/revoke/account navigation clears `summary` and
`projected` before requery. The third-party Child sees only opaque cell IDs
and projected coordinates; no image URLs, private pixels, JWT or WGS84.

A later independent API phase must implement the genuinely full current
viewport PhotoAsset Range, time/album/favorite filters, exact Count and sparse
Anchor before the bottom strip may be called a full iOS Map Photos grid.

Test: `node --test desktop/tests/gallery-places-ios27-camera-filmstrip.cjs`
and full exact-head Web/Desktop/Go Windows/Linux/Final Gate. Inaccessible
production-only acceptance: 按用户决定跳过（未验收）.
