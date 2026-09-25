//go:build windows

package mount

func repairSyncRootPlatform(root string) error {
	_ = cfUnregister(root)
	return cfRegister(root)
}
