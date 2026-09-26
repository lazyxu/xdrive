//go:build !linux

package sourceagent

import (
	"fmt"
	"os"
)

func fileExternalID(rootKey string, info os.FileInfo) (string, error) {
	_ = rootKey
	_ = info
	return "", fmt.Errorf("native source scanning is supported on Linux only")
}
