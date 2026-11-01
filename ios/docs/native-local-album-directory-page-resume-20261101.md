# Native iOS PhotoKit album directory page restoration (2026-11-01)

Scope: fixed Gallery **Albums** source directory, not album member identifiers or Viewer. The existing native album directory reads 32 PhotoKit collections per page; returning from another Gallery source or reopening the verified Owner's app previously reset its child @State cursor to zero. If the set of albums shrank, reading the previous cursor could fail with invalidRange or display an empty end page.

Keep only a bounded, 32-aligned **localAlbumDirectoryOffset** (0..10000) as a new optional field in the existing <=2KiB v1 route snapshot. The verified Owner/Server/root shell owns this index and resets it on logout or scope change; old snapshots decode without it. No album localIdentifier, membership list, cover, ticket or media metadata is persisted. Reopening always rechecks current PhotoKit authorization and fetches the directory again. On an invalid/past-end page, retrieve current authorized directory total from the first page and move to the final existing 32-slot page; a legitimate empty end page also clamps. No background album scanner, new library walk or network activity.

Add pure Swift route-store tests for legacy v1, valid/invalid/tampered 32-slot cursors, 0/32/37/120 collection counts and Owner switch. Extend existing iOS IPA-backed Node source checks for the Gallery binding, real PhotoKit reauthorization and source navigation. No changes to PhotoKitAlbumPager semantics, the native Viewer (local/cloud), map, backup, Android, Web, Desktop runtime or CI workflows.

Exact PR HEAD: native unsigned IPA build, applicable full CI, Final Gate and mergeability mandatory. Real iPhone source switches, album deletion, Limited Photos access, rotation and VoiceOver acceptance remain **跳过（未验收）**.
