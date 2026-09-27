//go:build !windows

package shellintegration

func RegisterExplorerActions(string) error { return nil }
func UnregisterExplorerActions() error     { return nil }
