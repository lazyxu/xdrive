# syntax=docker/dockerfile:1
ARG CADDY_VERSION=2.10.2
FROM caddy:${CADDY_VERSION}-builder-alpine AS builder
RUN xcaddy build --with github.com/caddy-dns/alidns@c8c945ded9ace193e86f063842ba59981b35146b

FROM caddy:${CADDY_VERSION}-alpine
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/lazyxu/xdrive" \
      org.opencontainers.image.description="xDrive Caddy reverse proxy with AliDNS DNS-01 support" \
      org.opencontainers.image.version="$VERSION"
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
