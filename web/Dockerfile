# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY ui/shared/ /app/ui/shared/
RUN npm run build

FROM nginx:1.27-alpine
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/lazyxu/xdrive" \
      org.opencontainers.image.description="xDrive Web UI" \
      org.opencontainers.image.version="$VERSION"
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
