# Desktop login identity/route password isolation

Source-confirmed gap: the freeSolo server and username text inputs in `App.tsx` directly updated the identity without running the saved-profile selector, leaving the old password typed into the next Server/Owner. Manual LAN-IP edits had the same route-safety gap, and the saved-password flag did not check the route.

- Server, username or optional LAN-IP edits now clear the transient password and prior account's persistence toggles.
- Selecting an existing saved profile may explicitly restore that profile's own remember/autologin toggles, never a previous profile's typed password.
- The encrypted saved password is eligible only when the current Server/username and chosen LAN IP match the profile's stored route.
- A failed authentication with an **unchanged** Server, username and LAN IP still retains the entered password for immediate correction/retry.
- This does not modify Electron safeStorage, Go Agent, HTTPS validation, persisted ciphertext or backup tasks.

Exact-HEAD Desktop TypeScript and source-callback regression tests plus full PR CI/Final Gate are required.
