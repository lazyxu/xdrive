package mount

func Cleanup(root string) error {
	return cleanupPlatform(root)
}
