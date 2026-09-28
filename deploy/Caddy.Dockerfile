# syntax=docker/dockerfile:1
ARG CADDY_VERSION=2.10.2
FROM caddy:${CADDY_VERSION}-builder-alpine AS builder
ARG GOPROXY=https://proxy.golang.org|direct
ARG GOSUMDB=sum.golang.org
RUN GOPROXY="${GOPROXY}" GOSUMDB="${GOSUMDB}" xcaddy build --with github.com/caddy-dns/alidns@c8c945ded9ace193e86f063842ba59981b35146b

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
