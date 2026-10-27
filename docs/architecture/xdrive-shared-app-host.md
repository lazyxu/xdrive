# Shared xDrive application with platform Host adapters

## Decision (2026-10-27)

Desktop and Synology DSM are **two hosts for one xDrive React/MUI
application**. Do not implement or evolve DSM routes, menus, Gallery, Viewer,
settings, dialogs, or page layout independently of Desktop. Desktop changes
should become available to DSM through the same shared UI component.

The authoritative navigation vocabulary is
`ui/shared/src/mui/WorkspaceRoute.ts`; both host entries mount
`XDriveApp` and the same `XDriveWorkspaceSidebar`. A missing host
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
