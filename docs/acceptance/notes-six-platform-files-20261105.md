# Notes to Files six-platform acceptance matrix (N02)

Scope: validate the existing Owner-bound /@xDrive/@笔记 namespace through ordinary Files surfaces on Web, PWA, Desktop, DSM, native iOS and native Android. This is a functional acceptance record, not a claim that physical devices or a deployed NAS have already been tested.

## Server-authoritative contract

- Both iOS备份 and 我的笔记 remain visible, readable, previewable and downloadable to their owning account.
- Ordinary Files writes must not create, overwrite, rename, move, copy, delete, trash, restore, share or upload into the managed Notes tree. The Server is authoritative even if a client accidentally leaves an action enabled.
- The supported Notes API remains the only write route for 我的笔记; the dedicated iOS import route is the only import/update exception for iOS备份.
- Another Owner must not list, inspect, preview, download or mutate another account's Notes nodes, content, images or history.
- Unrelated ordinary folders under the same Owner root remain writable.

## Automated Server regression

`TestNotesNamespaceOwnerBoundAndOrdinaryFilesCannotWrite` now exercises:

- Owner A can read the managed Note Node and exact Markdown bytes through ordinary Files GET routes.
- Owner B receives not-found for the same Node and file-content IDs.
- Rename, move, delete, single-node copy, batch copy/move/delete, queued copy, share creation and FileVersion restore are rejected for a managed Note.
- A Notes API update still succeeds, creates revision history, and remains readable after rejected Files mutations.

Run the focused PostgreSQL integration test with the repository's normal API test environment (XD_TEST_DATABASE_URL):

    go test ./internal/api -run '^TestNotesNamespaceOwnerBoundAndOrdinaryFilesCannotWrite$' -count=1

## Client acceptance — repeat for each row

| Client | Real interaction path | Required result |
| --- | --- | --- |
| Web | Files → @xDrive → @笔记 → iOS备份 / 我的笔记 | Browse, preview and download work; ordinary mutations are hidden or rejected without changing the Node |
| PWA | Installed PWA → same Files path | Same Owner scope and read-only behavior after app restart/offline recovery |
| Desktop Windows | Installed Desktop → Files path | Agent-backed reads work; copy/move/delete/upload/rename cannot bypass Server guards |
| DSM | NAS XDriveApp → Files path | Backup-only Agent/CGI reads work; managed Notes mutations fail closed; normal folders still work |
| iOS | Native Files → managed Notes path | Native reads/downloads work; rename/move/delete/upload/restore are unavailable or rejected |
| Android | Native Files → managed Notes path | Native reads/downloads work; rename/move/delete/upload/restore are unavailable or rejected |

For each client, use two separately authenticated Owner accounts. Verify the second account cannot discover the first account's managed directories by guessed Node ID or cached navigation state. Then switch back and verify the first account's content is unchanged.

## Physical acceptance record

Record client version/build SHA, Server version, redacted account pair, device/NAS model, operation, expected result, actual result and evidence. Mark each case PASS, FAIL or NOT RUN. CI and the Server integration test do not substitute for Desktop installation, DSM NAS operation, iPhone or Android physical-device acceptance.

Current state: Server regression implementation is being added in N02; the six client physical/installed-client matrix remains NOT RUN until performed on those clients.