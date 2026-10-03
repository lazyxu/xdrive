# syntax=docker/dockerfile:1
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot
FROM golang:1.25-bookworm AS build
ARG VERSION=dev
ARG BUILD_CHANNEL=dev
ARG BUILD_COMMIT=
ARG BUILD_COMMIT_MESSAGE_B64=
ARG BUILD_COMMIT_TIME=
ARG BUILD_TIME=
ARG GOPROXY=https://proxy.golang.org|direct
ARG GOSUMDB=sum.golang.org
WORKDIR /src
COPY go.mod go.sum ./
RUN GOPROXY="${GOPROXY}" GOSUMDB="${GOSUMDB}" go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -tags=nodynamic -trimpath \
    -ldflags="-s -w -X github.com/lazyxu/xdrive/internal/version.Version=$VERSION -X github.com/lazyxu/xdrive/internal/version.Channel=$BUILD_CHANNEL -X github.com/lazyxu/xdrive/internal/version.Commit=$BUILD_COMMIT -X github.com/lazyxu/xdrive/internal/version.CommitMessageBase64=$BUILD_COMMIT_MESSAGE_B64 -X github.com/lazyxu/xdrive/internal/version.CommitTime=$BUILD_COMMIT_TIME -X github.com/lazyxu/xdrive/internal/version.BuildTime=$BUILD_TIME" \
    -o /out/xdrive-server ./cmd/server \
    && mkdir -p /out/data/.xdrive-uploads

FROM ${RUNTIME_IMAGE}
ARG VERSION=dev
ARG BUILD_COMMIT=
ARG BUILD_TIME=
LABEL org.opencontainers.image.source="https://github.com/lazyxu/xdrive" \
      org.opencontainers.image.description="xDrive server" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$BUILD_COMMIT" \
      org.opencontainers.image.created="$BUILD_TIME"
WORKDIR /app
COPY --from=build /out/xdrive-server /usr/local/bin/xdrive-server
COPY --from=build --chown=65532:65532 /out/data/ /data/
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/usr/local/bin/xdrive-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/xdrive-server"]
