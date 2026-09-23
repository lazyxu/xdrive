//go:build windows

package main

import "testing"

func TestTrayCallbackEventLegacy(t *testing.T) {
	for _, event := range []uint32{
		trayWMLButtonUp,
		trayWMLButtonDbl,
		trayWMRButtonUp,
		trayWMContextMenu,
		trayNINSelect,
		trayNINKeySelect,
	} {
		if got := trayCallbackEvent(uintptr(event)); got != event {
			t.Fatalf("legacy event %#x decoded as %#x", event, got)
		}
	}
}

func TestTrayCallbackEventVersion4(t *testing.T) {
	const iconID = 0x37
	for _, event := range []uint32{
		trayWMLButtonUp,
		trayWMLButtonDbl,
		trayWMRButtonUp,
		trayWMContextMenu,
		trayNINSelect,
		trayNINKeySelect,
	} {
		lparam := uintptr(event) | (uintptr(iconID) << 16)
		if got := trayCallbackEvent(lparam); got != event {
			t.Fatalf("version-4 event %#x with icon id %#x decoded as %#x", event, iconID, got)
		}
	}
}
