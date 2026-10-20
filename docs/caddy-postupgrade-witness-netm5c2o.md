# NET-M5-C2-O · Server-visible Caddy witness handoff after official upgrade

The operator's preexisting Caddy can already serve HTTPS, while System Dependencies reports a missing Host Control snapshot. Prior merged #2155, #2161 and #2171 repair the observer and legacy host import, but the installer still finishes without verifying the **running Server's** /host-control mount. The exact old diagnostic string also indicates the production Server may not yet run the new release; a GitHub merge never upgrades physical hardware.

**Read-only check:** `xdrive-server caddy-host witness-check` reads the same sanitized, fresh Host Control JSON and heartbeat as the admin Server API, requiring internal gateway health plus every locally enabled HTTPS TLS identity (domain digest or LAN IP SAN). It returns an allowlisted reason, without Docker control, SQL, keyring, DNS, CA export, secrets or outbound traffic. Local result does not prove WAN availability, device CA trust, or a signed applied desired revision.

After installer Host Control bootstrap, the trusted host checks this CLI in the **running Server container** with bounded retries. Failure prints a prominent warning and leaves the already working Caddy unchanged. `xdrive-server doctor` reports the same strict local witness using only known sanitized reason codes, helping distinguish missing heartbeat, snapshot, outdated Server CLI, mount mismatch, and local TLS uncertainty. No Web/Mobile Web/Desktop API divergence.

Production acceptance still requires operator upgrade and physical Server mount, Host Control, real domain/LAN TLS and external-device login checks. Future NET-M5 issue #2075 controls Rescue/Host Apply/rollback; this change does not expose Caddy Apply or remove `apply_supported=false`.
