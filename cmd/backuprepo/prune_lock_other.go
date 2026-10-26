//go:build !linux

package main

import "errors"

func acquirePruneLock(repo string) (func(), error) {
	return nil, errors.New("manual v2 prune is supported only in the Linux Server container")
}
