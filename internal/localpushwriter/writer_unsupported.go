//go:build !linux && !windows

package localpushwriter

import "os"

// Native first-file writing is currently supported on Linux and Windows only.
func lockNativeWriter(*os.File) error   { return ErrUnavailable }
func unlockNativeWriter(*os.File) error { return ErrUnavailable }
