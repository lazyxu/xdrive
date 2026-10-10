package main

import "strings"

// explorerWindowState contains only a File Explorer top-level window handle and
// its caption. Native enumeration is Windows-only; selection is testable on any
// platform without opening a real window or changing the foreground.
type explorerWindowState struct {
	handle uintptr
	title  string
}

func explorerWindowTitleMatchesFolder(title, folder string) bool {
	title = strings.TrimSpace(title)
	folder = strings.TrimSpace(folder)
	if folder == "" || title == "" {
		return false
	}
	return strings.EqualFold(title, folder) ||
		(len(title) > len(folder)+3 && strings.EqualFold(title[:len(folder)], folder) && title[len(folder):len(folder)+3] == " - ")
}

// Prefer a window created by this particular /select launch. If Explorer
// reused a window, only activate it when its folder caption uniquely matches
// the target. Never bring an unrelated or ambiguous Explorer window forward.
func chooseExplorerWindowToActivate(before, after []explorerWindowState, folder string) uintptr {
	known := make(map[uintptr]struct{}, len(before))
	for _, window := range before {
		known[window.handle] = struct{}{}
	}
	newWindows := make([]explorerWindowState, 0, len(after))
	for _, window := range after {
		if window.handle == 0 {
			continue
		}
		if _, exists := known[window.handle]; !exists {
			newWindows = append(newWindows, window)
		}
	}
	if len(newWindows) == 1 {
		return newWindows[0].handle
	}
	candidates := after
	if len(newWindows) > 1 {
		candidates = newWindows
	}
	var match uintptr
	for _, window := range candidates {
		if window.handle == 0 || !explorerWindowTitleMatchesFolder(window.title, folder) {
			continue
		}
		if match != 0 {
			return 0 // ambiguous folder names: do not focus a random Explorer
		}
		match = window.handle
	}
	return match
}
