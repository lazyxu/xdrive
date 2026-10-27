# Administrator backup verification evidence

The shared Web/Desktop Admin UI renders only Host-signed-off, bounded
`xdrive-host-backup-verify-v1` receipt fields. The receipt records actual
referenced CAS object/byte checks and safe category codes without raw paths.
A legacy history entry lacking the optional structured receipt stays readable
without invented zeros. A v1 archive has no repository CAS objects (its backup
files are instead checked via SHA256SUMS), and a failed v2 pass reports partial
counts. An individual CAS receipt may have state=success even when the overall
administrator deep verification fails at a later repository-wide step. The
shared UI explicitly calls out the overall failure instead of a green pass.
Neither a successful historical verification nor a checksum report
claims that PostgreSQL and file data have been physically restored.

The `XDriveBackupVerificationReceipt` shared component is used for the
verification detail view after the merged shared UI prerequisite #2835.
Do not create a competing Desktop, Web, Synology or DSM implementation.
