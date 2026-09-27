# Yike Photos V1 release acceptance

Yike Photos support depends on the current private Web API used by the signed-in `photo.baidu.com` application. This checklist is the release gate for the first usable xDrive Yike backup version. The connector is intentionally **read-only on Yike** and **backup-only on xDrive**.

## Scope that must work

A user must be able to configure a Yike Cookie in Web or Desktop, validate it, have xDrive automatically bind the managed logical target `来源/一刻相册/uid_<百度UID>_<账号名称>/`, run scan-only or sync mode, trigger an immediate run, and let the pull worker run on schedule. Media already copied into xDrive must never be deleted merely because it disappears from Yike.

The V1 release does not require Yike-side uploads/deletes/renames, mirror deletion, inferred Live Photo pairing, EXIF processing, or a Yike-style album browsing UI.

## Credential-safe live smoke

Never paste a real Cookie into source code, an issue, a PR, CI variables intended for logs, or a shell command that will be saved to history. On a trusted test machine, read it interactively into an environment variable:

```bash
read -rsp "Yike Cookie: " XD_YIKE_TEST_COOKIE
echo
export XD_YIKE_TEST_COOKIE
scripts/test-yike-live.sh
unset XD_YIKE_TEST_COOKIE
```

The smoke test is build-tagged and not part of normal CI. It only calls read-only user-info, list, album-list and download-link endpoints. Passing it confirms the current private API contract still matches xDrive; it does not replace the end-to-end sync checks below.

## End-to-end release gate

Use a Yike account whose test set includes photos and videos. Complete every blocking item:

- [ ] Web: add a Yike source, expand “如何获取 Cookie”, test the Cookie, and create the source without choosing a target directory.
- [ ] Desktop: repeat the same create/test flow; Yike must not expose the normal target-folder browser.
- [ ] After credential persistence, the Source target resolves to `来源/一刻相册/uid_<百度UID>_<账号名称>/`.
- [ ] The managed hierarchy is represented by xDrive Nodes only; imported bytes continue to use CAS/dedup storage.
- [ ] An invalid/expired Cookie is rejected and is not shown as configured.
- [ ] Replacing a valid stored Cookie with an invalid Cookie is rejected and the previous credential remains usable.
- [ ] `scan` mode enumerates the root library without downloading media.
- [ ] `sync` mode downloads normal photos and videos into the managed Yike target.
- [ ] At least one large video completes through resumable upload without worker-local full-file staging.
- [ ] Root-library media and own albums are traversed successfully.
- [ ] For media exposing Yike `shoot_time`, Source metadata preserves it as `captured_at` independently from remote `ctime`.
- [ ] Joined/shared albums are traversed when the account has them.
- [ ] One media object belonging to multiple albums produces one SourceItem/xDrive file, with multiple collection memberships rather than duplicate content.
- [ ] Chinese names, spaces and names containing Windows-reserved characters are mapped to valid deterministic xDrive paths.
- [ ] A second run with no remote changes transfers no duplicate content.
- [ ] After one file with a valid Yike MD5 has been downloaded and verified, importing another same-user item with the same size/MD5 can reuse the owned CAS blob with zero transferred bytes and without opening a new Yike media download.
- [ ] An MD5 mismatch fails closed, creates no trusted digest mapping, and does not publish the target file.
- [ ] A newly added Yike item is imported on the next run.
- [ ] A remotely changed item is updated rather than duplicated.
- [ ] A pure path move is reflected without re-downloading bytes when the planner identifies a move.
- [ ] During a large transfer, Web/Desktop show live scan/transfer progress and the current Source path.
- [ ] Use “停止” during a large transfer; the run becomes `cancelled`, active I/O stops promptly, failed-item count does not increase, and no missing inference runs.
- [ ] Stop/restart the worker during a large transfer; the next run resumes through the existing xDrive upload-session/Range path.
- [ ] Force one item-level transfer failure; the Source shows the failed item and Web/Desktop expose “重试失败项”.
- [ ] After the underlying failure is removed, the next scan retries the failed item and clears its error state.
- [ ] Remove a test item from Yike; the SourceItem becomes `missing` but the already imported xDrive node/content remains.
- [ ] Pause a Source and confirm scheduled/manual execution is gated until re-enabled.
- [ ] Delete the Source and confirm its Source metadata/credential are removed while already imported xDrive files remain.
- [ ] Restart the API and pull worker; configured Sources remain usable.
- [ ] Backup and restore the server, then run `xdrive-server source-credentials verify` with the restored connector keyring before restarting normal pull work.

A convenient forced run in the deployed Compose stack is:

```bash
docker compose --env-file ~/.xd/.env -f ~/.xd/docker-compose.yml \
  exec -T worker xdrive-server worker --once
```

## Pass criteria

V1 is release-ready only when normal repository CI is green, the credential persistence tests pass, the read-only live smoke passes against a current Yike account, and every applicable blocking end-to-end item above passes. If Yike changes its private API, fail closed: report a clear Source error, preserve the stored xDrive backup, and do not add mutating Yike workarounds.


## Per-Source scheduling

- [ ] Default newly created Source uses `interval=6h`.
- [ ] Changing the Source to another interval affects only that Source.
- [ ] A five-field cron schedule runs in the configured IANA timezone.
- [ ] A pending manual **立即扫描** request overrides interval/cron and runs on the next worker poll.
- [ ] Paused Sources remain skipped even when their schedule is due.
- [ ] An older Source with empty schedule fields still follows `XD_SOURCE_PULL_INTERVAL` as the compatibility fallback.
