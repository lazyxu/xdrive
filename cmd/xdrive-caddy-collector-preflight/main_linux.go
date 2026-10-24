//go:build linux

// The independent Collector preflight deliberately has NO signing, HTTP,
// Host deployment, privileged operation or public Applied endpoint.
package main

import (
	"fmt"
	"os"

	"github.com/lazyxu/xdrive/internal/caddyhostidentity"
)

func main() {
	if len(os.Args) != 1 || caddyhostidentity.CheckOperatorCollectorBootstrap() != nil {
		fmt.Fprintln(os.Stderr, "xDrive Caddy Collector: unverified (no Applied)")
		os.Exit(1)
	}
	fmt.Println("xDrive Caddy Collector: key preflight verified; Applied disabled")
}
