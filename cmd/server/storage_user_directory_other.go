//go:build !linux

package main

import "fmt"

func runStorageRepairUserDirectories(args []string) error {
	return fmt.Errorf("storage repair-user-directories is supported only on Linux")
}
