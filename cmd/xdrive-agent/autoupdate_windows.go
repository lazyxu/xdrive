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
	if strings.TrimSpace(os.Getenv("XD_DISABLE_AUTO_UPDATE")) == "1" {
		return ch
	}
	channel, commit, err := xupdate.AutomaticTarget(version.String())
	if err != nil {
		log.Printf("auto-update channel: %v", err)
		return ch
	}
	if channel == "" {
		return ch
	}
	go func() {
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
			started, result, err := xupdate.InstallTargetWithProgress(ctx, version.String(), channel, commit, func(event xupdate.ProgressEvent) {
				log.Print(xupdate.FormatProgress(event))
			})
			if err != nil {
				log.Printf("auto-update check (%s) failed: %v", channel, err)
				continue
			}
			if started {
				log.Printf("update %s from %s channel verified; installer started", result.Latest, channel)
				ch <- struct{}{}
				return
			}
		}
	}()
	return ch
}
