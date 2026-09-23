.PHONY: test fmt build build-linux-client build-windows-binaries web-build server-install

test:
	go test ./...

fmt:
	gofmt -w ./cmd ./internal

build:
	go build ./cmd/server ./cmd/xd ./cmd/xdrive-agent ./cmd/xdrive-updater

build-linux-client:
	bash scripts/build-linux-deb.sh 0.0.0+dev dist

build-windows-binaries:
	GOOS=windows GOARCH=amd64 go build -o dist/xd.exe ./cmd/xd
	GOOS=windows GOARCH=amd64 go build -ldflags="-H=windowsgui" -o dist/xdrive-agent.exe ./cmd/xdrive-agent

web-build:
	cd web && npm ci --no-audit --no-fund && npm run build

server-install:
	bash deploy/install-server.sh
