//go:build !linux

package synologyui

import "errors"

// DSM package filesystem measurement is deliberately Linux-only.
type nasVolumeSpace struct {
	CapacityBytes  int64 `json:"capacity_bytes"`
	AvailableBytes int64 `json:"available_bytes"`
}

func readNASVolumeSpace(string) (nasVolumeSpace, error) {
	return nasVolumeSpace{}, errors.New("DSM package filesystem read requires Linux")
}
