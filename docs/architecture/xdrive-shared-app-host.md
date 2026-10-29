# Shared xDrive application with platform Host adapters

## Decision (2026-10-27)

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
