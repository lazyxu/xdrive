package main

import (
	"context"
	"flag"
	"log"
	"strings"

	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/userconfig"
	"github.com/lazyxu/xdrive/internal/version"
)

func main() {
	sourceFlag := flag.String("source", "", "update source: github or gitlab")
	channelFlag := flag.String("channel", "", "update channel: stable or master")
	flag.Parse()

	current := version.String()
	source := strings.TrimSpace(*sourceFlag)
	channel := strings.TrimSpace(*channelFlag)
	var err error
	if source == "" {
		if prefs, prefsErr := userconfig.LoadUpdatePreferences(); prefsErr == nil {
			source = prefs.Source
		}
	}
	if source == "" {
		source, err = xupdate.AutomaticSource()
		if err != nil {
			log.Printf("xDrive updater: %v", err)
			return
		}
	} else {
		source, err = xupdate.NormalizeSource(source)
		if err != nil {
			log.Printf("xDrive updater: %v", err)
			return
		}
	}
	if channel == "" {
		channel, err = xupdate.AutomaticChannel(current)
		if err != nil {
			log.Printf("xDrive updater: %v", err)
			return
		}
	}
	if channel == "" {
		log.Printf("xDrive updater: %s has no automatic channel; use --channel master for development builds", current)
		return
	}
	channel, err = xupdate.NormalizeChannel(channel)
	if err != nil {
		log.Printf("xDrive updater: %v", err)
		return
	}
	started, result, err := xupdate.InstallTargetFromSourceWithProgress(context.Background(), current, channel, source, func(event xupdate.ProgressEvent) {
		log.Print(xupdate.FormatProgress(event))
	})
	if err != nil {
		log.Printf("xDrive updater: %v", err)
		return
	}
	if !started {
		log.Printf("xDrive updater: %s is current on %s channel via %s", current, channel, source)
		return
	}
	log.Printf("xDrive updater: install handoff accepted for %s from %s channel via %s", result.Latest, channel, source)
}
