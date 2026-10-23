# CR03g · Real Chromium IndexedDB under Linux kernel block EIO

**Status: Draft, NOT VERIFIED.** This is the final scoped native Linux block
I/O-failure follow-up to [#2427](https://github.com/lazyxu/xdrive/pull/2427)
and real read-only file-system experiment
[#2422](https://github.com/lazyxu/xdrive/pull/2422). Unlike #2427,
which intentionally proved only dm-error capability, CR03g must actually run
the original opted-in P1 production IndexedDB through a genuine fault.

A source-exact opt-in GitHub Runner creates a brand new 256 MiB sparse image,
a private /dev/loopN, a uniquely named dm-linear mapping and an ext4 mount
containing ONLY Chromium's synthetic Default/IndexedDB directory. Every
privileged command is limited to this exact mapping; the shell restores it,
unmounts, detaches and securely removes the scratch area on success or failure.

The actual native Chromium app seeds one synthetic Owner scope, original
directory and album, and closes. The kernel mapping changes to dm-error and
a direct 4 KiB block read MUST really fail with Linux EIO. A fresh native
Chrome visits the existing public PWA offline route and proves historical-
only or empty rendering, a failed native IndexedDB transaction, failure of
a new P1 capture, rejection of false durable purge success, and peer UI
invalidation across tabs. This is not an intercepted API or synthetic JS
exception.

The browser then closes; the private mapping is restored, its direct block
read succeeds, and ONLY its disposable ext4 is unmounted/fsck'ed/remounted.
A third Chrome process must not resurrect the rejected metadata or
fabricate Owner authorization. The real public Service Worker may cache
only anonymous static assets. Preserve all other users' code/PRs.

**Strict exclusions:** real phones/iOS/Android/Windows block EIO, installed
PWA lockscreen recovery, concurrent real Owner upload and 100k media are
NOT TESTED. A passing kernel dd alone is insufficient; original native
Chromium must exhibit a genuine IndexedDB write failure and persist no
forbidden row. Any missing device privileges, delayed native IDB success,
Chrome hang, failed recovery/cleanup or incorrect evidence remains RED.
No production service/web/Go/Worker or cache code changes in this PR.
Only a sanitized summary of boolean results plus accurate source SHA
is uploaded, never browser profile, secrets, output paths or database bytes.

The user-directed inaccessible production-only safety acceptance remains
**按用户决定跳过（未验收）**, never a source/CI/merge blocker.
Code-level Owner/ACL, privacy and real OS negatives are mandatory. Exact HEAD
specialty and complete CI/Final Gate must pass before merge.
