//go:build !linux && !windows

package localpush

import (
	"fmt"
	"os"
)

func platformNativeItemIdentity(_ string, _ os.FileInfo) (nativeItemObject, error) {
	return nativeItemObject{}, fmt.Errorf("local file identity is not supported on this platform")
}
