# xDrive Desktop

Phase 4 connects the Electron desktop UI to the existing Go `xdrive-agent` through the private Desktop IPC introduced in Phase 3.

## Responsibilities

- Electron main window, single-instance lifecycle, and system tray;
- Electron Main reads `desktop-ipc.json`, owns the local bearer token, and performs all Agent HTTP requests;
- the sandboxed renderer receives only narrow business operations through preload/`contextBridge`;
- login, required password change, logout, sync status, pause/resume, sync-now, open-folder, settings, and conflict resolution;
- agent status updates use the Phase 3 revision/long-poll endpoint;
- React renderer continues to consume `ui/shared`;
- Windows NSIS and Linux DEB desktop packaging.

The renderer never receives the Agent IPC URL/token or xDrive access/refresh tokens. Authentication and secret storage remain owned by the Go agent.

Phase 4 does not remove the legacy Windows agent tray/control page yet; that compatibility cleanup remains Phase 5. It also does not automatically launch `xdrive-agent`. When the agent is unavailable, Electron shows a disconnected state and allows the user to retry. This avoids accidentally starting duplicate Linux agents before Linux single-instance ownership is hardened.

## Development

```bash
cd desktop
npm install --no-audit --no-fund
npm run test:main
npm run build
npm start
```
