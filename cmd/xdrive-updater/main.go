package main

import (
	"context"
	"flag"
	"log"
	"strings"

	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/version"
)

func main() {
	channelFlag := flag.String("channel", "", "update channel: stable, master, or commit")
	commitFlag := flag.String("commit", "", "commit SHA for the commit channel")
	flag.Parse()

	current := version.String()
	channel := strings.TrimSpace(*channelFlag)
	commit := strings.TrimSpace(*commitFlag)
	if channel == "" && commit != "" {
		channel = xupdate.ChannelCommit
	}

	var err error
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

	started, result, err := xupdate.InstallTargetWithProgress(context.Background(), current, channel, commit, func(event xupdate.ProgressEvent) {
		log.Print(xupdate.FormatProgress(event))
	})
	if err != nil {
		log.Printf("xDrive updater: %v", err)
		return
	}
	if !started {
		log.Printf("xDrive updater: %s is current on %s channel", current, channel)
		return
	}
	log.Printf("xDrive updater: installing %s from %s channel", result.Latest, channel)
}
