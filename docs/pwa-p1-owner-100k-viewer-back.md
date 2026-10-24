# PWA P1: real Owner 100k Gallery → original JPEG Viewer → Back

This is a narrowly scoped first step for #2260. It reuses the original
authenticated Files→Gallery→Files 390px native Chromium and real Gin,
PostgreSQL17, LocalCAS fixture, without changing production code.

Each of three independent 100k logical PhotoAsset / 115k metadata Node fixtures
must still abort 4–6 genuine stale thumbnail HTTP requests via Go
Request.Context.Done within 160ms and deliver no bytes after cancellation.
Then the original Mobile App is reopened in Gallery at a deep chronological
anchor, a visible original JPEG tile is opened by browser-native pointer input,
the real private original is decoded and painted, and the Viewer Back button
must preserve the same hash, DOM, scroll host, grid and offset.

It is NOT a performance optimization, full 115k physically distinct CAS
originals, dynamic H264/Live motion playback or actual iOS/Android Installed
acceptance. Only a subset of test media contains genuine CAS bytes. Those
remaining measurements must be done separately before claiming full P1 closure.

Unreachable production safety acceptance: 按用户决定跳过（未验收）.
Code-level Owner/ACL/Abort/privacy checks are not skipped.
