package sourceagent

import "testing"

func TestParseLegacyRootIdentity(t *testing.T) {
	device, inode, ok := ParseLegacyRootIdentity("shared", "fs:shared:123:456")
	if !ok || device != 123 || inode != 456 {
		t.Fatalf("parse=(%d,%d,%t)", device, inode, ok)
	}
	for _, value := range []string{
		"",
		"fs:personal:123:456",
		"fs:shared:not-a-number:456",
		"fs:shared:123:not-a-number",
		"fs:shared:123:456:extra",
		"fs2:shared:123:456",
	} {
		if _, _, ok := ParseLegacyRootIdentity("shared", value); ok {
			t.Fatalf("invalid legacy root identity accepted: %q", value)
		}
	}
}
