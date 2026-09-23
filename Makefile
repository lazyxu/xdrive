.PHONY: test build build-linux build-windows web-build compose-up compose-down fmt

test:
	go test ./...

fmt:
	gofmt -w ./cmd ./internal

build:
	go build ./cmd/server ./cmd/xd

build-linux:
	GOOS=linux GOARCH=amd64 go build -o dist/xd-linux-amd64 ./cmd/xd

build-windows:
	GOOS=windows GOARCH=amd64 go build -o dist/xd-windows-amd64.exe ./cmd/xd

web-build:
	cd web && npm install --no-audit --no-fund && npm run build

compose-up:
	docker compose -f deploy/docker-compose.yml up --build -d

compose-down:
	docker compose -f deploy/docker-compose.yml down
