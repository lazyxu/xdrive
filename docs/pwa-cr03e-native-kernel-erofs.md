# PWA CR03e - Linux kernel EROFS and native Chromium IndexedDB (2026-10-23)

This is an independent P1-03 increment for #2348. Native Chrome quota,
Linux EACCES, and genuine LevelDB file corruption are already tested by
merged PRs #2388, #2415 and #2412 respectively. This test must not call
those distinct failures equivalent to Linux EROFS.

The CI runner creates a fresh, disposable browser Profile with a dedicated
128 MiB Linux tmpfs mounted at Default/IndexedDB. Genuine production P1
IndexedDB methods persist an opted-in directory and album, then Chrome exits.
Linux remounts only that temporary filesystem read-only. An unprivileged OS
file-create syscall must return native EROFS, not a fabricated DOMException
or Playwright network interception.

Two real Chromium tabs load the historical-only React UI while the database
resides on the read-only filesystem. Existing history may be readable or
empty, but no live Owner authorization may be inferred. P1 capture must not
claim a new persistent transaction; failed durable clear must not claim
deletion while its cross-tab invalidation broadcast must still arrive.
After closing the browser, remount the same tmpfs read-write and verify a
third independent Chromium process did not resurrect the prohibited entry,
nor turn offline history into authenticated server data.

The test is restricted to the Runner's exact private profile path and
must restore/unmount its own scratch tmpfs. No real user profile, tokens,
media, production credentials or browsing history are used or exported.
If the Runner cannot mount or generate real EROFS, leave the test RED rather
than using a synthetic error. Code under normal Web/Go/SW is unchanged.

This does not establish kernel block-device EIO, macOS/Windows/iOS/Android
filesystem faults, long-term old hashed asset deletion safety or genuine
installed mobile device behavior. These remain explicitly NOT TESTED.
Physical production-only security acceptance is SKIPPED (UNVERIFIED) per
owner decision, not a source/CI/merge gate; code-level privacy and ACL
negative tests remain mandatory.
