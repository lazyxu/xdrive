//go:build !linux

package offlinebundle

import "errors"

func hostFilesystemFreeBytes(_ string) (uint64, error) {
	return 0, errors.New("Host filesystem probe is Linux-only")
}
