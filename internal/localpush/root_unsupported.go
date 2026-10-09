//go:build !linux && !windows

package localpush

import (
	"fmt"
	"os"
)

func platformRootIdentity(_ string, _ os.FileInfo) (string, bool, error) {
	return "", false, fmt.Errorf("local root identity is not yet supported on this platform")
}
