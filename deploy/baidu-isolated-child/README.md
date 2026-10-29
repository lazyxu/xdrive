# Optional independent Baidu map Child — immutable deployment inputs

The **only** xDrive Gallery UI/Owner/Viewer/Map presentation remains in the
trusted React Parent. The separate HTTPS Child runs the Baidu JavaScript SDK
and receives limited non-media geometry; it must not receive the Gallery
session, JWT, photo URLs, private Node IDs, or original GPS.

## Image payload

Starting with the associated Caddy image build, all three optional Child files
are packaged from the **same source commit as Web and Caddy**:

- `/usr/share/xdrive-baidu-isolated-child/index.html` — **unconfigured HTML template**
- `/usr/share/xdrive-baidu-isolated-child/child.js` — exact SDK Child logic
- `/usr/share/xdrive-baidu-isolated-child/child.css` — Child styling

They are intentionally **outside** Caddy's Gallery web root `/srv`. The
normal Gallery `Caddyfile`, docker-compose and HTTP service do **not** expose
them, add a Child virtual host, or change either host's Origin/CSP. The
`caddy-image` CI job verifies SHA-256 byte equality for all three source
files against the built image, and confirms Child files are absent from
Gallery's ordinary public paths.

This only ensures **the matching Child code is available for deployment**;
it is not automatic isolated-Child deployment, proof of a working Provider,
or evidence that an old separately hosted Child updated after a Server or
Gallery Caddy upgrade.

## Explicit independent deployment

To use the isolated alternative:

1. Keep the Child on an independently controlled HTTPS **site** that passes
   `node deploy/baidu-isolated-child/validate-site.mjs "$gallery_https_origin" "$child_https_origin"`
   (two trusted, distinct HTTPS site origins) and has a correctly
   scoped Host-only Gallery session. Follow `Caddyfile.example`; never import
   that host config into the Gallery site or expose `/api/*`.
2. From the **same published exact-SHA Caddy image** as the Server/Gallery,
   extract `child.js` and `child.css` into the independently managed Child
   static directory used by `Caddyfile.example`
   (`/srv/xdrive-baidu-isolated-child` inside that host). For an initial
   deployment, also extract the HTML *template* and substitute
   `REPLACE_WITH_TRUSTED_HTTPS_PARENT_ORIGIN` with the **verified exact
   Gallery HTTPS Origin** from trusted deployment configuration. Never derive
   this value from a request, browser query, or third-party SDK.
3. Verify the **deployed** Child's JS/CSS bytes equal the exact image assets,
   check the independent Origin, CSP/frame-ancestors, and map-only ticket
   endpoint, then reload that Child site. Updating only the Server, main Caddy
   or PWA is **not sufficient** for a previously deployed independent Child.
4. Keep the normal map's inline SDK alternative and static fallback intact;
   any Child deployment, DNS or token mismatch must fail closed.

To inspect the packaged copy without exposing it through the Gallery site
(example after an image has *actually* been published):

```sh
image=ghcr.io/lazyxu/xdrive-caddy:sha-REPLACE_WITH_PUBLISHED_COMMIT12
container=$(docker create "$image") || exit 1
docker cp "$container:/usr/share/xdrive-baidu-isolated-child/child.js" ./child.js
docker cp "$container:/usr/share/xdrive-baidu-isolated-child/child.css" ./child.css
docker rm "$container"
```

The template still requires an independently controlled Child host; copying
`child.js` to a local directory does **not** turn on the isolated SDK.

## Mouse-held pan patch

`#3161` revoked old Cell click authority immediately when pan started and
retained the last verified visual covers while the real mouse button was down.
The same 500-ms settled-camera query runs after release for both SDK Hosts.
Do not treat a Source PR merge or queued CI as a built/published/deployed
Docker image; check the running Server/Web **and Child** versions separately.
