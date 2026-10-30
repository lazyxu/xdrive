# Shared xDrive application with platform Host adapters

## Decision (2026-10-27)

> **2026-10-30 scope clarification:** one React UI applies to Desktop + Synology DSM (and shared browser UI primitives), **not native iOS or Android Apps**. Both mobile Apps target fully native product screens. The current iOS WKWebView is temporary as-built; see [mobile-native-migration.md](./mobile-native-migration.md).

Desktop and Synology DSM are **two hosts for one xDrive React/MUI
application**. Do not implement or evolve DSM routes, menus, Gallery, Viewer,
settings, dialogs, or page layout independently of Desktop. Desktop changes
should become available to DSM through the same shared UI component.

The authoritative navigation vocabulary and privileged-route admission policy
are in `ui/shared/src/mui/WorkspaceRoute.ts`; both hosts mount `XDriveApp`
and the same `XDriveWorkspaceSidebar`. The shared frame checks verified
Server role before any administrative sidebar action reaches a Host callback.
The DSM adapter must not authorize itself as Server administrator. A missing host
capability produces an explicitly unavailable action/page, **not**
a disappearing route, fabricated transfers, simulated file writes, or
unverified success. Server administrator routes must not appear or execute
without verified Server role; UI checks alone never grant permissions.

```text
               ui/shared/src/mui/XDriveApp
            ┌──────────┴──────────────┐
      Desktop host                Synology DSM host
       Electron IPC           DSM session -> CGI -> owning Agent
            └──────────┬──────────────┘
          Server Owner / Device / Root rules
```

## Migration status, not a claim of finished parity

1. **Implemented in this first architecture change:** a single workspace
   frame and shared route vocabulary, a typed host/page registration
   boundary, both hosts mounting the same frame, full ordinary DSM sidebar
   route coverage, honest unavailable states, and an explicit admin guard
   in the shared outlet.
2. **Existing shared page implementations used on both sides:** common
   FileExplorer primitives, QuickLook, DeviceBackup, TaskCenter,
   CloudStorage, LocalStorage, Diagnostics, Settings and Homepage.
   The DSM Owner file adapter still has narrower operations than Desktop.
3. **Still outstanding:** move Desktop's approximately 3.4k-line stateful
   controller/route composition to common hooks and renderer registry,
   move Desktop-specific FileExplorer/Overview wrappers into shared
   host-neutral controllers, and wire DSM's real authenticated gallery/map,
   cloud Pull, transfer history, conflict handling and authorized admin
   services to the same pages. No unimplemented feature is reported working.

### Host boundary

- Desktop: Electron preload IPC to the owning xdrive-agent, with native
  file dialogs, OS integration and desktop credentials.
- DSM: DSM-authenticated, CSRF-protected same-origin CGI to the existing
  owning Agent, retaining per-request user/Owner/Root authorization and
  revocation. Never create a second backup or CAS writer, accept an
  arbitrary agent method/URL or reuse a session across users.
- Both hosts render the same MUI page. Host-specific methods provide
  data, callbacks, file picker/permissions and optional native actions.
  Unsupported actions have an explicit reason.
- The first backup-only Synology SPK remains independent of having a
  complete DSM GUI. Physical ACL/upload/incremental/stop/upgrade
  verification remains **跳过（未验收）** at the user's direction, not
  a CI or merge gate.

### Test invariants

Run `node web/scripts/check-synology-desktop-backup-parity.mjs`,
`npm run build:synology --prefix web`, the Desktop renderer TypeScript
checks, and existing executable DSM authentication/Owner/Root tests.
Physical DSM tests cannot be claimed without real device evidence.


## Host data-port migration (follow-on)

DSM no longer owns a `pages: { render() }` JSX registry. Its entry only
supplies the real Agent/CGI, device backup, cloud and browser-storage ports.
The shared `XDriveAppPageOutlet` composes all currently supported page JSX
and renders explicit unavailable states for missing ports.

**Not yet completed:** Desktop's stateful controller and page composition
still live in `desktop/src/renderer/App.tsx`; its full FileExplorer must
converge with the transitional DSM Owner-read bridge on host-neutral ports.
Gallery/map, Pull, transfer history, conflicts and administrator features
still require real authorized DSM transports, never fabricated success.


## Batch 2: Desktop common Host-backed page migration

The same `XDriveAppPageOutlet` now renders **Gallery/Map/Viewer, DeviceBackup,
remote Pull/SourceManager, personal/global TaskCenter, Cloud Storage and Local
Storage** from typed domain data and operation props. Their Desktop JSX
branches have been removed from `desktop/src/renderer/App.tsx`; Electron IPC,
native dialogs and real Agent API calls remain in Desktop Host controllers.
The common page itself never imports the Electron global.

The remaining Desktop Overview, full Files/Viewer controller, Conflicts,
Diagnostics, settings/modal composition and Server admin controllers have not
yet moved into host-neutral domain ports. DSM's missing Gallery, Pull and admin
transports must become real authenticated capabilities rather than simulated
success. This batch does not claim full DSM functionality or real-device
acceptance.


## Batch 3: administrator workspace pages

All five Desktop administrator routes now render their existing shared MUI
components from the common Host outlet: Users, Audit, Global Storage,
Services/Dependencies and Backup/System Maintenance. The **Server-verified**
role guard remains at the common route/outlet and the original Agent
capability checks remain on the Desktop Host page props. The Agent IPC code,
privileged task action, maintenance state and unsaved-dependencies navigation
guard stay on the Desktop host; no native operation is available through an
unverified Synology administrator session.

Desktop Overview, full Files, Conflicts, Diagnostics and general Settings
still need controller extraction; this is NOT completion of full DSM data
capabilities.


## Shared Conflict and Diagnostics routes

The Conflict page's complete MUI composition now lives in
`ui/shared/src/mui/ConflictsPage.tsx`, with a narrow typed conflict model;
the Desktop-only implementation is retired to a compatibility re-export.
Desktop's actual Agent conflict read/open/resolve callbacks remain Host
services. Diagnostics already used one canonical `XDriveDiagnosticsPage`;
Desktop now supplies its real restart, reconnect, repair, log/export and
settings actions as data props to the same outlet, while DSM retains its
separately authenticated diagnostic read adapter.

Only the Desktop Overview and full Files controllers remain outside the
common page outlet. This does not imply Synology supports absent Agent
capabilities or Server administrator roles.


## Shared navigation composition

`xDriveWorkspaceHostSections` now owns Home, Conflicts, Diagnostics,
Server-admin menus and Settings for both Desktop and DSM. Host-specific
status counts remain passed-in data. DSM's own administrator status does
not enable Server-admin links; only a verified xDrive Server role does.
Both Settings sidebar actions open the actual shared dialog.


## Owner-scoped Overview controller migration

Desktop Overview now renders through the **same shared app outlet** as DSM.
`ui/shared/src/mui/OverviewPage.tsx` owns the React state and Home composition;
only `desktop/src/renderer/desktopOverviewAdapter.ts` calls Electron IPC
for recent/favorites, availability, disk, file open and native thumbnail/poster.
No background Overview data requests or timers are mounted while Files,
Gallery/Viewer or another page is selected.

The controller fences all accepted Home data and failure messages by the
current Owner identity, rejects superseded asynchronous account responses,
preserves silent unverified first-read list cards, and does not treat a failed
read as a confirmed empty result. DSM retains its real authenticated local
overview fallback without inventing a full Server/Agent Home port.

The remaining full Files page still requires host-neutral extraction of
DesktopFileExplorer and Owner-authorized DSM mutation/preview actions.

## All-platform architecture extension (2026-10-29)

The full Web/Mobile Web/PWA/WKWebView IPA/Android Compose/Desktop/DSM UI and
platform-owned feature matrix is documented in
[all-platform UI architecture](./xdrive-all-platform-ui.md).
Desktop local-folder Push backup and Windows CfAPI/Linux FUSE virtual-drive
mapping are **separate** native features; convergence of shared React page
logic must not retire either Agent-backed capability.


## Host-neutral read-surface admission (2026-10-29 follow-on)

The shared `XDriveAppPageOutlet` now selects the NAS/backup-only Owner read
fallback from an **explicit Host service capability**, not the literal
`desktop`/`synology` platform string. Supplying a backup client alone
never replaces Desktop's full Overview, Files, Tasks or backup pages.
The DSM Host intentionally opts into `ownerBackupReadFallback: true`, while
its cloud-storage refresh policy is supplied through
`cloudStorageRefresh.clearOnRefresh`. No Server role or filesystem access is
inferred from either UI flag. The existing per-request Owner/Root/CGI checks
remain authoritative.

Both the counted Desktop/Web Range reader and the DSM cursor reader cross
the same `FileExplorerDirectoryReadStrategy` boundary. Counted responses
now reject invalid positional ranges, repeated/invalid node IDs and mismatched
sort echoes before they can be published; cursor pagination continues to
require its genuine opaque token and never fabricates a count. Valid responses
and AbortSignals are forwarded without synthesis.

**Not yet migrated:** Desktop's full `DesktopFileExplorer` stateful controller
and its remaining legacy `XDriveApp` Files-child mount. This incremental
boundary change is not a claim of completed DSM writes, complete Files parity,
or physical DSM verification (which remains **跳过（未验收）**).


## Single Files route dispatch (2026-10-29)

Desktop and DSM now enter Files through the SAME
`XDriveAppRouteContent -> XDriveAppPageOutlet` path. The shared registry
includes `files` and the old Files-specific `children` override is removed.
Desktop's pre-existing status/conflict warnings remain Host-wide notices and
continue to display before routed content. The shared page outlet owns the
Files route remount/disposal lifecycle just like every other workspace page.

**This is an intermediate routing milestone, NOT the final Host Adapter
migration.** The Desktop Host still contributes its authenticated native
`DesktopFilesPage/DesktopFileExplorer` controller as an explicitly named
`filesControllerContent` transitional element. DSM supplies a separately
authorized Owner-cursor port with honest unavailable write actions. No native
IPC, generic Agent RPC, storage Owner rights or authentication is inferred
from presence of either element. The remaining full Desktop Files stateful
controller/transport split is a separate migration and should retire this
temporary element once real Host-neutral controller ports are implemented.

Source regressions assert that no Host can silently bypass the common route
with a hidden Files child, that Desktop/DSM can render their current legitimate
controllers under a single page outlet, and that a bare backup-only client
cannot fabricate Files permission. Physical NAS validation remains
**跳过（未验收）**, not CI or merge gating.


## Files Host capability snapshot (2026-10-29)

The Desktop Host's native Files feature negotiation now flows through the
typed pure `xDriveFileExplorerHostCapabilities(agent.hello?.capabilities)`
snapshot in `ui/shared/src/mui/FileExplorerHostCapabilities.ts`.
Absent, incomplete or unknown Agent handshake flags default to unavailable.
In particular, folder uploads require **both** conflict preflight and policy.
The same verified snapshot feeds Files and its related Overview upload/disk
status; no second JSX copy performs Agent capability detection.

This does not grant DSM any native methods. DSM's Owner-files CGI read path
still advertises actual unsupported mutations, and Server/Agent permission
checks remain necessary even if an advertised capability is present.

This removes a real Host-specific policy branch from the large Desktop
application controller, but **does not yet move its entire stateful
DesktopFileExplorer controller to shared**. That remaining migration should
replace the temporary `filesControllerContent` element with typed data and
operation ports once the native lifecycle is actually extracted.


## Consolidated read-only Files/Viewer controller extraction (2026-10-29)

Two disjoint development branches were merged by a **two-parent Git commit**
into one integration branch; only the integration branch opens a PR/CI run.
Desktop's current-file availability request projection is now in
`ui/shared/src/file-explorer-availability-request-projection.ts`, with
source precedence and non-forged numeric Node identity preserved. It performs
no network access: the existing Owner-fenced Agent batch read remains on
Desktop, so a navigation or Owner switch still retires outdated responses.

DSM's read-only Files -> QuickLook candidate selection is now in
`ui/shared/src/mui/FileExplorerReadOnlyViewerSelection.ts`. It requires a
current Owner scope, root revision, Host identity, and exact selected Node
identity before showing the current Viewer item. Unsupported or stale
selection IDs do not create an open Viewer. DSM still uses the same shared
QuickLook component and its existing authorized media transport.

**Explicit out-of-scope:** PDF editing, document/content editing, and other
new modification/editor capabilities. Read-only PDF/text/media viewing and
existing authorized file operations are not silently removed. Neither shared
projection creates a new editing action, Owner permission, Agent method or
generic CGI proxy. Full extraction of Desktop's remaining stateful Files
controller is still required before removing the transitional
`filesControllerContent`.


## Current Files read-only controller extraction (2026-10-29)

The existing queued Files/Viewer integration PR now includes two more
Host-neutral, presentation-only modules consolidated *before CI starts*:

- `FileExplorerDeviceReadPresentation` converts real Agent availability
  snapshots and running hydration progress into shared Files status and
  availability labels. Desktop retains its Owner-fenced batched Agent reads,
  native keep/release actions, and truthful error behavior; this model owns no
  filesystem permissions, timers, or durable transfers.
- `FileExplorerReadOnlyDownloadAdmission` checks the current verified
  DSM Owner directory, exact Node/revision/size/type, one-file limit, and
  in-flight state before any existing authenticated original-file download.
  DSM still verifies whole-file SHA-256 and requires an explicit user action
  to save. The shared model does not mint a download token or a write method.

**No PDF editor or other content-editing feature is being developed.**
Existing read-only PDF/text/audio/video viewing remains intact. Retiring
Desktop's temporary `filesControllerContent` still requires further
state/controller extraction and real Host data-port convergence.
