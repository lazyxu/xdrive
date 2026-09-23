//go:build windows

package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/version"
)

func startAutoUpdate(ctx context.Context) <-chan struct{} {
	ch := make(chan struct{}, 1)
	if strings.TrimSpace(os.Getenv("XD_DISABLE_AUTO_UPDATE")) == "1" || !xupdate.IsReleaseVersion(version.String()) {
		return ch
	}
	go func() {
		// Avoid competing with mount initialization during login.
		timer := time.NewTimer(90 * time.Second)
		defer timer.Stop()
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			case <-ticker.C:
			}
			started, result, err := xupdate.InstallLatest(ctx, version.String())
			if err != nil {
				log.Printf("auto-update check failed: %v", err)
				continue
			}
			if started {
				log.Printf("update %s verified; installer started", result.Latest)
				ch <- struct{}{}
				return
			}
		}
	}()
	return ch
}
