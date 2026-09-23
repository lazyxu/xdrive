//go:build windows

package mount

import (
	"testing"
	"unsafe"
)

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
		{"cfOperationTransferData", unsafe.Sizeof(cfOperationTransferData{}), 40},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s size=%d want=%d", c.name, c.got, c.want)
		}
	}
}
