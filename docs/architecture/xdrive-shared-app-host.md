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
