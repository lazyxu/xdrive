# Android photo/video backup — durable Owner-scoped device registration

Draft P0 dependency for native Android auto backup. The existing Go Server
already admits \`platform=android\` **identity-only** device registrations, and
\`NativePhotoDeviceEnrollment.register\` performs the live Owner/Root proof
and returns the one-time registration token.

This store makes the real returned registration usable across app restarts:
- AndroidKeyStore AES-GCM, private committed preferences, independent key/AAD.
- Exact server origin, server-instance ID, Owner ID/name and Root node ID
  fence the stored identity. Root **revision** may change after upload.
- No raw MediaStore ID, URI, filename, photo bytes, password, access bearer,
  task record or Desktop Agent capability is persisted.
- A corrupted entry or lost Keystore key fails closed, never masquerades as
  a new device and **never** causes automatic POST re-enrollment. An existing
  different Owner or device registration requires explicit user reset/revoke.
- The credential alone does not authorize photo upload. A foreground or
  scheduled runner must verify the *current* live Owner and Root first.
- No scheduling, network heartbeat, consent UI or automatic registration
  is implemented by this storage component.

Physical Android instrumentation tests verify real sealed storage, Owner and
Server-instance isolation, restart retention, idempotent writes and
fail-closed corruption/Keystore loss. No device CI or Final Gate success
is claimed until this exact branch is tested.


### Live, read-only device self validation
A restored credential is never accepted solely from the Android Keystore. `verifyExisting()` first checks the exact current Owner and Root via authenticated `/me` and `/nodes/root`, then calls the existing read-only `/devices/self` endpoint with the **same** bearer plus private device ID and token headers. A mismatched ID, revoked token, owner switch, missing Server installation ID or logout after GET fails closed; it neither schedules an upload nor auto-POSTs another registration. JVM MockWebServer and Android instrumentation regressions cover these fences. No automatic backup is claimed.
