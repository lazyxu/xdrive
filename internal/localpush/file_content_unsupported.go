//go:build !linux && !windows

package localpush

import (
	"errors"
	"os"
)

func openRootScopedRegularFile(_ RootGrant, _ string) (*os.File, error) {
	return nil, errors.New("verified native file reads are supported on Windows and Linux only")
}
