//go:build !windows

package mount

import "fmt"

func keepLocalPlatform(string) error { return fmt.Errorf("file availability controls require Windows CfAPI") }
func releaseSpacePlatform(string) error { return fmt.Errorf("file availability controls require Windows CfAPI") }
func onlineOnlyPlatform(string) error { return fmt.Errorf("file availability controls require Windows CfAPI") }
func availabilityPlatform(path string) (FileAvailability, error) {
	return FileAvailability{Path: path}, fmt.Errorf("file availability controls require Windows CfAPI")
}
func requestSyncPlatform(string) bool { return false }
