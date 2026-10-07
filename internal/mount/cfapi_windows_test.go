//go:build windows

package mount

import (
	"testing"
	"unsafe"
)

func TestWindowsHydrationBufferBoundedToRangeChunk(t *testing.T) {
	tests := []struct {
		name     string
		required int64
		want     int
	}{
		{name: "empty", required: 0, want: 0},
		{name: "small", required: 123, want: 123},
		{name: "one-gib", required: 1 << 30, want: int(windowsHydrationChunkSize)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf := newWindowsHydrationBuffer(tt.required)
			if len(buf) != tt.want {
				t.Fatalf("buffer len=%d want=%d", len(buf), tt.want)
			}
		})
	}
}

func TestCfapiStructLayouts64Bit(t *testing.T) {
	if unsafe.Sizeof(uintptr(0)) != 8 {
		t.Skip("layout assertions target 64-bit Windows")
	}
	checks := []struct {
		name      string
		got, want uintptr
	}{
		{"cfSyncRegistration", unsafe.Sizeof(cfSyncRegistration{}), 72},
		{"cfSyncPolicies", unsafe.Sizeof(cfSyncPolicies{}), 24},
		{"cfCallbackRegistration", unsafe.Sizeof(cfCallbackRegistration{}), 16},
		{"cfPlaceholderCreateInfo", unsafe.Sizeof(cfPlaceholderCreateInfo{}), 88},
		{"cfCallbackInfo", unsafe.Sizeof(cfCallbackInfo{}), 152},
		{"cfOperationInfo", unsafe.Sizeof(cfOperationInfo{}), 48},
		{"cfOperationParametersTransferData", unsafe.Sizeof(cfOperationParametersTransferData{}), 40},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s size=%d want=%d", c.name, c.got, c.want)
		}
	}
}
