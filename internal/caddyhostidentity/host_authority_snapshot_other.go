//go:build !linux

package caddyhostidentity

import "context"

func privateRunFixedHostSnapshot(context.Context, string) ([]byte, error) { return nil, errUntrusted }

func privateRunFencedHostSnapshot(context.Context, string) ([]byte, string, error) {
	return nil, "", errUntrusted
}
