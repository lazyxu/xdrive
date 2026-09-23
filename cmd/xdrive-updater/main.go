package main

import (
	"context"
	"log"

	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/version"
)

func main() {
	current := version.String()
	if !xupdate.IsReleaseVersion(current) {
		log.Printf("xDrive updater: %s is not a stable release build; skipping", current)
		return
	}
	started, result, err := xupdate.InstallLatest(context.Background(), current)
	if err != nil {
		log.Printf("xDrive updater: %v", err)
		return
	}
	if !started {
		log.Printf("xDrive updater: %s is current", current)
		return
	}
	log.Printf("xDrive updater: installing %s", result.Latest)
}
