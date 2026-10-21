# syntax=docker/dockerfile:1
ARG CADDY_VERSION=2.10.2
FROM caddy:${CADDY_VERSION}-builder-alpine AS builder
ARG GOPROXY=https://proxy.golang.org|direct
ARG GOSUMDB=sum.golang.org
# sum.golang.org occasionally resets long-lived HTTP/2 streams while xcaddy is
# resolving the AliDNS dependency graph. Force HTTP/1.1 for Go module traffic
# and retry the build in-place so the module cache is reused across attempts.
RUN set -eu; \
    attempt=1; \
    while [ "$attempt" -le 3 ]; do \
      if GODEBUG=http2client=0 GOPROXY="${GOPROXY}" GOSUMDB="${GOSUMDB}" \
        xcaddy build --with github.com/caddy-dns/alidns@c8c945ded9ace193e86f063842ba59981b35146b; then \
        exit 0; \
      fi; \
      if [ "$attempt" -eq 3 ]; then \
        echo "xcaddy build failed after $attempt attempts" >&2; \
        exit 1; \
      fi; \
      echo "xcaddy build attempt $attempt failed; retrying with cached modules..." >&2; \
      sleep $((attempt * 5)); \
      attempt=$((attempt + 1)); \
    done

FROM caddy:${CADDY_VERSION}-alpine
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/lazyxu/xdrive" \
      org.opencontainers.image.description="xDrive Web + Caddy edge with AliDNS DNS-01 support" \
      org.opencontainers.image.version="$VERSION"
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Caddy's upstream final image may retain cap_net_bind_service=+ep on this
# executable. A capability-dumb file cannot exec with cap_drop=ALL (EPERM),
# even on rescue's unprivileged :8080. Strip the unnecessary file capability
# after COPY; the existing root-run primary Caddy binds 80/443 with Docker's
# normal process capabilities. Do not weaken the nonroot rescue sandbox.
RUN setcap -r /usr/bin/caddy && test -z "$(getcap /usr/bin/caddy)"
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/Caddyfile.lan-ip /etc/caddy/Caddyfile.lan-ip
COPY deploy/Caddyfile.lan-only /etc/caddy/Caddyfile.lan-only
COPY deploy/caddy-lan-start.sh /usr/local/bin/xdrive-caddy-start
COPY deploy/Caddyfile.http /etc/caddy/Caddyfile.http
COPY deploy/Caddyfile.rescue /etc/caddy/Caddyfile.rescue
COPY deploy/Caddyfile.common /etc/caddy/Caddyfile.common
COPY web/dist/ /srv/
# Main Caddy overlays /srv/assets; rescue keeps the image-baked copy.
COPY web/dist/assets/ /usr/share/xdrive-current-assets/
COPY deploy/pwa-archive-assets.sh /usr/local/bin/xdrive-pwa-archive-assets
RUN chmod 0755 /usr/local/bin/xdrive-pwa-archive-assets

# A bare IP URL normally sends no SNI. Caddy 2.10.2 must emit a real
# TLS connection policy with default_sni for BOTH IP-only and dual modes,
# not merely parse a Caddyfile that later fails during a TLS handshake.
RUN chmod 0755 /usr/local/bin/xdrive-caddy-start && \
    XD_DOMAIN=drive.example.com XD_LAN_HTTPS_IP=192.168.2.4 \
    caddy adapt --config /etc/caddy/Caddyfile.lan-ip --adapter caddyfile --pretty \
      > /tmp/xdrive-lan-ip-adapted.json && \
    grep -Fq '"default_sni": "192.168.2.4"' /tmp/xdrive-lan-ip-adapted.json && \
    grep -Fq '"tls_connection_policies"' /tmp/xdrive-lan-ip-adapted.json && \
    XD_LAN_HTTPS_IP=192.168.2.4 \
    caddy adapt --config /etc/caddy/Caddyfile.lan-only --adapter caddyfile --pretty \
      > /tmp/xdrive-lan-only-adapted.json && \
    grep -Fq '"default_sni": "192.168.2.4"' /tmp/xdrive-lan-only-adapted.json && \
    grep -Fq '"tls_connection_policies"' /tmp/xdrive-lan-only-adapted.json && \
    rm -f /tmp/xdrive-lan-ip-adapted.json /tmp/xdrive-lan-only-adapted.json
