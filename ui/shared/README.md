# xDrive shared UI

This directory contains platform-neutral UI contracts that are shared by the Web client today and can be reused by the Electron desktop client later.

Keep host-specific concerns out of this layer:

- no browser token persistence or `localStorage`;
- no xDrive HTTP transport implementation;
- no Electron IPC or Node APIs;
- no Windows/Linux filesystem integration.

Shared server DTOs, presentation helpers, and later host-neutral React components belong here.
