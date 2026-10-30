# Android photo backup: verified-only large incremental index (Draft)

This is the **completed side only** of the Android original photo/video MVP.
It does not schedule scans or send bytes. The previously merged
\`NativePhotoBackupLedger\` (128 encrypted intents) remains authoritative for
all planned, MAY_HAVE_SENT and UNKNOWN_ACK operations. Missing a completed
row is **not** permission to upload again until the intent ledger is checked.

The SQLite table is a fixed-schema, primary-key indexed receipt record with
one row per Owner/Server installation/Device/asset/resource, storing only
hashes, resource/version, size, verified Node ID/revision and original SHA-256.
It never persists raw MediaStore IDs/URIs, path, filename, token, location,
album or media bytes. Its Owner scope includes canonical HTTPS origin,
installation ID, Owner ID, username, root Node ID, and Android device ID.
Root revision is **not** a scope key, because directory revisions can change
when files are added.

**Recording policy:** only a \`NativePhotoBackupIntent\` with phase VERIFIED
and an exact Node receipt may be inserted, after the separate ledger's
\`acknowledgeVerified\`. Changed versions replace only the same
Owner/device/asset/resource row. SQLite transactions atomically persist the
receipt and total count; hard quota 250,000 rows fails closed rather than
evicting another Owner or unconfirmed upload. SQLite is stored in app-private
storage (Android application backup is disabled).

**Instrumentation:** restart persistence, Owner/device/Server isolation,
root revision stability, version change, unmatched resource, idempotence,
MAY_HAVE_SENT denial and full-quota failure. No emulator result or 100k
performance is claimed until exact-HEAD Android CI. No new writer, worker,
screen, background grant or unsafe retry.
