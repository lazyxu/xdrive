//go:build windows

package mount

func cleanupPlatform(root string) error {
	return cfUnregister(root)
}
