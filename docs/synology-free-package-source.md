# xDrive DSM 7: free Package Center source

This is a **third-party** package source, not Synology's official store. It
needs no paid listing or Synology developer certificate. Deploying the source
on Cloudflare Workers requires a **free Cloudflare account and an API token**;
a custom domain is optional.

## Architecture

- The existing GitHub Publish Packages gate builds and verifies the exact
  ARMv7 xdrivenas SPK, its shared DSM MUI, version and SHA256.
- Verified SPK and .spk.sha256 are stored in immutable GitHub Releases named
  dsm-edge-<full-source-SHA> or dsm-stable-<full-source-SHA>.
  Later publications never overwrite an existing version's bytes.
- A separate channel Release, dsm-edge-feed or dsm-stable-feed, contains only
  catalog.json with immutable URL, package version, source SHA, SHA256, MD5,
  size and target architecture. A lower version, duplicate identity with
  changed bytes, invalid artifact digest or stale master publisher is rejected.
- A tiny HTTPS Cloudflare Worker implements the POST/GET /nas/ protocol that
  DSM Package Center expects. It fetches the fixed channel feed, validates
  the catalog and advertises only armada38x DSM 7 (minimum build 40759).
  Missing stable packages produce an empty list; broken metadata produces
  503 rather than a fabricated update.
- No NAS data, credentials, upload tokens or xDrive account details reach the
  Worker. The NAS's original Agent remains the only backup writer.

## One-time free deployment

1. Open Cloudflare, create a free account and enable your workers.dev subdomain.
2. Create an account-limited Workers deployment API token. Add the GitHub
   repository secrets CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
   Never put the token in a GitHub Issue or an unencrypted configuration file.
3. In GitHub Actions, manually run **Deploy free DSM Package Center source**
   from reviewed master. It first runs the unit tests; missing credentials
   cause an explicit failed check rather than a fake deployment.
4. Read the final Wrangler deployment URL from the job output and confirm
   its /healthz endpoint responds with a valid JSON status.

Add one of these sources to DSM Package Center > Settings > Package Sources:

- **Stable (recommended)**:
  https://xdrive-dsm-packages.<your-workers-subdomain>.workers.dev/
  Only verified v* release packages appear. Before a first stable release,
  this feed intentionally contains no package.
- **Master / Edge (opt-in)**:
  https://xdrive-dsm-packages.<your-workers-subdomain>.workers.dev/edge
  This offers verified rolling snapshot updates, which may change frequently.

Do not register both channels for one installed xdrivenas package. For a
manual diagnostic POST:

    curl -fsS -X POST \
      -d 'arch=armada38x&build=64570&major=7&minor=2&language=enu' \
      'https://xdrive-dsm-packages.<your-workers-subdomain>.workers.dev/edge/nas/'

After the first compatible SPK appears in Community, install it once.
When a higher DSM package version is released, Package Center can display it
under Updates. To opt into unattended updates, enable Auto-update for this
package in Package Center Settings **only if DSM permits it**.

## Guarantees and limitations

- The Publisher only runs after normal GitHub Release checks. Edge feed
  promotion rechecks the published Snapshot SHA. Stable promotion only runs
  after the existing full v* Final Gate.
- The package already has silent_upgrade=yes, a graceful bounded Agent stop,
  persistent DSM FHS home/var directories and idempotent backup receipts.
  This does not guarantee no interruption on an arbitrary forced DSM shutdown.
- DSM 7 will warn about third-party packages. Some packages have a disabled
  Auto-update checkbox even if silent_upgrade=yes, and this project does not
  override Package Center policy or invent a root-level auto-installer.
- Only armada38x/ARMv7 DSM 7 is supported by the current SPK.
- The source code, CI passing, and published GitHub artifacts alone do not
  establish that the Cloudflare Worker has been deployed or that a physical
  DSM has accepted an unattended upgrade. Without a configured Cloudflare
  account and NAS this remains **跳过（未验收）**.
- The Worker does not need Cloudflare R2 or paid hosting; GitHub Releases
  hosts the SPK files. Respect hosting providers' free-tier quotas.
