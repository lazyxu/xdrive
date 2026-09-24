# syntax=docker/dockerfile:1
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/xdrive-server ./cmd/server \
    && mkdir -p /out/data/.xdrive-uploads

FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/lazyxu/xdrive" \
      org.opencontainers.image.description="xDrive server" \
      org.opencontainers.image.version="$VERSION"
WORKDIR /app
COPY --from=build /out/xdrive-server /usr/local/bin/xdrive-server
COPY --from=build --chown=65532:65532 /out/data/ /data/
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/usr/local/bin/xdrive-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/xdrive-server"]
