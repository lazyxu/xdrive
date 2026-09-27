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
	channelFlag := flag.String("channel", "", "update channel: stable, master, or commit")
	commitFlag := flag.String("commit", "", "commit SHA for the commit channel")
	flag.Parse()

	current := version.String()
	source := strings.TrimSpace(*sourceFlag)
	channel := strings.TrimSpace(*channelFlag)
	commit := strings.TrimSpace(*commitFlag)
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
	if channel == "" && commit != "" {
		channel = xupdate.ChannelCommit
	}

	if channel == "" {
		channel, commit, err = xupdate.AutomaticTarget(current)
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
	if channel == xupdate.ChannelCommit && commit == "" {
		log.Printf("xDrive updater: commit channel requires --commit SHA or XD_UPDATE_COMMIT")
		return
	}

	started, result, err := xupdate.InstallTargetFromSourceWithProgress(context.Background(), current, channel, commit, source, func(event xupdate.ProgressEvent) {
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
