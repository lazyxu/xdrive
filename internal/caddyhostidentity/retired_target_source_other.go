//go:build !linux

package caddyhostidentity

import "time"

func privateReadHostRetiredTargets(string, string, privateHostAuthoritySnapshot, string, string,
	time.Time) (privateRetiredTargets, error) {
	return privateRetiredTargets{}, errUntrusted
}
