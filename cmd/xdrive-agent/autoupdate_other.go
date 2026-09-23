//go:build !windows

package main

import "context"

func startAutoUpdate(context.Context) <-chan struct{} {
	return nil
}
