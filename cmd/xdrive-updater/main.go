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
	channelFlag := flag.String("channel", "", "update channel: stable or master")
	flag.Parse()

	current := version.String()
	channel := strings.TrimSpace(*channelFlag)
	var err error
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

	started, result, err := xupdate.InstallChannel(context.Background(), current, channel)
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
