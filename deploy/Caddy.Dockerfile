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
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/Caddyfile.http /etc/caddy/Caddyfile.http
COPY deploy/Caddyfile.common /etc/caddy/Caddyfile.common
COPY web/dist/ /srv/
