package mount

func RepairSyncRoot(root string) error {
	return repairSyncRootPlatform(root)
}
