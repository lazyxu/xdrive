.PHONY: test fmt build icons build-linux-client build-windows-binaries web-build server-install

test:
	go test ./...

fmt:
	gofmt -w ./cmd ./internal

build:
	go build ./cmd/server ./cmd/xd ./cmd/xdrive-agent ./cmd/xdrive-updater

icons:
	node scripts/generate-icon-assets.mjs

build-linux-client:
	bash scripts/build-linux-deb.sh 0.0.0+dev dist

build-windows-binaries:
	GOOS=windows GOARCH=amd64 go build -o dist/xd.exe ./cmd/xd
	go run github.com/tc-hib/go-winres@v0.3.3 make --in packaging/windows/xdrive-agent-winres.json --arch amd64 --out cmd/xdrive-agent/rsrc
	GOOS=windows GOARCH=amd64 go build -ldflags="-H=windowsgui" -o dist/xdrive-agent.exe ./cmd/xdrive-agent; status=$?; rm -f cmd/xdrive-agent/rsrc_windows_amd64.syso; exit $status

web-build:
	cd web && npm ci --no-audit --no-fund && npm run build

server-install:
	bash deploy/install-server.sh
