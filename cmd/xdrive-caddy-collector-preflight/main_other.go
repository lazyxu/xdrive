//go:build !linux

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "xDrive Caddy Collector: unsupported platform (no Applied)")
	os.Exit(1)
}
