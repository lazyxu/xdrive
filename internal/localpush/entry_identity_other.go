//go:build !linux && !windows

package localpush

import (
	"errors"
	"os"
)

func platformEntryIdentity(_ string, _ os.FileInfo) (string, bool, uint64, error) {
	return "", false, 0, errors.New("native local entry identity is unsupported on this platform")
}
