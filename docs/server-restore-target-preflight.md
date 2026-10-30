# Server MVP: validate restore /data before maintenance

Previously server-restore.sh could stop a healthy Server/Worker and only
then discover a missing Docker /data bind directory, a deleted named volume,
an unsupported mount, or a backup stored *inside* the data to be replaced.
A subsequent Docker -v on a missing directory would create an empty
destination. This is not an acceptable first-response-to-failure or
a trustworthy restore target.

The recovery path now performs TWO independent read-only /data checks:
one before the optional safety backup, and one after it but before any service
stop, then verifies that the late maintenance-side resolved identity is the
same. Inspects existing Server container mounts without creating a new
container; falls back to exactly one legacy labelled volume if needed.
Rejects absent/symlinked bind roots, unsafe host root, unsupported mount
types, missing named volume, ambiguous fallback, and full v1/v2 source/live
directory overlap. Database-only operations do not trigger file-data
overlap rejection; their remaining existing mount requirement stays intact.

The existing Server restore preflights still require a bounded Manifest,
complete exact checksums, safe v1 tar headers, offline PostgreSQL TOC and,
for v2, the shared CAS lock and independent CAS verification. This new
target gate does NOT prove a production restore, does not automatically
roll back a partially changed DB, and does not replace the existing
safety backup or CAS/UploadSession receipts.

Executable regression: scripts/test-server-restore-target-preflight.sh
is run by scripts/test-server-v1-restore-preflight.sh inside the original
server-validation CI. It uses a fake Docker binary with no privileged
side effects; valid bind/volume paths reach its deliberately failing
mock PostgreSQL startup, while unsafe paths must be rejected before
pre-restore backup or any service start/stop. Existing Docker integration
backup/restore, installer rollback, security and Final Gate still apply.
